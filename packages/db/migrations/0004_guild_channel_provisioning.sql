ALTER TABLE guild_channel_configs
  ADD COLUMN IF NOT EXISTS setup_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS verification_channel_id text,
  ADD COLUMN IF NOT EXISTS verification_panel_message_id text,
  ADD COLUMN IF NOT EXISTS managed_resources jsonb NOT NULL DEFAULT '[]'::jsonb;
