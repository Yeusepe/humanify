/**
 * Purpose: Registers the World ID verification provider manifest behind the shared provider template.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * External references:
 * - https://docs.world.org/world-id/concepts
 * - https://semaphore.appliedzkp.org/docs/concepts/nullifiers
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { defineVerificationProvider } from "../template";

export const worldIdVerificationProvider = defineVerificationProvider({
  benefits: [
    "Strong proof that you are a real person without handing over a full identity document.",
    "Designed around privacy-preserving nullifiers so checks can be harder to link together.",
    "Great fit when a community mostly cares about uniqueness and anti-Sybil protection.",
  ],
  defaultRank: 2,
  goodFor: "People who want a strong proof-of-personhood option when World ID is supported for them.",
  id: "world_id",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "server_verified_proof",
    serverEndpointPath: "/verification/providers/world-id/proof",
    serverVerificationNote: "Humanify must verify the World ID proof and nullifier server-side; client-visible status is not trusted.",
  },
  privacyDetails: "World ID is privacy-preserving, but it is not the widest-coverage route for age or nationality proofs.",
  privacySummary: "Very private",
  summary: "Choose World ID if you want a privacy-friendly proof-of-personhood option and it is available in your region.",
  supportedClaimKeys: ["age_over_18", "nationality"],
  thingsToKnow: [
    "Availability is narrower than Self.xyz or Didit in many countries.",
    "It is better for uniqueness and proof-of-human than for broad document verification.",
    "Humanify still needs a server-side proof check before release can happen.",
  ],
  title: "World ID",
  whatYouNeed: "A World ID-supported credential path in a country and flow where World ID is available to you.",
});
