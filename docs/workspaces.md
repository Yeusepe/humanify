# Workspace Bootstrap

This document governs the repo-level monorepo bootstrap created for `bootstrap-workspaces` and the Bun workspace scaffolds created for `scaffold-bun-apps`.

## Governing docs

- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\reference-baseline.md`
- `docs\README.md`

## Upstream docs

- Bun workspaces: https://bun.sh/docs/install/workspaces
- Bun test runner: https://bun.sh/docs/test
- Bun TypeScript support: https://bun.sh/docs/typescript
- GitHub Actions workflow syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Bun CI guide: https://bun.sh/guides/runtime/cicd
- `setup-bun` action: https://github.com/oven-sh/setup-bun
- Rust toolchain action: https://github.com/actions-rust-lang/setup-rust-toolchain
- discord.js: https://discord.js.org/docs/packages/discord.js/main
- Elysia: https://elysiajs.com/at-glance
- TanStack Start React overview: https://tanstack.com/start/latest/docs/framework/react/overview
- TanStack Start build from scratch: https://tanstack.dev/start/latest/docs/framework/react/build-from-scratch
- TanStack Start Tailwind integration: https://tanstack.dev/start/latest/docs/framework/react/guide/tailwind-integration
- Didit JavaScript SDK: https://docs.didit.me/integration/web-sdks/javascript-sdk
- Didit API full flow: https://docs.didit.me/integration/api-full-flow
- Didit webhooks: https://docs.didit.me/integration/webhooks
- Privado verifier overview: https://docs.privado.id/docs/verifier/verifier-overview/
- Privado request API: https://docs.privado.id/docs/verifier/verification-library/request-api/
- Privado verification API: https://docs.privado.id/docs/verifier/verification-library/verification-api/
- Privado verifier backend: https://docs.privado.id/docs/verifier/verifier-backend/
- W3C VC Data Model: https://www.w3.org/TR/vc-data-model/
- HeroUI React getting started: https://www.heroui.com/docs/react/getting-started
- HeroUI theming: https://www.heroui.com/docs/react/getting-started/theming
- HeroUI styling: https://www.heroui.com/docs/react/getting-started/styling
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Cargo manifests: https://doc.rust-lang.org/cargo/reference/manifest.html
- Postgres.js: https://github.com/porsager/postgres
- Temporal TypeScript SDK: https://docs.temporal.io/develop/typescript/core-application
- TypeScript `tsconfig`: https://www.typescriptlang.org/tsconfig
- `rustfmt` configuration: https://github.com/rust-lang/rustfmt/blob/master/Configurations.md

## Scope of this bootstrap

The repository is still greenfield, so the workspace layer establishes the root manifests, validation scripts, formatting hooks, and the first real Bun-side app/package skeletons needed by later workstreams.

Current boundaries:

- the Bun workspace root owns repo-level orchestration in `package.json`, `tsconfig.json`, and `tooling\`
- Bun apps and packages own minimal installable runtime shells under `apps\*` and `packages\*`
- the Cargo workspace root is owned by the Rust workstream and may evolve independently from Bun-side scaffolding
- Rust-owned paths (`crates\*`, `services\*`) remain out of scope for Bun-side app/package work

## Root workspace conventions

### Bun / TypeScript

- Root package manager/runtime: Bun
- Root workspace globs: `apps/*`, `packages/*`
- Repo automation entrypoints: `.github\workflows\ci.yml` and `.github\workflows\release-readiness.yml`
- Repo-level scripts:
  - `bun run check`
  - `bun run build`
  - `bun run db:migrate`
  - `bun run db:status`
  - `bun run dev`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run format:check`
  - `bun test`
- `tooling\verify-workspaces.ts` remains the single source of truth for required Bun workspace directories, root manifests, and first-class Bun app/package entry files.
- Root Bun scripts delegate workspace work with `bun run --filter '*' ...` so new apps/packages participate automatically once they define the standard scripts.
- `packages\db` owns the canonical SQL migration set and the Bun-first migration/status commands used by local development and future deploy hooks.
- `tooling\run-cargo-metadata.ts` skips Cargo metadata cleanly when a shared environment contains partial Rust scaffolding outside the Bun workstream.
- `tooling\dev-stack.ts` owns root local-stack orchestration so developers can start the full Docker + Bun + Rust stack with one command.
- `.github\workflows\ci.yml` mirrors the documented root scripts and adds Rust test coverage plus clean-database migration validation against the same `pgvector/pgvector:pg17` image used locally.
- `.github\workflows\release-readiness.yml` reruns the validation bundle for tags/manual releases and uploads build artifacts without pretending deploy automation exists.

### Bun workspace ownership

| Workspace | Role | Notes |
| --- | --- | --- |
| `apps\bot-bun` | Bun + `discord.js` bot runtime shell | Starts a real Discord client only when `DISCORD_BOT_TOKEN` is provided |
| `apps\api-bun` | Bun + Elysia HTTP surface | Exposes health and contract-summary endpoints |
| `apps\dashboard-start` | TanStack Start + React 19 moderation dashboard MVP | Imports Tailwind v4 and HeroUI v3 styles and currently exposes `/`, `/cases`, `/verification`, and `/policy` operator routes with explicit read-boundary states |
| `apps\scan-worker-temporal` | supported-runtime Temporal worker | Claims canonical scan requests from Postgres, executes durable `/scan` workflows, and syncs moderator warnings through the existing API boundary |
| `apps\verifier-start` | TanStack Start + React 19 verifier shell | Mirrors dashboard stack with verifier-specific content |
| `packages\auth` | Shared auth/session package | Owns Discord OAuth state, verifier challenge tokens, and session cookie helpers |
| `packages\config` | Shared Bun runtime config package | Validates service/env settings, Discord OAuth inputs, session secrets, and policy clamp defaults |
| `packages\db` | Shared Bun Postgres package | Owns migration discovery, connection resolution, and canonical schema bootstrap |
| `packages\contracts` | Shared Bun contract package | Re-exports the canonical JSON Schema instead of copying Rust contract definitions |
| `packages\discord-core` | Shared Discord execution package | Owns gateway intents, custom IDs, audit reasons, and capability-aware action helpers |
| `packages\policy-engine` | Shared Bun policy package | Converts advisory risk + guild policy into clamped allowed actions |
| `packages\queue` | Shared Redis Streams package | Owns queue envelopes, trace propagation, and recovery plan helpers |
| `packages\telemetry` | Shared observability package | Owns traceparent helpers, safe log fields, and redaction boundaries |
| `packages\verification-providers` | Shared verification strategy/pipeline package | Owns role-based strategy manifests, capture-provider adapters, reusable-proof backend adapters, Humanify claim predicate helpers, and runtime strategy filtering |
| `packages\ui` | Shared HeroUI shell components | Provides minimal shared layout components for Start apps |

Verification workspace rule:

- `packages\verification-providers` is not an app-level provider registry that leaks provider semantics into `apps\api-bun` or `apps\verifier-start`.
- It defines generic capture-provider, reusable-proof-backend, and policy-consumer strategy boundaries so the Bun apps stay orchestration-first.
- The approved default strategy mapping is Didit for first-time capture and Privado for reusable-proof verification, but the workspace contract stays role-based so later providers can be swapped without rewriting app logic.
- Humanify claim helpers and proof normalization in this package must preserve the repo's no-custody rule: only minimal proof receipts, attestation references, nullifiers or replay guards, and audit evidence may leave the strategy layer.

### Local dev stack command

- Run `bun run dev` from the repo root to start the local infra stack plus the Bun and Rust processes.
- `bun run dev` now applies `bun run db:migrate` after Docker infra readiness and before application processes start.
- `bun run dev` now also starts `apps\scan-worker-temporal` plus local Temporal/Temporal UI services so `/scan` and `/scan-all` can execute durably.
- The local infrastructure is defined in `docker-compose.local.yml`.
- `apps\dashboard-start` and `apps\verifier-start` now use Vite `--strictPort` so the documented ports remain stable instead of silently moving.
- The app-facing defaults are now `3210` (dashboard), `3211` (API), and `3212` (verifier) to reduce collisions with other common local tooling.
- The root launcher preflights every required host port before startup and fails fast instead of reporting readiness against stale listeners.
- See `docs\local-development.md` for the authoritative port map, env requirements, infra services, and bot inclusion rules.

### Rust

- Root `Cargo.toml` remains the authoritative Cargo workspace manifest.
- Rust membership, exclusions, shared dependencies, and lint policy are owned by the Rust workstream.
- Bun-side validation only requires that the root manifest continues to be a valid Cargo workspace.
- `tooling\run-rustfmt.ts` defers to the current Rust workspace state rather than hard-coding Bun-side assumptions.

## Planned directory layout

```txt
apps/
  api-bun/
  bot-bun/
  dashboard-start/
  scan-worker-temporal/
  verifier-start/

packages/
  auth/
  config/
  db/
  contracts/
  discord-core/
  policy-engine/
  queue/
  telemetry/
  verification-providers/
  ui/

crates/
  humanify-core/
  humanify-evidence/
  humanify-inference/
  humanify-learning/
  humanify-policy/
  humanify-proto/
  humanify-risk/

services/
  evidence-rs/
  inference-rs/
  learning-rs/
  trust-rs/
```

## Validation expectations

- `bun run check` must validate the root workspace contract, Cargo workspace presence, and Bun workspace typechecks/tests.
- `bun run build` builds the Start apps and runs build hooks for Bun packages/apps.
- `bun test` covers the repo-level workspace validator plus Bun-side package/app tests where available.
- Shared Bun kernel packages must expose a real `src\index.ts` entrypoint plus package-level `build`, `lint`, and `typecheck` scripts so root workspace filters can treat them as first-class workspaces.
- `bun run format:check` follows the current Rust workspace state owned outside this workstream.
- CI must keep using the same root commands where they exist, plus `cargo test --workspace --all-targets` and `bun run db:migrate` / `bun run db:status` against a clean Postgres service so migration drift is caught before merge.
