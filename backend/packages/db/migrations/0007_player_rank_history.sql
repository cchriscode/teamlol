-- Daily snapshot of league_entries → drives tier progression dots +
-- LP trend chart on summoner overview. One row per (puuid, queue, day).
CREATE TABLE IF NOT EXISTS "player_rank_history" (
  "puuid"         text NOT NULL,
  "queue_type"    text NOT NULL,
  "snapshot_date" date NOT NULL,
  "tier"          text NOT NULL,
  "rank"          text NOT NULL,                  -- 'I' | 'II' | 'III' | 'IV'
  "lp"            integer NOT NULL,
  "wins"          integer NOT NULL,
  "losses"        integer NOT NULL,
  "captured_at"   timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("puuid", "queue_type", "snapshot_date")
);
CREATE INDEX IF NOT EXISTS "prh_puuid_date_idx"
  ON "player_rank_history" ("puuid", "snapshot_date" DESC);
