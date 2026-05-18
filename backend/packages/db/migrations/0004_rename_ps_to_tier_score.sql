-- Rename ps_score → tier_score (and same for tier_snapshots).
-- The old name leaked the lol.ps brand; ours is just "tier score".
DROP INDEX IF EXISTS "cs_bracket_lane_idx";
ALTER TABLE "champion_stats"  RENAME COLUMN "ps_score" TO "tier_score";
ALTER TABLE "tier_snapshots" RENAME COLUMN "ps_score" TO "tier_score";
CREATE INDEX IF NOT EXISTS "cs_bracket_lane_idx"
  ON "champion_stats" ("bracket", "lane", "tier_score");
