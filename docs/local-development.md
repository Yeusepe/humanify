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

1. Starts local infrastructure with `docker compose -f docker-compose.local.yml up -d --wait --remove-orphans`
2. Starts the Bun application surfaces
3. Starts the Rust HTTP services
4. Waits for the application/service HTTP endpoints to become reachable
5. Keeps the stack attached until interrupted
6. Shuts down the child processes and local infrastructure when interrupted or when a managed process exits unexpectedly

This is local development orchestration, not a production deployment model.

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

## 4. Discord bot behavior

The root command now treats the bot as part of the full stack.

- If `DISCORD_BOT_TOKEN` is set, the bot is started automatically.
- If `DISCORD_BOT_TOKEN` is **not** set and `HUMANIFY_SKIP_BOT` is not `1`, the root command fails fast instead of silently running a partial stack.
- If you intentionally want to work without the Discord bot, set `HUMANIFY_SKIP_BOT=1`.

This keeps the default behavior honest while still allowing deliberate botless work.

## 5. Environment bootstrap

Copy `.env.example` to `.env` for local development and adjust values as needed.

Important variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | required for the bot unless explicitly skipped |
| `HUMANIFY_SKIP_BOT` | explicit opt-out for botless local work |
| `HUMANIFY_API_PORT` | Bun API port |
| `HUMANIFY_*_BIND_ADDR` | Rust service bind addresses |
| `HUMANIFY_POSTGRES_*` | Postgres credentials/database name |
| `HUMANIFY_ELECTRIC_PORT` | host port for Electric |
| `HUMANIFY_ELECTRIC_SECRET` | required Electric secret |
| `HUMANIFY_MINIO_*` | MinIO local credentials and ports |
| `HUMANIFY_QDRANT_*` | Qdrant local ports |
| `HUMANIFY_GRAFANA_*` | Grafana local credentials and port |

SQLite/libSQL-based local prediction state remains file-backed and does not require a separate container yet.

## 6. Stopping the stack

The root command stops the managed Bun and Rust processes on `SIGINT`/`SIGTERM` and then runs Docker Compose down for the local infrastructure.

Named Docker volumes persist between runs, so local development data is not discarded unless you remove the volumes yourself.
