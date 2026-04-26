-- Purpose: add canonical guild channel configuration storage for moderator alerts, review routing, and audit/log workflows.
-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\architecture.md
-- - docs\api.md
-- - docs\data-platform.md
-- - docs\discord-bot.md
-- - docs\observability-security.md
-- - docs\testing.md
-- External references:
-- - https://www.postgresql.org/docs/current/sql-insert.html
-- - https://www.postgresql.org/docs/current/ddl-constraints.html
-- Tests:
-- - packages/db/src/migrator.test.ts
-- - packages/db/src/guild-channel-config.integration.test.ts

CREATE TABLE IF NOT EXISTS guild_channel_configs (
  guild_id text PRIMARY KEY REFERENCES guilds (guild_id) ON DELETE CASCADE,
  moderator_alert_channel_id text NOT NULL,
  review_channel_id text,
  audit_log_channel_id text,
  moderation_log_channel_id text,
  created_by_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  updated_by_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
