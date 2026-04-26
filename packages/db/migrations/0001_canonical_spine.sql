-- Purpose: bootstrap the canonical Humanify Postgres spine for guild policy, verification, cases, evidence, learning, outbox, idempotency, and audit ownership.
-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\architecture.md
-- - docs\data-platform.md
-- - docs\api.md
-- - docs\cases-and-reports.md
-- - docs\verification.md
-- - docs\learning.md
-- - docs\operations.md
-- - docs\observability-security.md
-- - docs\testing.md
-- - docs\local-development.md
-- - docs\workspaces.md
-- External references:
-- - https://www.postgresql.org/docs/current/sql-createextension.html
-- - https://www.postgresql.org/docs/current/ddl-constraints.html
-- - https://github.com/pgvector/pgvector/blob/master/README.md
-- Tests:
-- - packages/db/src/migrator.test.ts

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guild_install_status') THEN
    CREATE TYPE guild_install_status AS ENUM ('pending', 'active', 'disabled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guild_member_quarantine_state') THEN
    CREATE TYPE guild_member_quarantine_state AS ENUM ('clear', 'watch', 'quarantined', 'released');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guild_member_verification_state') THEN
    CREATE TYPE guild_member_verification_state AS ENUM ('not_required', 'required', 'pending', 'passed', 'failed', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guild_member_risk_state') THEN
    CREATE TYPE guild_member_risk_state AS ENUM ('clear', 'watch', 'verify', 'contained', 'review');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_session_state') THEN
    CREATE TYPE verification_session_state AS ENUM (
      'pending',
      'challenge_issued',
      'oauth_bound',
      'provider_pending',
      'passed',
      'failed',
      'expired',
      'cancelled',
      'released'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_status') THEN
    CREATE TYPE case_status AS ENUM (
      'open',
      'reviewing',
      'actioned',
      'dismissed',
      'appealed',
      'overturned',
      'reopened',
      'closed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_intake_source') THEN
    CREATE TYPE report_intake_source AS ENUM (
      'slash_command',
      'message_context',
      'api_form',
      'detector_bridge',
      'appeal',
      'internal'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appeal_status') THEN
    CREATE TYPE appeal_status AS ENUM ('submitted', 'reviewing', 'approved', 'denied', 'withdrawn');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_outcome_kind') THEN
    CREATE TYPE case_outcome_kind AS ENUM (
      'confirmed_scam',
      'confirmed_bot',
      'confirmed_hacked_account',
      'false_positive',
      'dismissed',
      'overturned'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_kind') THEN
    CREATE TYPE evidence_kind AS ENUM (
      'message_link',
      'attachment',
      'screenshot',
      'moderator_note',
      'provider_result',
      'external_url',
      'derived_text'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'blob_derivative_kind') THEN
    CREATE TYPE blob_derivative_kind AS ENUM ('thumbnail', 'redacted', 'ocr_text', 'provider_export', 'normalized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_delivery_status') THEN
    CREATE TYPE outbox_delivery_status AS ENUM ('pending', 'publishing', 'published', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_execution_status') THEN
    CREATE TYPE action_execution_status AS ENUM ('pending', 'accepted', 'executed', 'failed', 'rejected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signal_type') THEN
    CREATE TYPE signal_type AS ENUM (
      'text_similarity',
      'domain_reputation',
      'invite_reputation',
      'image_hash',
      'behavior_pattern',
      'reporter_reputation',
      'server_trust',
      'false_positive_suppression'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_input_source_kind') THEN
    CREATE TYPE risk_input_source_kind AS ENUM ('join', 'message', 'report', 'provider_callback', 'manual_review');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recommended_action_kind') THEN
    CREATE TYPE recommended_action_kind AS ENUM (
      'none',
      'watch',
      'verify',
      'quarantine',
      'timeout',
      'kick',
      'ban'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS guilds (
  guild_id text PRIMARY KEY,
  install_status guild_install_status NOT NULL DEFAULT 'pending',
  plan_tier text NOT NULL DEFAULT 'community',
  discord_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identities (
  user_id text PRIMARY KEY,
  username text,
  global_name text,
  avatar_hash text,
  banner_hash text,
  is_bot boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  public_flags bigint NOT NULL DEFAULT 0,
  account_created_at timestamptz,
  profile_signal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guild_members (
  member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  joined_at timestamptz,
  left_at timestamptz,
  current_role_ids text[] NOT NULL DEFAULT '{}'::text[],
  quarantine_state guild_member_quarantine_state NOT NULL DEFAULT 'clear',
  verification_state guild_member_verification_state NOT NULL DEFAULT 'not_required',
  risk_state guild_member_risk_state NOT NULL DEFAULT 'clear',
  moderation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild_members_unique_member UNIQUE (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS moderators (
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  permission_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_snapshot text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_policy_versions (
  policy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  policy_payload jsonb NOT NULL,
  verification_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  trust_network_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text REFERENCES user_identities (user_id),
  effective_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild_policy_versions_version_positive CHECK (version_number > 0),
  CONSTRAINT guild_policy_versions_unique_version UNIQUE (guild_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS guild_policy_versions_one_active_idx
  ON guild_policy_versions (guild_id)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS verification_requirements (
  requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  policy_version_id uuid REFERENCES guild_policy_versions (policy_version_id) ON DELETE SET NULL,
  requirement_key text NOT NULL,
  required_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  challenge_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_requirements_unique_key UNIQUE (guild_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS verification_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  member_id uuid REFERENCES guild_members (member_id) ON DELETE SET NULL,
  requirement_id uuid REFERENCES verification_requirements (requirement_id) ON DELETE SET NULL,
  challenge_id uuid NOT NULL DEFAULT gen_random_uuid(),
  state verification_session_state NOT NULL DEFAULT 'pending',
  initiated_by text NOT NULL DEFAULT 'system',
  required_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  challenge_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  challenge_expires_at timestamptz,
  expires_at timestamptz,
  passed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_sessions_unique_challenge UNIQUE (challenge_id)
);

CREATE INDEX IF NOT EXISTS verification_sessions_lookup_idx
  ON verification_sessions (guild_id, user_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS verification_artifacts (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES verification_sessions (session_id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  artifact_kind text NOT NULL,
  provider_reference_id text,
  attestation_status text NOT NULL,
  expires_at timestamptz,
  redacted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_inputs (
  input_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  member_id uuid REFERENCES guild_members (member_id) ON DELETE SET NULL,
  source_kind risk_input_source_kind NOT NULL,
  source_ref text NOT NULL,
  input_fingerprint text NOT NULL,
  source_timestamp timestamptz,
  normalized_hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_inputs_unique_fingerprint UNIQUE (guild_id, input_fingerprint)
);

CREATE TABLE IF NOT EXISTS risk_feature_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_id uuid NOT NULL REFERENCES risk_inputs (input_id) ON DELETE CASCADE,
  scorer_version text NOT NULL,
  features jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_feature_snapshots_unique_version UNIQUE (input_id, scorer_version)
);

CREATE TABLE IF NOT EXISTS risk_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_id uuid NOT NULL REFERENCES risk_inputs (input_id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  member_id uuid REFERENCES guild_members (member_id) ON DELETE SET NULL,
  input_fingerprint text NOT NULL,
  scorer_version text NOT NULL,
  score smallint NOT NULL,
  confidence numeric(4, 3) NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  recommended_action recommended_action_kind NOT NULL,
  advisory_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_decisions_score_range CHECK (score BETWEEN 1 AND 10),
  CONSTRAINT risk_decisions_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT risk_decisions_unique_fingerprint UNIQUE (input_fingerprint, scorer_version)
);

CREATE TABLE IF NOT EXISTS action_recommendations (
  recommendation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES risk_decisions (decision_id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  policy_version_id uuid REFERENCES guild_policy_versions (policy_version_id) ON DELETE SET NULL,
  action recommended_action_kind NOT NULL,
  requires_review boolean NOT NULL DEFAULT false,
  is_clamped boolean NOT NULL DEFAULT false,
  clamp_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_recommendations_one_per_decision UNIQUE (decision_id)
);

CREATE TABLE IF NOT EXISTS cases (
  case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  subject_user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  subject_member_id uuid REFERENCES guild_members (member_id) ON DELETE SET NULL,
  opening_fingerprint text NOT NULL,
  reason text NOT NULL,
  severity smallint NOT NULL,
  status case_status NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cases_severity_range CHECK (severity BETWEEN 1 AND 10),
  CONSTRAINT cases_unique_opening_fingerprint UNIQUE (guild_id, opening_fingerprint)
);

CREATE INDEX IF NOT EXISTS cases_subject_lookup_idx
  ON cases (guild_id, subject_user_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  case_id uuid REFERENCES cases (case_id) ON DELETE SET NULL,
  reporter_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  reporter_member_id uuid REFERENCES guild_members (member_id) ON DELETE SET NULL,
  subject_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  subject_member_id uuid REFERENCES guild_members (member_id) ON DELETE SET NULL,
  intake_source report_intake_source NOT NULL,
  trigger_fingerprint text NOT NULL,
  report_reason text NOT NULL,
  reporter_notes text,
  abuse_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_unique_trigger_per_reporter UNIQUE (guild_id, intake_source, trigger_fingerprint, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS reports_case_lookup_idx
  ON reports (guild_id, case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS case_events (
  case_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases (case_id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  actor_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  actor_service text,
  event_type text NOT NULL,
  summary text,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_events_timeline_idx
  ON case_events (case_id, created_at ASC);

CREATE TABLE IF NOT EXISTS case_outcomes (
  outcome_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases (case_id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  subject_user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  moderator_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  outcome case_outcome_kind NOT NULL,
  confidence numeric(4, 3) NOT NULL,
  rationale text,
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  source_event_id uuid REFERENCES case_events (case_event_id) ON DELETE SET NULL,
  supersedes_outcome_id uuid REFERENCES case_outcomes (outcome_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_outcomes_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS appeals (
  appeal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases (case_id) ON DELETE CASCADE,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  subject_user_id text NOT NULL REFERENCES user_identities (user_id) ON DELETE CASCADE,
  reviewer_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  status appeal_status NOT NULL DEFAULT 'submitted',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases (case_id) ON DELETE CASCADE,
  report_id uuid REFERENCES reports (report_id) ON DELETE SET NULL,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  evidence_type evidence_kind NOT NULL,
  capture_source text NOT NULL,
  actor_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blob_objects (
  blob_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  object_key text NOT NULL,
  byte_length bigint NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  blake3 text NOT NULL,
  perceptual_hash text,
  capture_source text,
  retention_class text NOT NULL DEFAULT 'standard',
  redaction_status text NOT NULL DEFAULT 'raw',
  legal_hold boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blob_objects_byte_length_nonnegative CHECK (byte_length >= 0),
  CONSTRAINT blob_objects_object_key_unique UNIQUE (bucket, object_key),
  CONSTRAINT blob_objects_sha256_unique UNIQUE (sha256),
  CONSTRAINT blob_objects_blake3_unique UNIQUE (blake3)
);

CREATE TABLE IF NOT EXISTS blob_derivatives (
  derivative_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_id uuid NOT NULL REFERENCES blob_objects (blob_id) ON DELETE CASCADE,
  derivative_blob_id uuid REFERENCES blob_objects (blob_id) ON DELETE SET NULL,
  derivative_type blob_derivative_kind NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blob_derivatives_unique_kind UNIQUE (blob_id, derivative_type)
);

CREATE TABLE IF NOT EXISTS evidence_links (
  evidence_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES evidence_records (evidence_id) ON DELETE CASCADE,
  blob_id uuid REFERENCES blob_objects (blob_id) ON DELETE SET NULL,
  derivative_id uuid REFERENCES blob_derivatives (derivative_id) ON DELETE SET NULL,
  discord_message_url text,
  provider_reference_id text,
  redacted_text_snapshot text,
  retention_state text NOT NULL DEFAULT 'active',
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learned_signals (
  signal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text REFERENCES guilds (guild_id) ON DELETE CASCADE,
  signal_family signal_type NOT NULL,
  source_case_id uuid REFERENCES cases (case_id) ON DELETE SET NULL,
  source_outcome_id uuid REFERENCES case_outcomes (outcome_id) ON DELETE SET NULL,
  weight numeric(10, 4) NOT NULL DEFAULT 0,
  confidence numeric(4, 3) NOT NULL DEFAULT 0,
  true_positive_count integer NOT NULL DEFAULT 0,
  false_positive_count integer NOT NULL DEFAULT 0,
  freshness_state text NOT NULL DEFAULT 'fresh',
  is_suppressed boolean NOT NULL DEFAULT false,
  suppressed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learned_signals_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT learned_signals_positive_counters CHECK (true_positive_count >= 0 AND false_positive_count >= 0)
);

CREATE TABLE IF NOT EXISTS signal_examples (
  example_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES learned_signals (signal_id) ON DELETE CASCADE,
  source_case_id uuid REFERENCES cases (case_id) ON DELETE SET NULL,
  evidence_id uuid REFERENCES evidence_records (evidence_id) ON DELETE SET NULL,
  normalized_value_hash text NOT NULL,
  label case_outcome_kind NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signal_embeddings (
  embedding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_type text NOT NULL,
  owner_entity_id text NOT NULL,
  signal_id uuid REFERENCES learned_signals (signal_id) ON DELETE SET NULL,
  embedding_model text NOT NULL,
  embedding_version text NOT NULL,
  embedding vector,
  freshness_state text NOT NULL DEFAULT 'fresh',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_embeddings_unique_owner UNIQUE (owner_entity_type, owner_entity_id, embedding_model, embedding_version)
);

CREATE TABLE IF NOT EXISTS reputation_views (
  reputation_view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text REFERENCES guilds (guild_id) ON DELETE CASCADE,
  reputation_kind text NOT NULL,
  subject_key text NOT NULL,
  score numeric(10, 4) NOT NULL DEFAULT 0,
  confidence numeric(4, 3) NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reputation_views_identity_idx
  ON reputation_views (guild_id, reputation_kind, subject_key);

CREATE TABLE IF NOT EXISTS outbox_events (
  outbox_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_key text NOT NULL,
  idempotency_key text,
  payload jsonb NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status outbox_delivery_status NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_unique_event_key UNIQUE (event_key),
  CONSTRAINT outbox_events_attempt_count_nonnegative CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS outbox_events_dispatch_idx
  ON outbox_events (delivery_status, available_at, created_at);

CREATE TABLE IF NOT EXISTS idempotency_receipts (
  idempotency_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boundary text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text,
  response_code integer,
  response_body jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT idempotency_receipts_unique_boundary UNIQUE (boundary, idempotency_key)
);

CREATE TABLE IF NOT EXISTS action_execution_receipts (
  action_execution_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases (case_id) ON DELETE SET NULL,
  case_event_id uuid REFERENCES case_events (case_event_id) ON DELETE SET NULL,
  guild_id text NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  subject_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  action_type recommended_action_kind NOT NULL,
  provider_action_key text NOT NULL,
  executor_service text NOT NULL,
  status action_execution_status NOT NULL DEFAULT 'pending',
  discord_audit_reason text,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT action_execution_receipts_unique_provider_key UNIQUE (action_type, provider_action_key)
);

CREATE TABLE IF NOT EXISTS audit_records (
  audit_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text REFERENCES guilds (guild_id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_user_id text REFERENCES user_identities (user_id) ON DELETE SET NULL,
  actor_service text,
  target_type text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL,
  rationale text,
  request_id text,
  trace_id text,
  idempotency_key text,
  related_case_id uuid REFERENCES cases (case_id) ON DELETE SET NULL,
  related_case_event_id uuid REFERENCES case_events (case_event_id) ON DELETE SET NULL,
  related_execution_receipt_id uuid REFERENCES action_execution_receipts (action_execution_receipt_id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_records_lookup_idx
  ON audit_records (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stream_consumer_checkpoints (
  stream_consumer_checkpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_name text NOT NULL,
  consumer_group text NOT NULL,
  message_id text NOT NULL,
  handler_version text NOT NULL,
  entity_type text,
  entity_id text,
  status text NOT NULL DEFAULT 'processed',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stream_consumer_checkpoints_unique_message UNIQUE (stream_name, consumer_group, message_id, handler_version)
);

CREATE TABLE IF NOT EXISTS projection_failures (
  projection_failure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_name text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  failure_kind text NOT NULL,
  last_error text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT projection_failures_retry_count_nonnegative CHECK (retry_count >= 0)
);
