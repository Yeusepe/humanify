/**
 * Purpose: Registers the Didit verification provider manifest behind the shared provider template.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * External references:
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.didit.me/integration/webhooks
 * - https://docs.didit.me/console/data-retention
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { defineVerificationProvider } from "../template";

export const diditVerificationProvider = defineVerificationProvider({
  benefits: [
    "Usually the fastest browser flow.",
    "Supports the broadest range of common IDs and countries.",
    "Best fallback if the more private options do not support your documents.",
  ],
  defaultRank: 3,
  deletionPolicy:
    "Humanify deletes the Didit session via DELETE /v3/session/{session_id}/ immediately after normalizing the verification result.",
  goodFor: "People who want speed and broad document support, even if it is less private.",
  id: "didit",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "signed_webhook",
    serverEndpointPath: "/callbacks/providers/didit",
    serverVerificationNote: "Humanify must verify Didit's signed webhook or server-side status result before trusting the verification.",
  },
  privacyDetails: "Didit sees the underlying identity data during verification, so it is less private than Self.xyz or World ID.",
  privacySummary: "Fastest, but less private",
  summary: "Choose Didit if you want the quickest web flow or the other providers do not support your document or country.",
  supportedClaimKeys: ["age_over_18", "nationality"],
  thingsToKnow: [
    "It is the least private option because the provider processes your document data.",
    "Humanify keeps only the minimum attestation and deletes the Didit session afterward.",
    "It is a practical fallback, not the best base for a private reusable identity.",
  ],
  title: "Didit",
  whatYouNeed: "A common government ID or other document that Didit supports in its browser flow.",
});
