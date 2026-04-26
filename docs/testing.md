# Humanify testing strategy

Purpose: define the implementation-facing test layers, fixture rules, adversarial coverage, and exit criteria that future Bun and Rust work must satisfy.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\contracts.md`
- `docs\data-platform.md`
- `docs\observability-security.md`
- `docs\local-development.md`
- `docs\architecture.md`
- `docs\api.md`
- `docs\discord-bot.md`
- `docs\verification.md`
- `docs\cases-and-reports.md`
- `docs\learning.md`
- `docs\testing.md`

Upstream docs:
- Bun test runner: https://bun.sh/docs/test
- TypeScript `tsconfig`: https://www.typescriptlang.org/tsconfig
- discord.js: https://discord.js.org/docs/packages/discord.js/main
- Axum: https://docs.rs/axum/latest/axum/
- Docker Compose: https://docs.docker.com/compose/
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- PostgreSQL: https://www.postgresql.org/docs/current/index.html

## 1. Testing rules for this repo

1. docs and contracts first for architecture-changing work
2. failing tests before implementation when executable tests are practical
3. no production stubs or workaround flows to satisfy tests
4. every meaningful change runs relevant checks plus the nearest subsystem tests
5. moderation safety, replay, and audit paths are first-class test targets

## 2. Test pyramid by layer

| Layer | Primary tools | What it should prove |
| --- | --- | --- |
| Schema/contract tests | JSON Schema fixtures, shared contract package tests | Bun and Rust stay aligned on payload shape and safety semantics |
| Unit tests | Bun test, Rust crate tests | pure scoring rules, validation helpers, hash/normalization utilities, policy clamps |
| Route/handler tests | Bun test around Elysia handlers, Axum service tests | authz, validation, error envelopes, callback verification, idempotent writes |
| Bot interaction tests | Bun test with Discord-client isolation helpers | command routing, permission-denial paths, API handoff, audit-reason formatting |
| Integration tests | local Postgres/Redis/MinIO/Electric stack via Docker Compose | canonical writes, outbox, streams, evidence metadata, provider callback flows |
| End-to-end workflow tests | local full stack from `bun run dev` or CI equivalent | moderator flow from intake to review/action/learning |
| Adversarial/regression tests | crafted fixtures and replay cases | prompt injection, false-positive suppression, callback replay, report brigading |

## 3. Minimum coverage expectations by subsystem

| Subsystem | Must-have tests |
| --- | --- |
| `packages\config` | startup config validation, secret redaction summaries, role-specific loader defaults |
| `packages\policy-engine` | score-to-action ladder, max-automatic-action clamps, verification threshold logic |
| `packages\auth` | Discord OAuth state signing, verifier challenge expiry, session cookie defaults |
| `packages\queue` | envelope serialization, trace propagation, consumer recovery helpers |
| `apps\api-bun` | auth/session guards, validation, idempotency, Postgres-first writes, error envelopes |
| `apps\bot-bun` | command routing, permission checks, refusal paths, approved-action execution receipts |
| verification | signed-link/session binding, single-use challenge rules, verifier route helpers, callback signature/replay rejection, release-to-role flow |
| cases/evidence | dedupe, case-event append-only behavior, evidence hashing and derivative writeback, appeal transitions |
| learning | feedback ingestion, suppressions, decay, calibration metrics, advisory-only reuse in inference |
| operations | startup config validation, queue recovery helpers, outbox forwarding, observability wiring smoke tests |

## 4. Fixture and data rules

1. Prefer deterministic fixtures for Discord events, verification callbacks, risk decisions, case outcomes, and evidence metadata.
2. Keep raw sensitive content out of committed fixtures when hashes or redacted samples are enough.
3. Integration fixtures should create canonical Postgres rows and then drive queues or callbacks from those rows.
4. Replays should reuse the same idempotency keys to prove duplicate safety.
5. False-positive and appeal fixtures should be first-class because the product's safety model depends on them.

## 5. Adversarial and safety regression suite

Future work should add explicit regression coverage for:

- prompt-injection-like text in usernames, messages, screenshots, and report notes
- duplicate provider callbacks and expired callback attempts
- moderator or reporter abuse patterns such as brigading and revenge reporting
- bot permission drift and target-hierarchy failures during execution
- Rust-service degradation that must not expand enforcement authority
- stale or corrupted local caches that should be rebuilt instead of trusted

## 6. Suggested execution bundle by change type

| Change type | Required checks |
| --- | --- |
| docs-only | relevant docs review + repo baseline checks |
| shared contracts / policy | `bun run check`, contract tests, affected Rust/Bun unit tests |
| API routes | `bun run check`, route tests, callback/idempotency tests, integration tests if data shape changes |
| bot changes | `bun run check`, bot tests, permission-path tests, integration coverage when action execution changes |
| data layer | `bun run check`, `bun run db:migrate`, migration validation, integration tests against Postgres/Redis/R2 stand-ins |
| Rust service changes | relevant `cargo test` targets, service handler tests, contract fixtures, `bun run check` if Bun-facing contracts change |

## 7. Exit criteria for later implementation work

A subsystem change is not done until it can point to:

1. governing docs updated
2. upstream references verified
3. tests added at the correct layer
4. relevant baseline and subsystem checks run successfully
5. evidence that advisory-only, audit, idempotency, and replay rules still hold
