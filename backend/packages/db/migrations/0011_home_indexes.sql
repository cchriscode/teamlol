-- Home page performance: three indexes that close gaps the schema's
-- composite primary keys leave open for these specific scan patterns.

-- /api/home/trending-champions does a CTE with
--   WHERE bracket = 'diamond+' GROUP BY patch ORDER BY SUM(games) DESC
-- The champion_stats PK leads with `patch`, not `bracket`, so this
-- degenerates into a full bracket scan across every patch we've stored.
CREATE INDEX IF NOT EXISTS "cs_bracket_patch_idx"
  ON "champion_stats" ("bracket", "patch");

-- Same route's `prev` CTE pulls
--   WHERE bracket = 'diamond+' AND snapshot_date < CURRENT_DATE - 2
--   ORDER BY snapshot_date DESC LIMIT 200
-- tier_snapshots PK leads with `snapshot_date`, so bracket filtering is
-- post-scan. A bracket-leading index lets the planner narrow first then
-- use the trailing date column for the range + ORDER BY.
CREATE INDEX IF NOT EXISTS "ts_bracket_date_desc_idx"
  ON "tier_snapshots" ("bracket", "snapshot_date" DESC);

-- /api/home/coverage does MAX(ingested_at) on matches; without an index
-- this is a sequential scan over ~1.5M rows. A descending index turns it
-- into an index-only lookup of the first row.
CREATE INDEX IF NOT EXISTS "matches_ingested_at_desc_idx"
  ON "matches" ("ingested_at" DESC);
