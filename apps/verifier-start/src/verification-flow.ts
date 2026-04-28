/**
 * Purpose: Defines the verifier app's signed-link session loading, challenge submission, and honest step-state helpers.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\verification.md
 * - docs\observability-security.md
 * - docs\testing.md
 * External references:
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://developer.mozilla.org/docs/Web/API/Fetch_API
 * Tests:
 * - apps/verifier-start/src/verification-flow.test.ts
 */

import { createRequestTelemetryContext, injectRequestTelemetryHeaders } from "@humanify/telemetry";
import {
  getDefaultHumanifyIdClaimBundle as getSharedDefaultHumanifyIdClaimBundle,
  getHumanifyIdClaimBundles as getSharedHumanifyIdClaimBundles,
  parseVerificationProviderSelection,
  resolveVerificationProviderCatalog,
  verificationOptionSupportsFaceVerificationRequirement,
  verificationProviderSupportsClaims,
  type HumanifyClaimKey,
  type HumanifyIdClaimBundle,
  type VerificationProviderDefinition,
  type VerificationProviderHandoffKind,
} from "@humanify/verification-providers";

import {
  getVerificationOptionBrowserLaunch,
  startVerificationOptionBrowserLaunch,
  type VerificationOptionBrowserResult,
  type VerificationOptionLaunch,
} from "./verification-options/runtime";

export type VerificationRouteSearch = {
  serverName?: string;
  sessionId?: string;
  token?: string;
  username?: string;
};

export type VerificationProviderId = VerificationProviderDefinition["id"];
export type VerificationProviderOption = VerificationProviderDefinition;

export type GuildVerificationConfigSnapshot = {
  availableProviderIds: string[];
  defaultProviderId: VerificationProviderId;
  defaultReusableProofBackendId?: VerificationProviderId;
  enabledProviderIds: VerificationProviderId[];
  faceVerificationRequired: boolean;
  fallbackRoles: string[];
  requiredBundleIds: string[];
  roleGrantBindings?: Array<{
    roleId: string;
    trigger: string;
  }>;
  source: "catalog_default" | "persisted";
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
};

export type VerificationSessionSnapshot = {
  challengeExpiresAt: string;
  challengeId: string;
  guildId: string;
  releaseEligible: boolean;
  requiredCapabilities: string[];
  sessionId: string;
  source: string;
  state: "challenge_issued" | "provider_pending" | "passed" | "failed" | "expired" | "cancelled" | "released";
  userId: string;
};

export type VerificationProviderBoundary = {
  handoffKind?: VerificationProviderHandoffKind;
  launch?: VerificationOptionLaunch;
  nextStep: string;
  providerFlowConfigured: boolean;
  providerServerEndpoint?: string;
  providerSessionToken?: string;
  providerStartEndpoint?: string;
  providerStartToken?: string;
  releaseEligible: boolean;
  requestedClaims?: HumanifyClaimKey[];
  requiredCapabilities?: string[];
  selectedProvider?: VerificationProviderId;
  serverVerificationNote?: string;
  status: string;
};

export type VerificationSummary = {
  authoritativeSource?: string;
  verificationDecision?: {
    action: "escalate_review" | "keep_quarantined" | "release_now" | "require_stronger_evidence" | "wait_for_provider";
    matchedClaims?: HumanifyClaimKey[];
    message: string;
    missingClaims?: HumanifyClaimKey[];
    releaseEligible: boolean;
    reviewRequired: boolean;
  };
  faceVerificationPassed?: boolean;
  faceVerificationPerformed?: boolean;
  nullifierRefs?: string[];
  proofReceipt?: {
    nullifiers?: Array<{
      claimKey?: HumanifyClaimKey;
      nullifier: string;
      nullifierSessionId?: string;
      scopeId?: number;
    }>;
    proofReceiptHash?: string;
    proofReceiptRef?: string;
    trustedIssuerScopes?: string[];
    verifiablePresentationCount?: number;
  };
  proofReceiptHash?: string;
  proofReceiptRef?: string;
  providerReferenceId?: string;
  providerStatus?: string;
  requestedClaims?: HumanifyClaimKey[];
  satisfiedClaims?: HumanifyClaimKey[];
  status?: "failed" | "pending" | "verified";
  trustedIssuerScopes?: string[];
  verifiablePresentationCount?: number;
};

export type ReusableCredentialBridgeSummary = {
  approvedClaims?: HumanifyClaimKey[];
  claims?: {
    disclosedAttributes?: Record<string, string>;
    proofOnlyPredicates?: Record<string, boolean>;
  };
  contractVersion?: string;
  handoff?: {
    disclosedAttributeKeys?: string[];
    proofOnlyClaimKeys?: string[];
    requestedClaims?: HumanifyClaimKey[];
    targetBackend?: string;
  };
  policyInputs?: {
    faceVerification?: {
      passed?: boolean;
      performed?: boolean;
      requirementSatisfied?: boolean;
    };
  };
  status?: string;
  targetProvider?: VerificationProviderId;
  temporaryRetention?: {
    expiresAt?: string;
  };
};

export type VerificationSessionData = {
  providerBoundary: VerificationProviderBoundary;
  persistence: string;
  reusableCredentialBridge?: ReusableCredentialBridgeSummary;
  session: VerificationSessionSnapshot;
  verification?: VerificationSummary;
  verificationConfig: GuildVerificationConfigSnapshot;
};

export type VerificationChallengeData = {
  challenge: {
    challengeId: string;
    guildId: string;
    sessionId: string;
    userId: string;
    verified: boolean;
  };
  persistence: string;
  providerBoundary: VerificationProviderBoundary;
  session: VerificationSessionSnapshot;
  verificationConfig: GuildVerificationConfigSnapshot;
};

export type ReusableProofStartData = {
  flow: {
    providerId: VerificationProviderId;
    providerSessionId: string;
    providerSessionToken: string;
    qrCodeValue: string;
    request: {
      chainID: string;
      reason: string;
      scope: Array<{
        circuitId: string;
        id: number;
        query: {
          allowedIssuers: string[];
          context: string;
          credentialSubject: Record<string, unknown>;
          type: string;
        };
      }>;
    };
    requestUri?: string;
    universalLink: string;
  };
  persistence: string;
  providerBoundary: VerificationProviderBoundary;
  session: VerificationSessionSnapshot;
};

export type ReusableProofVerificationData = {
  persistence: string;
  providerBoundary: VerificationProviderBoundary;
  session: VerificationSessionSnapshot;
  verification: VerificationSummary & {
    message: string;
    proofReceipt: {
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
    providerId: VerificationProviderId;
    providerSessionId: string;
    satisfiedClaims: HumanifyClaimKey[];
    status: "failed" | "pending" | "verified";
  };
};

export type VerificationReleaseData = {
  providerBoundary: VerificationProviderBoundary;
  release: {
    appliedRoleIds: string[];
    releasedAt: string;
    triggerKeys: string[];
  };
  session: VerificationSessionSnapshot;
  verification?: VerificationSummary;
  verificationConfig: GuildVerificationConfigSnapshot;
};

export type VerificationChecklistItem = {
  detail: string;
  status: "blocked" | "complete" | "pending";
  title: string;
};

type ApiEnvelope<TData> = {
  contractVersion: string;
  data: TData;
  requestId: string;
};

type ApiErrorEnvelope = {
  errorCode: string;
  message: string;
  requestId: string;
  retryable: boolean;
};

type FetchLike = (input: URL | string | Request, init?: RequestInit) => Promise<Response>;

function readSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class VerifierApiError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly requestId?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "VerifierApiError";
  }
}

export function getVerificationProviderCatalog(env: Record<string, string | undefined> = {}) {
  return resolveVerificationProviderCatalog({
    enabledProviderIds: parseVerificationProviderSelection(env.VITE_HUMANIFY_ENABLED_VERIFICATION_PROVIDERS),
  });
}

export function getDefaultVerificationProviderId(env: Record<string, string | undefined> = {}) {
  return getVerificationProviderCatalog(env).defaultProvider().id;
}

export function getVerificationProviderOptions(env: Record<string, string | undefined> = {}): VerificationProviderOption[] {
  return getVerificationProviderCatalog(env).list();
}

export function getGuildVerificationProviderOptions(
  verificationConfig?: GuildVerificationConfigSnapshot,
  env: Record<string, string | undefined> = {},
): VerificationProviderOption[] {
  const browserCatalog = getVerificationProviderCatalog(env);
  if (!verificationConfig) {
    return browserCatalog.list();
  }

  const enabledProviderIds = verificationConfig.enabledProviderIds.filter((providerId) => browserCatalog.has(providerId));
  if (enabledProviderIds.length === 0) {
    return [];
  }

  return browserCatalog.withEnabled(enabledProviderIds).list();
}

export function getVerificationProvider(
  providerId: VerificationProviderId,
  env: Record<string, string | undefined> = {},
): VerificationProviderOption {
  return getVerificationProviderCatalog(env).require(providerId);
}

export function getDefaultHumanifyIdClaimBundle(): HumanifyIdClaimBundle {
  return getSharedDefaultHumanifyIdClaimBundle();
}

export function getHumanifyIdClaimBundles(): HumanifyIdClaimBundle[] {
  return getSharedHumanifyIdClaimBundles();
}

export function getGuildVerificationClaimBundleOptions(
  verificationConfig?: GuildVerificationConfigSnapshot,
): HumanifyIdClaimBundle[] {
  const bundles = getSharedHumanifyIdClaimBundles();
  if (!verificationConfig) {
    return bundles;
  }

  return bundles.filter((bundle) => verificationConfig.requiredBundleIds.includes(bundle.bundleId));
}

export function getInitialGuildVerificationSelection(
  verificationConfig?: GuildVerificationConfigSnapshot,
  env: Record<string, string | undefined> = {},
) {
  const providerOptions = getGuildVerificationProviderOptions(verificationConfig, env);
  const claimBundleOptions = getGuildVerificationClaimBundleOptions(verificationConfig);
  const providerId = providerOptions.find((provider) => provider.id === verificationConfig?.defaultProviderId)?.id
    ?? providerOptions[0]?.id
    ?? getDefaultVerificationProviderId(env);
  const claimBundleId = claimBundleOptions[0]?.bundleId ?? getSharedDefaultHumanifyIdClaimBundle().bundleId;

  return {
    claimBundleId,
    providerId,
  };
}

export function getVerificationProviderClaimCompatibility(
  provider: VerificationProviderOption,
  requestedClaims: readonly HumanifyClaimKey[],
): boolean {
  return verificationProviderSupportsClaims(provider, requestedClaims);
}

export function getVerificationProviderAvailability(input: {
  faceVerificationRequired: boolean;
  provider: VerificationProviderOption;
  requestedClaims: readonly HumanifyClaimKey[];
}) {
  if (!getVerificationProviderClaimCompatibility(input.provider, input.requestedClaims)) {
    return {
      allowed: false,
      reason: "This option cannot prove the checks this server asked for.",
    } as const;
  }

  if (
    input.faceVerificationRequired
    && !verificationOptionSupportsFaceVerificationRequirement(input.provider)
  ) {
    return {
      allowed: false,
      reason: "This server needs a face check, so choose a first-time capture option instead.",
    } as const;
  }

  return {
    allowed: true,
  } as const;
}

export function getVerificationOptionLaunch(boundary: VerificationProviderBoundary): VerificationOptionLaunch | null {
  return getVerificationOptionBrowserLaunch(boundary);
}

export function parseVerificationSearch(search: Record<string, unknown>): VerificationRouteSearch {
  return {
    serverName: readSearchString(search.serverName),
    sessionId: readSearchString(search.sessionId),
    token: readSearchString(search.token),
    username: readSearchString(search.username),
  };
}

export function hasVerificationLink(
  search: VerificationRouteSearch,
): search is VerificationRouteSearch & { sessionId: string; token: string } {
  return Boolean(search.sessionId && search.token);
}

export function getVerifierApiBaseUrl(env: Record<string, string | undefined> = {}): string {
  const configuredBaseUrl = env.VITE_HUMANIFY_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:3211";
}

function buildApiUrl(apiBaseUrl: string, path: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

async function readApiEnvelope<TData>(response: Response): Promise<TData> {
  const json = (await response.json()) as ApiEnvelope<TData> | ApiErrorEnvelope;

  if (!response.ok) {
    const error = json as ApiErrorEnvelope;
    throw new VerifierApiError(
      error.errorCode ?? "internal_error",
      error.message ?? "Verification request failed.",
      error.requestId,
      error.retryable ?? false,
    );
  }

  return (json as ApiEnvelope<TData>).data;
}

export async function fetchVerificationSession(
  fetchImpl: FetchLike,
  input: { apiBaseUrl: string; sessionId: string; token: string },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(
      input.apiBaseUrl,
      `/verification/sessions/${encodeURIComponent(input.sessionId)}?token=${encodeURIComponent(input.token)}`,
    ),
    {
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
      }, requestTelemetry),
    },
  );

  return readApiEnvelope<VerificationSessionData>(response);
}

export async function completeVerificationChallenge(
  fetchImpl: FetchLike,
  input: {
    apiBaseUrl: string;
    challengeId: string;
    guildId: string;
    providerId: VerificationProviderId;
    requestedClaims: readonly HumanifyClaimKey[];
    sessionId: string;
    token: string;
    userId: string;
  },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, `/verification/challenges/${encodeURIComponent(input.challengeId)}/complete`),
    {
      body: JSON.stringify({
        guildId: input.guildId,
        providerId: input.providerId,
        requestedClaims: input.requestedClaims,
        sessionId: input.sessionId,
        token: input.token,
        userId: input.userId,
      }),
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }, requestTelemetry),
      method: "POST",
    },
  );

  return readApiEnvelope<VerificationChallengeData>(response);
}

export async function startReusableProofFlow(
  fetchImpl: FetchLike,
  input: {
    apiBaseUrl: string;
    backUrl?: string;
    finishUrl?: string;
    providerId: VerificationProviderId;
    providerStartEndpoint: string;
    providerStartToken: string;
  },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, input.providerStartEndpoint),
    {
      body: JSON.stringify({
        backUrl: input.backUrl,
        finishUrl: input.finishUrl,
        providerStartToken: input.providerStartToken,
      }),
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }, requestTelemetry),
      method: "POST",
    },
  );

  return readApiEnvelope<ReusableProofStartData>(response);
}

export async function verifyReusableProofResult(
  fetchImpl: FetchLike,
  input: {
    apiBaseUrl: string;
    providerId: VerificationProviderId;
    providerSessionToken: string;
  },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, `/verification/providers/${encodeURIComponent(input.providerId)}/proof`),
    {
      body: JSON.stringify({
        providerSessionToken: input.providerSessionToken,
      }),
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }, requestTelemetry),
      method: "POST",
    },
  );

  return readApiEnvelope<ReusableProofVerificationData>(response);
}

export async function releaseVerificationSession(
  fetchImpl: FetchLike,
  input: {
    apiBaseUrl: string;
    guildId: string;
    sessionId: string;
    token: string;
    userId: string;
  },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, `/verification/sessions/${encodeURIComponent(input.sessionId)}/release`),
    {
      body: JSON.stringify({
        guildId: input.guildId,
        token: input.token,
        userId: input.userId,
      }),
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }, requestTelemetry),
      method: "POST",
    },
  );

  return readApiEnvelope<VerificationReleaseData>(response);
}

export function buildVerificationChecklist(input: {
  challengeCompleted: boolean;
  providerFlowConfigured: boolean;
  releaseEligible: boolean;
}) {
  const items: VerificationChecklistItem[] = [
    {
      detail: "The Bun API accepted a signed verifier link and derived the session context from that server-signed challenge.",
      status: "complete",
      title: "Signed verifier link",
    },
    {
      detail: input.challengeCompleted
        ? "The Discord-bound challenge request was accepted and the session moved to provider pending."
        : "Confirm the Discord-bound challenge before any provider step can begin.",
      status: input.challengeCompleted ? "complete" : "pending",
      title: "Discord-bound challenge",
    },
    {
      detail: input.providerFlowConfigured
        ? "The selected provider's server verification flow is configured; start the wallet handoff and wait for Humanify's server verification result."
        : "Provider verification remains disabled until Humanify wires the selected provider's server-side proof or webhook contract.",
      status: input.providerFlowConfigured ? "pending" : "blocked",
      title: "Provider verification",
    },
    {
      detail: input.releaseEligible
        ? "The session is eligible for Bun-side release orchestration."
        : "Release-to-role stays blocked until Humanify verifies the selected provider handoff in canonical Postgres state.",
      status: input.releaseEligible ? "pending" : "blocked",
      title: "Release-to-role",
    },
  ];

  return items;
}

export async function startVerificationOptionLaunch(
  input: {
    launch: VerificationOptionLaunch;
    onBrowserResult: (result: VerificationOptionBrowserResult) => void;
  },
) {
  await startVerificationOptionBrowserLaunch(input.launch, {
    onBrowserResult: input.onBrowserResult,
  });
}
