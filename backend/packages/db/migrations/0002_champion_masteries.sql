CREATE TABLE IF NOT EXISTS "champion_masteries" (
	"puuid" text NOT NULL,
	"champion_id" integer NOT NULL,
	"level" integer NOT NULL,
	"points" integer NOT NULL,
	"last_played_at" bigint NOT NULL,
	"chest_granted" boolean DEFAULT false NOT NULL,
	"tokens_earned" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "champion_masteries_puuid_champion_id_pk" PRIMARY KEY("puuid","champion_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_puuid_points_idx" ON "champion_masteries" ("puuid", "points");
