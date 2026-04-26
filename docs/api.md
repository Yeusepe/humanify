# Humanify API boundary

Purpose: define the authoritative Bun HTTP surface, route groups, write semantics, auth boundaries, and callback rules that later `apps\api-bun` work must implement.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\contracts.md`
- `docs\data-platform.md`
- `docs\observability-security.md`
- `docs\architecture.md`
- `docs\verification.md`
- `docs\cases-and-reports.md`
- `docs\api.md`

Upstream docs:
- Elysia: https://elysiajs.com/at-glance
- Discord OAuth2: https://discord.com/developers/docs/topics/oauth2
- Discord interactions security: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
- PostgreSQL: https://www.postgresql.org/docs/current/index.html
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- OpenTelemetry context propagation: https://opentelemetry.io/docs/concepts/context-propagation/
- Bun HTTP runtime: https://bun.sh/docs/api/http

## 1. API role

`apps\api-bun` is the product-facing authority boundary for Humanify. It is responsible for:

1. authenticating moderators and verifier users
2. validating every external request at the first boundary
3. loading canonical guild policy and actor authorization context
4. writing Postgres business state and outbox rows in the same transaction
5. calling Rust services only for advisory or transform work
6. producing audit records for security-sensitive mutations

The API is not allowed to turn Rust outputs into enforcement without Bun-side policy evaluation.

## 2. Actor classes

| Actor | Primary entrypoints | Required checks |
| --- | --- | --- |
| Moderator browser session | dashboard routes and mutations | Discord OAuth2 session, guild membership, role/permission checks, CSRF/state protection |
| Verifier browser session | verification start/status/challenge routes | Discord account binding, session/challenge expiry, provider-specific capability rules |
| Discord bot | internal API routes and callbacks it triggers | signed internal service identity or shared internal auth contract, guild-scoped authorization |
| Provider callback sender | `POST /callbacks/*` | signature verification, replay resistance, provider enabled for guild, idempotency receipt |
| Internal worker/service | action approval, evidence, or projection refresh routes where needed | service identity, scope-limited auth, canonical state re-check |

## 3. Route inventory

The exact path names may evolve, but the route groups and ownership below should remain stable.

| Group | Representative routes | Notes |
| --- | --- | --- |
| Health and metadata | `GET /healthz`, `GET /service-info`, `GET /contracts/summary`, `GET /contracts/schema` | never mutates state |
| Auth | `POST /auth/discord/start`, `GET /auth/discord/callback`, `POST /auth/logout`, `GET /session` | owns browser session bootstrap and guild-scoped identity |
| Guild config | `GET /guilds/:guildId/policy`, `PUT /guilds/:guildId/policy`, `PUT /guilds/:guildId/channels`, `PUT /guilds/:guildId/verification` | all writes create audit records |
| Cases | `GET /guilds/:guildId/cases`, `GET /guilds/:guildId/cases/:caseId`, `POST /guilds/:guildId/cases/:caseId/review`, `POST /guilds/:guildId/cases/:caseId/appeal` | ties into `docs\cases-and-reports.md` |
| Reports and evidence | `POST /guilds/:guildId/reports`, `POST /guilds/:guildId/reports/:reportId/evidence`, `POST /guilds/:guildId/evidence/upload-url`, `POST /guilds/:guildId/evidence/:evidenceId/redact` | upload URLs are brokered, time-limited, and auditable |
| Verification | `POST /guilds/:guildId/verification/sessions`, `GET /verification/sessions/:sessionId`, `POST /verification/challenges/:challengeId/complete`, `POST /verification/sessions/:sessionId/release` | detailed flow in `docs\verification.md` |
| Provider callbacks | `POST /callbacks/discord/interactions`, `POST /callbacks/providers/:providerId` | raw-body verification, replay-safe, Postgres-first writes |
| Moderation | `POST /guilds/:guildId/moderation/approve`, `POST /guilds/:guildId/moderation/quarantine`, `POST /guilds/:guildId/moderation/timeout`, `POST /guilds/:guildId/moderation/kick`, `POST /guilds/:guildId/moderation/ban` | API clamps action against policy before the bot executes |
| Read models and audit | `GET /guilds/:guildId/audit`, `GET /guilds/:guildId/risk-queue`, `GET /guilds/:guildId/users/:userId/profile` | should read Postgres/Electric-backed views rather than recomputing |

## 4. Request and transaction rules

1. **Validate before side effects.** Request bodies, params, auth context, and callback signatures are checked before any mutation or remote call.
2. **Write Postgres first.** If the request creates or changes business state, the canonical Postgres mutation and any matching outbox row happen before queue publication or long-running follow-up work.
3. **Attach idempotency at the boundary.** Provider callbacks, repeated moderator actions, report submissions with uploads, and retryable verifier steps must write durable idempotency receipts.
4. **Emit audit rows inside or immediately after the canonical write.** Do not rely on logs as the only explanation trail.
5. **Return stable error shapes.** API consumers should receive a request-correlated typed error envelope rather than framework-native text blobs.

Recommended error envelope:

```ts
interface ApiErrorEnvelope {
  requestId: string;
  errorCode:
    | "unauthorized"
    | "forbidden"
    | "validation_failed"
    | "conflict"
    | "not_found"
    | "rate_limited"
    | "provider_callback_invalid"
    | "dependency_unavailable"
    | "internal_error";
  message: string;
  retryable: boolean;
}
```

## 5. Callback and webhook rules

| Callback type | Required controls | Canonical outcome |
| --- | --- | --- |
| Discord interaction HTTP ingress | verify Discord signature and timestamp over the raw body before parsing | accepted interaction event or explicit rejection audit |
| Verification provider callback | verify provider signature or equivalent proof, enforce replay resistance, reject disabled providers | provider event receipt plus verification session transition |
| Browser return/callback after OAuth2 | validate CSRF/state, bind Discord identity to pending session, exchange code server-side only | moderator or verifier session creation |

Callback writes must be **idempotent** and **Postgres-first**. Queue publication or downstream Rust work comes after the durable receipt exists.

## 6. Auth and authorization boundaries

1. Moderator-facing routes require a Discord-authenticated browser session plus guild-scoped authorization.
2. Verification routes require a verifier session bound to the same Discord account and guild challenge that started the flow.
3. Internal routes used by the bot or workers must use service identity, not moderator sessions.
4. Capability checks are separate from identity checks: a moderator may be logged in but still lack permission to approve `kick` or `ban` actions.
5. `allowAutoBan` and `maxAutomaticAction` remain policy data; they are never inferred from a Rust recommendation.

## 7. Outbound dependency rules

| Dependency | API uses it for | Guardrails |
| --- | --- | --- |
| Postgres | canonical state, outbox, idempotency, audit | transactions own truth |
| Redis Streams | async fan-out after canonical commit | publish references and immutable facts, not exclusive state |
| Rust services | scoring, similarity, learning, evidence transforms | advisory-only or transform-only results |
| R2/MinIO | brokered evidence uploads/downloads | short-lived signed URLs, Postgres-owned metadata |
| Electric | UI read-model sync | API owns what is synced; Electric does not create business state |

## 8. What later implementation should add here

- API runtime boot should compose shared kernel packages instead of re-implementing their concerns:
  - `packages\config` for startup validation and safe env summaries
  - `packages\auth` for Discord OAuth URL/state/session helpers
  - `packages\db` for canonical write plans, idempotency receipts, and outbox metadata
  - `packages\queue` for Redis Streams envelopes that carry canonical refs plus `traceparent`
  - `packages\policy-engine` for advisory-score clamps into allowed actions
  - `packages\telemetry` for trace propagation, header redaction, and structured log context
- concrete route-to-handler ownership once shared Bun packages exist
- exact auth/session cookie or token contract once `packages\auth` is introduced
- exact request and response schemas for each route group once the JSON Schema and generated types expand
- provider-specific callback contracts once the first real provider is selected and documented in `docs\verification.md`
