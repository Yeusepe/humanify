/**
 * Purpose: Registers Humanify's internal policy-consumer strategy manifest so pipelines can explicitly model the Bun-owned release decision step.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\architecture.md
 * External references:
 * - https://opentelemetry.io/docs/concepts/context-propagation/
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { getSupportedVerificationClaimIds } from "../claims";
import { defineVerificationStrategy } from "../template";

export const humanifyPolicyConsumerStrategy = defineVerificationStrategy({
  benefits: [
    "Keeps release-to-role decisions inside Bun-owned policy evaluation instead of adapter-local logic.",
    "Normalizes capture and reusable-proof receipts before guild policy decides whether a requirement is satisfied.",
    "Preserves the minimal-storage rule by storing only normalized proof receipts, audit facts, and replay guards.",
  ],
  capabilities: {
    claimDelivery: getSupportedVerificationClaimIds().map((claimKey) => ({
      claimKey,
      deliveryKind: "policy_evaluation" as const,
    })),
    faceVerification: {
      satisfiesFaceVerificationPolicy: true,
      summary: "Humanify can evaluate normalized face-check policy inputs regardless of which enabled provider supplied them.",
      supportLevel: "capture_attestation",
    },
    reusableIdentity: {
      contractRole: "none",
      disclosedAttributeKeys: [],
      proofOnlyClaimKeys: [],
      summary: "Humanify consumes reusable identity handoff contracts for policy and audit, but it is not itself a credential backend.",
    },
  },
  defaultRank: 1,
  goodFor: "Every verification lane, because Humanify is always the policy consumer that decides release eligibility.",
  id: "humanify",
  integration: {
    completionMode: "policy_consumer_evaluation",
    handoffKind: "policy_evaluation",
    serverEndpointPath: "/verification/sessions/:sessionId/release",
    serverVerificationNote: "Humanify re-checks canonical session state, normalized strategy receipts, and guild policy before release-to-role stays possible.",
  },
  privacyDetails: "Humanify stores only normalized proof receipts, attestation references, nullifiers or replay guards, and audit facts instead of raw identity payloads.",
  privacySummary: "Bun-owned policy consumer",
  role: "policy_consumer",
  summary: "Humanify is the verifier/orchestrator and policy consumer that decides whether a guild's verification requirement is satisfied.",
  supportedClaimKeys: getSupportedVerificationClaimIds(),
  thingsToKnow: [
    "Humanify is not a capture provider or identity wallet; it only consumes normalized outcomes and applies policy.",
    "A verified external strategy receipt is still required before Humanify can evaluate release eligibility.",
    "No raw identity documents or full reusable credentials should leave the concrete strategy layer.",
  ],
  title: "Humanify",
  whatYouNeed: "A verified receipt from an enabled capture provider or reusable-proof backend that satisfies the guild's claim requirements.",
});
