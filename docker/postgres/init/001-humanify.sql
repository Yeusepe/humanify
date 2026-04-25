-- Governing docs:
-- - AGENTS.md
-- - Implementation Plan.txt
-- - docs\reference-baseline.md
-- - docs\data-platform.md
-- - docs\local-development.md
-- Upstream docs:
-- - https://github.com/pgvector/pgvector/blob/master/README.md
-- - https://hub.docker.com/r/pgvector/pgvector
--
-- Tests:
-- - bun run dev

CREATE EXTENSION IF NOT EXISTS vector;
