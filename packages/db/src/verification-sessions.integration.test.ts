/**
 * Purpose: Verifies the real Postgres verification-session repository persists only minimal-custody Didit and Privado verification summaries when a test database is available.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\observability-security.md
 * - docs\verification.md
 * Tests:
 * - packages/db/src/verification-sessions.integration.test.ts
 * External references:
 * - https://bun.sh/docs/test
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 */

import { afterAll, expect, test } from "bun:test";
import postgres from "postgres";

import { createPostgresVerificationSessionsRepository } from "./verification-sessions";

const connectionString = process.env.HUMANIFY_DATABASE_URL ?? process.env.HUMANIFY_POSTGRES_URL;
const repository = connectionString
  ? createPostgresVerificationSessionsRepository({
      connectionString,
    })
  : undefined;
const sql = connectionString
  ? postgres(connectionString, {
      max: 1,
    })
  : undefined;

afterAll(async () => {
  await repository?.close();
  await sql?.end();
});

const integrationTest = repository && sql ? test : test.skip;

integrationTest("Didit callback persistence keeps only normalized summaries, webhook receipts, and bridge metadata", async () => {
  const scope = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const challengeId = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const userId = `user_${scope}`;

  await repository!.createSession({
    challengeExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    challengeId,
    guildId,
    initiatedBy: "integration-test",
    requiredCapabilities: ["document_identity", "liveness"],
    sessionId,
    userId,
  });
  await repository!.markDiditSessionCreated({
    callbackUrl: `https://verifier.humanify.test/verify?sessionId=${sessionId}`,
    providerSessionId: `didit_${scope}`,
    providerSessionStatus: "Not Started",
    requestedClaims: ["age_over_18", "nationality"],
    sessionId,
    verificationUrl: `https://verify.didit.me/session/didit_${scope}`,
    workflowId: "11111111-2222-3333-4444-555555555555",
  });
  await repository!.recordDiditResult({
    providerSessionId: `didit_${scope}`,
    providerStatus: "Approved",
    purge: {
      attemptedAt: "2026-01-01T00:00:00.000Z",
      outcome: "deleted",
    },
    requestedClaims: ["age_over_18", "nationality"],
    reusableCredentialBridge: {
      artifactPayload: {
        approvedClaims: ["age_over_18", "age_over_21", "nationality"],
        bridgeId: `bridge_${scope}`,
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18", "age_over_21"],
        },
        contractVersion: "reusable_identity_handoff_v1",
        custody: {
          storesDocumentImages: false,
          storesFullReusableCredential: false,
          storesRawDiditPayload: false,
        },
        handoff: {
          disclosedAttributeKeys: ["nationality"],
          handoffKind: "external_issuer_request",
          note: "Issuer handoff required.",
          proofOnlyClaimKeys: ["age_over_18", "age_over_21"],
          requestedClaims: ["age_over_18", "age_over_21", "nationality"],
          requiredExternalInputs: ["holderDid", "issuerDid", "credentialSchema", "issuerSigningKeyRef"],
          targetBackend: "privado",
        },
        policyInputs: {
          faceVerification: {
            evidenceSource: "capture_provider",
            passed: true,
            performed: true,
            satisfiesFaceVerificationRequirement: true,
          },
        },
        status: "issuer_handoff_required",
        targetProvider: "privado",
        temporaryRetention: {
          expiresAt: "2026-01-01T01:00:00.000Z",
          retainedClaims: ["age_over_18", "age_over_21", "nationality"],
          retainedPolicyInputs: ["faceVerification"],
        },
      },
      artifactStatus: "issuer_handoff_required",
      bridgeId: `bridge_${scope}`,
      expiresAt: "2026-01-01T01:00:00.000Z",
      summary: {
        approvedClaims: ["age_over_18", "age_over_21", "nationality"],
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18", "age_over_21"],
        },
        contractVersion: "reusable_identity_handoff_v1",
        policyInputs: {
          faceVerification: {
            evidenceSource: "capture_provider",
            passed: true,
            performed: true,
            satisfiesFaceVerificationRequirement: true,
          },
        },
        status: "issuer_handoff_required",
        targetProvider: "privado",
      },
      targetProvider: "privado",
    },
    resultSummary: {
      authoritativeSource: "didit_decision_api",
      faceVerificationPassed: true,
      faceVerificationPerformed: true,
      providerReferenceId: `didit_${scope}`,
      providerStatus: "Approved",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["document_identity", "age_over_18", "age_over_21", "nationality", "liveness", "face_verification"],
    },
    sessionId,
    state: "passed",
    webhook: {
      providerStatus: "Approved",
      timestamp: "1735689600",
      webhookType: "status.updated",
      workflowId: "11111111-2222-3333-4444-555555555555",
    },
  });

  const persisted = await repository!.getSession(sessionId);
  expect(persisted).toMatchObject({
    providerStatus: {
      purge: {
        attemptedAt: "2026-01-01T00:00:00.000Z",
        outcome: "deleted",
      },
      requestedClaims: ["age_over_18", "nationality"],
      reusableCredentialBridge: {
        approvedClaims: ["age_over_18", "age_over_21", "nationality"],
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18", "age_over_21"],
        },
        contractVersion: "reusable_identity_handoff_v1",
        policyInputs: {
          faceVerification: {
            evidenceSource: "capture_provider",
            passed: true,
            performed: true,
            satisfiesFaceVerificationRequirement: true,
          },
        },
        status: "issuer_handoff_required",
        targetProvider: "privado",
      },
      selectedProvider: "didit",
      status: "provider_webhook_verified",
      verifiedWebhook: {
        providerStatus: "Approved",
        timestamp: "1735689600",
        webhookType: "status.updated",
        workflowId: "11111111-2222-3333-4444-555555555555",
      },
    },
    resultSummary: {
      authoritativeSource: "didit_decision_api",
      faceVerificationPassed: true,
      faceVerificationPerformed: true,
      providerReferenceId: `didit_${scope}`,
      providerStatus: "Approved",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["document_identity", "age_over_18", "age_over_21", "nationality", "liveness", "face_verification"],
    },
    state: "passed",
  });
  expect(JSON.stringify(persisted)).not.toContain("idVerifications");
  expect(JSON.stringify(persisted)).not.toContain("livenessChecks");

  const artifacts = await sql!<Array<{
    artifact_kind: string;
    provider_name: string;
    provider_reference_id: string | null;
    redacted_payload: Record<string, unknown>;
  }>>`
    SELECT artifact_kind, provider_name, provider_reference_id, redacted_payload
    FROM verification_artifacts
    WHERE session_id = ${sessionId}::uuid
    ORDER BY provider_name ASC, artifact_kind ASC
  `;

  expect([...artifacts]).toEqual([
    {
      artifact_kind: "capture_attestation",
      provider_name: "didit",
      provider_reference_id: `didit_${scope}`,
      redacted_payload: {
        authoritativeSource: "didit_decision_api",
        faceVerificationPassed: true,
        faceVerificationPerformed: true,
        providerReferenceId: `didit_${scope}`,
        providerStatus: "Approved",
        requestedClaims: ["age_over_18", "nationality"],
        satisfiedClaims: ["document_identity", "age_over_18", "age_over_21", "nationality", "liveness", "face_verification"],
      },
    },
    {
      artifact_kind: "reusable_credential_bridge",
      provider_name: "privado",
      provider_reference_id: `bridge_${scope}`,
      redacted_payload: {
        approvedClaims: ["age_over_18", "age_over_21", "nationality"],
        bridgeId: `bridge_${scope}`,
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18", "age_over_21"],
        },
        contractVersion: "reusable_identity_handoff_v1",
        custody: {
          storesDocumentImages: false,
          storesFullReusableCredential: false,
          storesRawDiditPayload: false,
        },
        handoff: {
          disclosedAttributeKeys: ["nationality"],
          handoffKind: "external_issuer_request",
          note: "Issuer handoff required.",
          proofOnlyClaimKeys: ["age_over_18", "age_over_21"],
          requestedClaims: ["age_over_18", "age_over_21", "nationality"],
          requiredExternalInputs: ["holderDid", "issuerDid", "credentialSchema", "issuerSigningKeyRef"],
          targetBackend: "privado",
        },
        policyInputs: {
          faceVerification: {
            evidenceSource: "capture_provider",
            passed: true,
            performed: true,
            satisfiesFaceVerificationRequirement: true,
          },
        },
        status: "issuer_handoff_required",
        targetProvider: "privado",
        temporaryRetention: {
          expiresAt: "2026-01-01T01:00:00.000Z",
          retainedClaims: ["age_over_18", "age_over_21", "nationality"],
          retainedPolicyInputs: ["faceVerification"],
        },
      },
    },
  ]);
});

integrationTest("Privado proof persistence stores minimal receipt refs, hashes, issuer scopes, and nullifier refs only", async () => {
  const scope = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const challengeId = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const userId = `user_${scope}`;

  await repository!.createSession({
    challengeExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    challengeId,
    guildId,
    initiatedBy: "integration-test",
    requiredCapabilities: ["age_over_18"],
    sessionId,
    userId,
  });
  await repository!.recordReusableProofResult({
    providerId: "privado",
    providerSessionId: `privado_${scope}`,
    requestedClaims: ["age_over_18", "nationality"],
    resultSummary: {
      authoritativeSource: "privado_verifier_backend_status",
      message: "Privado verified 2 reusable proof predicate(s) for the current Humanify session.",
      nullifierRefs: ["nullifier_age", "nullifier_country"],
      proofReceiptHash: "sha256:proofhash",
      proofReceiptRef: `privado:session:privado_${scope}`,
      providerReferenceId: `privado_${scope}`,
      providerStatus: "success",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["age_over_18", "nationality"],
      trustedIssuerScopes: ["did:issuer:age", "did:issuer:nationality"],
      verifiablePresentationCount: 2,
    },
    sessionId,
    state: "passed",
  });

  const persisted = await repository!.getSession(sessionId);
  expect(persisted).toMatchObject({
    providerStatus: {
      providerSessionId: `privado_${scope}`,
      requestedClaims: ["age_over_18", "nationality"],
      selectedProvider: "privado",
      status: "provider_proof_verified",
    },
    resultSummary: {
      authoritativeSource: "privado_verifier_backend_status",
      nullifierRefs: ["nullifier_age", "nullifier_country"],
      proofReceiptHash: "sha256:proofhash",
      proofReceiptRef: `privado:session:privado_${scope}`,
      providerReferenceId: `privado_${scope}`,
      providerStatus: "success",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["age_over_18", "nationality"],
      trustedIssuerScopes: ["did:issuer:age", "did:issuer:nationality"],
      verifiablePresentationCount: 2,
    },
    state: "passed",
  });
  expect(JSON.stringify(persisted)).not.toContain("jwz");
  expect(JSON.stringify(persisted)).not.toContain("verifiablePresentations");
  expect(JSON.stringify(persisted)).not.toContain("userDID");

  const [artifact] = await sql!<Array<{
    artifact_kind: string;
    provider_name: string;
    provider_reference_id: string | null;
    redacted_payload: Record<string, unknown>;
  }>>`
    SELECT artifact_kind, provider_name, provider_reference_id, redacted_payload
    FROM verification_artifacts
    WHERE
      session_id = ${sessionId}::uuid
      AND provider_name = ${"privado"}
      AND artifact_kind = ${"reusable_proof_receipt"}
  `;

  expect(artifact).toEqual({
    artifact_kind: "reusable_proof_receipt",
    provider_name: "privado",
    provider_reference_id: `privado_${scope}`,
    redacted_payload: {
      authoritativeSource: "privado_verifier_backend_status",
      message: "Privado verified 2 reusable proof predicate(s) for the current Humanify session.",
      nullifierRefs: ["nullifier_age", "nullifier_country"],
      proofReceiptHash: "sha256:proofhash",
      proofReceiptRef: `privado:session:privado_${scope}`,
      providerReferenceId: `privado_${scope}`,
      providerStatus: "success",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["age_over_18", "nationality"],
      trustedIssuerScopes: ["did:issuer:age", "did:issuer:nationality"],
      verifiablePresentationCount: 2,
    },
  });
});
