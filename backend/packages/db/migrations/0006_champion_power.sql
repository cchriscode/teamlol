-- Champion power curve — winrate bucketed by game duration.
-- Drives the "파워 그래프" on champion detail pages.
CREATE TABLE IF NOT EXISTS "champion_power" (
  "patch"       text    NOT NULL,
  "bracket"     text    NOT NULL,
  "lane"        text    NOT NULL,
  "champion_id" integer NOT NULL,
  "bucket"      text    NOT NULL,            -- 'short' | 'mid_short' | 'mid' | 'mid_long' | 'long'
  "min_minute"  integer NOT NULL,
  "max_minute"  integer NOT NULL,            -- inclusive lower, exclusive upper; null max = infinity
  "games"       integer NOT NULL,
  "wins"        integer NOT NULL,
  "wr"          real    NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("patch", "bracket", "lane", "champion_id", "bucket")
);
