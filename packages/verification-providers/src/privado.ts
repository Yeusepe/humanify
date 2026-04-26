/**
 * Purpose: Builds Privado reusable-proof requests, wallet links, and normalized verification summaries for Humanify's reusable-proof backend role.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://docs.privado.id/docs/verifier/verification-library/request-api/
 * - https://docs.privado.id/docs/verifier/verification-library/verification-api/
 * - https://docs.privado.id/docs/verifier/verifier-backend/
 * - https://docs.privado.id/docs/wallet/universal-links/
 * - https://docs.privado.id/docs/verifier/verification-library/zk-query-language/
 * Tests:
 * - packages/verification-providers/src/privado.test.ts
 */

import { type HumanifyClaimKey } from "./claims";
import { createReusableIdentityHandoffContract, type ReusableIdentityHandoffContract } from "./reusable-identity";

export type PrivadoClaimScopeRequest = {
  circuitId: string;
  id: number;
  params?: {
    nullifierSessionId: string;
  };
  query: {
    allowedIssuers: string[];
    context: string;
    credentialSubject: Record<string, unknown>;
    type: string;
  };
};

export type PrivadoVerifierBackendSignInRequest = {
  chainID: string;
  reason: string;
  scope: PrivadoClaimScopeRequest[];
};

export type PrivadoVerifierBackendQRCodeMessage = {
  body: {
    callbackUrl?: string;
    reason?: string;
    scope?: Array<Record<string, unknown>>;
  };
  from?: string;
  id: string;
  thid?: string;
  typ?: string;
  type?: string;
};

export type PrivadoVerifierBackendSignInResponse = {
  qrCode: PrivadoVerifierBackendQRCodeMessage | string;
  sessionID: string;
};

export type PrivadoVerifierBackendNullifier = {
  nullifier: string;
  nullifierSessionID: string;
  scopeID: number;
};

export type PrivadoVerifierBackendVerifiablePresentation = {
  credentialSubject?: Record<string, unknown>;
  proofType?: string;
  schemaContext?: string[];
  schemaType?: string[];
};

export type PrivadoVerifierBackendStatusResponse = {
  jwz?: string;
  jwzMetadata?: {
    nullifiers?: PrivadoVerifierBackendNullifier[];
    userDID: string;
    verifiablePresentations: PrivadoVerifierBackendVerifiablePresentation[];
  };
  message?: string;
  status: "error" | "pending" | "success";
};

export type PrivadoVerificationPlan = {
  expectedClaims: HumanifyClaimKey[];
  nullifierSessionId: string;
  request: PrivadoVerifierBackendSignInRequest;
  scopeByClaim: Record<HumanifyClaimKey, PrivadoClaimScopeRequest>;
};

export type PrivadoWalletLaunch = {
  qrCodeValue: string;
  requestUri?: string;
  universalLink: string;
};

export type PrivadoNormalizedVerificationResult = {
  evidence: {
    nullifiers: Array<{
      claimKey?: HumanifyClaimKey;
      nullifier: string;
      nullifierSessionId: string;
      scopeId: number;
    }>;
    proofReceiptHash?: string;
    proofReceiptRef?: string;
    trustedIssuerScopes: string[];
    verifiablePresentationCount: number;
  };
  message: string;
  satisfiedClaims: HumanifyClaimKey[];
  status: "failed" | "pending" | "verified";
};

export type PrivadoReusableCredentialBridge = ReusableIdentityHandoffContract & {
  handoff: ReusableIdentityHandoffContract["handoff"] & {
    requiredExternalInputs: ["holderDid", "issuerDid", "credentialSchema", "issuerSigningKeyRef"];
    targetBackend: "privado";
  };
  source: ReusableIdentityHandoffContract["source"] & {
    providerId: "didit";
  };
  targetProvider: "privado";
};

const privadoUniversalLinkBase = "https://wallet.privado.id/";
const privadoKycContext = "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/kyc-v4.jsonld";
const privadoDefaultCircuitId = "credentialAtomicQueryV3-beta.1";

function dedupeStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function encodeWalletMessage(value: string) {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(value)));
  }

  return Buffer.from(value, "utf8").toString("base64");
}

function appendWalletUrl(url: URL, key: "back_url" | "finish_url", value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }

  url.hash += `${url.hash.includes("=") ? "&" : ""}${key}=${encodeURIComponent(trimmed)}`;
}

function createProofReceiptHashSegment(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (entry) => entry.toString(16).padStart(2, "0")).join("");
}

function formatPrivadoDateNumber(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return Number.parseInt(`${year}${month}${day}`, 10);
}

function createAgeThresholdDateNumber(now = Date.now()) {
  const thresholdDate = new Date(now);
  thresholdDate.setUTCFullYear(thresholdDate.getUTCFullYear() - 18);
  return formatPrivadoDateNumber(thresholdDate);
}

function createPrivadoScopeForClaim(
  claimKey: HumanifyClaimKey,
  scopeId: number,
  trustedIssuers: string[],
  nullifierSessionId: string,
  now = Date.now(),
): PrivadoClaimScopeRequest {
  switch (claimKey) {
    case "age_over_18":
      return {
        circuitId: privadoDefaultCircuitId,
        id: scopeId,
        params: {
          nullifierSessionId,
        },
        query: {
          allowedIssuers: trustedIssuers,
          context: privadoKycContext,
          credentialSubject: {
            birthday: {
              $lte: createAgeThresholdDateNumber(now),
            },
          },
          type: "KYCAgeCredential",
        },
      };
    case "nationality":
      return {
        circuitId: privadoDefaultCircuitId,
        id: scopeId,
        params: {
          nullifierSessionId,
        },
        query: {
          allowedIssuers: trustedIssuers,
          context: privadoKycContext,
          credentialSubject: {
            countryCode: {},
          },
          type: "KYCCountryOfResidenceCredential",
        },
      };
    default:
      throw new Error(`Privado does not currently implement reusable-proof query generation for "${claimKey}".`);
  }
}

export function createPrivadoVerificationPlan(input: {
  chainId?: string;
  nullifierSessionId: string;
  now?: number;
  requestedClaims: readonly HumanifyClaimKey[];
  trustedIssuers: readonly string[];
}) {
  const expectedClaims = dedupeStrings(input.requestedClaims) as HumanifyClaimKey[];
  if (expectedClaims.length === 0) {
    throw new Error("Privado verification plans require at least one requested claim.");
  }

  const trustedIssuers = dedupeStrings(input.trustedIssuers);
  if (trustedIssuers.length === 0) {
    throw new Error("Privado verification plans require at least one trusted issuer DID.");
  }

  const scopeByClaim = {} as Record<HumanifyClaimKey, PrivadoClaimScopeRequest>;
  const scope = expectedClaims.map((claimKey, index) => {
    const claimScope = createPrivadoScopeForClaim(
      claimKey,
      index + 1,
      trustedIssuers,
      input.nullifierSessionId,
      input.now,
    );
    scopeByClaim[claimKey] = claimScope;
    return claimScope;
  });

  return {
    expectedClaims,
    nullifierSessionId: input.nullifierSessionId,
    request: {
      chainID: input.chainId?.trim() || "80002",
      reason: `Humanify reusable proof request for ${expectedClaims.join(", ")}.`,
      scope,
    },
    scopeByClaim,
  } satisfies PrivadoVerificationPlan;
}

function extractPrivadoRequestUri(qrCode: string) {
  if (qrCode.startsWith("https://wallet.privado.id/")) {
    return undefined;
  }

  if (qrCode.startsWith("iden3comm://?")) {
    const parsed = new URL(qrCode.replace("iden3comm://?", "https://wallet.local/?"));
    return parsed.searchParams.get("request_uri") ?? undefined;
  }

  if (qrCode.startsWith("http://") || qrCode.startsWith("https://")) {
    return qrCode;
  }

  return undefined;
}

export function buildPrivadoWalletLaunch(input: {
  backUrl?: string;
  finishUrl?: string;
  qrCode: PrivadoVerifierBackendQRCodeMessage | string;
}) {
  if (typeof input.qrCode === "string" && input.qrCode.startsWith("https://wallet.privado.id/")) {
    return {
      qrCodeValue: input.qrCode,
      universalLink: input.qrCode,
    } satisfies PrivadoWalletLaunch;
  }

  const walletUrl = new URL(privadoUniversalLinkBase);
  const requestUri = typeof input.qrCode === "string" ? extractPrivadoRequestUri(input.qrCode) : undefined;

  if (requestUri) {
    walletUrl.hash = `request_uri=${encodeURIComponent(requestUri)}`;
  } else {
    const message = typeof input.qrCode === "string" ? input.qrCode : JSON.stringify(input.qrCode);
    walletUrl.hash = `i_m=${encodeWalletMessage(message)}`;
  }

  appendWalletUrl(walletUrl, "back_url", input.backUrl);
  appendWalletUrl(walletUrl, "finish_url", input.finishUrl);

  return {
    qrCodeValue: typeof input.qrCode === "string" ? input.qrCode : JSON.stringify(input.qrCode),
    requestUri,
    universalLink: walletUrl.toString(),
  } satisfies PrivadoWalletLaunch;
}

export async function normalizePrivadoVerificationResult(input: {
  expectedClaims: readonly HumanifyClaimKey[];
  nullifierSessionId: string;
  providerSessionId: string;
  status: PrivadoVerifierBackendStatusResponse;
  trustedIssuers: readonly string[];
}) {
  if (input.status.status === "pending") {
    return {
      evidence: {
        nullifiers: [],
        proofReceiptRef: `privado:session:${input.providerSessionId}`,
        trustedIssuerScopes: dedupeStrings(input.trustedIssuers),
        verifiablePresentationCount: 0,
      },
      message: "Privado has not finished verifying the reusable proof yet.",
      satisfiedClaims: [],
      status: "pending",
    } satisfies PrivadoNormalizedVerificationResult;
  }

  if (input.status.status === "error") {
    return {
      evidence: {
        nullifiers: [],
        proofReceiptRef: `privado:session:${input.providerSessionId}`,
        trustedIssuerScopes: dedupeStrings(input.trustedIssuers),
        verifiablePresentationCount: 0,
      },
      message: input.status.message ?? "Privado reported that the reusable proof did not verify.",
      satisfiedClaims: [],
      status: "failed",
    } satisfies PrivadoNormalizedVerificationResult;
  }

  const metadata = input.status.jwzMetadata;
  if (!metadata) {
    throw new Error("Privado success responses must include jwzMetadata.");
  }

  const expectedClaimSet = new Set<HumanifyClaimKey>(input.expectedClaims);
  const satisfiedClaims = [...expectedClaimSet];
  const nullifiers = (metadata.nullifiers ?? []).map((entry) => ({
    claimKey: [...expectedClaimSet][entry.scopeID - 1],
    nullifier: entry.nullifier,
    nullifierSessionId: entry.nullifierSessionID,
    scopeId: entry.scopeID,
  })).filter((entry) => entry.nullifierSessionId === input.nullifierSessionId);

  const proofReceiptHash = input.status.jwz
    ? `sha256:${createProofReceiptHashSegment(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.status.jwz)))}`
    : undefined;

  return {
    evidence: {
      nullifiers,
      proofReceiptHash,
      proofReceiptRef: `privado:session:${input.providerSessionId}`,
      trustedIssuerScopes: dedupeStrings(input.trustedIssuers),
      verifiablePresentationCount: metadata.verifiablePresentations.length,
    },
    message: `Privado verified ${satisfiedClaims.length} reusable proof predicate(s) for the current Humanify session.`,
    satisfiedClaims,
    status: "verified",
  } satisfies PrivadoNormalizedVerificationResult;
}

export function createPrivadoReusableCredentialBridge(input: {
  bridgeTtlSeconds?: number;
  now?: number;
  source: {
    guildId: string;
    providerSessionId: string;
    sessionId: string;
    userId: string;
  };
  verifiedDiditFacts: {
    ageOver18?: boolean;
    ageOver21?: boolean;
    documentIdentityVerified: boolean;
    faceVerificationPassed: boolean;
    faceVerificationPerformed: boolean;
    livenessVerified: boolean;
    nationality?: string;
    satisfiedClaims: readonly HumanifyClaimKey[];
  };
}) {
  if (!input.verifiedDiditFacts.documentIdentityVerified) {
    return undefined;
  }

  const nationality = input.verifiedDiditFacts.nationality?.trim() || undefined;

  return createReusableIdentityHandoffContract({
    bridgeTtlSeconds: input.bridgeTtlSeconds,
    handoff: {
      disclosedAttributeKeys: ["nationality"],
      note:
        "Humanify stops at a documented bridge request. A separate issuer/backend with its own legal basis and signing material must mint any Privado-held credential; Humanify never imports the full Didit session or keeps raw documents.",
      proofOnlyClaimKeys: [
        "age_over_18",
        "age_over_21",
        "gender_marker_female",
        "gender_marker_male",
        "gender_marker_x",
      ],
      requiredExternalInputs: ["holderDid", "issuerDid", "credentialSchema", "issuerSigningKeyRef"],
      targetBackend: "privado",
    },
    now: input.now,
    source: {
      ...input.source,
      providerId: "didit",
    },
    verifiedSourceFacts: {
      disclosedAttributes: nationality
        ? {
          nationality,
        }
        : undefined,
      faceVerification: {
        evidenceSource: "capture_provider",
        passed: input.verifiedDiditFacts.faceVerificationPassed,
        performed: input.verifiedDiditFacts.faceVerificationPerformed,
      },
      satisfiedClaims: input.verifiedDiditFacts.satisfiedClaims.filter((claim): claim is HumanifyClaimKey => {
        if (claim === "nationality" && nationality) {
          return true;
        }

        return (
          claim === "age_over_18" ||
          claim === "age_over_21" ||
          claim === "gender_marker_female" ||
          claim === "gender_marker_male" ||
          claim === "gender_marker_x"
        );
      }),
    },
  }) as PrivadoReusableCredentialBridge | undefined;
}
