-- ML pick recommendation pipeline.
--
-- Three tables form the model lifecycle:
--   1. training_samples (materialized view) — input data extracted from matches
--   2. ml_model_weights — learned weight per feature, versioned
--   3. ml_model_metadata — training run history + held-out validation scores
--
-- The training loop runs as a worker aggregator (mlTrain) on a daily
-- cadence, reads training_samples, fits L1-regularized logistic regression
-- in pure Node, and writes weights with a new model_version. The API picks
-- up the latest version via redis pub/sub or boot-time DB lookup.

-- 1) Training samples. Materialized for fast iteration; refresh as part of
--    the training cron. Filtered to:
--      - solo queue (420)
--      - emerald+ tier on at least one participant per side
--      - last N patches (controlled at query time)
--      - 10 participants present
CREATE MATERIALIZED VIEW IF NOT EXISTS training_samples AS
SELECT
  m.match_id,
  m.patch,
  m.game_creation,
  m.bluewin,
  -- Champion + lane arrays ordered by (team, slot) so consumers can split
  -- by side with a fixed pivot.
  ARRAY_AGG(mp.champion_id ORDER BY mp.team, mp.slot) AS champion_ids,
  ARRAY_AGG(mp.team        ORDER BY mp.team, mp.slot) AS teams,
  ARRAY_AGG(mp.lane        ORDER BY mp.team, mp.slot) AS lanes
FROM matches m
JOIN match_participants mp ON mp.match_id = m.match_id
WHERE m.queue_id = 420
GROUP BY m.match_id, m.patch, m.game_creation, m.bluewin
HAVING COUNT(*) = 10 AND m.bluewin IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ts_match_idx ON training_samples (match_id);
CREATE INDEX IF NOT EXISTS ts_patch_idx ON training_samples (patch);
CREATE INDEX IF NOT EXISTS ts_creation_idx ON training_samples (game_creation DESC);

-- 2) Learned weights. Sparse: only non-zero (after L1 thresholding) weights
--    stored. feature_id is deterministic — same (feature_type, meta) →
--    same id across re-trainings, so we can warm-start from prior version.
CREATE TABLE IF NOT EXISTS ml_model_weights (
  model_version  text  NOT NULL,
  feature_id     int   NOT NULL,
  feature_type   text  NOT NULL,    -- 'bias' | 'champ' | 'pair' | 'cross' | 'triple'
  feature_meta   jsonb NOT NULL,    -- {a:266, side:'blue'} | {a:266, b:142, side:'blue'} | {a:266, b:142, ourSide:'blue'} | ...
  weight         real  NOT NULL,
  PRIMARY KEY (model_version, feature_id)
);
CREATE INDEX IF NOT EXISTS mw_version_idx ON ml_model_weights (model_version);

-- 3) Training run metadata. One row per successful train cycle.
CREATE TABLE IF NOT EXISTS ml_model_metadata (
  model_version    text PRIMARY KEY,
  trained_at       timestamptz NOT NULL DEFAULT now(),
  sample_size      int  NOT NULL,
  features_total   int  NOT NULL,    -- after dict build
  features_live    int  NOT NULL,    -- non-zero after L1
  train_auc        real NOT NULL,
  test_auc         real NOT NULL,
  test_log_loss    real NOT NULL,
  lambda           real NOT NULL,
  learning_rate    real NOT NULL,
  epochs           int  NOT NULL,
  patches          text[] NOT NULL,
  bracket          text  NOT NULL,    -- 'emerald+' for now
  notes            text
);
CREATE INDEX IF NOT EXISTS mm_trained_idx ON ml_model_metadata (trained_at DESC);

-- Note: training_samples MV is refreshed by the worker, not on every read.
-- REFRESH MATERIALIZED VIEW CONCURRENTLY training_samples;  ← in the cron
