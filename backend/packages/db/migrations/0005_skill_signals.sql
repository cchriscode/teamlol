-- Skill/impact signals for AI Score v3.1 — parsed from raw participant data.
ALTER TABLE "match_participants"
  ADD COLUMN IF NOT EXISTS "first_blood_kill"   boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "first_blood_assist" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "first_tower_kill"   boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "dragon_takedowns"   integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "baron_takedowns"    integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "herald_takedowns"   integer DEFAULT 0 NOT NULL;
