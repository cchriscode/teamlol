CREATE TABLE IF NOT EXISTS "accounts" (
	"puuid" text PRIMARY KEY NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"region" text NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "summoners" (
	"puuid" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"profile_icon_id" integer NOT NULL,
	"summoner_level" integer NOT NULL,
	"revision_date" bigint NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_entries" (
	"puuid" text NOT NULL,
	"queue_type" text NOT NULL,
	"tier" text NOT NULL,
	"rank" text NOT NULL,
	"league_points" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"veteran" boolean DEFAULT false NOT NULL,
	"inactive" boolean DEFAULT false NOT NULL,
	"fresh_blood" boolean DEFAULT false NOT NULL,
	"hot_streak" boolean DEFAULT false NOT NULL,
	"season" text,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "league_entries_puuid_queue_type_pk" PRIMARY KEY("puuid","queue_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"patch" text NOT NULL,
	"queue_id" integer NOT NULL,
	"game_creation" bigint NOT NULL,
	"game_duration" integer NOT NULL,
	"game_version" text NOT NULL,
	"map_id" integer NOT NULL,
	"bluewin" integer,
	"raw_detail" jsonb NOT NULL,
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_participants" (
	"match_id" text NOT NULL,
	"puuid" text NOT NULL,
	"slot" integer NOT NULL,
	"team" text NOT NULL,
	"lane" text NOT NULL,
	"role" text,
	"champion_id" integer NOT NULL,
	"champion_key" text NOT NULL,
	"win" boolean NOT NULL,
	"kills" integer NOT NULL,
	"deaths" integer NOT NULL,
	"assists" integer NOT NULL,
	"kp" real,
	"cs" integer NOT NULL,
	"cs_at_14" integer,
	"cs_diff_at_14" integer,
	"gold_per_min" real NOT NULL,
	"xp_per_min" real NOT NULL,
	"dmg_to_champ_per_min" real NOT NULL,
	"dmg_to_obj" integer NOT NULL,
	"damage_taken_per_min" real NOT NULL,
	"dmg_mitigated_per_min" real,
	"vision_score" integer NOT NULL,
	"wards_placed" integer NOT NULL,
	"wards_killed" integer NOT NULL,
	"time_dead_pct" real NOT NULL,
	"solo_kills" integer DEFAULT 0 NOT NULL,
	"multi_kills" integer DEFAULT 0 NOT NULL,
	"worthless_deaths" integer DEFAULT 0 NOT NULL,
	"free_kills_count" integer DEFAULT 0 NOT NULL,
	"items" jsonb NOT NULL,
	"spells" jsonb NOT NULL,
	"runes" jsonb,
	"ai_score_cached" real,
	"ai_score_algo_version" text,
	"raw_participant" jsonb NOT NULL,
	"ingested_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "match_participants_match_id_puuid_pk" PRIMARY KEY("match_id","puuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_timelines" (
	"match_id" text PRIMARY KEY NOT NULL,
	"raw_timeline" jsonb NOT NULL,
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "champion_stats" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"lane" text NOT NULL,
	"champion_id" integer NOT NULL,
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"pickrate" real NOT NULL,
	"banrate" real NOT NULL,
	"avg_kda" real,
	"ps_score" real,
	"sample_n" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "champion_stats_patch_bracket_lane_champion_id_pk" PRIMARY KEY("patch","bracket","lane","champion_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "champion_matchups" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"lane" text NOT NULL,
	"champion_a" integer NOT NULL,
	"champion_b" integer NOT NULL,
	"games" integer NOT NULL,
	"a_wins" integer NOT NULL,
	"a_winrate" real NOT NULL,
	"avg_gold_diff_at_15" real,
	"avg_cs_diff_at_14" real,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "champion_matchups_patch_bracket_lane_champion_a_champion_b_pk" PRIMARY KEY("patch","bracket","lane","champion_a","champion_b")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "champion_synergies" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"champion_a" integer NOT NULL,
	"champion_b" integer NOT NULL,
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"pair_winrate" real NOT NULL,
	"synergy_delta" real NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "champion_synergies_patch_bracket_champion_a_champion_b_pk" PRIMARY KEY("patch","bracket","champion_a","champion_b")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_duo_synergy" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"adc_id" integer NOT NULL,
	"sup_id" integer NOT NULL,
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"pair_winrate" real NOT NULL,
	"synergy_delta" real NOT NULL,
	"archetype" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_duo_synergy_patch_bracket_adc_id_sup_id_pk" PRIMARY KEY("patch","bracket","adc_id","sup_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copick_probs" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"anchor_role" text NOT NULL,
	"anchor_id" integer NOT NULL,
	"partner_role" text NOT NULL,
	"partner_id" integer NOT NULL,
	"cooccur_count" integer NOT NULL,
	"anchor_total" integer NOT NULL,
	"prob" real NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "copick_probs_patch_bracket_anchor_role_anchor_id_partner_role_partner_id_pk" PRIMARY KEY("patch","bracket","anchor_role","anchor_id","partner_role","partner_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_score_cohorts" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"champion_id" integer NOT NULL,
	"lane" text NOT NULL,
	"result" text NOT NULL,
	"stat_key" text NOT NULL,
	"mean" real NOT NULL,
	"std" real NOT NULL,
	"sample_n" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_score_cohorts_patch_bracket_champion_id_lane_result_stat_key_pk" PRIMARY KEY("patch","bracket","champion_id","lane","result","stat_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_score_lane_global" (
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"lane" text NOT NULL,
	"result" text NOT NULL,
	"stat_key" text NOT NULL,
	"mean" real NOT NULL,
	"std" real NOT NULL,
	"sample_n" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_score_lane_global_patch_bracket_lane_result_stat_key_pk" PRIMARY KEY("patch","bracket","lane","result","stat_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tier_snapshots" (
	"snapshot_date" date NOT NULL,
	"patch" text NOT NULL,
	"bracket" text NOT NULL,
	"lane" text NOT NULL,
	"champion_id" integer NOT NULL,
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"pickrate" real NOT NULL,
	"banrate" real NOT NULL,
	"ps_score" real,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tier_snapshots_snapshot_date_patch_bracket_lane_champion_id_pk" PRIMARY KEY("snapshot_date","patch","bracket","lane","champion_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"riot_id" text NOT NULL,
	"region" text NOT NULL,
	"matched_puuid" text,
	"ip_hash" text NOT NULL,
	"searched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "static_champions" (
	"patch" text NOT NULL,
	"key" text NOT NULL,
	"id" integer NOT NULL,
	"name_kr" text NOT NULL,
	"name_en" text NOT NULL,
	"title" text,
	"lanes" jsonb NOT NULL,
	"tags" jsonb NOT NULL,
	"info_difficulty" integer,
	"blind_pick_safe" integer DEFAULT 0 NOT NULL,
	"raw_data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "static_champions_patch_key_pk" PRIMARY KEY("patch","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "static_items" (
	"patch" text NOT NULL,
	"id" integer NOT NULL,
	"name_kr" text NOT NULL,
	"name_en" text NOT NULL,
	"raw_data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "static_items_patch_id_pk" PRIMARY KEY("patch","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "static_runes" (
	"patch" text NOT NULL,
	"id" integer NOT NULL,
	"tree_key" text NOT NULL,
	"rune_key" text NOT NULL,
	"name_kr" text NOT NULL,
	"icon_path" text NOT NULL,
	"raw_data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "static_runes_patch_id_pk" PRIMARY KEY("patch","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "static_versions" (
	"patch" text PRIMARY KEY NOT NULL,
	"locale" text NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"is_current" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_riot_id_idx" ON "accounts" USING btree ("game_name","tag_line","region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_region_idx" ON "accounts" USING btree ("region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "summoners_region_idx" ON "summoners" USING btree ("region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "summoners_refreshed_idx" ON "summoners" USING btree ("refreshed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "league_entries_tier_idx" ON "league_entries" USING btree ("tier","queue_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "league_entries_refreshed_idx" ON "league_entries" USING btree ("refreshed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_patch_queue_idx" ON "matches" USING btree ("patch","queue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_creation_idx" ON "matches" USING btree ("game_creation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_region_idx" ON "matches" USING btree ("region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_puuid_idx" ON "match_participants" USING btree ("puuid","ingested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_lane_champ_idx" ON "match_participants" USING btree ("lane","champion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_champion_idx" ON "match_participants" USING btree ("champion_id","lane");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_bracket_lane_idx" ON "champion_stats" USING btree ("bracket","lane","ps_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cmu_a_idx" ON "champion_matchups" USING btree ("lane","champion_a","a_winrate");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_a_idx" ON "champion_synergies" USING btree ("champion_a","synergy_delta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bds_adc_idx" ON "bot_duo_synergy" USING btree ("adc_id","synergy_delta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bds_sup_idx" ON "bot_duo_synergy" USING btree ("sup_id","synergy_delta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_anchor_idx" ON "copick_probs" USING btree ("anchor_role","anchor_id","partner_role","prob");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asc_lookup_idx" ON "ai_score_cohorts" USING btree ("champion_id","lane","bracket","result");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ts_date_idx" ON "tier_snapshots" USING btree ("snapshot_date","bracket","lane");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sl_time_idx" ON "search_logs" USING btree ("searched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sl_riot_id_idx" ON "search_logs" USING btree ("riot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "static_champ_id_idx" ON "static_champions" USING btree ("patch","id");