# Humanify observability and security baseline

Purpose: define day-one observability, auditability, and security expectations for Bun apps, Rust services, queues, verification flows, and evidence handling.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\contracts.md`
- `docs\data-platform.md`
- `docs\observability-security.md`

Upstream docs:
- Bun environment variables: https://bun.sh/docs/runtime/env
- Discord OAuth2: https://discord.com/developers/docs/topics/oauth2
- Discord interactions security: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
- Didit API full flow: https://docs.didit.me/integration/api-full-flow
- Didit webhooks: https://docs.didit.me/integration/webhooks
- Privado verifier overview: https://docs.privado.id/docs/verifier/verifier-overview/
- Privado request API: https://docs.privado.id/docs/verifier/verification-library/request-api/
- Privado verification API: https://docs.privado.id/docs/verifier/verification-library/verification-api/
- Privado verifier backend: https://docs.privado.id/docs/verifier/verifier-backend/
- W3C VC Data Model: https://www.w3.org/TR/vc-data-model/
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Redis `XAUTOCLAIM`: https://redis.io/docs/latest/commands/xautoclaim/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- OpenTelemetry signals: https://opentelemetry.io/docs/concepts/signals/
- OpenTelemetry context propagation: https://opentelemetry.io/docs/concepts/context-propagation/
- OpenTelemetry JS propagation: https://opentelemetry.io/docs/languages/js/propagation/
- OpenTelemetry Rust: https://opentelemetry.io/docs/languages/rust/
- Sentry Bun: https://docs.sentry.io/platforms/javascript/guides/bun/
- Sentry Bun options: https://docs.sentry.io/platforms/javascript/guides/bun/configuration/options/
- Sentry Rust: https://docs.sentry.io/platforms/rust/
- Sentry Rust data collected: https://docs.sentry.io/platforms/rust/data-management/data-collected/
- Grafana docs: https://grafana.com/docs/

This document is governed by `docs\reference-baseline.md`. Future implementation work in this area must cite that baseline plus the exact upstream docs for the specific SDK, service, or provider being wired.

## 1. Safety and authority model

Humanify remains a safety-first moderation system.

1. Model and heuristic outputs are advisory only.
2. The Bun policy engine is the only component allowed to decide whether an action is permitted.
3. The executor may only perform actions already approved by server policy and current Discord permissions.
4. Rust services may score, enrich, classify, hash, or learn, but they never directly execute moderation actions.
5. Queue delivery does not grant authority; every consumer must treat messages as requests to evaluate, not permission to act.
6. Verification remains role-based: capture providers and reusable-proof backends can produce attestations, but only the Bun policy consumer may decide whether a guild requirement is satisfied.
7. Humanify does not custody raw identity documents, full reusable credential payloads, or direct Didit session imports; verification observability must therefore focus on minimal receipts, refs, reject reasons, and replay guards.

Anything that would let inference bypass policy is out of bounds for this architecture.

## 2. Day-one observability contract

Every boundary in the system must produce five forms of operational evidence:

| Signal | Required outcome |
| --- | --- |
| Traces | Cross-service request lineage from ingress to action/result |
| Structured logs | Searchable event context with trace correlation |
| Metrics | Health, throughput, saturation, error-rate, and queue-lag visibility |
| Error reporting | Actionable exception/panic capture with release and environment context |
| Audit records | Durable explainability for security-sensitive and moderator-visible events |

Operational telemetry is not a substitute for audit records. Logs and traces can be sampled or retained for shorter periods; audit records must remain durable and explainable in Postgres-backed state.

## 3. Required coverage by component

| Component | Trace | Logs | Metrics | Errors | Audit requirements |
| --- | --- | --- | --- | --- | --- |
| `apps\bot-bun` | Discord event ingestion, command handling, action execution, evidence capture | structured JSON with guild/case correlation | event rate, command latency, Discord API failures, action execution outcomes | unhandled command/event failures to Sentry | approved actions, failed executions, permission denials |
| `apps\api-bun` | HTTP ingress, policy evaluation, capture callbacks, reusable-proof verification, outbox writes | request lifecycle, authz failures, callback/proof verification results, persistence minimization results | route latency, callback reject rate, proof verification reject rate, outbox backlog | unhandled route errors and degraded dependencies | policy decisions, callback/proof accept or reject, minimal-persistence decisions, retention changes |
| `apps\dashboard-start` / `apps\verifier-start` | user navigation and critical mutations where supported | UI error context only; no secrets or raw verification payloads | page/action latency, verification completion funnel | frontend exceptions to Sentry with scrubbed context | user-visible moderation or verification state changes come from server audits, not client logs |
| Rust services | request handlers, worker jobs, model calls, evidence transforms | structured `tracing`-compatible logs | job duration, model latency, queue consumption, retry count | panics, failed jobs, degraded model/runtime state | hashes created, redaction completion, learning ingest acceptance |
| Redis Streams | producer span ends at publish; consumer span links to message metadata | publish/claim/ack/retry events | lag, pending entries, claim count, dead-letter count | repeated poison messages | durable receipts stay in Postgres |
| Evidence/R2 flow | ingest, derivative generation, signed read/write issuance, delete | object/key refs by opaque IDs only | upload/download failures, derivative latency, delete backlog | storage and transform failures | evidence access, redaction, hold, deletion eligibility |

## 4. Trace design

### 4.1 Ingress rules

Start a root span at every external ingress:

- Discord gateway events into the bot
- HTTP requests into Bun APIs
- capture-provider callbacks and reusable-proof verification submissions
- dashboard or verifier mutations that reach the server
- worker pulls from Redis Streams when no upstream trace is present

Each ingress must create or recover:

- `traceId`
- `spanId`
- `requestId`
- stable domain correlation fields such as `guildId`, `caseId`, `eventId`, and hashed/opaque subject identifiers

### 4.2 Propagation rules

OpenTelemetry trace context is the default propagation model.

1. Use standard W3C trace headers on HTTP boundaries.
2. When work crosses Redis Streams, copy trace context and a minimal correlation envelope into the message metadata so consumers can continue the trace or create linked spans.
3. Preserve correlation through Postgres outbox rows so retries and replays keep lineage.
4. Use baggage only for low-cardinality, non-secret routing context; never place secrets, tokens, raw evidence, raw proof material, or provider payloads in trace metadata.

Current first-slice wiring:

- `apps\bot-bun` now creates a request correlation bundle per interaction and forwards both `traceparent` and `x-request-id` to `apps\api-bun`.
- `apps\verifier-start` now forwards the same correlation headers on signed-link session fetch and challenge-complete requests so verifier-originated API work joins the same trace/log lineage model as Bun services.
- `packages\queue` continues the same `traceparent` through Redis Streams envelopes.
- Rust HTTP services now log incoming `traceparent` and `x-request-id` on their request spans so Bun-originated work remains correlated at the advisory boundary even before full OpenTelemetry SDK exporters land.

### 4.3 Span expectations

Every meaningful span should describe:

- operation kind (`http.server`, `http.client`, `queue.publish`, `queue.consume`, `policy.evaluate`, `discord.action`, `evidence.transform`)
- service name and version
- success/failure status
- bounded identifiers needed for correlation

Do not attach raw message content, full evidence bodies, OAuth codes, webhook signatures, raw proof payloads, auth headers, cookies, document images, or signed R2 URLs as span attributes.

## 5. Logging baseline

1. Logs must be structured, machine-parseable, and correlated with `traceId` and `spanId` when available.
2. Bun apps and Rust services should converge on the same core fields: timestamp, level, service, environment, release, requestId, traceId, spanId, event name, and bounded correlation IDs.
3. Logs are for operational diagnosis, not durable business truth.
4. Security-sensitive logs must record the decision that something was rejected or allowed without dumping the sensitive payload itself.

Current first-slice logging posture:

- `apps\api-bun` now emits structured request-complete and request-failed logs with `requestId`, `traceId`, `spanId`, method, path, and status, while redacting sensitive headers before they reach logs.
- Internal API errors now return a stable generic `internal_error` message to clients while detailed diagnostics stay in structured logs.
- `apps\bot-bun` boot logs now advertise both propagation headers and whether Sentry is enabled for that runtime.

Required redaction defaults:

- authorization headers
- cookies and session material
- Discord OAuth codes and refresh/access tokens
- provider webhook secrets and signatures
- raw proof payloads, reusable credential bodies, and provider-issued document images
- R2 credentials and full presigned URLs
- raw evidence content
- unhashed user identifiers when a hashed or internal ID is sufficient

## 6. Metrics baseline

Metrics should exist from the first service skeletons, even if the initial set is small.

Minimum families:

- ingress throughput by source (`discord_event`, `api_route`, `verification_callback`, `stream_message`)
- latency histograms for policy evaluation, inference calls, evidence transforms, and moderation action execution
- error counts by service and operation
- Redis Streams backlog, pending-entry age, `XAUTOCLAIM` recovery count, and dead-letter count
- verification funnel metrics: started, challenged, passed, failed, expired
- verification control metrics: callback signature failures, proof verification failures, replay rejects, and purge/delete follow-up backlog
- evidence pipeline metrics: blobs ingested, derivatives produced, redactions pending, deletion backlog

Avoid high-cardinality labels such as raw user IDs, object keys, or message content.

## 7. Error reporting baseline

Sentry is the default error collection surface for Bun and Rust runtimes; OpenTelemetry remains the canonical cross-service correlation layer.

Rules:

1. Initialize Sentry as early as possible in each runtime.
2. Set release and environment explicitly.
3. Keep default PII capture disabled unless a reviewed need exists.
4. If request/user context is attached, scrub it first and prefer internal IDs or hashes.
5. Treat Sentry event payloads as external data egress; never send secrets, raw evidence, or raw verification payloads.
6. Ensure shutdown paths flush Sentry and telemetry exporters cleanly.

Current first-slice Bun wiring:

- `apps\api-bun` and `apps\bot-bun` now preload Bun-specific Sentry initialization before application code runs.
- Sentry stays opt-in through environment configuration (`HUMANIFY_SENTRY_DSN`, optional `HUMANIFY_SENTRY_TRACES_SAMPLE_RATE`) and keeps `sendDefaultPii` disabled by default.
- Humanify redacts nested event payloads before Sentry egress, so callback tokens, OAuth codes, cookies, DSNs, and signed URLs are scrubbed even if they appear in captured error metadata.

Sentry is for actionable failures; audit records still belong in canonical application state.

## 8. Auditability baseline

The following events require durable audit records in Postgres-backed state, even if they also appear in logs or traces:

- policy decisions that change or confirm allowed actions
- moderator actions, reversals, appeals, and overrides
- executor attempts, successes, failures, and permission denials
- capture-provider callback or reusable-proof verification acceptance/rejection
- evidence creation, redaction, access grant, legal hold, retention change, and deletion
- verification persistence minimization decisions and auditable reject records
- changes to security-sensitive configuration, thresholds, roles, or secrets references

Audit rows should capture actor, target, action, rationale, related entity IDs, and timestamps. Audit records must point to evidence or decision artifacts by stable references, not by embedding raw sensitive content.

## 9. Security boundaries

### 9.1 Secrets and configuration

1. Secrets are injected from environment or a future secret manager, not committed to the repo.
2. Bun's automatic `.env` loading is convenient for local development, but production and CI should prefer explicit environment injection or `--no-env-file` where appropriate.
3. Every service must validate required configuration at startup and fail closed if critical secrets are missing.
4. Use separate credentials per service and environment.
5. Prefer least-privilege credentials:
   - Bun API credentials should not also own storage-admin or database-admin rights.
   - Rust workers should only receive the tokens and database permissions needed for their bounded tasks.
6. Secret values must never be written to logs, traces, metrics labels, audit payloads, or client-visible error messages.

### 9.2 Provider webhooks and proof verification callbacks

All inbound callbacks are untrusted until verified.

Each concrete provider integration must add its exact official callback or proof verification docs to the local subsystem doc before implementation. For the approved architecture, that means Didit webhook docs for first-time capture flows and Privado request/verification/backend docs for reusable-proof verification flows.

Required controls:

1. Verify provider signatures or proofs according to the provider's official documentation before side effects. Didit-style webhooks must use the raw request body when the provider requires signature verification over raw bytes; Privado-style proof flows must verify the returned proof against the request/query context server-side.
2. Bind every callback or proof to the canonical verification session, enabled strategy role, expected guild/user, and expected claim bundle before updating state.
3. Enforce replay resistance with timestamps, nonce/idempotency receipts, provider event IDs, backend request IDs, or nullifiers as applicable.
4. Reject unknown or disabled strategies, invalid signatures/proofs, expired challenges, duplicate deliveries, mismatched claim bundles, and callbacks that would expand Humanify into raw identity custody.
5. Store only the minimum callback/proof material needed for explainability and retries: receipt refs, attestation refs, nullifiers/replay guards, verified predicates, and auditable reject reasons.
6. Direct provider session imports, raw document custody, and full reusable credential storage are out of bounds.

Discord-specific rule: any HTTP interaction endpoint must validate the Discord signature and timestamp per the official interactions security docs before processing the body.

### 9.3 Service-to-service trust

Internal traffic is not automatically trusted just because it is inside the same deployment boundary.

Assumptions:

1. Bun apps are trusted to evaluate policy and own side-effect approval.
2. Rust services are trusted to compute and enrich, not to authorize moderation.
3. Redis Streams is transport, not an authority boundary.
4. Postgres is the canonical state owner for policy, audit, receipts, and retention metadata.
5. Evidence in R2 is private by default; possession of an object key alone is not authorization.

Therefore:

- downstream consumers must re-check canonical state before destructive actions
- service credentials should be scoped per service identity
- any future direct service-to-service auth layer should bind identity to service role, not just network location

### 9.4 Moderation actions

Only the Bun policy engine may emit approved action intents to `policy.actions`.

The executor must:

1. read the already-clamped decision
2. confirm the guild's configured maximum automatic action
3. confirm current Discord permissions and target state
4. record an audit receipt
5. refuse to execute anything that arrived as raw model output or from an unapproved producer

No Rust service, dashboard client, verifier client, or provider callback may directly trigger irreversible enforcement.

### 9.5 Evidence access

1. Evidence access is brokered by the application, not by exposing permanent object URLs.
2. Use time-limited signed reads or writes only when necessary, with minimal scope and expiry.
3. Default moderator UX should prefer redacted or derived views when full raw evidence is unnecessary.
4. Every evidence access grant, export, redaction, and deletion decision must be auditable.
5. Processing pipelines should operate on opaque evidence IDs and hashes where possible.

### 9.6 Minimal retention

Keep the least amount of sensitive data required to explain decisions, support appeals, and operate the system.

Rules:

1. Prefer hashes, embeddings, derived features, and redacted summaries over raw content.
2. Treat provider callback bodies, verification artifacts, and temporary challenge material as short-lived unless a reviewed retention reason exists; the default verification posture is process-and-reduce-to-receipts, not store-the-session.
3. Retention policy is owned by Postgres metadata, not inferred from queue state or object existence.
4. Deletion and expiration must be observable, auditable, and replay-safe.
5. Legal holds or investigation holds must override ordinary deletion, with explicit audit attribution.
6. Humanify must not keep raw identity documents, full reusable credential payloads, or direct Didit full-session exports as part of ordinary operations.

## 10. Implementation gate for future work

No service or integration in this area is ready until it can answer all of the following:

1. Where is the root span started, and how does trace context cross HTTP and Redis?
2. Which fields are logged, and which are redacted?
3. Which metrics expose health and backlog?
4. What goes to Sentry, and what is scrubbed before egress?
5. Which events become durable audit records?
6. Which secret/config values are required, and how are they validated?
7. How are provider signatures/proofs, callback replay, and evidence access controlled?
8. How does the change preserve the advisory-only model and policy-authoritative execution boundary?
