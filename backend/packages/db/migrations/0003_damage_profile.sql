ALTER TABLE "champion_stats"
  ADD COLUMN IF NOT EXISTS "ap_share" real,
  ADD COLUMN IF NOT EXISTS "ad_share" real;
