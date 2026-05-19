-- Performance indexes from site-wide efficiency audit (P2 batch).

-- 1) Covering partial index for the player_tier CTE pattern used by
--    tier/dmgProfile/matchup/synergy/botDuo/copick/chPower aggregators.
--    Every aggregator scans league_entries with WHERE queue_type='RANKED_SOLO_5x5'
--    to bucket participants by tier. Including `tier` in the index lets PG
--    answer the projection without touching the heap. Partial WHERE keeps
--    it tiny (~50% of league_entries rows).
CREATE INDEX IF NOT EXISTS "league_entries_solo_cover_idx"
  ON "league_entries" ("puuid")
  INCLUDE ("tier")
  WHERE queue_type = 'RANKED_SOLO_5x5';

-- 2) champion_matchups + champion_synergies: hot WHERE always filters by
--    (patch, bracket) first; existing indexes lead with championA/lane.
--    Add (patch, bracket) leading prefix so the planner can immediately
--    narrow the rowset before joining/filtering champions.
CREATE INDEX IF NOT EXISTS "cmu_patch_bracket_lane_idx"
  ON "champion_matchups" ("patch", "bracket", "lane", "champion_a");

CREATE INDEX IF NOT EXISTS "cs_patch_bracket_champa_idx"
  ON "champion_synergies" ("patch", "bracket", "champion_a");
