-- LP snapshots — append-only history of league_entries. Built up over time
-- by every league_entries upsert (via the worker hook) + the periodic
-- pollLpSnapshots aggregator. Lets us reconstruct per-match LP deltas by
-- locating snapshots before/after a match's gameCreation timestamp.
--
-- Keyed by (puuid, queueType, recordedAt) so multiple snapshots per puuid+
-- queue are kept. recorded_at is a real timestamp (not date) so the worker
-- can poll every few minutes.

CREATE TABLE IF NOT EXISTS "lp_snapshots" (
  "puuid"          text                     NOT NULL,
  "queue_type"     text                     NOT NULL,
  "tier"           text                     NOT NULL,
  "rank"           text                     NOT NULL DEFAULT '',
  "league_points"  integer                  NOT NULL,
  "wins"           integer                  NOT NULL DEFAULT 0,
  "losses"         integer                  NOT NULL DEFAULT 0,
  "recorded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("puuid", "queue_type", "recorded_at")
);

-- Lookup by puuid + queueType ordered by time desc — used to find the
-- snapshot pair straddling a given match's gameCreation timestamp.
CREATE INDEX IF NOT EXISTS "lp_snap_puuid_q_time_idx"
  ON "lp_snapshots" ("puuid", "queue_type", "recorded_at" DESC);

-- For the polling aggregator: pick puuids whose latest LEAGUE-V4 fetch is
-- stale. We track "last polled" via the existing league_entries.refreshed_at;
-- this index supports the LIMIT N ORDER BY refreshed_at ASC query.
CREATE INDEX IF NOT EXISTS "league_entries_refreshed_solo_idx"
  ON "league_entries" ("refreshed_at" ASC)
  WHERE queue_type = 'RANKED_SOLO_5x5';
