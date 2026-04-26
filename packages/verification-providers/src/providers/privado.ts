/**
 * Purpose: Registers the Privado reusable-proof backend strategy manifest behind the shared strategy template.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * External references:
 * - https://docs.privado.id/docs/verifier/verifier-overview/
 * - https://docs.privado.id/docs/verifier/verification-library/request-api/
 * - https://docs.privado.id/docs/verifier/verification-library/verification-api/
 * - https://docs.privado.id/docs/verifier/verifier-backend/
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { defineVerificationStrategy } from "../template";

export const privadoVerificationProvider = defineVerificationStrategy({
  benefits: [
    "Primary reusable-proof backend for age and nationality claims in the current Humanify architecture.",
    "Turns verifier requests into wallet-friendly universal links or QR flows instead of forcing fresh document capture.",
    "Keeps the underlying credential with the holder while Humanify stores only proof receipts and satisfied predicates.",
  ],
  defaultRank: 1,
  goodFor: "People who already hold a reusable credential and want the default Humanify reusable-proof path.",
  id: "privado",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "server_verified_proof",
    serverEndpointPath: "/verification/providers/privado/proof",
    serverVerificationNote: "Humanify must verify the returned Privado proof against the original request or verifier-backend context before trusting it.",
  },
  privacyDetails: "Privado lets the holder keep the credential and only disclose the minimum proof bundle that satisfies the query.",
  privacySummary: "Primary reusable proof",
  role: "reusable_proof_backend",
  summary: "Choose Privado when you want Humanify's primary reusable-proof backend for age and nationality predicates.",
  supportedClaimKeys: ["age_over_18", "nationality"],
  thingsToKnow: [
    "Humanify must build a verifier request, present a universal link or QR code, and verify the proof server-side before release stays possible.",
    "The reusable credential remains with the user; Humanify stores only proof receipts, issuer scope, freshness, and satisfied predicates.",
    "This is the primary reusable-proof backend for the current strategy model.",
  ],
  title: "Privado",
  whatYouNeed: "A Privado-compatible wallet or web wallet holding a credential that can satisfy the requested proof bundle.",
});
