-- AI Score v2: drop cohort baseline infra, drop dead columns, convert all
-- timestamps to timestamptz (interpreting existing naive values in current
-- session timezone, which is UTC for the default Docker Postgres image).

DROP TABLE IF EXISTS "ai_score_cohorts";
DROP TABLE IF EXISTS "ai_score_cohorts_lane_global";
--> statement-breakpoint

ALTER TABLE "match_participants" DROP COLUMN IF EXISTS "worthless_deaths";
--> statement-breakpoint
ALTER TABLE "match_participants" DROP COLUMN IF EXISTS "free_kills_count";
--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "ai_score_letter" text;
--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "discovered_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "last_seen_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "summoners" ALTER COLUMN "refreshed_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "league_entries" ALTER COLUMN "refreshed_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "ingested_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "match_participants" ALTER COLUMN "ingested_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "match_timelines" ALTER COLUMN "ingested_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "champion_stats" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "champion_matchups" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "champion_synergies" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bot_duo_synergy" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "copick_probs" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tier_snapshots" ALTER COLUMN "captured_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "search_logs" ALTER COLUMN "searched_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "static_champions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "static_items" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "static_runes" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "static_versions" ALTER COLUMN "discovered_at" SET DATA TYPE timestamp with time zone;
