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
  discordSnowflakeToTimestamp,
  evaluateDiscordAccountTrust,
} from "@humanify/discord-core";
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
  loadOptionalDiscordVerificationAuthConfig,
  loadDiditConfig,
  loadPrivadoVerifierConfig,
  type DiscordVerificationAuthConfig,
  type DiditConfig,
  type EnvSource,
  type PrivadoVerifierConfig,
} from "@humanify/config";
import type {
  VerificationSessionRecord,
  VerificationSessionState,
  VerificationSessionsRepository,
} from "@humanify/db";

import type { BetterAuthBridge } from "../auth/better-auth";

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
  betterAuthBridge?: BetterAuthBridge;
  diditClient?: DiditClient;
  privadoVerifierBackendClient?: PrivadoVerifierBackendClient;
};

export type ApiVerificationOptionEnvironment = {
  betterAuthBridge?: BetterAuthBridge;
  discordVerificationAuthConfig?: DiscordVerificationAuthConfig;
  diditClient?: DiditClient;
  diditConfig?: DiditConfig;
  privadoVerifierBackendClient?: PrivadoVerifierBackendClient;
  privadoVerifierConfig: PrivadoVerifierConfig;
};

export type VerificationProviderBoundary = {
  handoffKind?: VerificationProviderDefinition["integration"]["handoffKind"];
  launch?: Record<string, unknown>;
  nextStep: VerificationProviderDefinition["integration"]["completionMode"] | "complete_challenge" | "release_available" | "released";
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
  providerStartToken?: string;
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

type VerificationDecisionSummary = {
  action: "escalate_review" | "keep_quarantined" | "release_now" | "require_stronger_evidence" | "wait_for_provider";
  matchedClaims: HumanifyClaimKey[];
  message: string;
  missingClaims: HumanifyClaimKey[];
  releaseEligible: boolean;
  reviewRequired: boolean;
};

function summarizeVerificationDecision(input: {
  provider: VerificationProviderDefinition["id"];
  requestedClaims: HumanifyClaimKey[];
  riskScore?: number;
  satisfiedClaims: HumanifyClaimKey[];
  state: VerificationSessionState;
}): VerificationDecisionSummary {
  const matchedClaims = input.requestedClaims.filter((claim) => input.satisfiedClaims.includes(claim));
  const missingClaims = input.requestedClaims.filter((claim) => !input.satisfiedClaims.includes(claim));

  if (input.state === "provider_pending" || input.state === "challenge_issued") {
    return {
      action: "wait_for_provider",
      matchedClaims,
      message: "Humanify is still waiting for the provider's server-side verification result.",
      missingClaims,
      releaseEligible: false,
      reviewRequired: false,
    };
  }

  if (input.state === "passed" && missingClaims.length === 0) {
    return {
      action: "release_now",
      matchedClaims,
      message: "The current verification evidence satisfies this server's requested proof bundle.",
      missingClaims,
      releaseEligible: true,
      reviewRequired: false,
    };
  }

  if (input.state === "expired" || input.state === "cancelled") {
    return {
      action: "require_stronger_evidence",
      matchedClaims,
      message: "This verification attempt did not finish. Start another proof path to continue.",
      missingClaims,
      releaseEligible: false,
      reviewRequired: false,
    };
  }

  if (typeof input.riskScore === "number" && input.riskScore >= 7) {
    return {
      action: "escalate_review",
      matchedClaims,
      message: input.provider === "discord"
        ? "Discord account signals were too weak for automatic release, so Humanify should keep the member gated and flag the session for review."
        : "This verification result was risky enough that Humanify should keep the member gated and flag the session for review.",
      missingClaims,
      releaseEligible: false,
      reviewRequired: true,
    };
  }

  if (matchedClaims.length > 0 || missingClaims.length > 0) {
    return {
      action: "require_stronger_evidence",
      matchedClaims,
      message: "Some requested verification evidence is still missing. Complete a stronger proof path before release.",
      missingClaims,
      releaseEligible: false,
      reviewRequired: false,
    };
  }

  return {
    action: "keep_quarantined",
    matchedClaims,
    message: "Humanify should keep the member gated until stronger verification evidence is available.",
    missingClaims,
    releaseEligible: false,
    reviewRequired: false,
  };
}

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
      verificationDecision: summarizeVerificationDecision({
        provider: "didit",
        requestedClaims: input.requestedClaims as HumanifyClaimKey[],
        satisfiedClaims: Array.from(new Set(satisfiedClaims)) as HumanifyClaimKey[],
        state,
      }),
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
      verificationDecision: summarizeVerificationDecision({
        provider: input.provider.id,
        requestedClaims: input.requestedClaims as HumanifyClaimKey[],
        satisfiedClaims: normalizedResult.satisfiedClaims as HumanifyClaimKey[],
        state: normalizedResult.status === "verified"
          ? "passed"
          : normalizedResult.status === "failed"
            ? "failed"
            : "provider_pending",
      }),
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

const discordRuntime: ApiVerificationOptionRuntime = {
  async completeChallenge(input) {
    const { betterAuthBridge, discordVerificationAuthConfig } = input.runtimeEnvironment;
    if (!betterAuthBridge || !discordVerificationAuthConfig) {
      throw new ApiRouteError(
        503,
        "dependency_unavailable",
        "Discord account verification is not configured in this Humanify environment.",
        true,
      );
    }

    if (!input.providerStartToken) {
      throw new ApiRouteError(500, "dependency_unavailable", "Discord verification start token generation is unavailable.", true);
    }

    const updatedSession = await input.verificationSessionsRepository.markProviderChallengeStarted({
      launch: {
        mode: "redirect",
        providerId: "discord",
        url: `${discordVerificationAuthConfig.apiBaseUrl}${buildReusableProofProviderStartEndpoint(input.sessionId, input.provider.id)}?providerStartToken=${encodeURIComponent(input.providerStartToken)}`,
      },
      providerId: input.provider.id,
      requestedClaims: input.requestedClaims,
      sessionId: input.sessionId,
      status: "discord_sign_in_required",
    });
    if (!updatedSession) {
      throw new ApiRouteError(404, "not_found", "Verification session was not found while recording the Discord handoff.");
    }

    return updatedSession;
  },
  isConfigured(input) {
    return Boolean(input.betterAuthBridge && input.discordVerificationAuthConfig);
  },
};

const genericRuntime: ApiVerificationOptionRuntime = {
  isConfigured() {
    return false;
  },
};

const optionRuntimes: Record<string, ApiVerificationOptionRuntime> = {
  didit: diditRuntime,
  discord: discordRuntime,
  privado: privadoRuntime,
};

export function createApiVerificationOptionEnvironment(input: {
  env: EnvSource;
  overrides?: ApiVerificationOptionRuntimeOverrides;
}): ApiVerificationOptionEnvironment {
  const discordVerificationAuthConfig = loadOptionalDiscordVerificationAuthConfig(input.env);
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
    betterAuthBridge: input.overrides?.betterAuthBridge,
    discordVerificationAuthConfig,
    diditClient,
    diditConfig,
    privadoVerifierBackendClient,
    privadoVerifierConfig,
  };
}

export async function reconcileDiscordVerificationResult(input: {
  headers: Headers;
  now: () => number;
  requestedClaims: HumanifyClaimKey[];
  runtimeEnvironment: ApiVerificationOptionEnvironment;
  sessionId: string;
  subjectUserId: string;
  verificationSessionsRepository: VerificationSessionsRepository;
}) {
  const { betterAuthBridge } = input.runtimeEnvironment;
  if (!betterAuthBridge) {
    throw new ApiRouteError(
      503,
      "dependency_unavailable",
      "Discord account verification is not configured in this Humanify environment.",
      true,
    );
  }

  const accountInfo = await betterAuthBridge.getDiscordAccountInfo(input.headers);
  if (!accountInfo) {
    throw new ApiRouteError(401, "forbidden", "Discord sign-in did not produce an account session Humanify can verify.");
  }

  if (accountInfo.user.id !== input.subjectUserId) {
    throw new ApiRouteError(
      403,
      "forbidden",
      "The signed-in Discord account does not match the member who started this verification session.",
    );
  }

  const accessToken = await betterAuthBridge.getDiscordAccessToken(input.headers);
  const connectionTypes = accessToken?.scopes.includes("connections")
    ? (await betterAuthBridge.getDiscordConnections({
        accessToken: accessToken.accessToken,
      })).map((connection) => connection.type)
    : [];
  const rawData = accountInfo.data;
  const createdTimestamp = discordSnowflakeToTimestamp(accountInfo.user.id);
  const evaluation = evaluateDiscordAccountTrust({
    now: input.now(),
    snapshot: {
      avatar: typeof rawData.avatar === "string" ? rawData.avatar : accountInfo.user.image,
      connectionTypes,
      createdTimestamp,
      emailVerified: accountInfo.user.emailVerified === true,
      globalName: typeof rawData.global_name === "string" ? rawData.global_name : accountInfo.user.name,
      premiumType: typeof rawData.premium_type === "number" ? rawData.premium_type : undefined,
      publicFlags: typeof rawData.public_flags === "number" ? rawData.public_flags : undefined,
      userId: accountInfo.user.id,
      username: typeof rawData.username === "string" ? rawData.username : accountInfo.user.name,
    },
  });
  const verificationDecision = summarizeVerificationDecision({
    provider: "discord",
    requestedClaims: input.requestedClaims as HumanifyClaimKey[],
    riskScore: evaluation.riskScore,
    satisfiedClaims: evaluation.satisfied ? ["discord_account_trust"] : [],
    state: evaluation.satisfied ? "passed" : "failed",
  });
  const updatedSession = await input.verificationSessionsRepository.recordProviderResult({
    artifactKind: "account_signal_snapshot",
    providerId: "discord",
    providerReferenceId: accountInfo.user.id,
    requestedClaims: input.requestedClaims,
    resultSummary: {
      accountCreatedAt: new Date(createdTimestamp).toISOString(),
      authoritativeSource: "discord_better_auth_session",
      connectionTypeCount: [...new Set(connectionTypes)].length,
      connectionTypes: [...new Set(connectionTypes)].sort(),
      negativeReasonCodes: evaluation.negativeReasonCodes,
      positiveReasonCodes: evaluation.positiveReasonCodes,
      providerReferenceId: accountInfo.user.id,
      providerStatus: evaluation.satisfied ? "provider_account_verified" : "provider_account_insufficient",
      requestedClaims: input.requestedClaims,
      satisfiedClaims: evaluation.satisfied ? ["discord_account_trust"] : [],
      trustScore: evaluation.trustScore,
      trustSignals: {
        emailVerified: accountInfo.user.emailVerified === true,
        hasAvatar: Boolean(rawData.avatar ?? accountInfo.user.image),
        hasConnections: connectionTypes.length > 0,
        premiumType: typeof rawData.premium_type === "number" ? rawData.premium_type : null,
        publicFlags: typeof rawData.public_flags === "number" ? rawData.public_flags : null,
        riskScore: evaluation.riskScore,
      },
      verificationDecision,
    },
    sessionId: input.sessionId,
    state: evaluation.satisfied ? "passed" : "failed",
    status: evaluation.satisfied ? "provider_account_verified" : "provider_account_insufficient",
  });
  if (!updatedSession) {
    throw new ApiRouteError(404, "not_found", "Verification session was not found while recording the Discord result.");
  }

  return {
    evaluation,
    updatedSession,
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
      nextStep: record.state === "released"
        ? "released"
        : record.state === "passed"
          ? "release_available"
          : selectedProvider
            ? "provider_verification_required"
            : "complete_challenge",
      providerFlowConfigured: Boolean(status.launch) || Boolean(selectedProvider),
      providerSessionId: status.providerSessionId,
      releaseEligible: record.state === "passed",
      requestedClaims: status.requestedClaims as HumanifyClaimKey[] | undefined,
      selectedProvider,
      status: record.state === "released" ? "released" : status.status ?? "challenge_link_verified",
    };
  }

  return buildVerificationOptionBoundary(providerDefinition, {
    launch: status.launch,
    nextStep: record.state === "released" ? "released" : record.state === "passed" ? "release_available" : "provider_verification_required",
    providerFlowConfigured: Boolean(status.launch) || Boolean(selectedProvider),
    providerSessionId: status.providerSessionId,
    releaseEligible: record.state === "passed",
    requestedClaims: status.requestedClaims as HumanifyClaimKey[] | undefined,
    selectedProvider,
    status: record.state === "released" ? "released" : status.status ?? "challenge_link_verified",
  });
}
