# Documentation Index

- `docs\data-platform.md` — governing data platform design for Postgres, `pgvector`, SQLite/libSQL + `sqlite-vec`, Redis Streams, Electric sync, Cloudflare R2, and optional Qdrant.
- `docs\contracts.md` — governing Bun ↔ Rust shared contract doc for risk decisions, learning outcomes, policy inputs, action semantics, and reason-code taxonomy.
- `docs\contracts\humanify-contracts.schema.json` — canonical JSON Schema draft for the initial Bun ↔ Rust wire payloads and shared domain objects.
- `docs\local-development.md` — full local-stack orchestration for Docker-managed infrastructure plus Bun and Rust processes behind the root `bun run dev` command.
- `docs\observability-security.md` — day-one observability, auditability, secret/config, callback verification, evidence access, and moderation authority boundaries for Bun apps and Rust services.
- `docs\reference-baseline.md` — governing implementation reference baseline for the planned Bun, Rust, data, queue, storage, and observability stack. Future coding work should cite this doc plus the exact upstream official docs listed inside it.
- `docs\workspaces.md` — root Bun/Cargo workspace bootstrap, directory layout, and validation/formatting conventions for the greenfield monorepo skeleton.
- `..\Implementation Plan.txt` — current product, safety, and architecture plan.
- `..\AGENTS.md` — repository operating rules, safety requirements, and documentation/citation rules.
