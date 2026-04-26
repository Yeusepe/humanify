/**
 * Purpose: Registers the Self.xyz reusable-proof strategy manifest behind the shared strategy template.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * External references:
 * - https://docs.self.xyz/
 * - https://www.w3.org/TR/vc-data-model/
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { defineVerificationStrategy } from "../template";

export const selfReusableProofBackendStrategy = defineVerificationStrategy({
  benefits: [
    "Alternative reusable-proof backend when supported issuer coverage matches the community's policy.",
    "Shows only the claims you need instead of exposing the whole document.",
    "Useful when privacy matters more than broad browser-capture compatibility.",
  ],
  defaultRank: 2,
  goodFor: "People who want a privacy-preserving reusable proof path when Self.xyz supports their credential.",
  id: "self",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "server_verified_proof",
    serverEndpointPath: "/verification/providers/self/proof",
    serverVerificationNote: "Humanify must verify a Self-issued proof server-side; browser success alone is never sufficient.",
  },
  privacyDetails: "Humanify can verify the proof without seeing the raw document details behind it.",
  privacySummary: "Alternative reusable proof",
  role: "reusable_proof_backend",
  summary: "Choose Self.xyz when you want a reusable proof path and its supported credentials fit your policy needs.",
  supportedClaimKeys: ["age_over_18", "nationality"],
  thingsToKnow: [
    "You usually need a biometric passport, NFC national ID, or another attestation Self can read.",
    "Coverage is narrower than a broad first-time capture flow such as Didit.",
    "Privado remains Humanify's primary reusable-proof backend for the current architecture.",
  ],
  title: "Self.xyz",
  whatYouNeed: "A supported biometric passport, NFC national ID, or another credential Self can turn into a reusable proof.",
});
