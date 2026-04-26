/**
 * Purpose: Verifies the reusable identity handoff contract supports disclosed attributes, proof-only predicates, and face-verification policy inputs without exposing raw DOB or raw gender.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * Tests:
 * - packages/verification-providers/src/reusable-identity.test.ts
 * External references:
 * - https://www.w3.org/TR/vc-data-model/
 */

import { expect, test } from "bun:test";

import { createReusableIdentityHandoffContract } from "./reusable-identity";

test("reusable identity handoff contracts separate disclosed attributes from proof-only predicates", () => {
  const contract = createReusableIdentityHandoffContract({
    handoff: {
      disclosedAttributeKeys: ["nationality"],
      note:
        "Humanify can hand off nationality as a disclosed attribute and age/gender as proof-only predicates, but a separate issuer still owns credential minting.",
      proofOnlyClaimKeys: ["age_over_18", "age_over_21", "gender_marker_female"],
      requiredExternalInputs: ["holderDid", "issuerDid", "credentialSchema", "issuerSigningKeyRef"],
      targetBackend: "privado",
    },
    now: Date.UTC(2026, 0, 1, 0, 0, 0),
    source: {
      guildId: "guild_123",
      providerId: "didit",
      providerSessionId: "didit_session_123",
      sessionId: "session_123",
      userId: "user_123",
    },
    verifiedSourceFacts: {
      disclosedAttributes: {
        nationality: "ESP",
      },
      faceVerification: {
        evidenceSource: "capture_provider",
        passed: true,
        performed: true,
      },
      satisfiedClaims: ["age_over_18", "age_over_21", "nationality", "gender_marker_female", "document_identity"],
    },
  });

  expect(contract).toBeDefined();
  expect(contract!.contractVersion).toBe("reusable_identity_handoff_v1");
  expect(contract!.approvedClaims).toEqual(["age_over_18", "age_over_21", "nationality", "gender_marker_female"]);
  expect(contract!.claims).toEqual({
    disclosedAttributes: {
      nationality: "ESP",
    },
    proofOnlyPredicates: ["age_over_18", "age_over_21", "gender_marker_female"],
  });
  expect(contract!.policyInputs.faceVerification).toEqual({
    evidenceSource: "capture_provider",
    passed: true,
    performed: true,
    satisfiesFaceVerificationRequirement: true,
  });
  expect(contract!.temporaryRetention).toEqual({
    expiresAt: "2026-01-01T01:00:00.000Z",
    retainedClaims: ["age_over_18", "age_over_21", "nationality", "gender_marker_female"],
    retainedPolicyInputs: ["faceVerification"],
  });
  expect(JSON.stringify(contract)).not.toContain("dateOfBirth");
  expect(JSON.stringify(contract)).not.toContain("\"gender\":");
});
