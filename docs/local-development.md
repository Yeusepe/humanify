# Humanify local development stack

Purpose: define the full local-stack bring-up behind the root `bun run dev` command, including Docker-managed infrastructure, Bun app surfaces, Rust services, readiness expectations, and local environment requirements.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\workspaces.md`
- `docs\data-platform.md`
- `docs\observability-security.md`
- `docs\local-development.md`

Upstream docs:
- Docker Compose: https://docs.docker.com/compose/
- `docker compose up`: https://docs.docker.com/reference/cli/docker/compose/up/
- Electric installation: https://electric-sql.com/docs/guides/installation
- Electric sync config: https://electric-sql.com/docs/api/config
- Postgres.js: https://github.com/porsager/postgres
- pgvector Docker image: https://hub.docker.com/r/pgvector/pgvector
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- MinIO container docs: https://min.io/docs/minio/container/index.html
- Qdrant docs: https://qdrant.tech/documentation/
- Grafana Docker install: https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/
- Bun subprocesses: https://bun.sh/docs/api/spawn
- Cargo run: https://doc.rust-lang.org/cargo/commands/cargo-run.html

## 1. What `bun run dev` now does

The root command is the authoritative local bring-up entrypoint.

It performs the following in order:

1. Preflights every fixed host port the stack owns and fails immediately if any of them are already occupied
2. Starts local infrastructure with `docker compose -f docker-compose.local.yml up -d --wait --remove-orphans`
3. Applies the canonical Postgres migration bundle with `bun run db:migrate`
4. Starts the Bun application surfaces
5. Starts the Rust HTTP services
6. Waits for the application/service HTTP endpoints to become reachable
7. Keeps the stack attached until interrupted
8. Shuts down the child processes and local infrastructure when interrupted or when a managed process exits unexpectedly

This is local development orchestration, not a production deployment model.

If startup fails before the managed app processes are attached (for example, during migrations), the launcher now tears Docker Compose back down instead of leaving infra half-running.

## 2. Local infrastructure services

The local infrastructure stack currently includes:

| Service | Role | Host port |
| --- | --- | --- |
| Postgres + `pgvector` | canonical transactional store and vector extension | `5432` |
| Redis | Streams, queue state, ephemeral coordination | `6379` |
| Electric | self-hosted sync service in front of Postgres | `5133` |
| MinIO | local S3-compatible stand-in for Cloudflare R2 | `9000` API / `9001` console |
| Qdrant | optional vector/search sidecar for local experimentation | `6333` HTTP / `6334` gRPC |
| Grafana | local observability UI surface | `4300` |

### R2 note

Cloudflare R2 is the deployed object-storage target. Because R2 does not run locally, the development stack uses MinIO as a local S3-compatible stand-in.

### Postgres bootstrap note

- `docker\postgres\init\001-humanify.sql` only preloads `vector` when the Docker volume is initialized for the first time.
- The authoritative schema bootstrap path is `packages\db\migrations\0001_canonical_spine.sql` through `bun run db:migrate`.
- `bun run dev` executes that migration command automatically after Docker Compose reports infrastructure readiness.

## 3. Bun and Rust processes

After the Docker services are up, the root command starts:

| Process | Role | URL |
| --- | --- | --- |
| `apps\api-bun` | Bun + Elysia API | `http://localhost:3211/healthz` |
| `apps\dashboard-start` | dashboard shell | `http://localhost:3210/` |
| `apps\verifier-start` | verifier shell | `http://localhost:3212/` |
| `services\inference-rs` | inference service | `http://localhost:4101/healthz` |
| `services\learning-rs` | learning service | `http://localhost:4102/healthz` |
| `services\evidence-rs` | evidence service | `http://localhost:4103/healthz` |
| `services\trust-rs` | trust service | `http://localhost:4104/healthz` |

The dashboard and verifier use Vite `--strictPort` so they fail loudly if another process occupies their assigned ports.

## 4. Fixed-port preflight behavior

Before Docker or any child process starts, `bun run dev` checks that every required host port is available.

- This prevents stale listeners from satisfying readiness probes and causing a later false "stack is ready" message.
- It also keeps the command honest on shared machines: if the port map is already occupied, the stack does not partially boot.
- On Windows, the launcher first attempts to reap **repo-owned stale listeners** still bound to managed stack ports before failing preflight.

On Windows, use this PowerShell command to find the conflicting process for one or more ports:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3210,3211,3212,4101,4102,4103,4104,5432,6379,5133,9000,9001,6333,6334,4300 |
  Select-Object LocalAddress, LocalPort, OwningProcess, State
```

## 5. Discord bot behavior

The root command now treats the bot as part of the full stack.

- If `DISCORD_BOT_TOKEN` is set, the bot is started automatically.
- If `DISCORD_BOT_TOKEN` is **not** set and `HUMANIFY_SKIP_BOT` is not `1`, the root command fails fast instead of silently running a partial stack.
- If you intentionally want to work without the Discord bot, set `HUMANIFY_SKIP_BOT=1`.

This keeps the default behavior honest while still allowing deliberate botless work.

## 6. Environment bootstrap

Copy `.env.example` to `.env` for local development and adjust values as needed.

Important variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | required for the bot unless explicitly skipped |
| `DISCORD_CLIENT_ID` | required for Bun API Discord OAuth boot preflight |
| `DISCORD_CLIENT_SECRET` | required for Bun API Discord OAuth boot preflight |
| `DISCORD_REDIRECT_URI` | required Discord OAuth callback URL for Bun API boot |
| `HUMANIFY_SKIP_BOT` | explicit opt-out for botless local work |
| `HUMANIFY_ENABLED_VERIFICATION_PROVIDERS` | comma-separated provider ids enabled in the Bun API (`self,world_id,didit` by default) |
| `HUMANIFY_DIDIT_API_KEY` | Didit server API key used by `apps\api-bun` to create, inspect, and purge capture sessions |
| `HUMANIFY_DIDIT_WEBHOOK_SECRET` | shared secret used to verify `x-signature-v2` on Didit callbacks |
| `HUMANIFY_DIDIT_WORKFLOW_ID` | default Didit workflow UUID used for first-time capture |
| `HUMANIFY_DIDIT_API_BASE_URL` | optional override for the Didit API origin (defaults to `https://verification.didit.me`) |
| `HUMANIFY_API_PORT` | Bun API port |
| `HUMANIFY_VERIFIER_BASE_URL` | absolute verifier shell base URL used when Bun builds Didit callback and launch URLs |
| `HUMANIFY_DATABASE_URL` | optional full Postgres connection string for Bun-side migration/bootstrap tooling |
| `HUMANIFY_SESSION_SECRET` | required API session secret; `bun run dev` preflights it before starting local services |
| `HUMANIFY_POSTGRES_HOST` | host used by host-run Bun tooling when `HUMANIFY_DATABASE_URL` is unset |
| `HUMANIFY_POSTGRES_PORT` | host Postgres port used by Docker publish + host-run Bun tooling |
| `HUMANIFY_*_BIND_ADDR` | Rust service bind addresses |
| `HUMANIFY_POSTGRES_*` | Postgres credentials/database name |
| `HUMANIFY_ELECTRIC_PORT` | host port for Electric |
| `HUMANIFY_ELECTRIC_SECRET` | required Electric secret |
| `HUMANIFY_MINIO_*` | MinIO local credentials and ports |
| `HUMANIFY_QDRANT_*` | Qdrant local ports |
| `HUMANIFY_GRAFANA_*` | Grafana local credentials and port |
| `VITE_HUMANIFY_ENABLED_VERIFICATION_PROVIDERS` | comma-separated provider ids shown in the verifier UI; keep this aligned with the API variable above |

SQLite/libSQL-based local prediction state remains file-backed and does not require a separate container yet.

`bun run dev` now validates the documented Bun API boot contract up front. If `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, or `HUMANIFY_SESSION_SECRET` are missing, the launcher exits before starting Docker Compose or child processes.

## 7. Stopping the stack

The root command stops the managed Bun and Rust processes on `SIGINT`/`SIGTERM` and then runs Docker Compose down for the local infrastructure.

On Windows, the launcher now stops each managed child with `taskkill /PID <pid> /T /F` so `Ctrl+C` tears down the full spawned process tree instead of leaving nested Bun, Cargo, or Vite processes behind.
It also performs one last pass over the managed port map to reap any remaining repo-owned listeners that survived after their parent process exited.

Named Docker volumes persist between runs, so local development data is not discarded unless you remove the volumes yourself.
