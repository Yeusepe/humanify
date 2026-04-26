# Humanify data platform

Purpose: define the governing storage, sync, queue, and evidence model for the greenfield Humanify platform.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\data-platform.md`

Upstream docs:
- PostgreSQL: https://www.postgresql.org/docs/current/index.html
- pgvector: https://github.com/pgvector/pgvector/blob/master/README.md
- SQLite: https://www.sqlite.org/docs.html
- libSQL: https://docs.turso.tech/libsql
- sqlite-vec: https://alexgarcia.xyz/sqlite-vec/
- Didit API full flow: https://docs.didit.me/integration/api-full-flow
- Didit webhooks: https://docs.didit.me/integration/webhooks
- Privado verifier overview: https://docs.privado.id/docs/verifier/verifier-overview/
- Privado request API: https://docs.privado.id/docs/verifier/verification-library/request-api/
- Privado verification API: https://docs.privado.id/docs/verifier/verification-library/verification-api/
- Privado verifier backend: https://docs.privado.id/docs/verifier/verifier-backend/
- W3C VC Data Model: https://www.w3.org/TR/vc-data-model/
- Electric Postgres Sync: https://electric-sql.com/docs/intro
- Electric Postgres Sync primitives: https://electric-sql.com/primitives/postgres-sync
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare R2 data location: https://developers.cloudflare.com/r2/reference/data-location/
- Qdrant: https://qdrant.tech/documentation/

## 1. Governing decisions

1. Postgres is the canonical system of record for transactional state, audit state, moderation state, and durable vector ownership.
2. `pgvector` is the default durable vector index because it keeps embeddings next to their owning entities and inside the same transactional boundary.
3. SQLite or libSQL with `sqlite-vec` is a local prediction store only. It accelerates scoring and similarity near Bun or Rust workers, but it is never the audit source.
4. Electric sync reads from Postgres and powers the dashboard and verifier clients. It does not become a second source of truth.
5. Redis Streams is the default cross-service queue and event transport. A stream message means work is pending, not that business state is committed.
6. Cloudflare R2 stores large blobs only. Blob metadata, hashes, retention state, and access decisions stay in Postgres.
7. Qdrant is optional and projection-only. If enabled, it is fed from Postgres-owned embeddings and can be rebuilt from Postgres plus R2 metadata.
8. Verification storage is minimal-custody only. Humanify stores proof receipts, attestation references, nullifiers/replay guards, and audit evidence, not raw identity documents, full reusable credential payloads, or direct Didit full-session imports.

### 1.1 Concrete migration ownership in the repo

The current implementation anchors these decisions in a Bun-first migration package:

- `packages\db\migrations\0001_canonical_spine.sql` is the authoritative schema file for the first canonical data spine.
- `packages\db\src\migrator.ts` owns migration discovery, checksum drift detection, and Postgres-first application from Bun.
- `schema_migrations` records applied SQL files; it is the only migration bookkeeping table.
- Local Docker bootstrap under `docker\postgres\init\001-humanify.sql` is intentionally narrow and only preloads `vector` for first-time local volumes.

The first migration now creates the canonical table families for:

- tenant + identity: `guilds`, `user_identities`, `guild_members`, `moderators`
- policy + verification: `guild_policy_versions`, `guild_channel_configs`, `verification_requirements`, `verification_sessions`, `verification_artifacts`
- observation + scoring: `risk_inputs`, `risk_feature_snapshots`, `risk_decisions`, `action_recommendations`
- cases + evidence + outcomes: `cases`, `reports`, `case_events`, `case_outcomes`, `appeals`, `evidence_records`, `blob_objects`, `blob_derivatives`, `evidence_links`
- learning + vectors: `learned_signals`, `signal_examples`, `signal_embeddings`, `reputation_views`
- durability + replay: `outbox_events`, `idempotency_receipts`, `action_execution_receipts`, `audit_records`, `stream_consumer_checkpoints`, `projection_failures`

Implementation choice: policy, verification, moderation, and evidence payload details are initially carried in constrained `jsonb` documents plus explicit foreign keys, enum-backed states, and uniqueness constraints. For verification, those payloads are limited to role-based strategy configuration and minimal receipts/refs rather than full provider payloads, so the canonical boundary stays stable without turning Humanify into a provider artifact store.

## 2. Storage ownership matrix

| Concern | Canonical owner | Secondary copy or cache | Notes |
| --- | --- | --- | --- |
| Guild, member, policy, verification sessions, minimal proof receipts, cases, outcomes, audit trails | Postgres | Electric client sync views | Canonical transactional state with minimal-custody verification metadata only |
| Durable embeddings for cases, evidence, learned signals, domains, invites | Postgres + `pgvector` | Optional Qdrant projection; local SQLite caches | Postgres owns vector identity and lifecycle |
| Hot local similarity caches and feature snapshots | SQLite or libSQL + `sqlite-vec` | Rebuildable from Postgres streams | Worker-local, evictable |
| Queue backlogs, fan-out work, retries, consumer ownership | Redis Streams | Postgres outbox and receipts | Streams transport work; Postgres records business completion |
| Evidence files, screenshots, attachments, redacted exports | Cloudflare R2 | Local temp processing buffers only | Address by object key and hash |
| Live dashboard and verifier reads | Electric over Postgres | Browser-side TanStack DB state | Read model only |

## 3. Canonical core entities

The model should stay normalized around the moderation loop: observe, score, contain, verify, review, act, learn.

### 3.1 Tenant and identity spine

| Entity | Stored in | Core fields |
| --- | --- | --- |
| `guilds` | Postgres | `guild_id`, Discord guild identifiers, install status, plan/tier, created timestamps |
| `guild_members` | Postgres | `guild_id`, `user_id`, join metadata, current role snapshot, quarantine state, verification state |
| `user_identities` | Postgres | `user_id`, Discord account metadata, account age derivations, profile signal snapshot |
| `moderators` | Postgres | `guild_id`, `user_id`, role/permission snapshot for attribution and audit |

Notes:
- `user_identities` models the global Discord user.
- `guild_members` models per-guild policy state, risk state, and enforcement state.
- Member verification outcomes attach to the guild membership, not only the global user.

### 3.2 Policy and verification

| Entity | Stored in | Core fields |
| --- | --- | --- |
| `guild_policy_versions` | Postgres | thresholds, action ladder, quarantine role config, trust-network settings, effective timestamps |
| `guild_channel_configs` | Postgres | moderator alert channel plus optional review/audit/log channel selections for setup and warning workflows |
| `verification_requirements` | Postgres | role-based verification strategy requirements, challenge rules, fallback paths, retention rules |
| `verification_sessions` | Postgres | `session_id`, `guild_id`, `user_id`, required checks, selected strategy refs, challenge state, expiry, result summary |
| `verification_artifacts` | Postgres | capture session refs, reusable-proof receipt refs, verified claim predicates, nullifier/replay guard refs, attestation status, expiry |

Notes:
- Didit is the default first-time capture provider when a workflow needs live capture, and Privado is the primary reusable-ID / reusable-proof backend for reusable verification.
- Humanify does not become the reusable-ID store; it persists only minimal proof receipts, attestation references, nullifiers/replay guards, and audit evidence needed for policy and replay safety.
- Electric sync exposes policy and verification summaries needed by the dashboard and verifier, not raw provider payloads, raw document captures, or reusable credential bodies.
- Direct Didit full-session import into Postgres or R2 is out of scope for this architecture.

### 3.2.1 Verification storage runbook

The current canonical tables carry the following exact verification fields:

| Table / column | Stored fields |
| --- | --- |
| `verification_sessions.provider_status` after Didit reconciliation | `selectedProvider`, `status`, `requestedClaims`, Didit launch refs, `verifiedWebhook.{webhookType,timestamp,workflowId,providerStatus}`, `purge.{attemptedAt,outcome}`, optional `reusableCredentialBridge` summary |
| `verification_sessions.result_summary` after Didit reconciliation | `authoritativeSource`, `providerReferenceId`, `providerStatus`, `requestedClaims`, `satisfiedClaims`, `faceVerificationPerformed`, `faceVerificationPassed` |
| `verification_sessions.provider_status` after Privado proof read | `selectedProvider`, `providerSessionId`, `requestedClaims`, `status` |
| `verification_sessions.result_summary` after Privado proof read | `authoritativeSource`, `providerReferenceId`, `providerStatus`, `requestedClaims`, `satisfiedClaims`, `message`, `proofReceiptRef`, optional `proofReceiptHash`, `nullifierRefs`, `trustedIssuerScopes`, `verifiablePresentationCount` |
| `verification_artifacts` Didit row | `provider_name = didit`, `artifact_kind = capture_attestation`, `provider_reference_id = <didit session id>`, `redacted_payload =` the normalized Didit summary above |
| `verification_artifacts` Privado bridge row | `provider_name = privado`, `artifact_kind = reusable_credential_bridge`, `provider_reference_id = <bridgeId>`, `expires_at = temporaryRetention.expiresAt`, `redacted_payload =` bridge contract summary only |
| `verification_artifacts` Privado proof row | `provider_name = privado`, `artifact_kind = reusable_proof_receipt`, `provider_reference_id = <backend session id>`, `redacted_payload =` the normalized Privado proof summary above |

These tables must not contain raw Didit callback bodies, full Didit decision arrays, JWZ payloads, full verifiable presentations, document images, or imported reusable credentials.

### 3.3 Observation and scoring

| Entity | Stored in | Core fields |
| --- | --- | --- |
| `risk_inputs` | Postgres | source kind (`join`, `message`, `report`, `verification_ingress`), source IDs, timestamps, normalized hashes, feature references |
| `risk_feature_snapshots` | Postgres | deterministic features used for scoring, versioned by scorer/rule set |
| `risk_decisions` | Postgres | score, confidence, reason codes, recommended action, expiry, scorer version, linked input fingerprint |
| `action_recommendations` | Postgres | recommended moderation action, policy rule that mapped score to action, review requirements |

Notes:
- Keep the scored input fingerprint so a decision can be replayed or proven idempotent.
- A `risk_decisions` row exists before any queue delivery to avoid losing explainability if downstream workers fail.

### 3.4 Cases, review, and outcomes

| Entity | Stored in | Core fields |
| --- | --- | --- |
| `cases` | Postgres | `case_id`, `guild_id`, `subject_user_id`, reason, severity, status, opened/closed timestamps |
| `case_events` | Postgres | timeline entries for score, review, appeal, verification, enforcement, reopen |
| `reports` | Postgres | reporter identity, report reason, evidence references, abuse-defense metadata |
| `case_outcomes` | Postgres | final moderation outcome, moderator actor, rationale, outcome confidence, reversals |
| `appeals` | Postgres | appeal state, reviewer assignments, final disposition |

Notes:
- `cases` is the durable review object that connects reports, evidence, outcomes, and audit trails.
- Moderator feedback updates outcomes and learning state, but outcomes remain auditable regardless of learning changes.

### 3.5 Evidence and blob metadata

| Entity | Stored in | Core fields |
| --- | --- | --- |
| `evidence_records` | Postgres | `evidence_id`, `case_id`, evidence type, capture source, actor, created timestamp |
| `blob_objects` | Postgres | `blob_id`, bucket, object key, byte length, media type, `sha256`, `blake3`, optional perceptual hash |
| `blob_derivatives` | Postgres | parent blob, derivative type (`thumbnail`, `redacted`, `ocr_text`), processing status |
| `evidence_links` | Postgres | mapping from evidence to blob, Discord message URL, redacted text snapshot, retention/legal hold state |

Notes:
- R2 stores bytes; Postgres stores blob identity and policy metadata.
- Object keys should be content-addressed or hash-prefixed to make dedupe and immutable addressing straightforward.
- Retention, redaction, legal hold, and deletion eligibility are all metadata decisions in Postgres, never inferred from R2 alone.
- The first real durable evidence path is Discord `message_link` metadata only: `evidence_records` plus `evidence_links.discord_message_url` and optional `redacted_text_snapshot` are canonical, while blob-backed evidence kinds remain deferred until upload + hashing + redaction are wired.

### 3.6 Learning and similarity

| Entity | Stored in | Core fields |
| --- | --- | --- |
| `learned_signals` | Postgres | signal type, source outcome, confidence, decay state, suppress/disable flags |
| `signal_examples` | Postgres | links to source case, source outcome, evidence, normalized text/domain hashes, outcome label |
| `signal_embeddings` | Postgres + `pgvector` | owning entity type, owning entity ID, embedding model/version, vector or pending-projection placeholder, freshness state |
| `reputation_views` | Postgres | invite reputation, domain reputation, reporter reputation, false-positive counters, advisory report-anomaly views |

Notes:
- Vector rows should point back to their owning case, evidence, or learned signal.
- Learned signals are mutable; raw outcomes and examples are not rewritten to fit updated models.
- The current first advisory path lets Bun read canonical learned-signal rows, pass candidate text and metadata to `services\inference-rs`, and receive fastembed-backed similarity results without moving vector ownership out of Postgres.
- The first moderator-confirmed learning slice records `signal_examples.source_outcome_id` and may create `signal_embeddings` rows with `pending_projection` freshness when Postgres ownership is known but a later worker still has to compute or refresh the vector.
- The first trust/anomaly slice also uses `reputation_views` for:
  - `reporter_reputation` keyed by `(guild_id, reporter_user_id)` and refreshed only from moderator-reviewed cases
  - `subject_report_anomaly` keyed by `(guild_id, subject_user_id)` and refreshed from canonical report velocity / repeated-trigger counts
  - aggregated advisory summaries only; no raw cross-server trust exchange or automatic moderation authority

## 4. What lives in Postgres

Postgres should own:

1. All entities that affect policy, moderation, auditability, or user-visible state.
2. Every final or intermediate moderation decision that must be explainable later.
3. Durable embeddings and their ownership metadata.
4. Outbox events, idempotency receipts, and projection state that lets other systems be rebuilt.
5. Blob metadata, hash identity, retention metadata, redaction state, and minimal verification proof receipts/attestation summaries.

For verification specifically, retention means:

- Didit purge outcomes are retained as minimal receipt metadata in Postgres after provider-side deletion is requested.
- bridge rows expire on `verification_artifacts.expires_at` and are bounded to the external-handoff window only.
- reusable proof rows retain only redacted summary fields; they never become a second credential wallet.

Recommended supporting table families:

| Table family | Why it stays in Postgres |
| --- | --- |
| `outbox_events` | Reliable handoff from committed business state to Redis, Electric projections, and optional Qdrant indexing |
| `idempotency_receipts` | Prevent duplicate processing across Discord events, verification callbacks/proof submissions, and action execution |
| `stream_consumer_checkpoints` | Durable recovery if a worker loses local state |
| `projection_failures` | Operator visibility for stale Electric/Qdrant/SQLite projections |

## 5. What lives in SQLite or libSQL

SQLite or libSQL exists to keep local scoring cheap and resilient near workers.

Recommended local datasets:

| Local dataset | Why local | Rebuild source |
| --- | --- | --- |
| `local_feature_cache` | Fast recent joins/messages/features for hot scoring paths | Postgres risk inputs and feature snapshots |
| `local_signal_embeddings` | `sqlite-vec` nearest-neighbor checks without round-tripping to Postgres | Postgres `signal_embeddings` |
| `domain_reputation_cache` | Fast deny/review checks for repeated domains | Postgres reputation views |
| `invite_profile_cache` | Raid/invite heuristics close to the bot | Postgres invite reputation and recent joins |
| `false_positive_suppression_cache` | Avoid repeating known bad matches | Postgres learned signals and outcomes |
| `local_watermarks` | Last applied outbox or stream position for each worker | Postgres outbox plus Redis stream IDs |

Rules:

1. SQLite/libSQL rows are disposable. If corruption or drift is suspected, drop and rebuild from Postgres-backed events.
2. Do not keep exclusive business state only in SQLite/libSQL.
3. Keep private content minimized; prefer hashes, embeddings, and short-lived feature materialization.
4. If libSQL is used for edge deployment, treat it as a distribution strategy for the same embedded schema, not a second canonical platform DB.
5. Until the local cache refresh path is implemented, Bun should treat Postgres-owned learned-signal reads plus Rust-side fastembed inference as the authoritative advisory path.

## 6. What goes to Cloudflare R2

R2 should hold only byte-heavy or export-heavy payloads:

- screenshots
- message attachments
- uploaded evidence files
- redacted derivatives
- OCR/intermediate artifacts when they are too large for Postgres

Verification-specific boundary:

- R2 is not a sink for raw identity documents, reusable credential bodies, or direct Didit session exports.
- If a future reviewed verification flow needs temporary processing bytes, that processing must stay short-lived, non-canonical, and outside the reusable proof receipt model above.

Blob policy:

| Concern | Rule |
| --- | --- |
| Object key | Deterministic, hash-prefixed, and independent from mutable case status |
| Integrity | Record `sha256` and `blake3`; optional perceptual hash for image matching |
| Metadata | Store bucket, key, size, media type, capture source, redaction status, retention class, and legal hold in Postgres |
| Location | Use R2 location hints or jurisdiction controls only when policy or residency requires them |
| Access | Application access is via signed or brokered reads; dashboards never infer authorization from raw object URLs |
| Deletion | Deletion is driven by Postgres retention state, then executed against R2 |

## 7. Redis Streams boundaries

Redis Streams is the asynchronous transport between Bun apps and Rust services. Consumer groups own delivery; Postgres owns business completion.

Recommended stream families:

| Stream | Producer | Primary consumers | Payload summary |
| --- | --- | --- | --- |
| `risk.ingest` | bot/api | inference, learning preprocessor | normalized source refs and feature pointers |
| `verification.events` | api/verifier | trust/inference/policy workers | session transitions, capture callback refs, and reusable-proof verification refs |
| `evidence.ingest` | bot/api | evidence service | blob refs, capture metadata, redaction/extraction requests |
| `policy.actions` | api/policy engine | bot executor | approved moderation actions only |
| `learning.feedback` | dashboard/api | learning service | moderator-confirmed outcomes and corrections |
| `projection.refresh` | outbox forwarder | SQLite refreshers, optional Qdrant indexer | canonical entity changes that need local projections |

Rules:

1. Stream payloads carry references and immutable facts, not the only copy of a decision.
2. Every consumer group must be replay-safe by using idempotency receipts in Postgres.
3. Use pending-entry monitoring plus `XAUTOCLAIM`-style recovery semantics for abandoned work.
4. Trimming is operational, not business retention. Streams can be trimmed once Postgres receipts prove durable completion.

## 8. Electric sync plan

Electric sync should expose Postgres-backed read models to the dashboard and verifier apps.

Sync scope:

| Client surface | Synced data |
| --- | --- |
| Dashboard overview | guild policy summary, counts, live queue summaries, case summaries, verification funnel metrics |
| Case review UI | case headers, timeline entries, evidence metadata, redacted notes, action history |
| User risk profile | current membership status, recent decisions, verification summary, linked case summaries |
| Verifier app | verification session, challenge state, provider status summary, release-to-role result |
| Audit views | actor-attributed audit entries and action receipts |

Do not sync:

- raw R2 blobs
- unredacted private content
- worker-local SQLite caches
- provider secrets, raw attestation payloads, raw identity documents, or reusable credential bodies
- projection internals like stream pending entries

Rules:

1. Electric reads from Postgres-only tables or Postgres-managed views.
2. Sync authorization must scope by `guild_id` and actor membership.
3. Favor narrow read models for UI latency instead of syncing broad internal tables directly.
4. The UI can be optimistic for local actions, but the committed source remains Postgres.

## 9. Idempotency and replay boundaries

Each boundary needs its own idempotency key because the retry model differs by source.

| Boundary | Idempotency key | Durable receipt location |
| --- | --- | --- |
| Discord ingress | message ID, interaction ID, or derived join fingerprint | Postgres `idempotency_receipts` |
| Verification strategy callbacks and proof submissions | provider request/callback ID, proof scope/nullifier, or backend request ID + strategy role | Postgres `idempotency_receipts` |
| Risk decision calculation | input fingerprint + scorer version | Postgres `risk_decisions` unique constraint |
| Case open/create | guild + subject + opening trigger fingerprint | Postgres `cases` / `case_events` |
| Evidence ingest | blob hash + capture source + case/evidence reference | Postgres `blob_objects` and `evidence_links` |
| Moderation execution | Discord action key + case/action ID | Postgres `action_execution_receipts` |
| Stream consumer work | stream name + group + message ID + handler version | Postgres `stream_consumer_checkpoints` |
| Optional Qdrant projection | owning entity ID + embedding version | Postgres projection receipt |

Guidance:

1. Write the canonical Postgres mutation before acknowledging cross-service work as complete.
2. Retries may repeat transport effects; they must not create duplicate business records or duplicate Discord moderation actions.
3. Prefer immutable append-only events plus terminal status transitions over in-place mutation without history.
4. The first canonical report/evidence slice now uses:
   - `report:{guildId}:{triggerFingerprint}:{reporterUserId}` for report intake retries
   - `report-evidence:{reportId}:message_link:{messageId}` for message-link evidence retries
   - `cases.opening_fingerprint` reuse for the initial case-collapse path behind repeated report triggers

## 10. Vector ownership and optional Qdrant

Vector ownership rules:

1. Every durable embedding has an owning Postgres entity: case, evidence, learned signal, domain profile, invite profile, or reputation view.
2. The owning row defines retention, deletion, freshness, and access policy.
3. `pgvector` is the first durable index and the default query path for implementation one.
4. SQLite/libSQL copies are worker-local acceleration layers.
5. If Qdrant is enabled, it is populated asynchronously from Postgres-owned embeddings and can be fully reindexed from Postgres.

Use Qdrant only when at least one of these becomes true:

- cross-tenant vector throughput materially exceeds acceptable `pgvector` latency
- approximate search and filter combinations become a dedicated bottleneck
- a separate vector-serving tier is needed for operational isolation

Even then:

- Postgres remains the source of truth for embedding identity and ownership
- deletion and retention start in Postgres, then project to Qdrant
- Qdrant downtime must degrade search quality, not corrupt canonical moderation state

## 11. End-to-end write flow

```txt
Discord event / report / verification ingress
  -> normalize and validate
  -> write canonical Postgres rows
  -> append outbox event in same Postgres transaction
  -> forward outbox to Redis Streams consumer workloads
  -> workers enrich, classify, hash, redact, or index
  -> workers write results back to Postgres
  -> Electric exposes updated read models to dashboard/verifier
  -> optional SQLite/Qdrant projections refresh from canonical changes
```

This keeps committed business state ahead of queue processing and keeps every downstream cache or projection rebuildable.

## 12. Implementation notes for follow-on work

1. `define-shared-contracts` should align payloads and IDs with these entity families before service scaffolding begins.
2. `wire-observability-security` should add trace propagation across Postgres outbox forwarding, Redis Streams consumers, and R2 evidence operations.
3. Schema migrations should preserve append-only auditability for decisions, case events, and action receipts.
4. UI-facing Electric shapes should be defined as explicit read models, not direct exposure of every internal table.
