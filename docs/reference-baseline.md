# Humanify Reference Baseline

This document is the governing local reference for the `build-reference-baseline` workstream.

Its job is to make future implementation work traceable: every meaningful module, service, integration, schema, or workflow should cite this document, the nearest governing local doc for the subsystem, and the exact upstream official docs it relies on.

## Governing local docs

- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`

## How to use this baseline

1. Before implementation, identify the subsystem you are changing and the nearest local governing doc.
2. Cite `docs\reference-baseline.md` plus the specific upstream official docs for the technologies you are touching.
3. If a feature depends on a version-specific API, pin the package/crate version and update this file with the version-locked official URL when available.
4. If official documentation cannot be identified for a dependency or integration detail, treat that as a blocker.

### Suggested citation pattern for future code and docs

```txt
Governing docs:
- AGENTS.md
- Implementation Plan.txt
- docs\reference-baseline.md
- docs\<subsystem-doc>.md

Upstream docs:
- <official URL 1>
- <official URL 2>
```

## Product/runtime references

### Bun

- Planned use: primary JavaScript/TypeScript runtime, package manager, workspace tool, script runner, and test runner for product surfaces.
- Official docs:
  - https://bun.sh/docs
  - https://bun.sh/docs/runtime/env

### TypeScript

- Planned use: source language and root compiler configuration for Bun apps, shared packages, and repo-level tooling.
- Official docs:
  - https://www.typescriptlang.org/docs/
  - https://www.typescriptlang.org/tsconfig

### Discord platform + discord.js v14

- Planned use: Discord gateway, REST, commands, interactions, and moderation-facing bot orchestration in Bun apps.
- Official docs:
  - https://discord.js.org/docs/packages/discord.js/main
  - https://discord.com/developers/docs/intro
  - https://discord.com/developers/docs/topics/oauth2
  - https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
- Implementation note: when the workspace pins an exact `discord.js` v14 patch, add the corresponding version-specific docs URL here.

### Elysia

- Planned use: Bun-native API framework for `apps/api-bun`.
- Official docs:
  - https://elysiajs.com/at-glance

### TanStack Start RC

- Planned use: full-stack React framework for `apps/dashboard-start` and `apps/verifier-start`.
- Official docs:
  - https://tanstack.com/start/latest/docs/framework/react/overview
- Implementation note: this stack is still RC; keep version selection and doc URL updates synchronized.

### React 19

- Planned use: dashboard and verifier UI runtime.
- Official docs:
  - https://react.dev/blog/2024/12/05/react-19
  - https://react.dev/reference/react

### HeroUI v3

- Planned use: primary React component system for dashboard and verifier UIs.
- Official docs:
  - https://www.heroui.com/docs/react/getting-started

### Tailwind CSS v4

- Planned use: design tokens, utilities, layout, and styling foundation for HeroUI/TanStack Start surfaces.
- Official docs:
  - https://tailwindcss.com/docs
  - https://tailwindcss.com/docs/installation/using-vite

### TanStack DB beta

- Planned use: reactive client-side live data layer for dashboard and verifier apps.
- Official docs:
  - https://tanstack.com/db/latest/docs/overview
- Implementation note: this stack is beta; keep version selection and doc URL updates synchronized.

### Electric Postgres Sync

- Planned use: Postgres-to-client sync layer paired with TanStack DB for live application state.
- Official docs:
  - https://electric-sql.com/docs/intro
  - https://electric-sql.com/primitives/postgres-sync

## Data, search, queue, and storage references

### PostgreSQL

- Planned use: canonical transactional store for guild configuration, users, cases, outcomes, audit history, and policy state.
- Official docs:
  - https://www.postgresql.org/docs/current/index.html

### pgvector

- Planned use: canonical vector storage inside Postgres for embeddings tied to cases, evidence, and learned outcomes.
- Official docs:
  - https://github.com/pgvector/pgvector/blob/master/README.md

### SQLite

- Planned use: embedded prediction storage and local durable caches.
- Official docs:
  - https://www.sqlite.org/docs.html

### libSQL

- Planned use: SQLite-compatible option for embedded/local-first prediction storage where libSQL capabilities are needed.
- Official docs:
  - https://docs.turso.tech/libsql

### sqlite-vec

- Planned use: vector similarity inside SQLite/libSQL-backed embedded prediction stores.
- Official docs:
  - https://alexgarcia.xyz/sqlite-vec/

### Qdrant

- Planned use: optional external vector store if `pgvector` stops meeting throughput or filtering needs.
- Official docs:
  - https://qdrant.tech/documentation/

### Redis Streams

- Planned use: primary queue/event transport between Bun apps and Rust services.
- Official docs:
  - https://redis.io/docs/latest/develop/data-types/streams/
  - https://redis.io/docs/latest/commands/xautoclaim/

### Cloudflare R2

- Planned use: evidence/object blob storage, with canonical metadata and hashes stored elsewhere.
- Official docs:
  - https://developers.cloudflare.com/r2/
  - https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## Observability references

### OpenTelemetry

- Planned use: traces, metrics, and logs instrumentation across Bun apps and Rust services.
- Official docs:
  - https://opentelemetry.io/docs/
  - https://opentelemetry.io/docs/concepts/signals/
  - https://opentelemetry.io/docs/concepts/context-propagation/
  - https://opentelemetry.io/docs/languages/js/propagation/
  - https://opentelemetry.io/docs/languages/rust/

### Sentry

- Planned use: error capture and performance visibility for product surfaces and services.
- Official docs:
  - https://docs.sentry.io/
  - https://docs.sentry.io/platforms/javascript/guides/bun/
  - https://docs.sentry.io/platforms/javascript/guides/bun/configuration/options/
  - https://docs.sentry.io/platforms/rust/
  - https://docs.sentry.io/platforms/rust/data-management/data-collected/

### Grafana

- Planned use: dashboards and observability visualization for metrics, logs, and traces.
- Official docs:
  - https://grafana.com/docs/

## Rust intelligence references

### Axum

- Planned use: HTTP service framework for Rust inference, learning, evidence, and trust services.
- Official docs:
  - https://docs.rs/axum/latest/axum/

### Tokio

- Planned use: async runtime and concurrency foundation for Rust services and workers.
- Official docs:
  - https://tokio.rs/tokio/tutorial
  - https://docs.rs/tokio/latest/tokio/

### Cargo

- Planned use: workspace manifests, package metadata inheritance, and repo-level Rust package orchestration for crates and services.
- Official docs:
  - https://doc.rust-lang.org/cargo/reference/workspaces.html
  - https://doc.rust-lang.org/cargo/reference/manifest.html

### fastembed-rs

- Planned use: embedding generation for similarity, retrieval, and learned signal features.
- Official docs:
  - https://docs.rs/fastembed/latest/fastembed/

### Candle

- Planned use: native Rust inference for models that should stay inside the Rust stack.
- Official docs:
  - https://huggingface.github.io/candle/

### ort

- Planned use: ONNX Runtime bindings for Rust inference paths.
- Official docs:
  - https://ort.pyke.io/

### Burn

- Planned use: Rust-native training, experimentation, and model workflow exploration.
- Official docs:
  - https://burn.dev/books/burn/

### image

- Planned use: core image decoding, encoding, and manipulation for evidence processing.
- Official docs:
  - https://docs.rs/image/latest/image/

### fast_image_resize

- Planned use: high-throughput image resizing in evidence pipelines.
- Official docs:
  - https://docs.rs/fast_image_resize/latest/fast_image_resize/

### blake3

- Planned use: fast cryptographic hashing for evidence identity, deduplication, and integrity checks.
- Official docs:
  - https://docs.rs/blake3/latest/blake3/

### xxhash-rust

- Planned use: non-cryptographic fast hashing where speed matters more than cryptographic guarantees.
- Official docs:
  - https://docs.rs/xxhash-rust/latest/xxhash_rust/

## First follow-up docs expected after this baseline

- `docs\architecture.md` or an updated `Implementation Plan.txt` section that locks Bun + Rust boundaries.
- `docs\contracts.md` for Bun/Rust request, response, event, and reason-code contracts.
- `docs\operations.md` for queues, retries, idempotency, storage, and observability.

Until those docs exist, this file is the local governing reference for stack selection and upstream documentation lookup.
