-- Purpose: add canonical moderator-warning message refs and case-linked verification session reads for advisory Discord warning cards.
-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\architecture.md
-- - docs\api.md
-- - docs\data-platform.md
-- - docs\discord-bot.md
-- - docs\verification.md
-- External references:
-- - https://www.postgresql.org/docs/current/ddl-alter.html
-- - https://www.postgresql.org/docs/current/sql-createtable.html
-- - https://www.postgresql.org/docs/current/sql-insert.html
-- Tests:
-- - apps/api-bun/src/app.test.ts
-- - packages/db/src/moderator-warning-cards.integration.test.ts

ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES cases (case_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS verification_sessions_case_lookup_idx
  ON verification_sessions (guild_id, case_id, created_at DESC)
  WHERE case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS moderator_warning_message_refs (
  warning_message_ref_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases (case_id) ON DELETE CASCADE,
  subject_user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  message_state text NOT NULL DEFAULT 'active',
  last_actor_service text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderator_warning_message_refs_case_unique UNIQUE (case_id),
  CONSTRAINT moderator_warning_message_refs_message_unique UNIQUE (guild_id, channel_id, message_id),
  CONSTRAINT moderator_warning_message_refs_state_check CHECK (message_state IN ('active', 'deleted'))
);

CREATE INDEX IF NOT EXISTS moderator_warning_message_refs_subject_lookup_idx
  ON moderator_warning_message_refs (guild_id, subject_user_id, updated_at DESC);
