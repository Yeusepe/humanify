-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\architecture.md
-- - docs\api.md
-- - docs\data-platform.md
-- - docs\discord-bot.md
-- - docs\local-development.md
-- External references:
-- - https://www.postgresql.org/docs/current/index.html
-- - https://docs.temporal.io/typescript/introduction
-- - https://raw.githubusercontent.com/temporalio/docker-compose/main/docker-compose.yml

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'guild_scan_request_scope'
  ) THEN
    CREATE TYPE guild_scan_request_scope AS ENUM ('single_member', 'all_members');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'guild_scan_request_status'
  ) THEN
    CREATE TYPE guild_scan_request_status AS ENUM ('pending', 'claimed', 'running', 'completed', 'failed');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS guild_scan_requests (
  scan_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  requested_by_user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE RESTRICT,
  scope guild_scan_request_scope NOT NULL,
  target_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  status guild_scan_request_status NOT NULL DEFAULT 'pending',
  workflow_id text,
  temporal_task_queue text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  summary jsonb NOT NULL DEFAULT '{
    "notes": [],
    "processedMemberCount": 0,
    "suspiciousFindings": [],
    "suspiciousMemberCount": 0
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild_scan_requests_single_target_required CHECK (
    (scope = 'single_member' AND target_user_id IS NOT NULL)
    OR (scope = 'all_members' AND target_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS guild_scan_requests_guild_created_idx
  ON guild_scan_requests (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guild_scan_requests_status_created_idx
  ON guild_scan_requests (status, created_at ASC);
