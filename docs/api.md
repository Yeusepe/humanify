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
- Didit API flow: https://docs.didit.me/integration/api-full-flow
- Didit webhooks: https://docs.didit.me/integration/webhooks
- Privado verifier overview: https://docs.privado.id/docs/verifier/verifier-overview/
- Privado request API: https://docs.privado.id/docs/verifier/verification-library/request-api/
- Privado universal links: https://docs.privado.id/docs/wallet/universal-links/
- Privado verification API: https://docs.privado.id/docs/verifier/verification-library/verification-api/
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
| Verifier browser session | verification start/status/challenge routes | Discord account binding, session/challenge expiry, strategy eligibility rules, server-verification-required invariants |
| Discord bot | internal API routes and callbacks it triggers | signed internal service identity or shared internal auth contract, guild-scoped authorization |
| Strategy callback sender | `POST /callbacks/*` | verify the concrete adapter receipt, replay resistance, adapter enabled for guild, idempotency receipt |
| Internal worker/service | action approval, evidence, or projection refresh routes where needed | service identity, scope-limited auth, canonical state re-check |

## 3. Route inventory

The exact path names may evolve, but the route groups and ownership below remain stable.

| Group | Representative routes | Notes |
| --- | --- | --- |
| Health and metadata | `GET /healthz`, `GET /service-info`, `GET /contracts/summary`, `GET /contracts/schema` | never mutates state |
| Auth | `POST /auth/discord/start`, `GET /auth/discord/callback`, `POST /auth/logout`, `GET /session` | owns browser session bootstrap and guild-scoped identity |
| Guild config | `GET /guilds/:guildId/policy`, `PUT /guilds/:guildId/policy`, `PUT /guilds/:guildId/channels`, `PUT /guilds/:guildId/verification` | all writes create audit records; verification config owns enabled strategy adapters and the guild default first-time capture adapter |
| Cases | `GET /guilds/:guildId/cases`, `GET /guilds/:guildId/cases/:caseId`, `POST /guilds/:guildId/cases/:caseId/review`, `POST /guilds/:guildId/cases/:caseId/appeal` | ties into `docs\cases-and-reports.md` |
| Reports and evidence | `POST /guilds/:guildId/reports`, `POST /guilds/:guildId/reports/:reportId/evidence`, `POST /guilds/:guildId/evidence/upload-url`, `POST /guilds/:guildId/evidence/:evidenceId/redact` | report intake and Discord message-link evidence now persist canonically in Postgres; blob upload URLs remain brokered, time-limited, and auditable |
| Verification | `POST /guilds/:guildId/verification/sessions`, `GET /verification/sessions/:sessionId`, `POST /verification/challenges/:challengeId/complete`, `POST /verification/sessions/:sessionId/providers/:providerId/start`, `POST /verification/providers/:providerId/proof`, `POST /verification/sessions/:sessionId/release` | strategy/pipeline-oriented session flow; detailed verification role model lives in `docs\verification.md` |
| Strategy callbacks | `POST /callbacks/discord/interactions`, `POST /callbacks/providers/:providerId` | raw-body verification, replay-safe, Postgres-first writes; concrete path remains provider-shaped but semantics are strategy handoff receipts |
| Moderation | `POST /guilds/:guildId/moderation/approve`, `POST /guilds/:guildId/moderation/quarantine`, `POST /guilds/:guildId/moderation/timeout`, `POST /guilds/:guildId/moderation/kick`, `POST /guilds/:guildId/moderation/ban` | API clamps action against policy before the bot executes |
| Read models and audit | `GET /guilds/:guildId/audit`, `GET /guilds/:guildId/risk-queue`, `GET /guilds/:guildId/users/:userId/profile` | read Postgres/Electric-backed views rather than recomputing |

## 4. Request and transaction rules

1. **Validate before side effects.** Request bodies, params, auth context, and callback signatures are checked before any mutation or remote call.
2. **Write Postgres first.** If the request creates or changes business state, the canonical Postgres mutation and any matching outbox row happen before queue publication or long-running follow-up work.
3. **Attach idempotency at the boundary.** Provider callbacks, repeated moderator actions, report submissions with uploads, and retryable verifier steps must write durable idempotency receipts.
4. **Emit audit rows inside or immediately after the canonical write.** Do not rely on logs as the only explanation trail.
5. **Return stable error shapes.** API consumers receive a request-correlated typed error envelope rather than framework-native text blobs.

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
| Verification strategy handoff receipt | verify the concrete adapter's signature or proof server-side, enforce replay resistance, reject disabled adapters, and treat browser success as non-canonical | strategy receipt plus verification session transition |
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

## 8. Current `api-domain-spine` implementation notes

`apps\api-bun` now implements the route groups above with validated Elysia handlers and a stable request-correlated envelope shape:

```ts
interface ApiSuccessEnvelope<T> {
  contractVersion: string;
  requestId: string;
  data: T;
}
```

Implementation details made concrete by the current spine:

- `GET /service-info`, `GET /contracts/schema`, and `GET /contracts/summary` expose the API boundary metadata, shared package usage, and canonical schema references.
- `POST /auth/discord/start` and `GET /auth/discord/callback` now use `packages\auth` plus `packages\config` to issue signed Discord OAuth state and session-cookie planning metadata without pretending a session store already exists.
- `POST /guilds/:guildId/reports` now creates canonical Postgres state for the first real intake slice:
  - `guilds` and `user_identities` are upserted as needed so foreign keys stay honest
  - `cases` is created or re-used by `opening_fingerprint` when `openCase !== false`
  - `reports`, `case_events`, `audit_records`, `idempotency_receipts`, and `outbox_events` are written in the same transaction
  - the route returns `201 Created` with `persistence: persisted` and `queueDelivery: pending_outbox_publish` to distinguish canonical durability from later stream publication
- `POST /guilds/:guildId/reports/:reportId/evidence` now durably supports only canonical Discord `message_link` evidence:
  - the API validates the `https://discord.com/channels/{guildId}/{channelId}/{messageId}` form and rejects mismatched or non-Discord URLs
  - `evidence_records`, `evidence_links`, `case_events`, `audit_records`, `idempotency_receipts`, and `outbox_events` are written transactionally when the parent report exists
  - attachment, screenshot, and other blob-backed evidence kinds remain explicitly unavailable until object storage, hashing, and redaction flows are wired
- `POST /guilds/:guildId/cases/:caseId/review` now persists the first real moderator-confirmed learning slice:
  - `case_events`, `case_outcomes`, `audit_records`, `idempotency_receipts`, and `outbox_events` are written canonically before the route returns `201 Created`
  - the API hashes the subject user ID, calls `services\learning-rs` with the canonical `CaseOutcome`, and then updates `learned_signals`, `signal_examples`, and `signal_embeddings` when reusable redacted text exists
  - the same canonical review flow now refreshes per-guild `reputation_views` for `reporter_reputation`, so later report intake and queue reads can weight moderator-confirmed reporters without exposing a hidden enforcement path
  - if `services\learning-rs` is unavailable, the route still returns the persisted moderator outcome and explicitly reports that learning is pending retry from the canonical `learning.feedback` outbox event
- `GET /guilds/:guildId/cases` and `GET /guilds/:guildId/cases/:caseId` now read directly from canonical Postgres tables for the first slice, returning `readModelStatus: canonical_postgres` instead of synthetic placeholders.
- `POST /guilds/:guildId/reports` now refreshes a canonical per-subject `reputation_views` row for `subject_report_anomaly`:
  - counts and stores recent report velocity, unique reporter counts, repeated trigger reuse, and `coordinated_report_burst`
  - keeps the signal explicitly advisory with privacy notes in the summary payload
- `GET /guilds/:guildId/risk-queue` now returns a canonical Postgres-backed queue instead of a placeholder:
  - items include advisory-only anomaly flags plus aggregated reporter-trust counts
  - the route exposes counts and scores only; it does not expose cross-guild reporter identities or authorize moderation actions
- `PUT /guilds/:guildId/policy`, `PUT /guilds/:guildId/verification`, `POST /guilds/:guildId/cases/:caseId/appeal`, and the moderation routes still return `202 Accepted` planning envelopes containing:
  - a Postgres-first canonical write plan built with `packages\db`
  - idempotency metadata at the HTTP boundary
  - an outbox/Redis Streams envelope built with `packages\queue`
  - request and trace correlation from `packages\telemetry`
- verification routes now keep signed session identity explicit while treating concrete adapters as strategy modules:
  - `POST /guilds/:guildId/verification/sessions` accepts an optional originating `caseId`, creates the canonical verification session immediately, and signs the verifier challenge with `challengeId`, `sessionId`, `guildId`, and `userId`
  - `GET /verification/sessions/:sessionId?token=...` verifies the signed boundary and returns the canonical persisted session/provider state when available instead of fabricating completion from browser state
  - `POST /verification/challenges/:challengeId/complete` re-checks that the token matches `challengeId`, `sessionId`, `guildId`, and `userId`, validates the selected concrete adapter against `@humanify/verification-providers`, and either:
    - creates a real Didit session server-side and returns a Didit SDK launch contract, or
    - carries the consumer-selected proof bundle through the reusable-proof server handoff boundary (`handoffKind`, `serverEndpointPath`, `serverVerificationNote`, `providerStartEndpoint`, `providerStartToken`)
  - `POST /verification/sessions/:sessionId/providers/:providerId/start` now starts the reusable-proof backend boundary for Privado by validating a signed start token, creating the backend request with the shared claim catalog, and returning only wallet launch metadata plus a signed provider-session token
  - `POST /verification/providers/:providerId/proof` now reads Privado proof status server-side, normalizes the response to minimal proof evidence, and keeps release blocked unless the proof is verified
  - `POST /verification/sessions/:sessionId/release` now refuses to invent success and returns `409 conflict` until Humanify verifies the selected strategy handoff against canonical state
  - `POST /callbacks/providers/didit` is now live and must verify Didit raw-body webhook signatures, fetch the authoritative Didit decision server-side, reduce it to minimal-custody summary fields, and request provider-side deletion after reconciliation
- `PUT /guilds/:guildId/verification` now validates guild-level provider configuration against the shared provider catalog:
  - the route accepts a server-owner chosen `enabledProviderIds` list plus an optional `defaultProviderId`; those current field names remain stable even though the architecture treats them as concrete strategy adapters
  - the default provider must still be enabled for that guild and should represent the guild's default first-time capture adapter
  - the response surfaces `availableProviderIds`, `enabledProviderIds`, and `defaultProviderId` so the dashboard and verifier can stay adapter-neutral at the app boundary
- moderation routes (`/approve`, `/quarantine`, `/timeout`, `/kick`, `/ban`) are now concretely clamped through `packages\policy-engine`; a requested action that exceeds Bun policy or Discord capability constraints must fail with `403 forbidden`.
- moderation planning envelopes now separate durability from executor readiness: `durability: planned_not_persisted` means the bot must stop at planning, while `executorState` explains whether Bun approval exists but is still waiting on canonical persistence or is blocked by current capability.
- API startup now validates the required session, OAuth, data-plane, policy-clamp, and observability config bundles up front, and request handling now emits structured request logs with redacted headers plus default `no-store`/`nosniff` response headers.
- `GET /guilds/:guildId/audit` still returns explicit `pending_postgres_projection` status rather than synthetic data.
- non-Didit callback routes remain explicitly unavailable until their shared adapter templates are backed by equivalent server-side verification wiring; the API must not invent success from browser-only completion.
- Privado reusable-proof routes remain disabled unless `HUMANIFY_PRIVADO_VERIFIER_BASE_URL` and explicit `HUMANIFY_PRIVADO_ALLOWED_ISSUERS` are configured; `HUMANIFY_PRIVADO_CHAIN_ID` optionally scopes the generated request payload.
- `apps\dashboard-start` now consumes this boundary honestly through `/`, `/cases`, `/verification`, and `/policy` screens that surface metadata and pending states instead of fake live moderation rows.

## 9. What later implementation adds here

- exact auth/session persistence contract once `packages\auth` grows durable session storage helpers
- Postgres-backed read-model queries for case detail, user profile, verification-session status, audit, and risk-queue routes
- provider-specific callback contracts once the first real provider adapter is wired and documented in `docs\verification.md`
- R2 upload/redaction brokering once storage and evidence services are ready for those boundaries
