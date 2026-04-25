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
- discord.js: https://discord.js.org/docs/packages/discord.js/main
- Elysia: https://elysiajs.com/at-glance
- TanStack Start React overview: https://tanstack.com/start/latest/docs/framework/react/overview
- TanStack Start build from scratch: https://tanstack.dev/start/latest/docs/framework/react/build-from-scratch
- TanStack Start Tailwind integration: https://tanstack.dev/start/latest/docs/framework/react/guide/tailwind-integration
- HeroUI React getting started: https://www.heroui.com/docs/react/getting-started
- HeroUI theming: https://www.heroui.com/docs/react/getting-started/theming
- HeroUI styling: https://www.heroui.com/docs/react/getting-started/styling
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Cargo manifests: https://doc.rust-lang.org/cargo/reference/manifest.html
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
- Repo-level scripts:
  - `bun run check`
  - `bun run build`
  - `bun run dev`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run format:check`
  - `bun test`
- `tooling\verify-workspaces.ts` remains the single source of truth for required Bun workspace directories, root manifests, and first-class Bun app/package entry files.
- Root Bun scripts delegate workspace work with `bun run --filter '*' ...` so new apps/packages participate automatically once they define the standard scripts.
- `tooling\run-cargo-metadata.ts` skips Cargo metadata cleanly when a shared environment contains partial Rust scaffolding outside the Bun workstream.
- `tooling\dev-stack.ts` owns root local-stack orchestration so developers can start the full Bun + Rust stack with one command.

### Bun workspace ownership

| Workspace | Role | Notes |
| --- | --- | --- |
| `apps\bot-bun` | Bun + `discord.js` bot runtime shell | Starts a real Discord client only when `DISCORD_BOT_TOKEN` is provided |
| `apps\api-bun` | Bun + Elysia HTTP surface | Exposes health and contract-summary endpoints |
| `apps\dashboard-start` | TanStack Start + React 19 dashboard shell | Imports Tailwind v4 and HeroUI v3 styles |
| `apps\verifier-start` | TanStack Start + React 19 verifier shell | Mirrors dashboard stack with verifier-specific content |
| `packages\contracts` | Shared Bun contract package | Re-exports the canonical JSON Schema instead of copying Rust contract definitions |
| `packages\ui` | Shared HeroUI shell components | Provides minimal shared layout components for Start apps |

### Local dev stack command

- Run `bun run dev` from the repo root to start the current local stack:
  - `apps\api-bun` on port `3001`
  - `apps\dashboard-start` on port `3000`
  - `apps\verifier-start` on port `3002`
  - `services\inference-rs` on port `4101`
  - `services\learning-rs` on port `4102`
  - `services\evidence-rs` on port `4103`
  - `services\trust-rs` on port `4104`
- The Discord bot is also included when `DISCORD_BOT_TOKEN` is set; otherwise the stack launcher skips it with a warning so the rest of local development remains usable.
- The root launcher is intentionally orchestration-only: it starts the existing workspace/service dev entrypoints without inventing a second deployment model.

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
  verifier-start/

packages/
  contracts/
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
- `bun run format:check` follows the current Rust workspace state owned outside this workstream.
