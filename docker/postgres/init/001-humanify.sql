-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\architecture.md
-- - docs\reference-baseline.md
-- - docs\data-platform.md
-- - docs\operations.md
-- - docs\local-development.md
-- Upstream docs:
-- - https://github.com/pgvector/pgvector/blob/master/README.md
-- - https://hub.docker.com/r/pgvector/pgvector
--
-- Tests:
-- - packages/db/src/migrator.test.ts
--
-- Local-development note:
-- - this init script only preloads extensions on first container initialization
-- - canonical table ownership lives in packages\db\migrations and bun run db:migrate

CREATE EXTENSION IF NOT EXISTS vector;
