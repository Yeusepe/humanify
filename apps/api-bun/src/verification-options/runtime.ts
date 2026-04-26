/**
 * Purpose: Owns provider-specific verification option runtimes so the Bun API can dispatch through generic option boundaries instead of branching on concrete providers in app.ts.
 * Governing docs:
 * - AGENTS.md
 * - docs\api.md
 * - docs\verification.md
 * - docs\workspaces.md
 * - docs\observability-security.md
 * External references:
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.didit.me/integration/webhooks
 * - https://docs.privado.id/docs/verifier/verifier-overview/
 * - https://docs.privado.id/docs/verifier/verifier-backend/
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { createRequestTelemetryContext, injectRequestTelemetryHeaders, type TraceContext } from "@humanify/telemetry";
import {
  buildPrivadoWalletLaunch,
  createPrivadoReusableCredentialBridge,
  createPrivadoVerificationPlan,
  normalizePrivadoVerificationResult,
  type HumanifyClaimKey,
  type PrivadoVerificationPlan,
  type PrivadoVerifierBackendQRCodeMessage,
  type PrivadoVerifierBackendSignInRequest,
  type PrivadoVerifierBackendSignInResponse,
  type PrivadoVerifierBackendStatusResponse,
  type VerificationProviderCatalog,
  type VerificationProviderDefinition,
} from "@humanify/verification-providers";
import {
  loadDiditConfig,
  loadPrivadoVerifierConfig,
  type DiditConfig,
  type EnvSource,
  type PrivadoVerifierConfig,
} from "@humanify/config";
import type {
  VerificationSessionRecord,
  VerificationSessionState,
  VerificationSessionsRepository,
} from "@humanify/db";

import { createDiditClient, type DiditClient } from "../didit";
import { ApiRouteError } from "../api-route-error";

export type PrivadoVerifierBackendClient = {
  createProofRequest(
    request: PrivadoVerifierBackendSignInRequest,
    requestTelemetry?: ReturnType<typeof createRequestTelemetryContext>,
  ): Promise<PrivadoVerifierBackendSignInResponse>;
  readProofStatus(
    sessionId: string,
    requestTelemetry?: ReturnType<typeof createRequestTelemetryContext>,
  ): Promise<PrivadoVerifierBackendStatusResponse>;
};

export type ApiVerificationOptionRuntimeOverrides = {
  diditClient?: DiditClient;
  privadoVerifierBackendClient?: PrivadoVerifierBackendClient;
};

export type ApiVerificationOptionEnvironment = {
  diditClient?: DiditClient;
  diditConfig?: DiditConfig;
  privadoVerifierBackendClient?: PrivadoVerifierBackendClient;
  privadoVerifierConfig: PrivadoVerifierConfig;
};

export type VerificationProviderBoundary = {
  handoffKind?: VerificationProviderDefinition["integration"]["handoffKind"];
  launch?: Record<string, unknown>;
  nextStep: VerificationProviderDefinition["integration"]["completionMode"] | "complete_challenge" | "release_available";
  providerFlowConfigured: boolean;
  providerServerEndpoint?: string;
  providerSessionId?: string;
  providerSessionToken?: string;
  providerStartEndpoint?: string;
  providerStartToken?: string;
  releaseEligible: boolean;
  requestedClaims?: HumanifyClaimKey[];
  requiredCapabilities?: string[];
  selectedProvider?: string;
  serverVerificationNote?: string;
  status: string;
};

type RuntimeRequestContext = {
  requestId: string;
  traceContext: TraceContext;
};

type ChallengeCompletionInput = {
  challengeId: string;
  provider: VerificationProviderDefinition;
  requestedClaims: HumanifyClaimKey[];
  requiredCapabilities: string[];
  runtimeEnvironment: ApiVerificationOptionEnvironment;
  sessionId: string;
  token: string;
  verificationSessionsRepository: VerificationSessionsRepository;
};

type ReusableProofStartInput = {
  backUrl?: string;
  finishUrl?: string;
  now: () => number;
  provider: VerificationProviderDefinition;
  providerStartToken: string;
  requestContext: RuntimeRequestContext;
  requiredCapabilities: string[];
  requestedClaims: HumanifyClaimKey[];
  runtimeEnvironment: ApiVerificationOptionEnvironment;
  sessionConfig: {
    sessionSecret: string;
  };
  sessionId: string;
  challengeId: string;
  guildId: string;
  userId: string;
};

type ReusableProofVerificationInput = {
  now: () => number;
  provider: VerificationProviderDefinition;
  providerSessionId: string;
  providerSessionToken: string;
  requestContext: RuntimeRequestContext;
  requiredCapabilities: string[];
  requestedClaims: HumanifyClaimKey[];
  runtimeEnvironment: ApiVerificationOptionEnvironment;
  sessionId: string;
  verificationSessionsRepository: VerificationSessionsRepository;
};

type ProviderCallbackInput = {
  now: () => number;
  provider: VerificationProviderDefinition;
  rawBody: string;
  requestContext: RuntimeRequestContext;
  requestHeaders: Headers;
  runtimeEnvironment: ApiVerificationOptionEnvironment;
  verificationSessionsRepository: VerificationSessionsRepository;
};

type ApiVerificationOptionRuntime = {
  completeChallenge?(input: ChallengeCompletionInput): Promise<VerificationSessionRecord>;
  handleCallback?(input: ProviderCallbackInput): Promise<VerificationSessionRecord>;
  isConfigured(input: ApiVerificationOptionEnvironment): boolean;
  startReusableProof?(input: ReusableProofStartInput): Promise<{
    boundary: VerificationProviderBoundary;
    flow: {
      providerId: string;
      providerSessionId: string;
      providerSessionToken: string;
      qrCodeValue: string;
      request: PrivadoVerificationPlan["request"];
      requestUri?: string;
      universalLink: string;
    };
  }>;
  verifyReusableProof?(input: ReusableProofVerificationInput): Promise<{
    normalizedResult: Awaited<ReturnType<typeof normalizePrivadoVerificationResult>>;
    updatedSession: VerificationSessionRecord;
  }>;
};

function buildDiditCallbackUrl(config: DiditConfig, sessionId: string, token: string) {
  const callbackUrl = new URL("/verify", config.verifierBaseUrl);
  callbackUrl.searchParams.set("sessionId", sessionId);
  callbackUrl.searchParams.set("token", token);
  return callbackUrl.toString();
}

function readDiditDecisionArray(decision: Record<string, unknown>, key: string) {
  const entries = decision[key];
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter((entry) => Boolean(entry && typeof entry === "object")) as Array<Record<string, unknown>>;
}

function readDiditApprovedArray(decision: Record<string, unknown>, key: string) {
  return readDiditDecisionArray(decision, key).filter((entry) =>
    Boolean(entry && typeof entry === "object" && String((entry as Record<string, unknown>).status ?? "").toLowerCase() === "approved")
  ) as Array<Record<string, unknown>>;
}

function normalizeDiditDecision(input: {
  decision: Record<string, unknown>;
  providerSessionId: string;
  requestedClaims: string[];
  status: string;
}) {
  const approvedIdVerifications = readDiditApprovedArray(input.decision, "idVerifications").length > 0
    ? readDiditApprovedArray(input.decision, "idVerifications")
    : readDiditApprovedArray(input.decision, "id_verifications");
  const livenessChecks = readDiditDecisionArray(input.decision, "livenessChecks").length > 0
    ? readDiditDecisionArray(input.decision, "livenessChecks")
    : readDiditDecisionArray(input.decision, "liveness_checks");
  const approvedLivenessChecks = readDiditApprovedArray(input.decision, "livenessChecks").length > 0
    ? readDiditApprovedArray(input.decision, "livenessChecks")
    : readDiditApprovedArray(input.decision, "liveness_checks");
  const satisfiedClaims: string[] = [];
  const faceVerificationPerformed = livenessChecks.length > 0;
  const faceVerificationPassed = approvedLivenessChecks.length > 0;
  const primaryIdVerification = approvedIdVerifications[0];
  const nationality = typeof primaryIdVerification?.nationality === "string" && primaryIdVerification.nationality.trim().length > 0
    ? primaryIdVerification.nationality.trim()
    : undefined;
  const ageValue = Number(primaryIdVerification?.age);
  const ageOver18 = Number.isFinite(ageValue) && ageValue >= 18;
  const ageOver21 = Number.isFinite(ageValue) && ageValue >= 21;

  if (approvedIdVerifications.length > 0) {
    satisfiedClaims.push("document_identity");
    if (ageOver18) {
      satisfiedClaims.push("age_over_18");
    }

    if (ageOver21) {
      satisfiedClaims.push("age_over_21");
    }

    if (nationality) {
      satisfiedClaims.push("nationality");
    }
  }

  if (approvedLivenessChecks.length > 0) {
    satisfiedClaims.push("liveness");
    satisfiedClaims.push("face_verification");
  }

  const normalizedStatus = input.status.toLowerCase();
  const state: Exclude<VerificationSessionState, "challenge_issued" | "released"> =
    normalizedStatus === "approved"
      ? "passed"
      : normalizedStatus === "declined"
        ? "failed"
        : normalizedStatus === "expired"
          ? "expired"
          : normalizedStatus === "abandoned"
            ? "cancelled"
            : "provider_pending";

  return {
    bridgeFacts: {
      ageOver18,
      ageOver21,
      documentIdentityVerified: approvedIdVerifications.length > 0,
      faceVerificationPassed,
      faceVerificationPerformed,
      livenessVerified: approvedLivenessChecks.length > 0,
      nationality,
      satisfiedClaims: Array.from(new Set(satisfiedClaims)) as HumanifyClaimKey[],
    },
    resultSummary: {
      authoritativeSource: "didit_decision_api",
      faceVerificationPassed,
      faceVerificationPerformed,
      providerReferenceId: input.providerSessionId,
      providerStatus: input.status,
      requestedClaims: input.requestedClaims,
      satisfiedClaims: Array.from(new Set(satisfiedClaims)),
    },
    state,
  };
}

function buildVerificationOptionBoundary(
  provider: VerificationProviderDefinition,
  input: Omit<VerificationProviderBoundary, "handoffKind" | "providerServerEndpoint" | "serverVerificationNote">,
): VerificationProviderBoundary {
  return {
    ...input,
    handoffKind: provider.integration.handoffKind,
    providerServerEndpoint: provider.integration.serverEndpointPath,
    serverVerificationNote: provider.integration.serverVerificationNote,
  };
}

const diditRuntime: ApiVerificationOptionRuntime = {
  async completeChallenge(input) {
    const { diditClient, diditConfig } = input.runtimeEnvironment;
    if (!diditConfig || !diditClient) {
      throw new ApiRouteError(
        503,
        "dependency_unavailable",
        "Didit capture is not configured in this Humanify environment.",
        true,
      );
    }

    const persistedSession = await input.verificationSessionsRepository.getSession(input.sessionId);
    if (!persistedSession) {
      throw new ApiRouteError(404, "not_found", "Verification session was not found in canonical state.");
    }

    const callbackUrl = buildDiditCallbackUrl(diditConfig, input.sessionId, input.token);
    const diditSession = await diditClient.createSession({
      callbackUrl,
      metadata: {
        humanifyChallengeId: input.challengeId,
      },
      vendorData: input.sessionId,
      workflowId: diditConfig.workflowId,
    });
    const updatedSession = await input.verificationSessionsRepository.markDiditSessionCreated({
      callbackUrl,
      providerSessionId: diditSession.sessionId,
      providerSessionStatus: diditSession.sessionStatus,
      requestedClaims: input.requestedClaims,
      sessionId: input.sessionId,
      verificationUrl: diditSession.verificationUrl,
      workflowId: diditSession.workflowId,
    });
    if (!updatedSession) {
      throw new ApiRouteError(404, "not_found", "Verification session was not found while recording the provider session.");
    }

    return updatedSession;
  },
  async handleCallback(input) {
    const { diditClient } = input.runtimeEnvironment;
    if (!diditClient) {
      throw new ApiRouteError(
        503,
        "dependency_unavailable",
        "Didit callbacks are not configured in this Humanify environment.",
        true,
      );
    }

    const signature = input.requestHeaders.get("x-signature-v2");
    const timestamp = input.requestHeaders.get("x-timestamp");
    if (!diditClient.verifyWebhookSignature({ rawBody: input.rawBody, signature, timestamp })) {
      throw new ApiRouteError(401, "provider_callback_invalid", "Didit webhook signature verification failed.");
    }

    const payload = JSON.parse(input.rawBody) as {
      session_id?: string;
      status?: string;
      timestamp?: number;
      vendor_data?: string;
      webhook_type?: string;
      workflow_id?: string;
    };
    const internalSessionId = payload.vendor_data?.trim();
    if (!internalSessionId) {
      throw new ApiRouteError(400, "provider_callback_invalid", "Didit webhook is missing vendor_data.");
    }

    const persistedSession = await input.verificationSessionsRepository.getSession(internalSessionId);
    if (!persistedSession) {
      throw new ApiRouteError(404, "not_found", "Verification session was not found for the callback.");
    }

    const launch = persistedSession.providerStatus.launch as { providerSessionId?: string } | undefined;
    if (!launch?.providerSessionId || launch.providerSessionId !== payload.session_id) {
      throw new ApiRouteError(409, "provider_callback_invalid", "Provider callback does not match the stored provider session.");
    }

    const decision = await diditClient.retrieveDecision(payload.session_id);
    if (decision.vendorData && decision.vendorData !== internalSessionId) {
      throw new ApiRouteError(409, "provider_callback_invalid", "Provider decision vendor_data does not match the stored session.");
    }

    const requestedClaims = Array.isArray(persistedSession.providerStatus.requestedClaims)
      ? persistedSession.providerStatus.requestedClaims as string[]
      : [];
    const normalizedDecision = normalizeDiditDecision({
      decision: decision.decision ?? {},
      providerSessionId: payload.session_id,
      requestedClaims,
      status: decision.status,
    });
    const reusableCredentialBridge = normalizedDecision.state === "passed"
      ? createPrivadoReusableCredentialBridge({
        source: {
          guildId: persistedSession.guildId,
          providerSessionId: payload.session_id,
          sessionId: internalSessionId,
          userId: persistedSession.userId,
        },
        verifiedDiditFacts: normalizedDecision.bridgeFacts,
      })
      : undefined;
    const purge = await diditClient.deleteSession(payload.session_id);
    const updatedSession = await input.verificationSessionsRepository.recordDiditResult({
      providerSessionId: payload.session_id,
      providerStatus: decision.status,
      purge: {
        attemptedAt: new Date(input.now()).toISOString(),
        ...purge,
      },
      requestedClaims,
      reusableCredentialBridge: reusableCredentialBridge
        ? {
          artifactPayload: reusableCredentialBridge,
          artifactStatus: reusableCredentialBridge.status,
          bridgeId: reusableCredentialBridge.bridgeId,
          expiresAt: reusableCredentialBridge.temporaryRetention.expiresAt,
          summary: reusableCredentialBridge,
          targetProvider: reusableCredentialBridge.targetProvider,
        }
        : undefined,
      resultSummary: normalizedDecision.resultSummary,
      sessionId: internalSessionId,
      state: normalizedDecision.state === "provider_pending" ? "provider_pending" : normalizedDecision.state,
      webhook: {
        providerStatus: payload.status ?? decision.status,
        timestamp: timestamp ?? payload.timestamp ?? null,
        webhookType: payload.webhook_type ?? "status.updated",
        workflowId: payload.workflow_id ?? decision.workflowId ?? null,
      },
    });
    if (!updatedSession) {
      throw new ApiRouteError(404, "not_found", "Verification session was not found while recording the provider result.");
    }

    return updatedSession;
  },
  isConfigured(input) {
    return Boolean(input.diditConfig && input.diditClient);
  },
};

const privadoRuntime: ApiVerificationOptionRuntime = {
  isConfigured(input) {
    return input.privadoVerifierConfig.enabled;
  },
  async startReusableProof(input) {
    const { privadoVerifierBackendClient, privadoVerifierConfig } = input.runtimeEnvironment;
    if (!privadoVerifierConfig.enabled || !privadoVerifierBackendClient) {
      throw new ApiRouteError(
        503,
        "dependency_unavailable",
        `Reusable-proof start for "${input.provider.id}" is not configured in this Humanify environment.`,
        true,
      );
    }

    const verificationPlan: PrivadoVerificationPlan = createPrivadoVerificationPlan({
      chainId: privadoVerifierConfig.chainId,
      nullifierSessionId: input.sessionId,
      now: input.now(),
      requestedClaims: input.requestedClaims,
      trustedIssuers: privadoVerifierConfig.trustedIssuers,
    });
    const providerSession = await privadoVerifierBackendClient.createProofRequest(
      verificationPlan.request,
      createRequestTelemetryContext({
        requestId: input.requestContext.requestId,
        traceContext: input.requestContext.traceContext,
      }),
    );
    const walletLaunch = buildPrivadoWalletLaunch({
      backUrl: input.backUrl,
      finishUrl: input.finishUrl,
      qrCode: providerSession.qrCode as PrivadoVerifierBackendQRCodeMessage,
    });

    const { issueReusableProofSessionToken } = await import("@humanify/auth");
    const providerSessionToken = issueReusableProofSessionToken(
      {
        challengeId: input.challengeId,
        guildId: input.guildId,
        providerId: input.provider.id,
        providerSessionId: providerSession.sessionID,
        requiredCapabilities: input.requiredCapabilities,
        requestedClaims: input.requestedClaims,
        sessionId: input.sessionId,
        userId: input.userId,
      },
      input.sessionConfig.sessionSecret,
      900,
      input.now(),
    );

    return {
      boundary: buildVerificationOptionBoundary(input.provider, {
        nextStep: "provider_verification_required",
        providerFlowConfigured: true,
        providerSessionToken,
        providerStartEndpoint: buildReusableProofProviderStartEndpoint(input.sessionId, input.provider.id),
        providerStartToken: input.providerStartToken,
        releaseEligible: false,
        requestedClaims: input.requestedClaims,
        requiredCapabilities: input.requiredCapabilities,
        selectedProvider: input.provider.id,
        status: "proof_request_created",
      }),
      flow: {
        providerId: input.provider.id,
        providerSessionId: providerSession.sessionID,
        providerSessionToken,
        qrCodeValue: walletLaunch.qrCodeValue,
        request: verificationPlan.request,
        requestUri: walletLaunch.requestUri,
        universalLink: walletLaunch.universalLink,
      },
    };
  },
  async verifyReusableProof(input) {
    const { privadoVerifierBackendClient, privadoVerifierConfig } = input.runtimeEnvironment;
    if (!privadoVerifierConfig.enabled || !privadoVerifierBackendClient) {
      throw new ApiRouteError(
        503,
        "dependency_unavailable",
        `Reusable-proof verification for "${input.provider.id}" is not configured in this Humanify environment.`,
        true,
      );
    }

    const providerStatus = await privadoVerifierBackendClient.readProofStatus(
      input.providerSessionId,
      createRequestTelemetryContext({
        requestId: input.requestContext.requestId,
        traceContext: input.requestContext.traceContext,
      }),
    );
    const normalizedResult = await normalizePrivadoVerificationResult({
      expectedClaims: input.requestedClaims,
      nullifierSessionId: input.sessionId,
      providerSessionId: input.providerSessionId,
      status: providerStatus,
      trustedIssuers: privadoVerifierConfig.trustedIssuers,
    });
    const resultSummary = {
      authoritativeSource: "privado_verifier_backend_status",
      message: normalizedResult.message,
      nullifierRefs: normalizedResult.evidence.nullifiers.map((entry) => entry.nullifier),
      proofReceiptHash: normalizedResult.evidence.proofReceiptHash,
      proofReceiptRef: normalizedResult.evidence.proofReceiptRef,
      providerReferenceId: input.providerSessionId,
      providerStatus: providerStatus.status,
      requestedClaims: input.requestedClaims,
      satisfiedClaims: normalizedResult.satisfiedClaims,
      trustedIssuerScopes: normalizedResult.evidence.trustedIssuerScopes,
      verifiablePresentationCount: normalizedResult.evidence.verifiablePresentationCount,
    };
    const updatedSession = await input.verificationSessionsRepository.recordReusableProofResult({
      providerId: input.provider.id,
      providerSessionId: input.providerSessionId,
      requestedClaims: input.requestedClaims,
      resultSummary,
      sessionId: input.sessionId,
      state: normalizedResult.status === "verified"
        ? "passed"
        : normalizedResult.status === "failed"
          ? "failed"
          : "provider_pending",
    });
    if (!updatedSession) {
      throw new ApiRouteError(404, "not_found", "Verification session was not found while recording the proof result.");
    }

    return {
      normalizedResult,
      updatedSession,
    };
  },
};

const genericRuntime: ApiVerificationOptionRuntime = {
  isConfigured() {
    return false;
  },
};

const optionRuntimes: Record<string, ApiVerificationOptionRuntime> = {
  didit: diditRuntime,
  privado: privadoRuntime,
};

export function createApiVerificationOptionEnvironment(input: {
  env: EnvSource;
  overrides?: ApiVerificationOptionRuntimeOverrides;
}): ApiVerificationOptionEnvironment {
  const diditConfig = loadDiditConfig(input.env);
  const privadoVerifierConfig = loadPrivadoVerifierConfig(input.env);
  const privadoVerifierBackendClient = privadoVerifierConfig.enabled
    ? input.overrides?.privadoVerifierBackendClient ?? createPrivadoVerifierBackendClient({
      baseUrl: privadoVerifierConfig.verifierBaseUrl!,
    })
    : input.overrides?.privadoVerifierBackendClient;
  const diditClient = diditConfig
    ? input.overrides?.diditClient ?? createDiditClient(diditConfig)
    : input.overrides?.diditClient;

  return {
    diditClient,
    diditConfig,
    privadoVerifierBackendClient,
    privadoVerifierConfig,
  };
}

export function buildReusableProofProviderStartEndpoint(sessionId: string, providerId: string) {
  return `/verification/sessions/${encodeURIComponent(sessionId)}/providers/${encodeURIComponent(providerId)}/start`;
}

export function getApiVerificationOptionRuntime(providerId: string): ApiVerificationOptionRuntime {
  return optionRuntimes[providerId] ?? genericRuntime;
}

export function createPrivadoVerifierBackendClient(input: {
  baseUrl: string;
  fetchFn?: typeof fetch;
}): PrivadoVerifierBackendClient {
  const fetchFn = input.fetchFn ?? fetch;

  return {
    async createProofRequest(request, requestTelemetry = createRequestTelemetryContext()) {
      const response = await fetchFn(`${input.baseUrl}/sign-in`, {
        body: JSON.stringify(request),
        headers: injectRequestTelemetryHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }, requestTelemetry),
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`privado_verifier_backend_unavailable:${response.status}`);
      }

      return await response.json() as PrivadoVerifierBackendSignInResponse;
    },
    async readProofStatus(sessionId, requestTelemetry = createRequestTelemetryContext()) {
      const response = await fetchFn(`${input.baseUrl}/status?sessionID=${encodeURIComponent(sessionId)}`, {
        headers: injectRequestTelemetryHeaders({
          accept: "application/json",
        }, requestTelemetry),
      });
      if (!response.ok) {
        throw new Error(`privado_verifier_backend_unavailable:${response.status}`);
      }

      return await response.json() as PrivadoVerifierBackendStatusResponse;
    },
  };
}

export function buildProviderBoundaryFromRecord(
  record: VerificationSessionRecord,
  verificationProviderCatalog: VerificationProviderCatalog,
): VerificationProviderBoundary {
  const status = record.providerStatus as {
    launch?: Record<string, unknown>;
    providerSessionId?: string;
    requestedClaims?: string[];
    selectedProvider?: string;
    status?: string;
  };
  const selectedProvider = typeof status.selectedProvider === "string" ? status.selectedProvider : undefined;
  const providerDefinition = selectedProvider ? verificationProviderCatalog.get(selectedProvider) : undefined;

  if (!providerDefinition) {
    return {
      launch: status.launch,
      nextStep: record.state === "passed" ? "release_available" : selectedProvider ? "provider_verification_required" : "complete_challenge",
      providerFlowConfigured: Boolean(status.launch) || Boolean(selectedProvider),
      providerSessionId: status.providerSessionId,
      releaseEligible: record.state === "passed",
      requestedClaims: status.requestedClaims as HumanifyClaimKey[] | undefined,
      selectedProvider,
      status: status.status ?? "challenge_link_verified",
    };
  }

  return buildVerificationOptionBoundary(providerDefinition, {
    launch: status.launch,
    nextStep: record.state === "passed" ? "release_available" : "provider_verification_required",
    providerFlowConfigured: Boolean(status.launch) || Boolean(selectedProvider),
    providerSessionId: status.providerSessionId,
    releaseEligible: record.state === "passed",
    requestedClaims: status.requestedClaims as HumanifyClaimKey[] | undefined,
    selectedProvider,
    status: status.status ?? "challenge_link_verified",
  });
}
