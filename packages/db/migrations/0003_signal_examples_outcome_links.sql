-- Purpose: add outcome-linked signal example references without mutating the historical canonical spine migration.
-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\architecture.md
-- - docs\data-platform.md
-- - docs\learning.md
-- - docs\local-development.md
-- - docs\release-runbooks.md
-- External references:
-- - https://www.postgresql.org/docs/current/ddl-alter.html
-- - https://www.postgresql.org/docs/current/sql-createindex.html
-- Tests:
-- - packages/db/src/migrator.test.ts
-- - apps/api-bun/src/app.test.ts

ALTER TABLE signal_examples
  ADD COLUMN IF NOT EXISTS source_outcome_id uuid REFERENCES case_outcomes (outcome_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS signal_examples_outcome_hash_idx
  ON signal_examples (signal_id, source_outcome_id, normalized_value_hash);
