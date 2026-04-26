/**
 * Purpose: Registers the World ID reusable-proof strategy manifest behind the shared strategy template.
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

import { defineVerificationStrategy } from "../template";

export const worldIdVerificationProvider = defineVerificationStrategy({
  benefits: [
    "Strong proof-of-personhood option without handing over a full identity document.",
    "Designed around privacy-preserving nullifiers so uniqueness checks are harder to link together.",
    "Fits anti-Sybil or uniqueness-heavy communities better than broad KYC capture flows.",
  ],
  defaultRank: 3,
  goodFor: "People who want a uniqueness-focused reusable proof backend when World ID is supported for them.",
  id: "world_id",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "server_verified_proof",
    serverEndpointPath: "/verification/providers/world-id/proof",
    serverVerificationNote: "Humanify must verify the World ID proof and nullifier server-side; client-visible status is not trusted.",
  },
  privacyDetails: "World ID is privacy-preserving, but it is optimized for uniqueness rather than broad age or nationality coverage.",
  privacySummary: "Uniqueness-first reusable proof",
  role: "reusable_proof_backend",
  summary: "Choose World ID when you need a privacy-friendly proof-of-personhood lane rather than a full age or nationality proof set.",
  supportedClaimKeys: ["unique_person"],
  thingsToKnow: [
    "Availability is narrower than Didit or Privado in many countries.",
    "It is better for uniqueness and anti-Sybil checks than for broad document verification.",
    "Humanify still needs a server-side proof check before release can happen.",
  ],
  title: "World ID",
  whatYouNeed: "A World ID-supported credential path in a country and flow where World ID is available to you.",
});
