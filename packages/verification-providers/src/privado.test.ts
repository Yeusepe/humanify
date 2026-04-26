/**
 * Purpose: Verifies Privado reusable-proof helpers build documented query requests, wallet launches, and normalized verification summaries without leaking raw credential state.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\observability-security.md
 * External references:
 * - https://docs.privado.id/docs/verifier/verification-library/request-api/
 * - https://docs.privado.id/docs/verifier/verifier-backend/
 * - https://docs.privado.id/docs/wallet/universal-links/
 * Tests:
 * - packages/verification-providers/src/privado.test.ts
 */

import { expect, test } from "bun:test";

import {
  buildPrivadoWalletLaunch,
  createPrivadoReusableCredentialBridge,
  createPrivadoVerificationPlan,
  normalizePrivadoVerificationResult,
} from "./privado";

test("Privado verification plans use V3 queries, trusted issuers, and nullifier-bound scopes", () => {
  const plan = createPrivadoVerificationPlan({
    chainId: "80002",
    nullifierSessionId: "session_123",
    now: Date.UTC(2026, 0, 1, 0, 0, 0),
    requestedClaims: ["age_over_18", "nationality"],
    trustedIssuers: ["did:issuer:age", "did:issuer:nationality"],
  });

  expect(plan.request.chainID).toBe("80002");
  expect(plan.request.scope).toHaveLength(2);
  expect(plan.request.scope[0]).toMatchObject({
    circuitId: "credentialAtomicQueryV3-beta.1",
    id: 1,
    params: {
      nullifierSessionId: "session_123",
    },
    query: {
      allowedIssuers: ["did:issuer:age", "did:issuer:nationality"],
      context: "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/kyc-v4.jsonld",
      type: "KYCAgeCredential",
    },
  });
  expect(plan.request.scope[1]?.query).toEqual({
    allowedIssuers: ["did:issuer:age", "did:issuer:nationality"],
    context: "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/kyc-v4.jsonld",
    credentialSubject: {
      countryCode: {},
    },
    type: "KYCCountryOfResidenceCredential",
  });
});

test("Privado wallet launches convert backend request URIs into universal links with return URLs", () => {
  const launch = buildPrivadoWalletLaunch({
    backUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
    finishUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
    qrCode: "iden3comm://?request_uri=https%3A%2F%2Fverifier-backend.privado.id%2Fqr-store%3Fid%3Dabc123",
  });

  expect(launch.requestUri).toBe("https://verifier-backend.privado.id/qr-store?id=abc123");
  expect(launch.universalLink).toContain("https://wallet.privado.id/#request_uri=");
  expect(launch.universalLink).toContain("back_url=");
  expect(launch.universalLink).toContain("finish_url=");
});

test("Privado status normalization reduces success to predicates, receipt hash, and nullifiers", async () => {
  const result = await normalizePrivadoVerificationResult({
    expectedClaims: ["age_over_18", "nationality"],
    nullifierSessionId: "session_123",
    providerSessionId: "backend_123",
    status: {
      jwz: "proof-token",
      jwzMetadata: {
        nullifiers: [
          {
            nullifier: "nullifier_age",
            nullifierSessionID: "session_123",
            scopeID: 1,
          },
          {
            nullifier: "nullifier_country",
            nullifierSessionID: "session_123",
            scopeID: 2,
          },
        ],
        userDID: "did:polygonid:polygon:amoy:2qExample",
        verifiablePresentations: [
          { credentialSubject: { birthday: 20000101 } },
          { credentialSubject: { countryCode: 840 } },
        ],
      },
      status: "success",
    },
    trustedIssuers: ["did:issuer:age"],
  });

  expect(result.status).toBe("verified");
  expect(result.satisfiedClaims).toEqual(["age_over_18", "nationality"]);
  expect(result.evidence.nullifiers).toEqual([
    {
      claimKey: "age_over_18",
      nullifier: "nullifier_age",
      nullifierSessionId: "session_123",
      scopeId: 1,
    },
    {
      claimKey: "nationality",
      nullifier: "nullifier_country",
      nullifierSessionId: "session_123",
      scopeId: 2,
    },
  ]);
  expect(result.evidence.proofReceiptRef).toBe("privado:session:backend_123");
  expect(result.evidence.proofReceiptHash).toContain("sha256:");
});

test("Privado bridge contracts retain only minimal Didit facts while making issuer dependencies explicit", () => {
  const bridge = createPrivadoReusableCredentialBridge({
    bridgeTtlSeconds: 900,
    now: Date.UTC(2026, 0, 1, 0, 0, 0),
    source: {
      guildId: "guild_123",
      providerSessionId: "didit_session_123",
      sessionId: "session_123",
      userId: "user_123",
    },
    verifiedDiditFacts: {
      ageOver18: true,
      ageOver21: true,
      documentIdentityVerified: true,
      faceVerificationPassed: true,
      faceVerificationPerformed: true,
      livenessVerified: true,
      nationality: "ESP",
      satisfiedClaims: ["age_over_18", "age_over_21", "nationality", "gender_marker_female", "document_identity", "liveness"],
    },
  });
  expect(bridge).toBeDefined();

  expect(bridge!.targetProvider).toBe("privado");
  expect(bridge!.status).toBe("issuer_handoff_required");
  expect(bridge!.contractVersion).toBe("reusable_identity_handoff_v1");
  expect(bridge!.approvedClaims).toEqual(["age_over_18", "age_over_21", "nationality", "gender_marker_female"]);
  expect(bridge!.claims).toEqual({
    disclosedAttributes: {
      nationality: "ESP",
    },
    proofOnlyPredicates: ["age_over_18", "age_over_21", "gender_marker_female"],
  });
  expect(bridge!.policyInputs.faceVerification).toEqual({
    evidenceSource: "capture_provider",
    passed: true,
    performed: true,
    satisfiesFaceVerificationRequirement: true,
  });
  expect(bridge!.handoff.requestedClaims).toEqual([
    "age_over_18",
    "age_over_21",
    "nationality",
    "gender_marker_female",
  ]);
  expect(bridge!.handoff.disclosedAttributeKeys).toEqual(["nationality"]);
  expect(bridge!.handoff.proofOnlyClaimKeys).toEqual([
    "age_over_18",
    "age_over_21",
    "gender_marker_female",
  ]);
  expect(bridge!.handoff.requiredExternalInputs).toEqual([
    "holderDid",
    "issuerDid",
    "credentialSchema",
    "issuerSigningKeyRef",
  ]);
  expect(bridge!.durableAfterHandoff.retainedFacts).toEqual([
    "sourceAttestationRef",
    "approvedClaims",
    "disclosedAttributes",
    "proofOnlyPredicates",
    "faceVerification",
    "targetProvider",
    "handoffAuditRef",
  ]);
  expect(bridge!.temporaryRetention.retainedClaims).toEqual([
    "age_over_18",
    "age_over_21",
    "nationality",
    "gender_marker_female",
  ]);
  expect(bridge!.temporaryRetention.retainedPolicyInputs).toEqual(["faceVerification"]);
  expect(bridge!.custody.storesRawDiditPayload).toBe(false);
  expect(bridge!.custody.storesFullReusableCredential).toBe(false);
  expect(bridge!.custody.storesDocumentImages).toBe(false);
});
