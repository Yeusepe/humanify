# Documentation Index

- `docs\architecture.md` — implementation-facing runtime and subsystem ownership map for the Bun-authoritative / Rust-advisory platform, including topology and delivery dependency diagrams.
- `docs\api.md` — authoritative Bun API boundary, route groups, transaction rules, auth semantics, and callback/idempotency expectations.
- `docs\cases-and-reports.md` — report intake, evidence lifecycle, case-state model, appeals, and anti-brigading rules.
- `docs\contracts.md` — governing Bun ↔ Rust shared contract doc for risk decisions, learning outcomes, policy inputs, action semantics, and reason-code taxonomy.
- `docs\contracts\humanify-contracts.schema.json` — canonical JSON Schema draft for the initial Bun ↔ Rust wire payloads and shared domain objects.
- `docs\data-platform.md` — governing data platform design for Postgres, `pgvector`, SQLite/libSQL + `sqlite-vec`, Redis Streams, Electric sync, Cloudflare R2, and optional Qdrant.
- `docs\discord-bot.md` — Discord bot command, event-intake, permission, and executor rules for `apps\bot-bun` and planned shared bot helpers.
- `docs\learning.md` — moderator-feedback learning pipeline, learned-signal lifecycle, embedding ownership, and calibration/suppression rules.
- `docs\local-development.md` — full local-stack orchestration for Docker-managed infrastructure plus Bun and Rust processes behind the root `bun run dev` command.
- `docs\observability-security.md` — day-one observability, auditability, secret/config, callback verification, evidence access, and moderation authority boundaries for Bun apps and Rust services.
- `docs\operations.md` — deployment, queue, secrets, migration, and failure-handling expectations plus future runbook anchors.
- `docs\reference-baseline.md` — governing implementation reference baseline for the planned Bun, Rust, data, queue, storage, and observability stack. Future coding work should cite this doc plus the exact upstream official docs listed inside it.
- `docs\testing.md` — test layers, fixture strategy, adversarial regression expectations, and change-specific check bundles.
- `docs\verification.md` — verification session lifecycle, Discord-bound challenge flow, provider abstraction, callback rules, and release-to-role semantics.
- `docs\workspaces.md` — root Bun/Cargo workspace bootstrap, directory layout, and validation/formatting conventions for the greenfield monorepo skeleton.
- `..\Implementation Plan.txt` — current product, safety, and architecture plan.
- `..\AGENTS.md` — repository operating rules, safety requirements, and documentation/citation rules.
