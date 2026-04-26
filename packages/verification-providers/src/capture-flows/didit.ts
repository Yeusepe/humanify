/**
 * Purpose: Registers the Didit first-time capture-flow strategy manifest behind the shared strategy template.
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

import { defineVerificationStrategy } from "../template";

export const diditCaptureFlowStrategy = defineVerificationStrategy({
  benefits: [
    "Default first-time capture lane for users who need a fresh browser-based document flow.",
    "Supports the broadest range of common IDs and countries.",
    "Practical fallback when reusable-proof backends do not yet cover the user's credential.",
  ],
  defaultRank: 1,
  deletionPolicy:
    "Humanify deletes the Didit session via DELETE /v3/session/{session_id}/ immediately after normalizing the verification result.",
  goodFor: "People who need a fresh capture flow with broad document support, even if the provider sees the raw document during capture.",
  id: "didit",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "signed_webhook",
    serverEndpointPath: "/callbacks/providers/didit",
    serverVerificationNote: "Humanify must verify Didit's signed webhook or server-side status result before trusting the capture result.",
  },
  privacyDetails: "Didit sees the underlying identity data during first-time capture, so this lane is less private than reusable-proof verification.",
  privacySummary: "Default first-time capture",
  role: "capture_provider",
  summary: "Use Didit when you need Humanify's default first-time capture flow for document and liveness verification.",
  supportedClaimKeys: ["age_over_18", "nationality", "document_identity", "liveness"],
  thingsToKnow: [
    "Browser completion is only a UX step; Humanify still waits for a verified server receipt before release stays possible.",
    "Humanify keeps only normalized attestation facts and deletes the Didit session afterward.",
    "Didit is a capture flow, not Humanify's reusable-proof backend.",
  ],
  title: "Didit",
  whatYouNeed: "A supported government ID or other document that Didit can verify in its hosted browser flow.",
});
