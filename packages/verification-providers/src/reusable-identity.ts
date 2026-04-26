/**
 * Purpose: Defines the reusable identity handoff contract that can carry disclosed attributes, proof-only predicates, and face-verification policy inputs without storing raw DOB or raw gender.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * External references:
 * - https://www.w3.org/TR/vc-data-model/
 * Tests:
 * - packages/verification-providers/src/reusable-identity.test.ts
 * - packages/verification-providers/src/privado.test.ts
 */

import {
  getProofOnlyVerificationClaimIds,
  isDisclosedAttributeHumanifyClaimKey,
  isProofOnlyHumanifyClaimKey,
  type HumanifyClaimKey,
} from "./claims";

export const reusableIdentityContractVersion = "reusable_identity_handoff_v1";
export const reusableIdentityDisclosedAttributeKeys = ["nationality"] as const;

export type ReusableIdentityDisclosedAttributeKey = (typeof reusableIdentityDisclosedAttributeKeys)[number];
export type ReusableIdentityFaceVerificationEvidenceSource = "capture_provider" | "proof_of_personhood";

export type ReusableIdentityHandoffContract = {
  approvedClaims: HumanifyClaimKey[];
  bridgeId: string;
  claims: {
    disclosedAttributes: Partial<Record<ReusableIdentityDisclosedAttributeKey, string>>;
    proofOnlyPredicates: HumanifyClaimKey[];
  };
  contractVersion: typeof reusableIdentityContractVersion;
  custody: {
    storesDocumentImages: false;
    storesFullReusableCredential: false;
    storesRawDiditPayload: false;
  };
  durableAfterHandoff: {
    handoffAuditRef: string;
    retainedFacts: Array<
      | "sourceAttestationRef"
      | "approvedClaims"
      | "disclosedAttributes"
      | "proofOnlyPredicates"
      | "faceVerification"
      | "targetProvider"
      | "handoffAuditRef"
    >;
    sourceAttestationRef: string;
  };
  handoff: {
    disclosedAttributeKeys: ReusableIdentityDisclosedAttributeKey[];
    handoffKind: "external_issuer_request";
    note: string;
    proofOnlyClaimKeys: HumanifyClaimKey[];
    requestedClaims: HumanifyClaimKey[];
    requiredExternalInputs: string[];
    targetBackend: string;
  };
  policyInputs: {
    faceVerification: {
      evidenceSource: ReusableIdentityFaceVerificationEvidenceSource;
      passed: boolean;
      performed: boolean;
      satisfiesFaceVerificationRequirement: boolean;
    };
  };
  source: {
    guildId: string;
    providerId: string;
    providerSessionId: string;
    sessionId: string;
    userId: string;
  };
  status: "issuer_handoff_required";
  targetProvider: string;
  temporaryRetention: {
    expiresAt: string;
    retainedClaims: HumanifyClaimKey[];
    retainedPolicyInputs: ["faceVerification"];
  };
};

const disclosedAttributeClaimKeyByAttribute = {
  nationality: "nationality",
} as const satisfies Record<ReusableIdentityDisclosedAttributeKey, HumanifyClaimKey>;

function dedupeClaimKeys(values: readonly HumanifyClaimKey[]) {
  const seen = new Set<HumanifyClaimKey>();
  const deduped: HumanifyClaimKey[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

function dedupeDisclosedAttributeKeys(values: readonly ReusableIdentityDisclosedAttributeKey[]) {
  const seen = new Set<ReusableIdentityDisclosedAttributeKey>();
  const deduped: ReusableIdentityDisclosedAttributeKey[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

function sanitizeDisclosedAttributes(
  disclosedAttributes: Partial<Record<ReusableIdentityDisclosedAttributeKey, string>>,
  allowedAttributes: readonly ReusableIdentityDisclosedAttributeKey[],
) {
  const sanitized: Partial<Record<ReusableIdentityDisclosedAttributeKey, string>> = {};

  for (const attributeKey of allowedAttributes) {
    const value = disclosedAttributes[attributeKey]?.trim();
    if (!value) {
      continue;
    }

    sanitized[attributeKey] = value;
  }

  return sanitized;
}

export function createReusableIdentityHandoffContract(input: {
  bridgeTtlSeconds?: number;
  handoff: {
    disclosedAttributeKeys: readonly ReusableIdentityDisclosedAttributeKey[];
    note: string;
    proofOnlyClaimKeys: readonly HumanifyClaimKey[];
    requiredExternalInputs: readonly string[];
    targetBackend: string;
  };
  now?: number;
  source: {
    guildId: string;
    providerId: string;
    providerSessionId: string;
    sessionId: string;
    userId: string;
  };
  verifiedSourceFacts: {
    disclosedAttributes?: Partial<Record<ReusableIdentityDisclosedAttributeKey, string>>;
    faceVerification?: {
      evidenceSource?: ReusableIdentityFaceVerificationEvidenceSource;
      passed: boolean;
      performed: boolean;
    };
    satisfiedClaims: readonly HumanifyClaimKey[];
  };
}) {
  const disclosedAttributeKeys = dedupeDisclosedAttributeKeys(input.handoff.disclosedAttributeKeys);
  const disclosedAttributes = sanitizeDisclosedAttributes(
    input.verifiedSourceFacts.disclosedAttributes ?? {},
    disclosedAttributeKeys,
  );
  const disclosedClaimKeys = disclosedAttributeKeys.flatMap((attributeKey) => {
    if (!disclosedAttributes[attributeKey]) {
      return [];
    }

    const claimKey = disclosedAttributeClaimKeyByAttribute[attributeKey];
    return input.verifiedSourceFacts.satisfiedClaims.includes(claimKey) ? [claimKey] : [];
  });
  const allowedProofOnlyClaimKeys = dedupeClaimKeys(
    input.handoff.proofOnlyClaimKeys.filter((claimKey) => isProofOnlyHumanifyClaimKey(claimKey)),
  );
  const proofOnlyPredicateSet = new Set<HumanifyClaimKey>(allowedProofOnlyClaimKeys);
  const proofOnlyPredicates = dedupeClaimKeys(
    input.verifiedSourceFacts.satisfiedClaims.filter((claimKey) => proofOnlyPredicateSet.has(claimKey)),
  );
  const approvedClaimSet = new Set<HumanifyClaimKey>([...disclosedClaimKeys, ...proofOnlyPredicates]);
  const approvedClaims = dedupeClaimKeys(
    input.verifiedSourceFacts.satisfiedClaims.filter((claimKey) => approvedClaimSet.has(claimKey)),
  );
  if (approvedClaims.length === 0) {
    return undefined;
  }

  const expiresAt = new Date((input.now ?? Date.now()) + (input.bridgeTtlSeconds ?? 3600) * 1_000).toISOString();
  const bridgeId = crypto.randomUUID();
  const sourceAttestationRef = `${input.source.providerId}:session:${input.source.providerSessionId}`;
  const handoffAuditRef = `verification-bridge:${bridgeId}`;
  const faceVerification = input.verifiedSourceFacts.faceVerification ?? {
    evidenceSource: "capture_provider",
    passed: false,
    performed: false,
  };

  return {
    approvedClaims,
    bridgeId,
    claims: {
      disclosedAttributes,
      proofOnlyPredicates,
    },
    contractVersion: reusableIdentityContractVersion,
    custody: {
      storesDocumentImages: false,
      storesFullReusableCredential: false,
      storesRawDiditPayload: false,
    },
    durableAfterHandoff: {
      handoffAuditRef,
      retainedFacts: [
        "sourceAttestationRef",
        "approvedClaims",
        "disclosedAttributes",
        "proofOnlyPredicates",
        "faceVerification",
        "targetProvider",
        "handoffAuditRef",
      ],
      sourceAttestationRef,
    },
    handoff: {
      disclosedAttributeKeys: Object.keys(disclosedAttributes)
        .filter((key): key is ReusableIdentityDisclosedAttributeKey =>
          reusableIdentityDisclosedAttributeKeys.includes(key as ReusableIdentityDisclosedAttributeKey)
        ),
      handoffKind: "external_issuer_request",
      note: input.handoff.note,
      proofOnlyClaimKeys: proofOnlyPredicates,
      requestedClaims: approvedClaims,
      requiredExternalInputs: [...input.handoff.requiredExternalInputs],
      targetBackend: input.handoff.targetBackend,
    },
    policyInputs: {
      faceVerification: {
        evidenceSource: faceVerification.evidenceSource ?? "capture_provider",
        passed: faceVerification.passed,
        performed: faceVerification.performed,
        satisfiesFaceVerificationRequirement: faceVerification.performed && faceVerification.passed,
      },
    },
    source: {
      ...input.source,
    },
    status: "issuer_handoff_required",
    targetProvider: input.handoff.targetBackend,
    temporaryRetention: {
      expiresAt,
      retainedClaims: approvedClaims,
      retainedPolicyInputs: ["faceVerification"],
    },
  } satisfies ReusableIdentityHandoffContract;
}

export function getReusableIdentityProofOnlyClaimKeys() {
  return getProofOnlyVerificationClaimIds();
}

export function isReusableIdentityDisclosedAttributeClaim(claimKey: string) {
  return isDisclosedAttributeHumanifyClaimKey(claimKey);
}
