-- GDPR / Riot Developer Policy compliance — data deletion workflow.
-- Two tables: request queue + permanent block list (so a deleted puuid
-- isn't auto-re-ingested by BFS / search).

CREATE TABLE IF NOT EXISTS "deletion_requests" (
  "id"            text PRIMARY KEY,
  "puuid"         text,
  "riot_id"       text NOT NULL,
  "region"        text NOT NULL,
  "requested_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at"  timestamp with time zone,
  "status"        text NOT NULL DEFAULT 'pending',  -- 'pending' | 'processed' | 'rejected' | 'failed'
  "rows_deleted"  integer,
  "note"          text
);
CREATE INDEX IF NOT EXISTS "dr_status_idx" ON "deletion_requests" ("status", "requested_at");

CREATE TABLE IF NOT EXISTS "blocked_puuids" (
  "puuid"         text PRIMARY KEY,
  "reason"        text NOT NULL,                    -- 'gdpr-deletion' | 'manual'
  "blocked_at"    timestamp with time zone DEFAULT now() NOT NULL
);
