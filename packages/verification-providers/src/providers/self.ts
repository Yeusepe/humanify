/**
 * Purpose: Registers the Self.xyz verification provider manifest behind the shared provider template.
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

import { defineVerificationProvider } from "../template";

export const selfVerificationProvider = defineVerificationProvider({
  benefits: [
    "Shows only the claims you need instead of exposing the whole document.",
    "Best starting point for a reusable Humanify ID that stays private.",
    "Good option if privacy matters more to you than raw coverage.",
  ],
  defaultRank: 1,
  goodFor: "People who want the most private way to prove age or nationality.",
  id: "self",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "server_verified_proof",
    serverEndpointPath: "/verification/providers/self/proof",
    serverVerificationNote: "Humanify must verify a Self-issued proof server-side; browser success alone is never sufficient.",
  },
  privacyDetails: "Humanify can verify the proof without seeing the raw document details behind it.",
  privacySummary: "Most private",
  summary: "Choose Self.xyz if you want the most private option and you have a supported biometric passport or ID.",
  supportedClaimKeys: ["age_over_18", "nationality"],
  thingsToKnow: [
    "You usually need a biometric passport, NFC national ID, or another supported document.",
    "It does not support as many countries and documents as a broad web KYC provider.",
    "Humanify still needs a server-side proof check before release can happen.",
  ],
  title: "Self.xyz",
  whatYouNeed: "A supported biometric passport, NFC national ID, or another attestation Self can read.",
});
