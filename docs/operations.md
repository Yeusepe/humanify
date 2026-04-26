# Humanify operations and runbooks

Purpose: define the implementation-facing deployment, secrets, queue, observability, migration, and failure-handling expectations for the Bun and Rust platform.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\data-platform.md`
- `docs\observability-security.md`
- `docs\local-development.md`
- `docs\architecture.md`
- `docs\operations.md`

Upstream docs:
- Docker Compose: https://docs.docker.com/compose/
- `docker compose up`: https://docs.docker.com/reference/cli/docker/compose/up/
- Postgres.js: https://github.com/porsager/postgres
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Redis `XAUTOCLAIM`: https://redis.io/docs/latest/commands/xautoclaim/
- Electric installation: https://electric-sql.com/docs/guides/installation
- Electric sync config: https://electric-sql.com/docs/api/config
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Grafana docs: https://grafana.com/docs/
- Sentry Bun: https://docs.sentry.io/platforms/javascript/guides/bun/
- Sentry Rust: https://docs.sentry.io/platforms/rust/
- OpenTelemetry signals: https://opentelemetry.io/docs/concepts/signals/
- Bun subprocesses: https://bun.sh/docs/api/spawn
- Cargo run: https://doc.rust-lang.org/cargo/commands/cargo-run.html

## 1. Operational model

Humanify runs as a Bun-first product shell with Rust intelligence services and shared infrastructure.

| Layer | Operational owner | Notes |
| --- | --- | --- |
| Bun apps (`bot-bun`, `api-bun`, dashboard, verifier) | product boundary | auth, policy, UX, Discord execution |
| Rust services | advisory compute | inference, learning, evidence, trust |
| Postgres + `pgvector` | canonical state | migrations and backups matter before feature rollout |
| Redis Streams | async transport | pending entries require active consumer monitoring |
| Electric | UI read sync | must lag gracefully without corrupting canonical state |
| R2 / MinIO | blob storage | metadata-driven retention and access |
| Grafana / Sentry / OTel exporters | observability | operator visibility, not business truth |

## 2. Environment and secret classes

| Class | Examples | Operational rule |
| --- | --- | --- |
| Discord app secrets | bot token, client secret, interaction public key | scope to bot/API roles; never log |
| data-plane secrets | Postgres creds, Redis creds, Electric secret | validate at startup and fail closed |
| storage secrets | R2 or MinIO access keys | broker signed URLs server-side only |
| provider secrets | CAPTCHA or attestation webhook secrets | keep provider-specific rotation and callback verification auditable |
| observability secrets | Sentry DSNs, exporter endpoints | scrub payloads before egress |

Startup rule: each runtime validates required config for its role through shared `packages\config` loaders and aborts before accepting traffic if critical config is missing.

## 3. Queue and outbox operations

1. canonical Postgres writes happen before queue publish
2. outbox forwarding is the bridge from committed state to Redis Streams
3. `packages\queue` owns the shared Redis Streams envelope shape so messages always carry canonical refs plus propagated `traceparent`
4. each consumer group owns retries, checkpointing, and poison-message handling
5. `XAUTOCLAIM`-style recovery is required for abandoned work
6. trimming or retention of Redis Streams must be based on durable Postgres receipts, not hope

Recommended runbook triggers:

| Symptom | Likely problem | First response |
| --- | --- | --- |
| growing pending entries | crashed or stuck consumer | inspect consumer health, use checkpoint + `XAUTOCLAIM` recovery |
| repeated same message failures | poison message or schema drift | move to dead-letter handling, preserve trace and payload refs |
| API commit without downstream work | outbox forwarder issue | inspect outbox backlog before reprocessing |
| dashboard stale while API is healthy | Electric lag or read-model issue | verify Postgres write health, then Electric sync health |

## 4. Deploy and migration order

1. deploy backward-compatible Bun/Rust code first when possible
2. run Postgres migrations and extension/bootstrap steps before enabling new features that depend on them
3. roll out outbox or stream consumers only after canonical tables and receipts exist
4. enable UI surfaces only after their read models are synced and observable
5. provider callbacks and signed URL flows should stay disabled until secrets and audit paths are confirmed

Concrete repo path:

1. local Docker bootstrap mounts `docker\postgres\init\001-humanify.sql` only to preload `vector` on first database initialization
2. `packages\db\migrations\0001_canonical_spine.sql` owns canonical tables, enums, constraints, and `pgcrypto` / `vector` assertions
3. `bun run db:migrate` is the Bun-first entrypoint for local and future deployment automation
4. `bun run dev` runs `bun run db:migrate` after Docker readiness and before Bun/Rust services start

## 5. Required observability for operations

This document inherits the detailed rules in `docs\observability-security.md`. Operators should expect:

- traceable ingress-to-action lineage
- structured logs with request and case correlation
- metrics for queue lag, callback rejects, verification funnel, evidence backlog, and execution failures
- durable audit rows for moderation, verification, evidence, and config changes
- Sentry events scrubbed of secrets, raw evidence, and provider payloads

## 6. Failure-handling principles

| Failure type | Operational response |
| --- | --- |
| Rust advisory service unavailable | degrade to deterministic/Bun-side review path; do not grant extra enforcement power |
| Electric unavailable | dashboard/verifier may become stale, but Postgres remains source of truth |
| Redis unavailable | block async fan-out, preserve canonical writes and backlog visibility |
| R2/MinIO unavailable | prevent new evidence uploads/downloads safely, keep metadata and audit visible |
| provider callback invalid | reject, audit, and keep current verification state |
| bot permission drift | refuse execution, alert moderators/operators, preserve action intent receipt |

## 7. CI and release gates expected after scaffolding

Later automation should require at least:

- workspace validation
- Bun typecheck and tests
- Rust test/build coverage appropriate to changed crates/services
- migration validation against a clean Postgres instance
- callback signature and idempotency tests for providers
- evidence-storage and queue replay integration tests

## 8. Runbooks that should eventually exist as concrete procedures

1. rotate Discord/provider/storage secrets
2. recover a stuck Redis Streams consumer group
3. replay outbox events safely
4. rebuild Electric or local SQLite projections from Postgres
5. pause verification or evidence ingest safely during provider/storage incidents
6. restore Postgres and rehydrate rebuildable projections

Until those concrete runbooks exist, future work should update this doc as the operational source of truth.
