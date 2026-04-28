/**
 * Purpose: Registers the Discord OAuth-backed account-trust capture strategy manifest behind the shared strategy template.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\contracts.md
 * External references:
 * - https://better-auth.com/docs/authentication/discord
 * - https://better-auth.com/docs/concepts/oauth
 * - https://discord.com/developers/docs/topics/oauth2
 * - https://discord.com/developers/docs/resources/user#get-current-user
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { defineVerificationStrategy } from "../template";

export const discordCaptureFlowStrategy = defineVerificationStrategy({
  benefits: [
    "Lowest-friction first-party trust lane for communities that want a Discord-native gate before stronger proof.",
    "Uses OAuth-approved account and linked-account signals instead of document capture.",
    "Lets Bun score one normalized Discord evidence snapshot before deciding whether stronger evidence is needed.",
  ],
  capabilities: {
    claimDelivery: [
      { claimKey: "discord_account_trust", deliveryKind: "capture_attestation" },
    ],
    faceVerification: {
      satisfiesFaceVerificationPolicy: false,
      summary: "Discord account trust does not satisfy face-check policy requirements on its own.",
      supportLevel: "not_automatic",
    },
    reusableIdentity: {
      contractRole: "none",
      disclosedAttributeKeys: [],
      proofOnlyClaimKeys: [],
      summary: "Discord account trust stays inside the session evidence model and does not mint a reusable identity handoff.",
    },
  },
  defaultRank: 3,
  goodFor: "Communities that want a lightweight Discord-native trust gate before releasing members or escalating them into stronger proof paths.",
  id: "discord",
  integration: {
    completionMode: "provider_verification_required",
    handoffKind: "server_verified_proof",
    serverEndpointPath: "/auth/discord/handoff",
    serverVerificationNote:
      "Humanify only trusts the server-side Better Auth callback plus the Bun-owned Discord account scorer, never the browser redirect alone.",
  },
  privacyDetails:
    "Discord sees the OAuth consent and Humanify only keeps normalized account-trust facts, not raw provider tokens or the full connections payload.",
  privacySummary: "Discord-native trust signals",
  role: "capture_provider",
  summary: "Use Discord sign-in when the server wants Humanify to score native account-trust signals before stronger proof is requested.",
  supportedClaimKeys: ["discord_account_trust"],
  thingsToKnow: [
    "This lane does not prove age, nationality, document ownership, or liveness.",
    "Low-trust Discord results should escalate the user into a stronger proof lane instead of granting release automatically.",
    "Humanify only trusts the server-side callback and normalized score, not the browser redirect by itself.",
  ],
  title: "Discord",
  whatYouNeed: "A Discord account you can sign into in the browser, plus consent for the server-approved account signals Humanify requests.",
});
