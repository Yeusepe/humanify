# Humanify shared contracts

This document formalizes the first shared contracts between Bun apps and Rust services.

Governing local docs:
- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\README.md`
- `docs\reference-baseline.md`
- `docs\contracts\humanify-contracts.schema.json`

Upstream docs:
- https://bun.sh/docs/api/http
- https://docs.rs/axum/latest/axum/struct.Json.html
- https://serde.rs/derive.html
- https://docs.rs/serde_json/latest/serde_json/
- https://www.rfc-editor.org/rfc/rfc8259.txt
- https://json-schema.org/draft/2020-12
- https://semver.org/spec/v2.0.0.html

## 1. Contract status and ownership

- **Transport:** the first Bun ↔ Rust boundary is synchronous HTTP with JSON bodies.
- **Serialization:** Bun uses web-standard JSON request/response bodies; Rust uses Axum `Json<T>` plus `serde` / `serde_json`.
- **Canonical wire schema:** `docs\contracts\humanify-contracts.schema.json`
- **Current source of truth:** this markdown doc plus the JSON Schema file.
- **Future generated/code-owned locations:** `packages/contracts` on the Bun side and `crates/humanify-proto` on the Rust side, both derived from or kept in lockstep with the canonical schema.

Until the shared packages exist, new Bun routes and Rust handlers should treat this doc and the schema file as authoritative.

## 2. Safety boundary

Humanify remains a safety-first moderation system, not an auto-ban model.

1. **Rust model/service output is advisory only.**
2. **The Bun policy engine is authoritative** for thresholding, overrides, verification rules, and allowed actions.
3. **The executor is capability- and config-limited** and may only apply actions enabled by server configuration and supported by current Discord permissions.
4. **Irreversible enforcement is never implied by inference alone.** `recommendedAction` is a recommendation, not an execution order.

Explicitly forbidden on the Bun ↔ Rust wire contract:

- `execute`
- `allowedAction`
- `enforceNow`
- `autoBan`
- raw Discord moderation commands

Rust may recommend `ban`; Bun must still clamp that recommendation through server policy and capability checks.

## 3. Wire conventions

- **Encoding:** UTF-8 JSON over HTTP.
- **Content type:** `application/json`
- **Object model:** snake_case reason codes inside otherwise camelCase JSON payloads.
- **Timestamps:** RFC 3339 / ISO 8601 UTC strings.
- **IDs:** opaque strings unless the field name says `Hash`.
- **Confidence values:** decimal numbers in the inclusive range `0.0` to `1.0`.
- **Risk score:** integer in the inclusive range `1` to `10`.
- **Evidence refs:** stable opaque IDs that resolve to canonical evidence metadata elsewhere.

## 4. Versioning rules

- Every request and response must carry `contractVersion`.
- Contract versioning follows SemVer.
- While the platform is still pre-1.0, coordinated Bun and Rust releases are expected.
- For this phase, the contract starts at **`0.1.0`**.
- Incrementing guidance:
  - **PATCH:** doc-only clarification or schema metadata change with no wire change
  - **MINOR:** additive optional field, additive enum member, or new endpoint within the same compatibility expectations
  - **MAJOR:** field rename/removal, meaning change, tighter validation that rejects previously valid payloads, or reordered semantics of the action ladder

Schema ownership rule:

- The JSON Schema file owns the wire shape.
- This markdown file owns semantics, safety invariants, taxonomy, and rollout rules.
- Bun and Rust type definitions must not drift from either source.

## 5. Action ladder semantics

The action ladder is ordered from least to most disruptive:

| Action | Meaning | Reversible by default | Notes |
| --- | --- | --- | --- |
| `none` | observe only | yes | passive logging, no user-facing restriction |
| `watch` | increase review priority | yes | watchlist, light alerting, no containment |
| `verify` | require challenge or attestation | yes | preferred before hard containment when uncertainty is meaningful |
| `quarantine` | restrict roles, links, mentions, or access | yes | default containment action |
| `timeout` | temporary platform restriction | mostly | duration must come from policy, not from inference |
| `kick` | remove from guild | no | may be allowed only above server-configured threshold |
| `ban` | remove and block rejoin | no | off by default for automatic execution |

Rules:

- `recommendedAction` is monotonic within this ladder.
- Rust can recommend any ladder step.
- Bun policy evaluation may downgrade or upgrade that recommendation only inside configured server policy.
- The executor must clamp the final action to `serverPolicy.maxAutomaticAction` and current Discord permissions.
- The safest default for high uncertainty is `quarantine` or `verify`, not `kick` or `ban`.

## 6. Reason code taxonomy

Reason codes are stable machine-readable strings. Format:

```txt
<category>_<signal>
```

Examples:

- `account_age_lt_24h`
- `first_message_link`
- `mention_burst`
- `similar_to_confirmed_scam_template`
- `malicious_domain_pattern`
- `verification_passed_world_id`
- `false_positive_pattern_match`

### 6.1 Taxonomy categories

| Category | Meaning | Example codes |
| --- | --- | --- |
| `account` | account age and identity maturity signals | `account_age_lt_24h`, `account_age_lt_7d` |
| `profile` | avatar, banner, username, profile hygiene | `profile_missing_avatar`, `profile_missing_banner` |
| `message` | message content and first-contact behavior | `first_message_link`, `duplicate_message_pattern` |
| `behavior` | spam rate, mention burst, join spike, timing anomalies | `mention_burst`, `joins_during_raid_spike` |
| `invite` | invite source and invite reputation | `invite_used_by_suspicious_accounts` |
| `domain` | URL, domain reputation, lookalike detection | `malicious_domain_pattern`, `lookalike_domain` |
| `report` | trusted report and moderator report signals | `confirmed_cross_server_spam_report` |
| `verification` | verification and attestation outcomes | `verification_passed_captcha`, `verification_failed_challenge` |
| `learned` | embedding similarity, reputation, learned patterns | `similar_to_confirmed_scam_template`, `behavior_pattern_match` |
| `outcome` | moderation feedback, appeal correction, or neutral/no-signal results | `prior_false_positive`, `appeal_overturned_case`, `outcome_no_elevated_signal` |

### 6.2 Reason-code rules

- Reason codes are explanatory, not executable.
- Every `RiskDecision` must include at least one reason code.
- A reason code may raise or lower score.
- No undocumented reason code may be introduced in code without updating this doc and the canonical schema examples.
- High-impact enforcement must be explainable through reason codes visible to moderators.

## 7. Core domain contracts

The schema file contains the precise JSON shape. The sections below define semantics.

### 7.1 `RiskDecision`

Advisory risk output produced from deterministic scoring, learned signals, or both.

```ts
type RiskDecision = {
  userId: string;
  guildId: string;
  score: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  confidence: number; // 0..1
  reasonCodes: string[];
  recommendedAction: "none" | "watch" | "verify" | "quarantine" | "timeout" | "kick" | "ban";
  evidenceRefs: string[];
  expiresAt?: string;
};
```

Notes:

- This is the canonical advisory artifact shared across Bun and Rust.
- `recommendedAction` is derived from score, learned evidence, and heuristics, but is still non-authoritative.
- `expiresAt` is used for decaying time-sensitive decisions like join-spike suspicion.

### 7.2 `CaseOutcome`

Moderator-confirmed result used by learning and audit systems.

```ts
type CaseOutcome = {
  caseId: string;
  guildId: string;
  subjectUserIdHash: string;
  outcome:
    | "confirmed_scam"
    | "confirmed_bot"
    | "confirmed_hacked_account"
    | "false_positive"
    | "dismissed"
    | "overturned";
  confidence: number;
  decidedBy: string;
  decidedAt: string;
  reasonCodes: string[];
  evidenceRefs: string[];
};
```

Notes:

- `subjectUserIdHash` is hashed because learning and cross-case matching should not require plain user IDs.
- `CaseOutcome` is the authoritative input for calibration and false-positive suppression.

### 7.3 `LearnedSignal`

Derived reusable pattern learned from confirmed outcomes.

```ts
type LearnedSignal = {
  id: string;
  type:
    | "text_similarity"
    | "domain_reputation"
    | "invite_reputation"
    | "image_hash"
    | "behavior_pattern"
    | "reporter_reputation"
    | "server_trust";
  valueHash: string;
  weight: number;
  confidence: number;
  sourceCaseIds: string[];
  falsePositiveCount: number;
  truePositiveCount: number;
  lastSeenAt: string;
  expiresAt?: string;
};
```

Notes:

- Learned signals may influence score, confidence, and reasons.
- Learned signals may not trigger raw Discord enforcement on their own.
- A high false-positive count should reduce or nullify effective weight in policy-aware scoring.

## 8. Policy inputs

Two policy-related shapes matter:

1. **Scoring policy input** sent from Bun to Rust so inference can respect tenant-level signal toggles.
2. **Authoritative policy evaluation input** assembled in Bun after inference returns.

### 8.1 `ScoringPolicyInput` (cross-language)

```ts
type ScoringPolicyInput = {
  serverSensitivity: "low" | "balanced" | "high";
  preferredContainmentAction: "verify" | "quarantine";
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
  enabledSignalFamilies: string[];
  allowCrossServerSignals: boolean;
};
```

Rules:

- This shape informs scoring only.
- It does **not** authorize timeout, kick, or ban.
- Rust services should treat absent families as disabled rather than guessing.

### 8.2 `PolicyInput` (authoritative Bun-side shape)

```ts
type PolicyInput = {
  riskDecision: RiskDecision;
  serverPolicy: {
    maxAutomaticAction: RiskDecision["recommendedAction"];
    allowAutoBan: boolean;
    verificationRequiredAtOrAbove: number;
    quarantineAtOrAbove: number;
    timeoutAtOrAbove?: number;
    kickAtOrAbove?: number;
    banAtOrAbove?: number;
  };
  capabilityContext: {
    canManageRoles: boolean;
    canTimeout: boolean;
    canKick: boolean;
    canBan: boolean;
  };
  caseContext: {
    existingOpenCase: boolean;
    verificationStatus: "unknown" | "pending" | "passed" | "failed";
    appealOpen: boolean;
  };
};
```

Rules:

- `PolicyInput` is owned by Bun packages, not Rust services.
- The Bun policy engine is the only component allowed to convert a `RiskDecision` into an executable action.
- The executor must receive an already-clamped policy decision, never a raw `InferenceResponse`.

## 9. Bun ↔ Rust inference payloads

### 9.1 `InferenceRequest`

```ts
type InferenceRequest = {
  contractVersion: string;
  requestId: string;
  guildId: string;
  subjectUserId: string;
  event: {
    kind: "join" | "message" | "report" | "verification_update" | "manual_review";
    occurredAt: string;
  };
  features: {
    accountAgeHours: number;
    joinedAgeMinutes: number;
    hasAvatar: boolean;
    hasBanner: boolean;
    firstMessageDelaySeconds?: number;
    messageTextHash?: string;
    normalizedDomains: string[];
    inviteCodeHash?: string;
    mentionCountLastMinute: number;
    duplicateMessageCount: number;
  };
  evidenceRefs: string[];
  policyInput: ScoringPolicyInput;
};
```

Rules:

- Request payloads should prefer hashes, embeddings, and normalized metadata over raw private content.
- If a feature is unavailable, omit it instead of inventing a default.
- Bun owns request normalization before calling Rust.

### 9.2 `InferenceResponse`

```ts
type InferenceResponse = {
  contractVersion: string;
  requestId: string;
  modelVersion: string;
  decision: RiskDecision;
  learnedSignals: LearnedSignal[];
  warnings: string[];
};
```

Rules:

- `decision` is advisory.
- `warnings` should capture degraded inference states such as missing embeddings, unavailable reputation data, or partial evidence.
- Rust must echo the request ID for traceability.

## 10. Contract examples

### 10.1 Example `InferenceRequest`

```json
{
  "contractVersion": "0.1.0",
  "requestId": "req_01jz6n5x3q6k0d8d5f8n",
  "guildId": "123456789012345678",
  "subjectUserId": "234567890123456789",
  "event": {
    "kind": "message",
    "occurredAt": "2026-01-15T18:42:11Z"
  },
  "features": {
    "accountAgeHours": 4,
    "joinedAgeMinutes": 2,
    "hasAvatar": false,
    "hasBanner": false,
    "firstMessageDelaySeconds": 8,
    "messageTextHash": "blake3:8f7d3f...",
    "normalizedDomains": ["disc0rd-gifts.example"],
    "inviteCodeHash": "blake3:3c93e1...",
    "mentionCountLastMinute": 7,
    "duplicateMessageCount": 3
  },
  "evidenceRefs": ["evi_01jz6n6bk8y1rj8d3n3k"],
  "policyInput": {
    "serverSensitivity": "balanced",
    "preferredContainmentAction": "quarantine",
    "suspiciousRoleIds": [],
    "trustedRoleIds": ["111111111111111111"],
    "enabledSignalFamilies": ["account", "message", "behavior", "invite", "domain", "learned"],
    "allowCrossServerSignals": true
  }
}
```

### 10.2 Example `InferenceResponse`

```json
{
  "contractVersion": "0.1.0",
  "requestId": "req_01jz6n5x3q6k0d8d5f8n",
  "modelVersion": "risk-heuristics-0.1.0",
  "decision": {
    "userId": "234567890123456789",
    "guildId": "123456789012345678",
    "score": 8,
    "confidence": 0.91,
    "reasonCodes": [
      "account_age_lt_24h",
      "first_message_link",
      "malicious_domain_pattern",
      "similar_to_confirmed_scam_template"
    ],
    "recommendedAction": "quarantine",
    "evidenceRefs": ["evi_01jz6n6bk8y1rj8d3n3k"],
    "expiresAt": "2026-01-15T20:42:11Z"
  },
  "learnedSignals": [
    {
      "id": "ls_01jz6n8akgn1v8dqt8rn",
      "type": "text_similarity",
      "valueHash": "blake3:6540aa...",
      "weight": 2.5,
      "confidence": 0.93,
      "sourceCaseIds": ["case_01jz5rx5g8b9vn78q0pz"],
      "falsePositiveCount": 0,
      "truePositiveCount": 4,
      "lastSeenAt": "2026-01-15T18:42:11Z"
    }
  ],
  "warnings": []
}
```

## 11. Immediate implementation guidance

- New Bun and Rust service skeletons should validate payloads against `docs\contracts\humanify-contracts.schema.json`.
- New reason codes should be added docs-first.
- If future work introduces async contracts on Redis Streams, reuse these same domain shapes unless a stream-specific envelope is required.
