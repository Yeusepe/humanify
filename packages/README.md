# Packages Workspace

## Governing docs

- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\reference-baseline.md`
- `docs\workspaces.md`

## Upstream docs

- Bun workspaces: https://bun.sh/docs/install/workspaces
- TypeScript: https://www.typescriptlang.org/docs/
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12
- HeroUI React: https://www.heroui.com/docs/react/getting-started
- Postgres.js: https://github.com/porsager/postgres
- PostgreSQL: https://www.postgresql.org/docs/current/index.html

Shared Bun/TypeScript packages currently scaffolded here:

- `auth`: Discord OAuth state, verifier challenge token, and session cookie helpers
- `config`: runtime env validation, role-specific loaders, and safe config summaries
- `db`: canonical Postgres migration runner, connection resolution, and schema bootstrap helpers
- `contracts`: re-exports the canonical Bun ↔ Rust contract schema and shared metadata
- `discord-core`: shared Discord gateway intent, custom ID, audit-reason, and execution helpers
- `policy-engine`: authoritative Bun-side policy clamps from advisory risk to allowed actions
- `queue`: Redis Streams envelope, trace propagation, and consumer recovery helpers
- `telemetry`: traceparent, redaction, and structured log bootstrap helpers
- `verification-providers`: shared verification strategy package for capture flows, reusable-proof backends, policy-consumer glue, and Humanify ID claim bundle helpers
- `ui`: shared HeroUI-based shell components for Start apps
