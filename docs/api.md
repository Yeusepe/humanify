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
| Guild config | `GET /guilds/:guildId/policy`, `PUT /guilds/:guildId/policy`, `GET /guilds/:guildId/channels`, `PUT /guilds/:guildId/channels`, `GET /guilds/:guildId/verification`, `PUT /guilds/:guildId/verification` | all writes create audit records; channel config reads/writes support the Discord setup flow for moderator alert plus optional review/audit/log channels, and verification config owns enabled strategy adapters, required proof bundles, face-verification policy, and default provider choices |
| Scans | `POST /guilds/:guildId/scans`, `GET /guilds/:guildId/scans/:scanRequestId` | persists canonical scan requests first; Temporal workers claim and execute them later |
| Cases | `GET /guilds/:guildId/cases`, `GET /guilds/:guildId/cases/:caseId`, `GET /guilds/:guildId/cases/:caseId/warning-card`, `PUT /guilds/:guildId/cases/:caseId/warning-card/alert-message`, `POST /guilds/:guildId/cases/:caseId/review`, `POST /guilds/:guildId/cases/:caseId/appeal` | ties into `docs\cases-and-reports.md`; warning-card reads stay advisory and moderator-facing |
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
  - the current Discord bot now uses this same route for passive `detector_bridge` intake from suspicious joins and suspicious messages, keeping automated advisory ingestion on the same canonical report spine as moderator-created reports
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
- moderator warning cards now have a canonical advisory read/update flow for Discord bot use:
  - `GET /guilds/:guildId/cases/:caseId/warning-card` joins bounded case summary, evidence summary, the latest linked-or-subject verification summary, reusable-credential bridge status when present, face-check state when present, and the current persisted alert-message ref when one exists
  - `PUT /guilds/:guildId/cases/:caseId/warning-card/alert-message` persists the current Discord alert message ref for that case, appends a case event, writes audit/outbox/idempotency rows, and lets the bot update an existing warning card instead of reposting blindly
  - `apps\bot-bun` now uses those routes during both moderator-triggered and passive runtime paths: report/case intake, message-context evidence attachment, suspicious `guildMemberAdd` detector reports, suspicious `messageCreate` detector reports, and case-linked verification-shortcut refreshes; the resulting Discord warning remains advisory text and never authorizes automatic enforcement
- `POST /guilds/:guildId/reports` now refreshes a canonical per-subject `reputation_views` row for `subject_report_anomaly`:
  - counts and stores recent report velocity, unique reporter counts, repeated trigger reuse, and `coordinated_report_burst`
  - keeps the signal explicitly advisory with privacy notes in the summary payload
- `GET /guilds/:guildId/risk-queue` now returns a canonical Postgres-backed queue instead of a placeholder:
  - items include advisory-only anomaly flags plus aggregated reporter-trust counts
  - the route exposes counts and scores only; it does not expose cross-guild reporter identities or authorize moderation actions
- `PUT /guilds/:guildId/channels` now persists canonical guild channel configuration in Postgres instead of returning a stub:
  - the route requires `moderatorAlertChannelId` and accepts optional `reviewChannelId`, `auditLogChannelId`, and `moderationLogChannelId`
  - `guild_channel_configs`, `audit_records`, `idempotency_receipts`, and `outbox_events` are written inside the same canonical transaction before the route returns `200 OK`
  - the response stays plain and returns the persisted channel configuration plus `queueDelivery: pending_outbox_publish`
- `GET /guilds/:guildId/channels` now returns the current channel setup snapshot needed to hydrate `/humanify setup`:
  - when no channel row exists yet the response stays honest with `persistence: not_configured`
  - when a row exists the response returns the persisted channel ids plus `source: persisted`
- `PUT /guilds/:guildId/policy`, `POST /guilds/:guildId/cases/:caseId/appeal`, and the moderation routes still return `202 Accepted` planning envelopes containing:
  - a Postgres-first canonical write plan built with `packages\db`
  - idempotency metadata at the HTTP boundary
  - an outbox/Redis Streams envelope built with `packages\queue`
  - request and trace correlation from `packages\telemetry`
- verification routes now keep signed session identity explicit while treating concrete adapters as strategy modules:
  - provider-specific dispatch for capture starts, reusable-proof starts/verifications, and callbacks now lives in app-local option runtime modules so `apps\api-bun\src\app.ts` stays orchestration-first and `apps\verifier-start` main files stay provider-neutral
  - `GET /guilds/:guildId/verification` returns the current effective guild verification config snapshot; when no row exists yet the response stays honest with `persistence: catalog_default` instead of inventing a stored record
  - `PUT /guilds/:guildId/verification` now persists one canonical `verification_requirements` row per guild, along with `audit_records`, `idempotency_receipts`, and `outbox_events`, before returning `200 OK`
  - persisted verification config stays bundle-driven: the route stores `requiredBundleIds`, `faceVerificationRequired`, `enabledProviderIds`, `defaultProviderId`, optional `defaultReusableProofBackendId`, and the existing trusted/suspicious role arrays instead of baking raw provider claims into the route contract
  - `POST /guilds/:guildId/verification/sessions` accepts an optional originating `caseId`, validates that the case belongs to the same guild and subject user, persists that linkage on `verification_sessions.case_id`, appends a case event for warning/review reads, signs the verifier challenge with `challengeId`, `sessionId`, `guildId`, and `userId`, and returns the authoritative guild verification config snapshot needed by the verifier UI
  - `GET /verification/sessions/:sessionId?token=...` verifies the signed boundary and returns the canonical persisted session/provider state plus the normalized `verification` summary, the current guild verification config snapshot, and any persisted `reusableCredentialBridge` when available instead of fabricating completion from browser state
  - `POST /verification/challenges/:challengeId/complete` re-checks that the token matches `challengeId`, `sessionId`, `guildId`, and `userId`, validates the selected concrete adapter and requested proof bundle against both `@humanify/verification-providers` and the persisted guild verification config, and either:
    - creates a real Didit session server-side and returns a Didit SDK launch contract, or
    - carries the consumer-selected proof bundle through the reusable-proof server handoff boundary (`handoffKind`, `serverEndpointPath`, `serverVerificationNote`, `providerStartEndpoint`, `providerStartToken`)
  - `POST /verification/sessions/:sessionId/providers/:providerId/start` now starts the reusable-proof backend boundary for Privado by validating a signed start token, creating the backend request with the shared claim catalog, and returning only wallet launch metadata plus a signed provider-session token
  - `POST /verification/providers/:providerId/proof` now reads Privado proof status server-side, normalizes the response to minimal proof evidence, persists only the minimal receipt/hash/nullifier/issuer-scope summary, and keeps release blocked unless the proof is verified
  - `POST /verification/sessions/:sessionId/release` now refuses to invent success and returns `409 conflict` until Humanify verifies the selected strategy handoff against canonical state
  - `POST /callbacks/providers/didit` is now live and must verify Didit raw-body webhook signatures, fetch the authoritative Didit decision server-side, reduce it to minimal-custody summary fields, request provider-side deletion after reconciliation, and persist the honest reusable identity handoff contract when approved reusable claims are available
  - that handoff contract is additive API surface on the callback response and `GET /verification/sessions/:sessionId`; it exposes only time-bounded minimal facts split into `claims.disclosedAttributes`, `claims.proofOnlyPredicates`, and `policyInputs.faceVerification`, plus required external issuer inputs and durable audit refs, rather than pretending Humanify minted or stored a full reusable credential
  - the persisted verification summary exposed on callbacks and session-status reads is limited to normalized provider refs/status, satisfied claims, face-verification booleans, proof receipt refs/hashes, nullifier refs, issuer scopes, and purge/webhook receipt summaries; raw provider payloads remain out of bounds
- `PUT /guilds/:guildId/verification` now validates and persists guild-level verification configuration against the shared provider and claim-bundle catalogs:
  - the route accepts a server-owner chosen `enabledProviderIds` list plus `requiredBundleIds`, `faceVerificationRequired`, an optional `defaultProviderId`, and an optional `defaultReusableProofBackendId`
  - the default capture provider and default reusable-proof backend must still be enabled for that guild and must keep their correct shared strategy roles
  - the response surfaces `availableProviderIds`, `enabledProviderIds`, `defaultProviderId`, optional `defaultReusableProofBackendId`, `requiredBundleIds`, `requiredBundles`, and the full `availableBundles` catalog so the dashboard, verifier, and Discord setup flow can stay adapter-neutral at the app boundary
- scan routes now keep long-running member scans Postgres-first and durability-honest:
  - `POST /guilds/:guildId/scans` validates `single_member` vs `all_members`, writes `guild_scan_requests` plus audit/outbox/idempotency rows, and returns `201 Created` with `persistence: persisted` and `queueDelivery: pending_outbox_publish`
  - `GET /guilds/:guildId/scans/:scanRequestId` reads the canonical Postgres record and exposes only the actual workflow state (`pending`, `claimed`, `running`, `completed`, `failed`)
  - the API does not pretend the Discord walk already happened; the Temporal worker owns the later scan execution, weighted member scoring on the shared 1-10 advisory scale, report opening at the watch threshold, and moderator-warning refresh path
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
