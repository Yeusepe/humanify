# Humanify verification system

Purpose: define the implementation-facing verification session lifecycle, Discord-bound challenge flow, capture-flow and reusable-proof abstraction, callback rules, and release-to-role semantics for the Bun-owned verification subsystem.

Governing docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\contracts.md`
- `docs\data-platform.md`
- `docs\observability-security.md`
- `docs\architecture.md`
- `docs\api.md`
- `docs\discord-bot.md`
- `docs\verification.md`

Upstream docs:
- Discord OAuth2: https://discord.com/developers/docs/topics/oauth2
- Discord interactions security: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
- Didit JavaScript SDK: https://docs.didit.me/integration/web-sdks/javascript-sdk
- Didit API flow: https://docs.didit.me/integration/api-full-flow
- Didit webhooks: https://docs.didit.me/integration/webhooks
- Didit reusable KYC overview: https://docs.didit.me/core-technology/reusable-kyc/overview
- Didit share KYC via API: https://docs.didit.me/core-technology/reusable-kyc/share-kyc-via-api
- Privado verifier overview: https://docs.privado.id/docs/verifier/verifier-overview/
- Privado request API: https://docs.privado.id/docs/verifier/verification-library/request-api/
- Privado universal links: https://docs.privado.id/docs/wallet/universal-links/
- Privado verification API: https://docs.privado.id/docs/verifier/verification-library/verification-api/
- Privado verifier backend: https://docs.privado.id/docs/verifier/verifier-backend/
- World ID concepts: https://docs.world.org/world-id/concepts
- W3C VC Data Model: https://www.w3.org/TR/vc-data-model/
- Semaphore nullifiers: https://semaphore.appliedzkp.org/docs/concepts/nullifiers
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- PostgreSQL: https://www.postgresql.org/docs/current/index.html
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- OpenTelemetry context propagation: https://opentelemetry.io/docs/concepts/context-propagation/

## 1. Verification subsystem scope

Verification exists to reduce uncertainty and safely release legitimate users. It owns:

1. pending verification session creation
2. Discord-bound one-time challenge generation
3. browser session binding through Discord OAuth2
4. strategy requirement orchestration
5. server-side receipt verification and replay protection
6. final release-to-role or quarantine-release decision
7. durable audit and artifact metadata

It does **not** grant moderation authority to strategy adapters or clients. Adapters return attestations; Bun decides whether the guild's configured requirement is satisfied.

## 2. Session model

| Entity | Purpose | Canonical owner |
| --- | --- | --- |
| `verification_sessions` | user+guild scoped verification attempt and current state, with optional originating `case_id` for moderator warning/review reads | Postgres |
| `verification_requirements` | guild-configured capabilities and fallback rules | Postgres |
| `verification_artifacts` | redacted strategy result metadata and attestation refs | Postgres |
| short-lived challenge secret | Discord-bound one-time proof | derived server secret + Postgres metadata |
| strategy handoff receipt | replay-safe server receipt record | Postgres idempotency + audit |

Recommended session states:

`pending` → `challenge_issued` → `oauth_bound` → `strategy_pending` → `passed` or `failed` or `expired` or `cancelled`

`released` is a terminal post-pass state once Humanify completes the post-pass release step, applies any configured verification roles for the guild, and clears the configured containment roles used during moderator-started verification.

Verification metadata also records whether face verification was part of the capture flow and whether the face check passed. Guild policy can depend on those normalized fields; Bun does not infer them later from raw provider payloads. Didit and World ID can satisfy face-verification-related requirements through their normalized provider outcomes; Privado and Self.xyz do **not** automatically imply face verification and must rely on separate policy inputs if a face check matters.

## 3. Verification flow

```mermaid
sequenceDiagram
  participant User as Discord user
  participant Bot as apps/bot-bun
  participant API as apps/api-bun
  participant Verifier as apps/verifier-start
  participant Strategy as Verification strategy adapter

  User->>Bot: Click Verify in Discord
  Bot->>API: Create verification session + signed challenge request
  API-->>Bot: sessionId + short-lived challenge metadata
  Bot-->>User: Ephemeral challenge code / verifier link
  alt Moderator started verification for another member
    Bot-->>User: DM target user with verifier link + explanation
    Bot->>Bot: Apply configured containment roles
  end
  User->>Verifier: Open verification page
  Verifier->>API: Start browser verifier session
  API->>API: Validate Discord OAuth2 state and bind same guild/user
  API-->>Verifier: Session status + required capabilities
  User->>Verifier: Enter Discord-bound code and continue
  Verifier->>API: Complete challenge step
  API-->>Verifier: Strategy requirements to satisfy
  Verifier->>Strategy: Begin hosted capture or reusable proof flow
  Strategy->>API: Signed callback, proof, or status update
  API->>API: Verify receipt, replay, strategy enablement, session expiry
  API-->>Verifier: Updated status
  API->>API: Add release roles + clear configured containment roles
```

## 4. Verification role and strategy model

Humanify keeps verification architecture generic by splitting concrete adapters into strategy roles instead of baking provider brands into app logic.

| Strategy role | What the adapter does | Humanify responsibility | Default / primary concrete adapter | Explicit non-goal |
| --- | --- | --- | --- | --- |
| capture provider | runs a first-time capture flow or account-signal handoff and returns a Bun-normalized session result | create the Bun-owned session, bind the Discord challenge, receive the server receipt, normalize the result, and apply policy | **Didit** remains the default first-time capture provider; **Discord** is now a capture provider for the shared `discord_account_trust` claim | importing a third-party full KYC session into Humanify as a storage shortcut |
| reusable proof backend | requests reusable proofs from user-held credentials or wallet state and verifies them off-chain | create the verifier request, present proof options, require server-side verification, and store only proof receipts | **Privado** is the primary reusable-proof backend | treating browser completion as proof or storing the full credential payload |
| policy consumer / strategy pipeline | evaluates normalized outcomes against guild policy and controls role release | Bun API + verifier + bot own challenge binding, policy evaluation, audit, and release decisions | **Humanify** | custodying identity documents or becoming the canonical identity wallet |

Implementation rule: `packages\verification-providers` remains the shared adapter registry, but Bun policy, persistence, and UI language are defined in terms of **role + claim predicates + server verification contract**, not provider-specific app branches. On disk, one-time capture flows and reusable proof backends live in separate folders and separate manifests because a first-time capture flow is not a reusable provider.

### 4.1 Shared strategy registry and runtime enablement

Role-specific verification code belongs in `packages\verification-providers`, not in `apps\api-bun` or `apps\verifier-start`.

Folder rule:

- one-time capture flows live under `packages\verification-providers\src\capture-flows\`
- reusable proof backends live under `packages\verification-providers\src\reusable-proof-backends\`
- policy-consumer manifests live under `packages\verification-providers\src\policy-consumers\`, while shared pipeline glue stays in `src\pipelines.ts`
- Didit does not live in the reusable-proof-backend folder because it is a first-time capture flow

That package owns:

1. the generic strategy templates
2. the registered capture-flow catalog
3. the registered reusable-proof-backend catalog
4. the registered strategy pipeline catalog
5. the supported claim keys for each concrete adapter
6. runtime filtering of enabled adapters

Every adapter definition must declare:

| Field group | Required shape | Why it exists |
| --- | --- | --- |
| role + identity | `role`, `id`, `title`, `defaultRank` | keeps concrete adapters registered under a generic strategy model |
| user-facing manifest | `summary`, `goodFor`, `whatYouNeed`, `benefits`, `thingsToKnow` | lets the verifier explain tradeoffs without app-local provider conditionals |
| privacy contract | `privacySummary`, `privacyDetails`, optional `deletionPolicy` | keeps retention and minimization rules attached to the adapter |
| server handoff contract | `integration.handoffKind`, `integration.serverEndpointPath`, `integration.serverVerificationNote` | keeps the Bun boundary generic while still supporting concrete adapters |
| supported predicates | `supportedClaimKeys` | ties user-facing proof bundles to reusable policy checks |

The API and verifier must consume the shared catalog only. They may carry a concrete adapter id through routes and config, but they must not hard-code provider semantics in app-level control flow.

Runtime and guild enablement stay Bun-owned:

- `HUMANIFY_ENABLED_VERIFICATION_PROVIDERS` controls which concrete adapters the Bun API can expose at all.
- `VITE_HUMANIFY_ENABLED_VERIFICATION_PROVIDERS` controls which concrete adapters the verifier UI can render at all.
- `GET /guilds/:guildId/verification` returns the current effective guild verification config snapshot, and `PUT /guilds/:guildId/verification` persists the canonical guild row in `verification_requirements`.
- that canonical row keeps the setup surface bundle-driven: `requiredBundleIds`, `faceVerificationRequired`, `enabledProviderIds`, `defaultProviderId`, optional `defaultReusableProofBackendId`, trusted/suspicious role arrays, and `roleGrantBindings` for release triggers such as `verified_human`, `age_over_18`, and `age_over_21`.
- Keep the environment allowlists aligned so the browser never offers an adapter the API has disabled globally.

### 4.2 First-time capture default: Didit

Didit is the **default first-time capture provider** for flows that need a fresh browser-based identity or liveness capture.

Per Didit's official docs, the intended integration shape is:

1. Bun creates the verification session server-side with Didit's API using a workflow id and callback URL.
2. Bun returns the resulting `verification_url` (or equivalent session URL) to the verifier.
3. The verifier launches that URL in Didit's web flow, including the JavaScript SDK when Humanify wants an embedded or modal browser experience.
4. Didit sends a webhook/status update that Bun verifies server-side before Humanify marks the session as passed.

Important consequences for Humanify:

- browser completion is only a UX signal; it is **never** enough to release a user
- Bun must verify the Didit webhook or equivalent server-side receipt before changing canonical verification state
- Humanify stores only normalized verification facts needed for policy and audit, not the full Didit session payload
- those normalized facts include whether face verification ran and whether the face check passed

Didit also documents reusable KYC and B2B session sharing. Humanify **does not** use Didit's B2B full-session import as an internal shortcut. Didit's own sharing docs state that the import flow creates a **complete copy of the verification session, including documents and checks, inside the receiving service's environment**. That is out of bounds for Humanify because:

1. Humanify is a verifier/orchestrator/policy consumer, not an identity-data custodian
2. importing full Didit sessions would collapse the architecture back into provider-baked storage
3. reusable-proof reuse belongs in the reusable backend role, not the capture-provider role

### 4.2.1 Didit → reusable identity handoff boundary

When a Didit capture result is approved, Humanify may prepare a **reusable identity handoff contract** for a reusable backend such as **Privado**, but it must stop at an honest handoff boundary unless a separate issuer/backend with its own legal basis, wallet binding, and signing material is available.

The handoff contract keeps these **minimal approved facts** only long enough for the handoff window:

- disclosed attributes such as `nationality` when the source capture explicitly approved them
- proof-only predicates such as `age_over_18`, `age_over_21`, and later gender-marker predicates derived from DOB/gender without storing the raw underlying values
- first-class face-verification policy inputs (`performed`, `passed`, and whether the policy requirement is satisfied)
- the source capture attestation reference (`didit:session:<session_id>`)

Humanify sends or persists a reusable identity handoff contract that:

- names the source capture attestation and target backend (`privado` today)
- separates disclosed attributes from proof-only predicates so creator-facing setup stays plain-language and custody stays minimal
- carries only the minimal approved claims above plus face-verification policy inputs
- explicitly says that external issuer inputs such as holder DID, issuer DID, schema choice, and signing-key reference are still required

After a real external handoff completes, the durable Humanify record is still limited to:

- the source attestation reference
- approved claim names
- disclosed-attribute / proof-only summaries
- face-verification policy fields
- target backend id
- audit / handoff refs

Humanify does **not** keep raw documents, raw DOB, raw gender, full Didit payloads, imported Didit sessions, or full Privado credentials as part of this handoff.

### 4.3 Reusable-proof default: Privado

Privado is the **primary reusable-ID / reusable-proof backend** for Humanify's reusable verification lane.

Privado's verifier docs establish the intended model:

1. the verifier creates an off-chain auth or query request describing the claims that must be proven
2. Humanify presents that request through a Universal Link or QR code so the user can open Privado's wallet or web wallet
3. the wallet generates the proof and sends it back to the verifier callback
4. Bun verifies the proof server-side, either directly with the verification library flow or through a Privado verifier backend deployment

This makes Privado the correct home for later reusable-proof verification in Humanify:

- the user keeps the underlying credential and wallet state
- Humanify asks only for the minimum proof bundle needed by guild policy
- Bun records the verification receipt, trusted issuer scope, freshness, and satisfied predicates
- Humanify does not store the full credential payload or identity document data

### 4.4 Consumer-facing proof choices

The verifier should present verification as **proof choices**, not provider brands. Concrete adapters remain visible for transparency, but the primary user decision is which proof path to use.

| User-facing path | Strategy role | Default / primary adapter | Typical claims |
| --- | --- | --- | --- |
| Verify for the first time | capture provider | Didit | `age_over_18`, `age_over_21`, `nationality`, `document_identity`, `liveness`, `face_verification` |
| Use a reusable proof | reusable proof backend | Privado | `age_over_18`, `nationality`, later other reusable predicates |
| Prove uniqueness only | reusable proof backend or later specialist backend | World ID today | `unique_person`, face-verification-related policy inputs when World ID is the selected proof-of-personhood lane |

At verification time, the verifier presents these consumer-facing proof bundles:

| Verifier choice | Claims carried | Best for |
| --- | --- | --- |
| Only prove age over 18 | `age_over_18` | age-gated communities that do not need nationality |
| Only prove nationality | `nationality` | communities that only need country or citizenship eligibility |
| Prove age + nationality | `age_over_18`, `nationality` | communities that need both checks or users who want one reusable combined proof |

For the first implementation, the default proof bundle remains:

- `age_over_18`
- `nationality`

The shared claim catalog also reserves plain-language copy for stricter proof-only age predicates such as `age_over_21`, but the first persisted proof-bundle surface still exposes the v1 age-18 / nationality bundles until setup persistence grows that option explicitly.

## 4.5 Release-to-role mapping

Guild verification config can now attach Discord role releases to normalized verification triggers:

- `verified_human`: grant this role after any successful verification release
- `age_over_18`: grant this role only when the satisfied claims include the 18+ predicate
- `age_over_21`: grant this role only when the satisfied claims include the 21+ predicate

The verifier client calls the Bun release endpoint only after the canonical session reaches `passed`. Humanify then applies the configured roles, records the release summary, and surfaces the final `released` state back to the verifier UI.

### 4.5.1 Setup mode and managed Discord resources

Guild setup now has two explicit operating modes:

1. `manual`: admins choose the existing Discord channels and roles Humanify should use
2. `automatic`: Humanify creates and tracks the first verification channel/panel/release-role set itself

The canonical setup snapshot returned by `GET /guilds/:guildId/channels` and persisted by `PUT /guilds/:guildId/channels` now carries:

- `setupMode`
- optional `verificationChannelId`
- optional `verificationPanelMessageId`
- a `managedResources` inventory of Humanify-owned Discord objects

Automatic setup currently creates:

- a `prove-youre-human` text channel
- the reusable verification panel message in that channel
- `Verified Human`, `Quarantine`, `18+`, and `21+` roles

Those owned refs exist so later bot passes can safely refresh the panel and role mapping without blindly claiming unrelated admin-managed resources.

### 4.6 Verification containment at session start

When a trusted moderator starts verification for another member, Humanify uses the configured `suspiciousRoleIds` as immediate containment roles for that verification session.

Rules:

- Humanify DMs the target member with a signed verifier link and plain-language explanation of why verification is required.
- containment is attempted only for moderator-started cross-user flows (`/verify user:@member` and the warning-card `Start verification` shortcut), not for self-started member verification
- if no `suspiciousRoleIds` are configured, Humanify tells the moderator that automatic containment is not configured for the guild
- if Discord DM delivery or role mutation fails, Humanify tells the moderator plainly instead of claiming a clean containment start
- the successful Bun release step clears those configured containment roles together with any final verification role grants

`unique_person` remains a later extension and must stay behind the same role-based strategy model rather than becoming new app-local branching logic.

### 4.5 Minimal-storage rule

Humanify is a verifier/orchestrator/policy consumer only. It does **not** custody identity information.

Humanify does not store:

- raw document images
- passport or national ID numbers
- date of birth
- raw gender
- the full capture-provider payload
- the full reusable credential payload
- imported third-party full-session copies

Humanify stores only:

- proof receipt metadata
- issuer/provider reference
- claim predicates that were satisfied
- normalized face-verification fields (`faceVerificationPerformed`, `faceVerificationPassed`) when the capture flow exposes them
- expiry / freshness metadata
- unlinkable or scope-limited nullifiers / replay guards
- strategy handoff identifiers needed for audit and idempotency
- audit references showing that Bun verified the proof server-side

For the reusable identity handoff specifically, any temporary bridge facts are time-bounded handoff inputs rather than permanent profile data. The durable post-handoff record remains the attestation ref, approved claims, disclosed-attribute / proof-only summaries, face-verification policy fields, and audit refs.

This matches the W3C VC model's minimization guidance while keeping raw identity data out of Humanify's custody.

### 4.5.1 Verification storage runbook: exact durable fields

The current durable storage contract is intentionally narrow. Operators should expect the following canonical rows and fields after each verification boundary completes:

| Boundary | `verification_sessions.provider_status` | `verification_sessions.result_summary` | `verification_artifacts` | Explicitly not stored |
| --- | --- | --- | --- | --- |
| Didit capture created | `selectedProvider`, `status = didit_session_created`, `requestedClaims`, `workflowId`, `callbackUrl`, `launch.providerSessionId`, `launch.providerStatus`, `launch.url` | empty until Bun reconciles the webhook | none yet | no Didit decision payload, no document bytes |
| Didit webhook reconciled | prior Didit launch fields plus `status = provider_webhook_verified` or `provider_webhook_recorded`, `verifiedWebhook.{webhookType,timestamp,workflowId,providerStatus}`, `purge.{attemptedAt,outcome}`, optional `reusableCredentialBridge` summary | `authoritativeSource = didit_decision_api`, `providerReferenceId`, `providerStatus`, `requestedClaims`, `satisfiedClaims`, `faceVerificationPerformed`, `faceVerificationPassed` | one `capture_attestation` row for provider `didit` with the same normalized summary; optional `reusable_credential_bridge` row for provider `privado` with only the bridge contract | no raw `idVerifications`, no raw `livenessChecks`, no imported Didit session copy |
| Privado proof status read | `selectedProvider`, `providerSessionId`, `requestedClaims`, `status = pending_provider_verification` or `provider_proof_failed` or `provider_proof_verified` | `authoritativeSource = privado_verifier_backend_status`, `providerReferenceId`, `providerStatus`, `requestedClaims`, `satisfiedClaims`, `message`, `proofReceiptRef`, optional `proofReceiptHash`, `nullifierRefs`, `trustedIssuerScopes`, `verifiablePresentationCount` | one `reusable_proof_receipt` row for provider `privado` carrying the same normalized summary | no JWZ, no full VC / presentation array, no holder DID profile, no full wallet payload |
| Didit → reusable identity handoff | stored as the optional `reusableCredentialBridge` summary above | none beyond the Didit normalized summary and face fields | `provider_name = privado`, `artifact_kind = reusable_credential_bridge`, `provider_reference_id = bridgeId`, `attestation_status = issuer_handoff_required`, `expires_at`, and bridge payload containing only `approvedClaims`, `claims.{disclosedAttributes,proofOnlyPredicates}`, `policyInputs.faceVerification`, `handoff`, `custody`, `temporaryRetention`, and durable-after-handoff refs | no minted credential body, no issuer signing material, no raw Didit payload, no raw DOB, no raw gender |

### 4.5.2 Deletion, purge, and retention boundaries

Humanify treats provider cleanup as part of the verification receipt contract:

1. After Bun reconciles a Didit webhook against the server-side decision API, Humanify requests Didit-side deletion and stores only the minimal purge receipt (`attemptedAt`, provider outcome) in `verification_sessions.provider_status.purge`.
2. The bridge contract is time-bounded by `temporaryRetention.expiresAt`; that window exists only to support an external issuer/backend handoff and must not become a long-lived profile store.
3. The durable post-handoff record remains the source attestation ref, approved reusable claims, disclosed-attribute / proof-only summaries, face-verification policy fields, target backend id, and handoff audit ref.
4. Privado proof persistence is limited to receipt refs/hashes, nullifier refs, issuer scopes, predicate results, and proof-status messages. Humanify never stores the wallet credential, raw proof token, or the full verifier-backend success payload.
5. Deletion and expiry decisions stay Postgres-owned and auditable. Queue trimming or provider-side deletion never becomes the source of truth for retention.
6. Moderator warning-card reads prefer a session linked directly through `verification_sessions.case_id`; when no case-linked session exists yet, the bot may read the latest session for the same guild subject only if the payload keeps that fallback explicit.

### 4.5.3 Face-verification storage and use

Face verification is stored only as normalized policy inputs:

- `verification_sessions.result_summary.faceVerificationPerformed`
- `verification_sessions.result_summary.faceVerificationPassed`
- `verification_artifacts.redacted_payload.faceVerificationPerformed` / `faceVerificationPassed` for the Didit `capture_attestation`
- `reusableCredentialBridge.policyInputs.faceVerification.{performed,passed,satisfiesFaceVerificationRequirement}`

These fields exist so Bun policy and external issuer handoff logic can require or explain face verification without retaining selfie images, liveness media, or provider-native liveness payloads.

### 4.6 Reference strategy flows

```mermaid
flowchart TD
  Policy[Guild policy + required claims] --> Choice{User proof path}
  Choice -->|First-time capture| Didit[Didit capture provider]
  Choice -->|Reusable proof| Privado[Privado reusable-proof backend]
  Didit --> ServerReceipt[Server-side verification receipt]
  Privado --> ServerReceipt
  ServerReceipt --> Bun[Bun policy evaluation + audit]
  Bun --> Bot[Discord role release or quarantine retention]
```

```mermaid
sequenceDiagram
  participant User as Discord user
  participant Verifier as apps/verifier-start
  participant API as apps/api-bun
  participant Didit as Didit
  participant Wallet as Privado wallet / web wallet

  alt First-time capture
    Verifier->>API: Request Didit-backed first-time capture
    API->>Didit: Create session server-side
    Didit-->>API: verification_url / session refs
    API-->>Verifier: Strategy handoff info
    Verifier->>Didit: Launch hosted or JS SDK flow
    Didit->>API: Webhook / server receipt
    API->>API: Verify receipt + session binding
  else Reusable proof
    Verifier->>API: Request reusable-proof challenge
    API-->>Verifier: Privado request + universal link / QR metadata
    Verifier->>Wallet: Open Universal Link / scan QR
    Wallet->>API: Proof submission callback
    API->>API: Verify proof server-side
  end
  API->>API: Apply guild policy
```

### 4.7 Current verifier spine and remaining gaps

The current verifier spine is intentionally generic, but the default Didit capture flow is now wired through a real Bun-owned session spine:

1. `POST /guilds/:guildId/verification/sessions` creates the canonical verification session, stores the short-lived challenge boundary, and returns the signed verifier challenge token that carries `sessionId`, `challengeId`, `guildId`, `userId`, and required capabilities.
2. `GET /verification/sessions/:sessionId?token=...` verifies that signed token and returns the canonical persisted session when available, while still refusing to invent provider success from browser state alone.
3. The verifier UI renders the shared adapter catalog from `packages\verification-providers`, so strategy descriptions, privacy notes, and server handoff notes come from adapter modules rather than app-local conditionals.
4. The verifier UI lets the person verifying choose both the proof bundle and the concrete adapter, using consumer-facing wording rather than operator language.
5. The verifier and dashboard UIs split enabled options into **first-time capture flows** and **reusable proof backends**, so both consumers and server owners can understand what is being configured without reading app-local provider branches.
6. Provider-specific verifier UI copy and browser-launch behavior now live in app-local option runtime modules (`apps\verifier-start\src\verification-options\`) so `src\verification-flow.ts` and `src\routes\verify.tsx` stay option-driven.
7. The dashboard and verifier now consume the same authoritative guild verification config snapshot from Bun: enabled adapters, required proof bundles, face-verification policy, and default provider choices come from the persisted `verification_requirements` row when present, or an explicit `catalog_default` snapshot when a guild has not saved config yet.
8. `apps\api-bun\src\verification-options\` now owns provider-specific capture, reusable-proof, and callback runtimes so `apps\api-bun\src\app.ts` dispatches through generic option boundaries rather than branching on concrete adapters.
9. `POST /verification/challenges/:challengeId/complete` re-verifies the same signed token against `challengeId`, `sessionId`, `guildId`, and `userId`, validates the selected adapter and requested proof bundle against the shared registry plus the persisted guild config, and:
   - creates a real Didit session server-side when the selected adapter is `didit`
   - returns the Didit SDK launch contract to the verifier shell
   - exposes reusable-proof adapters through the same shared boundary with `providerStartEndpoint` and a signed `providerStartToken`
   - rejects reusable-proof adapters that cannot satisfy a guild's `faceVerificationRequired` policy instead of silently downgrading the flow
10. `POST /callbacks/providers/didit` verifies the raw-body HMAC/timestamp webhook boundary, fetches the authoritative Didit decision server-side, reduces the result to minimal-custody facts, requests Didit-side deletion after reconciliation, and persists a time-bounded Didit → Privado bridge contract when the approved predicates can seed a later reusable credential or proof-input handoff.
11. `POST /verification/sessions/:sessionId/providers/:providerId/start` is the reusable-proof start boundary. Today it is implemented for Privado and must:
   - verify the signed start token
   - build the provider request from Humanify claim predicates
   - return only wallet launch metadata (`request`, `requestUri`, `universalLink`, QR value) plus a signed `providerSessionToken`
12. `POST /verification/providers/:providerId/proof` is the reusable-proof verification boundary. Today it is implemented for Privado and must:
   - verify the signed provider session token
   - call the Privado verifier backend `GET /status`
   - normalize the result down to satisfied predicates, nullifiers scoped to the Humanify session, trusted issuer scopes, and minimal proof receipt refs or hashes
   - keep release blocked until Bun's canonical session state and policy checks agree
13. The verifier app forwards `x-request-id` and W3C `traceparent` on its session fetch, challenge-complete, reusable-proof start, and reusable-proof verification requests so troubleshooting lines up with the same correlation model as Bun and Rust services.

14. `GET /verification/sessions/:sessionId?token=...` and the Didit callback response may now surface that persisted reusable-credential bridge summary so the UI and privacy runbooks can see the honest handoff boundary without pretending that Humanify already issued a reusable credential.
15. `GET /verification/sessions/:sessionId?token=...` now surfaces the persisted normalized `verification` summary itself when Bun has already reconciled a Didit callback, Privado proof read, or Discord Better Auth handoff, so operators can confirm the stored minimal-custody fields without reading raw provider payloads.

16. Discord account verification is now a real shared-provider lane:
   - challenge completion may choose the `humanify_discord_account_trust_v1` bundle
   - Humanify stores only a signed provider-start token plus a redirect launch contract before leaving the verifier
   - Better Auth owns the Discord sign-in redirect and callback session cookies under the mounted `/auth/better` boundary
   - `GET /verification/providers/discord/handoff` is the Bun-owned reconciliation step that reads the Better Auth session, verifies the Discord account matches the verification-session subject, fetches approved connection signals when the configured scopes allow it, and persists only normalized trust facts and reason codes
   - browser completion alone never passes the session; Bun must record the normalized result plus the shared `verificationDecision` (`release_now`, `require_stronger_evidence`, `keep_quarantined`, or `escalate_review`) before release can proceed

## 5. Route and callback responsibilities

| Boundary | Representative route | Required invariant |
| --- | --- | --- |
| Session start | `POST /guilds/:guildId/verification/sessions` | create canonical session before sending challenge |
| Session fetch | `GET /verification/sessions/:sessionId` | expose only guild/user-authorized state |
| Challenge completion | `POST /verification/challenges/:challengeId/complete` | same Discord user, same guild, short-lived single-use challenge |
| Provider request start | `POST /verification/sessions/:sessionId/providers/:providerId/start` | signed provider-start token, provider-enabled config, no browser-created proof requests or ad-hoc OAuth redirects |
| Discord auth handoff | `GET /verification/providers/discord/handoff` | Better Auth session exists, signed-in Discord account matches the session subject, normalized account trust is persisted before redirect |
| Reusable-proof status verification | `POST /verification/providers/:providerId/proof` | signed provider-session token, server-side status read, minimal normalized proof evidence only |
| Strategy handoff receipt | `POST /callbacks/providers/:providerId` | verify the concrete adapter's server receipt, enforce replay safety, and require the adapter to be enabled for the guild |
| Release decision | `POST /verification/sessions/:sessionId/release` | Bun evaluates policy, applies release roles, clears configured containment roles, and writes the audit row |

## 6. Security and privacy invariants

1. OAuth2 binds the browser user to the Discord user who initiated the verification request.
2. One-time challenges are short-lived, single-use, and scoped to `guildId`, `userId`, and the initiating interaction/session.
3. Browser-reported success is never sufficient; Bun must verify the provider callback, proof submission, or equivalent server receipt before passing the session.
4. Only minimum strategy artifact metadata is stored durably; raw payloads, reusable credentials, full imported sessions, and secrets are not synced to clients.
5. Failed, expired, duplicate, or tampered callbacks create auditable reject records.
6. Release-to-role happens only after the session reaches a Bun-validated `passed` state and current guild policy still allows release.
7. Moderator-started verification containment uses the configured `suspiciousRoleIds`; those roles are only cleared by the successful Bun release step, not by browser completion alone.

## 6.1 Privado runtime configuration

Reusable-proof start and verification stay disabled unless Bun has explicit Privado verifier config:

- `HUMANIFY_PRIVADO_VERIFIER_BASE_URL` — base URL for the Privado verifier backend deployment Humanify calls for `/sign-in` and `/status`
- `HUMANIFY_PRIVADO_ALLOWED_ISSUERS` — comma-separated trusted issuer DIDs; wildcard issuers are intentionally rejected
- `HUMANIFY_PRIVADO_CHAIN_ID` — optional chain id passed into the generated Privado request payload

When those variables are absent, Humanify may still render Privado in shared catalogs for future capability planning, but Bun must not create or verify reusable proofs for it.

## 6.2 Discord Better Auth runtime configuration

Discord account verification stays disabled unless Bun has an explicit Better Auth verification bundle:

- `HUMANIFY_VERIFIER_BASE_URL` - verifier app base URL used for the post-auth return path
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `HUMANIFY_SESSION_SECRET` or `BETTER_AUTH_SECRET`
- optional `HUMANIFY_BETTER_AUTH_BASE_PATH` when the mounted Better Auth path should differ from `/auth/better`

When those variables are absent, Humanify may still surface Discord in shared catalogs for planning and setup, but Bun must not start or reconcile the Discord provider lane.

## 7. How verification interacts with moderation

- verification lowers uncertainty and may downgrade risk, but it does not erase prior evidence or case history
- a passed verification can trigger role release, reduced risk score, or case review recommendations depending on policy
- a failed or expired verification can keep quarantine, escalate to review, or preserve current containment
- irreversible actions still require the normal policy engine and moderator review path where configured

## 8. Dependencies for later phases

- `packages\auth` now owns verifier challenge tokens plus signed provider-start tokens; Discord browser auth itself is delegated to the app-local Better Auth bridge instead of a hand-rolled OAuth callback path
- bot challenge delivery and release receipts must match `docs\discord-bot.md`
- API callback and release routes must match `docs\api.md`
- release now clears configured containment roles together with the final verification role grants; future work can still extend this into richer quarantine-policy variants without reintroducing fake success paths
