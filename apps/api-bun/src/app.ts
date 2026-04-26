/**
 * Purpose: Defines the Bun-authoritative API domain spine with validated route groups, honest Postgres-first planning envelopes, and policy-clamped moderation boundaries.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\contracts.md
 * - docs\data-platform.md
 * - docs\verification.md
 * - docs\cases-and-reports.md
 * - docs\learning.md
 * - docs\observability-security.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://elysiajs.com/at-glance
 * - https://elysiajs.com/essential/validation
 * - https://elysiajs.com/patterns/error-handling
 * - https://discord.com/developers/docs/topics/oauth2
 * - https://opentelemetry.io/docs/concepts/context-propagation/
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { Elysia, t } from "elysia";

import {
  buildDiscordOAuthAuthorizeUrl,
  createSessionCookieOptions,
  issueDiscordOAuthState,
  issueReusableProofStartToken,
  issueVerifierChallengeToken,
  verifyDiscordOAuthState,
  verifyReusableProofSessionToken,
  verifyReusableProofStartToken,
  verifyVerifierChallengeToken,
} from "@humanify/auth";
import {
  loadAdvisoryServiceConfig,
  loadDataPlaneConfig,
  loadDiscordOAuthConfig,
  loadObservabilityConfig,
  loadPolicyClampConfig,
  loadServiceIdentityConfig,
  loadSessionConfig,
  summarizeConfigForLogs,
  type EnvSource,
} from "@humanify/config";
import {
  getHumanifyContractSummary,
  humanifyActionLadder,
  humanifyContractVersion,
  humanifyContractsSchema,
  isHumanifyAction,
  type HumanifyAction,
} from "@humanify/contracts";
import { createDiscordAuditReason, createBotGatewayIntents, resolveDiscordExecutionPlan } from "@humanify/discord-core";
import {
  createPostgresGuildChannelConfigRepository,
  createPostgresReportCasesRepository,
  createPostgresVerificationSessionsRepository,
  createIdempotencyReceipt,
  createOutboxEvent,
  type GuildChannelConfigRepository,
  parsePostgresConnectionString,
  planCanonicalWrite,
  redactPostgresConnectionString,
  type LearningFeedbackSummary,
  type CaseOutcomeKind,
  type ReportCasesRepository,
  type VerificationSessionRecord,
  type VerificationSessionsRepository,
} from "@humanify/db";
import {
  evaluatePolicy,
  type CapabilityContext,
  type CaseContext,
  type PolicyRiskDecision,
  type ServerPolicy,
} from "@humanify/policy-engine";
import { createQueueEnvelope } from "@humanify/queue";
import {
  createRequestTelemetryContext,
  createStructuredErrorFields,
  createStructuredLogFields,
  createTelemetryBootstrap,
  extractTraceContext,
  formatTraceParent,
  injectRequestTelemetryHeaders,
  redactSensitiveHeaders,
  requestIdHeaderName,
  type RequestTelemetryContext,
  type TraceContext,
} from "@humanify/telemetry";
import {
  getSupportedHumanifyClaimIds,
  isHumanifyClaimKey,
  parseVerificationProviderSelection,
  resolveVerificationProviderConfiguration,
  resolveVerificationProviderCatalog,
  verificationProviderSupportsClaims,
  type HumanifyClaimKey,
  type VerificationProviderConfiguration,
} from "@humanify/verification-providers";

import { ApiRouteError, type ApiErrorCode } from "./api-route-error";
import {
  createApiVerificationOptionEnvironment,
  buildProviderBoundaryFromRecord,
  buildReusableProofProviderStartEndpoint,
  getApiVerificationOptionRuntime,
  type ApiVerificationOptionRuntimeOverrides,
  type PrivadoVerifierBackendClient,
} from "./verification-options/runtime";
export type { ApiVerificationOptionRuntimeOverrides, PrivadoVerifierBackendClient } from "./verification-options/runtime";

const routeGroups = [
  "health",
  "metadata",
  "auth",
  "guild-config",
  "cases",
  "reports",
  "verification",
  "callbacks",
  "moderation",
  "read-models",
] as const;

const reportIntakeSources = ["slash_command", "message_context", "api_form", "detector_bridge", "appeal", "internal"] as const;
const evidenceKinds = ["message_link", "attachment", "screenshot", "moderator_note", "provider_result", "external_url", "derived_text"] as const;
const caseOutcomeKinds = [
  "confirmed_scam",
  "confirmed_bot",
  "confirmed_hacked_account",
  "false_positive",
  "dismissed",
  "overturned",
] as const;

type ApiEnvelope<TData> = {
  contractVersion: typeof humanifyContractVersion;
  data: TData;
  requestId: string;
};

type ResponseHeadersMap = Record<string, string | number | readonly string[] | undefined>;

type RequestContext = {
  requestId: string;
  traceContext: TraceContext;
};

type LoggerLike = Pick<Console, "error" | "info">;

type LearningServiceCaseOutcome = {
  caseId: string;
  confidence: number;
  decidedAt: string;
  decidedBy: string;
  evidenceRefs: string[];
  guildId: string;
  outcome: CaseOutcomeKind;
  reasonCodes: string[];
  subjectUserIdHash: string;
};

type LearningServiceSummary = LearningFeedbackSummary & {
  caseId: string;
  contractVersion: string;
};

export type LearningServiceClient = {
  ingestCaseOutcome(
    outcome: LearningServiceCaseOutcome,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<LearningServiceSummary>;
};

export type ApiAppOptions = {
  env?: EnvSource;
  guildChannelConfigRepository?: GuildChannelConfigRepository;
  learningServiceClient?: LearningServiceClient;
  logger?: LoggerLike;
  now?: () => number;
  reportCasesRepository?: ReportCasesRepository;
  verificationOptionRuntimeOverrides?: ApiVerificationOptionRuntimeOverrides;
  verificationSessionsRepository?: VerificationSessionsRepository;
};

function redactUrlSecret(url: string): string {
  const parsed = new URL(url);
  if (parsed.password) {
    parsed.password = "[redacted]";
  }
  return parsed.toString();
}

function isKnownValue<TValue extends string>(value: string, values: readonly TValue[]): value is TValue {
  return values.includes(value as TValue);
}

function requireKnownAction(value: string, fieldName: string): HumanifyAction {
  if (!isHumanifyAction(value)) {
    throw new ApiRouteError(
      400,
      "validation_failed",
      `${fieldName} must be one of: ${humanifyActionLadder.join(", ")}.`,
    );
  }

  return value;
}

function requireKnownVerificationProvider(value: string, fieldName: string, providerIds: readonly string[]) {
  if (!isKnownValue(value, providerIds)) {
    throw new ApiRouteError(
      400,
      "validation_failed",
      `${fieldName} must be one of: ${providerIds.join(", ")}.`,
    );
  }

  return value;
}

function requireKnownHumanifyClaims(values: string[], fieldName: string, supportedClaimIds: readonly HumanifyClaimKey[]) {
  if (values.length === 0) {
    throw new ApiRouteError(400, "validation_failed", `${fieldName} must contain at least one supported claim.`);
  }

  return values.map((value) => {
    if (!isHumanifyClaimKey(value)) {
      throw new ApiRouteError(
        400,
        "validation_failed",
        `${fieldName} must only include supported claims: ${supportedClaimIds.join(", ")}.`,
      );
    }

    return value;
  });
}

function buildEnvelope<TData>(requestId: string, data: TData): ApiEnvelope<TData> {
  return {
    contractVersion: humanifyContractVersion,
    data,
    requestId,
  };
}

function buildDerivedVerificationSession(
  verified: ReturnType<typeof verifyVerifierChallengeToken>,
  state: "challenge_issued" | "provider_pending" | "passed" | "failed" | "expired" | "cancelled",
) {
  return {
    challengeId: verified.challengeId,
    challengeExpiresAt: new Date(verified.exp * 1_000).toISOString(),
    guildId: verified.guildId,
    releaseEligible: state === "passed",
    requiredCapabilities: verified.requiredCapabilities,
    sessionId: verified.sessionId,
    source: "signed_challenge_token",
    state,
    userId: verified.userId,
  };
}

function buildVerificationSessionFromRecord(record: VerificationSessionRecord) {
  return {
    challengeExpiresAt: record.challengeExpiresAt,
    challengeId: record.challengeId,
    guildId: record.guildId,
    releaseEligible: record.state === "passed",
    requiredCapabilities: record.requiredCapabilities,
    sessionId: record.sessionId,
    source: "canonical_verification_session",
    state: record.state,
    userId: record.userId,
  };
}

function readReusableCredentialBridgeFromRecord(record: VerificationSessionRecord) {
  const bridge = (record.providerStatus as {
    reusableCredentialBridge?: Record<string, unknown>;
  }).reusableCredentialBridge;

  return bridge && typeof bridge === "object" ? bridge : undefined;
}

function readVerificationSummaryFromRecord(record: VerificationSessionRecord) {
  return Object.keys(record.resultSummary).length > 0 ? record.resultSummary : undefined;
}

function buildErrorEnvelope(requestId: string, errorCode: ApiErrorCode, message: string, retryable: boolean) {
  return {
    errorCode,
    message,
    requestId,
    retryable,
  };
}

function getHeaderRecordValue(headers: unknown, key: string): string | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  const value = (headers as ResponseHeadersMap)[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  if (typeof value === "number") {
    return String(value);
  }

  return typeof value === "string" ? value : undefined;
}

function ensureResponseContext(request: Request, set: { headers: ResponseHeadersMap }): RequestContext {
  const requestTelemetry = createRequestTelemetryContext({
    headers: request.headers,
    requestId: getHeaderRecordValue(set.headers, requestIdHeaderName),
    traceContext: extractTraceContext(request.headers),
  });

  set.headers[requestIdHeaderName] = requestTelemetry.requestId;
  set.headers.traceparent = formatTraceParent(requestTelemetry.traceContext);

  return {
    requestId: requestTelemetry.requestId,
    traceContext: requestTelemetry.traceContext,
  };
}

function createAuditRef(requestId: string, target: string, action: string) {
  return `audit:${target}:${action}:${requestId}`;
}

function defaultServerPolicy(env: EnvSource): ServerPolicy {
  return {
    allowAutoBan: false,
    banAtOrAbove: 10,
    kickAtOrAbove: 9,
    maxAutomaticAction: loadPolicyClampConfig(env).maxAutomaticAction,
    quarantineAtOrAbove: 7,
    timeoutAtOrAbove: 8,
    verificationRequiredAtOrAbove: 6,
  };
}

function mergeServerPolicy(env: EnvSource, partial: Partial<ServerPolicy> = {}): ServerPolicy {
  const merged = {
    ...defaultServerPolicy(env),
    ...partial,
  };

  if (partial.maxAutomaticAction) {
    merged.maxAutomaticAction = requireKnownAction(partial.maxAutomaticAction, "serverPolicy.maxAutomaticAction");
  }

  return merged;
}

function buildWriteArtifacts(input: {
  aggregateId: string;
  aggregateType: string;
  auditRefs: string[];
  canonicalMutations: Array<{
    dataRef: string;
    operation: "insert" | "update" | "delete";
    primaryKey: string;
    table: string;
  }>;
  idempotencyKey: string;
  kind: string;
  payload: Record<string, unknown>;
  requestContext: RequestContext;
  requestFingerprint?: string;
  scope: string;
  stream: string;
  transactionName: string;
}) {
  const idempotency = createIdempotencyReceipt({
    createdAt: new Date().toISOString(),
    key: input.idempotencyKey,
    requestId: input.requestContext.requestId,
    scope: input.scope,
  });
  const outbox = createOutboxEvent({
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    kind: input.kind,
    payloadRef: `${input.aggregateType}:${input.aggregateId}`,
    requestId: input.requestContext.requestId,
    stream: input.stream,
  });
  const writePlan = planCanonicalWrite({
    auditRefs: input.auditRefs,
    canonicalMutations: input.canonicalMutations,
    idempotency,
    outbox: [outbox],
    transactionName: input.transactionName,
  });
  const queueEnvelope = createQueueEnvelope({
    canonicalRef: {
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      eventId: outbox.eventId,
    },
    kind: input.kind,
    payload: input.payload,
    producer: "api-bun",
    requestId: input.requestContext.requestId,
    stream: input.stream,
    traceContext: input.requestContext.traceContext,
  });

  return {
    idempotency,
    queueEnvelope,
    requestFingerprint: input.requestFingerprint,
    writePlan,
  };
}

function buildReadModelPendingEnvelope(requestContext: RequestContext, entity: string, scope: Record<string, unknown>) {
  return buildEnvelope(requestContext.requestId, {
    items: [],
    readModelStatus: "pending_postgres_projection",
    scope,
    source: `${entity}_read_model_pending`,
  });
}

async function hashSubjectUserId(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId.trim()));
  const hash = Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, "0")).join("");
  return `sha256:${hash}`;
}

function createLearningServiceClient(input: {
  baseUrl: string;
  fetchFn?: typeof fetch;
}): LearningServiceClient {
  const fetchFn = input.fetchFn ?? fetch;

  return {
    async ingestCaseOutcome(outcome, requestTelemetry = createRequestTelemetryContext()) {
      const response = await fetchFn(`${input.baseUrl}/internal/learning/case-outcomes`, {
        body: JSON.stringify(outcome),
        headers: injectRequestTelemetryHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }, requestTelemetry),
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`learning_service_unavailable:${response.status}`);
      }

      return await response.json() as LearningServiceSummary;
    },
  };
}

function requireAbsoluteRequestUrl(value: string | undefined, fieldName: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    throw new ApiRouteError(400, "validation_failed", `${fieldName} must be a valid absolute URL.`);
  }
}

function requireMessageLinkEvidence(body: {
  channelId?: string;
  evidenceType: string;
  externalRef?: string;
  guildId: string;
  messageId?: string;
  subjectUserId?: string;
}) {
  if (body.evidenceType !== "message_link") {
    throw new ApiRouteError(
      503,
      "dependency_unavailable",
      "Only canonical Discord message-link evidence is durably supported until blob upload and redaction wiring lands.",
      true,
    );
  }

  if (!body.channelId || !body.externalRef || !body.messageId || !body.subjectUserId) {
    throw new ApiRouteError(
      400,
      "validation_failed",
      "message_link evidence requires channelId, externalRef, messageId, and subjectUserId.",
    );
  }

  let parsedExternalRef: URL;
  try {
    parsedExternalRef = new URL(body.externalRef);
  } catch {
    throw new ApiRouteError(400, "validation_failed", "message_link externalRef must be a valid absolute URL.");
  }

  if (parsedExternalRef.origin !== "https://discord.com") {
    throw new ApiRouteError(
      400,
      "validation_failed",
      "message_link externalRef must use the canonical https://discord.com/channels/{guildId}/{channelId}/{messageId} form.",
    );
  }

  const [, channelsLiteral, guildId, channelId, messageId] = parsedExternalRef.pathname.split("/");
  if (
    channelsLiteral !== "channels"
    || guildId !== body.guildId
    || channelId !== body.channelId
    || messageId !== body.messageId
  ) {
    throw new ApiRouteError(
      400,
      "validation_failed",
      "message_link externalRef must match the submitted guildId, channelId, and messageId.",
    );
  }

  return {
    channelId: body.channelId,
    externalRef: body.externalRef,
    messageId: body.messageId,
    subjectUserId: body.subjectUserId,
  };
}

function resolveResponseStatus(set: { status?: unknown }, response: unknown) {
  if (response instanceof Response) {
    return response.status;
  }

  if (typeof set.status === "number") {
    return set.status;
  }

  if (typeof set.status === "string") {
    const parsed = Number.parseInt(set.status, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 200;
}

function logApiRequest(
  logger: LoggerLike,
  context: {
    identity: ReturnType<typeof loadServiceIdentityConfig>;
    request: Request;
    requestContext: RequestContext;
  },
  details: {
    error?: unknown;
    event: "http.request.completed" | "http.request.failed";
    responseStatus: number;
  },
) {
  const path = new URL(context.request.url).pathname;
  const logFields = details.error
    ? createStructuredErrorFields(
        {
          environment: context.identity.environment,
          release: context.identity.release,
          requestId: context.requestContext.requestId,
          serviceName: context.identity.serviceName,
          traceContext: context.requestContext.traceContext,
        },
        details.error,
        {
          event: details.event,
          method: context.request.method,
          path,
          requestHeaders: redactSensitiveHeaders(context.request.headers),
          responseStatus: details.responseStatus,
        },
      )
    : createStructuredLogFields(
        {
          environment: context.identity.environment,
          release: context.identity.release,
          requestId: context.requestContext.requestId,
          serviceName: context.identity.serviceName,
          traceContext: context.requestContext.traceContext,
        },
        {
          event: details.event,
          method: context.request.method,
          path,
          responseStatus: details.responseStatus,
        },
      );

  const output = JSON.stringify(logFields);
  if (details.error || details.responseStatus >= 500) {
    logger.error(output);
    return;
  }

  logger.info(output);
}

export function createApiApp(options: ApiAppOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const identity = loadServiceIdentityConfig(env, { serviceName: "@humanify/api-bun" });
  const advisoryServices = loadAdvisoryServiceConfig(env);
  const dataPlaneConfig = loadDataPlaneConfig(env);
  const discordOAuthConfig = loadDiscordOAuthConfig(env);
  const observability = loadObservabilityConfig(env);
  const policyClampConfig = loadPolicyClampConfig(env);
  const verificationOptionEnvironment = createApiVerificationOptionEnvironment({
    env,
    overrides: options.verificationOptionRuntimeOverrides,
  });
  const learningServiceClient = options.learningServiceClient ?? createLearningServiceClient({
    baseUrl: advisoryServices.learningServiceUrl,
  });
  const guildChannelConfigRepository =
    options.guildChannelConfigRepository ?? createPostgresGuildChannelConfigRepository({
      connectionString: dataPlaneConfig.postgresUrl,
    });
  const reportCasesRepository = options.reportCasesRepository ?? createPostgresReportCasesRepository({
    connectionString: dataPlaneConfig.postgresUrl,
  });
  const verificationSessionsRepository =
    options.verificationSessionsRepository ?? createPostgresVerificationSessionsRepository({
      connectionString: dataPlaneConfig.postgresUrl,
    });
  const sessionConfig = loadSessionConfig(env);
  const verificationProviderCatalog = resolveVerificationProviderCatalog({
    enabledProviderIds: parseVerificationProviderSelection(env.HUMANIFY_ENABLED_VERIFICATION_PROVIDERS),
  });
  const supportedHumanifyClaimIds = getSupportedHumanifyClaimIds();
  const telemetry = createTelemetryBootstrap({
    ...identity,
    sentryDsn: observability.sentryDsn,
    sentryTracesSampleRate: observability.sentryTracesSampleRate,
  });

  const policyBodySchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    allowAutoBan: t.Optional(t.Boolean()),
    banAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
    kickAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
    maxAutomaticAction: t.Optional(t.String({ minLength: 1 })),
    quarantineAtOrAbove: t.Number({ minimum: 1, maximum: 10 }),
    reason: t.Optional(t.String({ minLength: 1 })),
    suspiciousRoleIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
    timeoutAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
    trustedRoleIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
    verificationRequiredAtOrAbove: t.Number({ minimum: 1, maximum: 10 }),
  });

  const reportBodySchema = t.Object({
    intakeSource: t.String({ minLength: 1 }),
    openCase: t.Optional(t.Boolean()),
    reportReason: t.String({ minLength: 1 }),
    reporterNotes: t.Optional(t.String()),
    reporterUserId: t.String({ minLength: 1 }),
    subjectUserId: t.String({ minLength: 1 }),
    triggerFingerprint: t.String({ minLength: 1 }),
  });

  const moderationBodySchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    capabilityContext: t.Object({
      canBan: t.Boolean(),
      canKick: t.Boolean(),
      canManageRoles: t.Boolean(),
      canTimeout: t.Boolean(),
    }),
    caseContext: t.Object({
      appealOpen: t.Boolean(),
      existingOpenCase: t.Boolean(),
      verificationStatus: t.Union([t.Literal("unknown"), t.Literal("pending"), t.Literal("passed"), t.Literal("failed")]),
    }),
    caseId: t.String({ minLength: 1 }),
    requestedAction: t.Optional(t.String({ minLength: 1 })),
    riskDecision: t.Object({
      confidence: t.Number({ minimum: 0, maximum: 1 }),
      evidenceRefs: t.Array(t.String({ minLength: 1 })),
      recommendedAction: t.String({ minLength: 1 }),
      reasonCodes: t.Array(t.String({ minLength: 1 })),
      score: t.Number({ minimum: 1, maximum: 10 }),
    }),
    serverPolicy: t.Optional(
      t.Object({
        allowAutoBan: t.Optional(t.Boolean()),
        banAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        kickAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        maxAutomaticAction: t.Optional(t.String({ minLength: 1 })),
        quarantineAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        timeoutAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        verificationRequiredAtOrAbove: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
      }),
    ),
    subjectUserId: t.String({ minLength: 1 }),
  });

  const verificationSessionSchema = t.Object({
    caseId: t.Optional(t.String({ minLength: 1 })),
    initiatedBy: t.Optional(t.String({ minLength: 1 })),
    requiredCapabilities: t.Array(t.String({ minLength: 1 })),
    userId: t.String({ minLength: 1 }),
  });

  const verificationConfigSchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    defaultProviderId: t.Optional(t.String({ minLength: 1 })),
    enabledProviderIds: t.Array(t.String({ minLength: 1 })),
    suspiciousRoleIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
    trustedRoleIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
  });

  const channelConfigSchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    auditLogChannelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    moderationLogChannelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    moderatorAlertChannelId: t.String({ minLength: 1 }),
    reviewChannelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  });

  const evidenceSchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    captureSource: t.String({ minLength: 1 }),
    channelId: t.Optional(t.String({ minLength: 1 })),
    evidenceType: t.String({ minLength: 1 }),
    externalRef: t.Optional(t.String({ minLength: 1 })),
    messageId: t.Optional(t.String({ minLength: 1 })),
    messagePreview: t.Optional(t.String()),
    subjectUserId: t.Optional(t.String({ minLength: 1 })),
  });

  const caseReviewSchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    confidence: t.Number({ minimum: 0, maximum: 1 }),
    outcome: t.String({ minLength: 1 }),
    rationale: t.Optional(t.String()),
    reasonCodes: t.Array(t.String({ minLength: 1 })),
  });

  const appealSchema = t.Object({
    notes: t.Optional(t.String()),
    subjectUserId: t.String({ minLength: 1 }),
  });

  return new Elysia({ name: "@humanify/api-bun" })
    .derive(({ request, set }) => {
      set.headers["cache-control"] = "no-store";
      set.headers.pragma = "no-cache";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["x-content-type-options"] = "nosniff";

      return {
        requestContext: ensureResponseContext(request, set),
      };
    })
    .onError(({ code, error, request, set }) => {
      const requestContext = ensureResponseContext(request, set);
      const responseStatus =
        error instanceof ApiRouteError
          ? error.status
          : code === "VALIDATION"
            ? 400
            : 500;

      logApiRequest(logger, { identity, request, requestContext }, {
        error,
        event: "http.request.failed",
        responseStatus,
      });

      if (error instanceof ApiRouteError) {
        set.status = error.status;
        return buildErrorEnvelope(requestContext.requestId, error.errorCode, error.message, error.retryable);
      }

      if (code === "VALIDATION") {
        set.status = 400;
        return buildErrorEnvelope(
          requestContext.requestId,
          "validation_failed",
          "Request validation failed.",
          false,
        );
      }

      set.status = 500;
      return buildErrorEnvelope(
        requestContext.requestId,
        "internal_error",
        "Internal API error.",
        false,
      );
    })
    .onAfterResponse((context: any) => {
      logApiRequest(logger, { identity, request: context.request, requestContext: context.requestContext }, {
        event: "http.request.completed",
        responseStatus: resolveResponseStatus(context.set, undefined),
      });
    })
    .get("/", ({ requestContext }) =>
      buildEnvelope(requestContext.requestId, {
        docs: ["docs\\api.md", "docs\\observability-security.md"],
        routeGroups,
        service: "api-bun",
        status: "ok",
      }),
    )
    .get("/health", () => ({
      contractVersion: humanifyContractVersion,
      status: "ok",
    }))
    .get("/healthz", () => ({
      contractVersion: humanifyContractVersion,
      status: "ok",
    }))
    .get("/contracts/summary", () => getHumanifyContractSummary())
    .get("/contracts/schema", ({ requestContext }) => buildEnvelope(requestContext.requestId, humanifyContractsSchema))
    .get("/service-info", ({ requestContext }) => {
      const postgres = parsePostgresConnectionString(dataPlaneConfig.postgresUrl);

      return buildEnvelope(requestContext.requestId, {
        authorityModel: {
          advisoryServices: "rust",
          canonicalStore: "postgres",
          productAuthority: "bun",
          queueTransport: "redis-streams",
        },
        bot: {
          gatewayIntents: createBotGatewayIntents({
            includeInviteTracking: true,
            includeMessageSignals: true,
          }),
        },
        dataPlane: {
          configured: true,
          postgres: {
            database: postgres.database,
            hostname: postgres.hostname,
            redactedUrl: redactPostgresConnectionString(dataPlaneConfig.postgresUrl),
          },
          redis: redactUrlSecret(dataPlaneConfig.redisUrl),
        },
        oauth: summarizeConfigForLogs(discordOAuthConfig),
        observability: summarizeConfigForLogs(observability),
        routeGroups,
        sharedPackages: [
          "@humanify/auth",
          "@humanify/config",
          "@humanify/contracts",
          "@humanify/db",
          "@humanify/discord-core",
          "@humanify/policy-engine",
          "@humanify/queue",
          "@humanify/telemetry",
        ],
        telemetry,
      });
    })
    .group("/auth", (app) =>
      app
        .post(
          "/discord/start",
          ({ body, requestContext }) => {
            const state = issueDiscordOAuthState(
              {
                guildId: body.guildId,
                redirectTo: body.redirectTo,
                stateId: crypto.randomUUID(),
                userId: body.userId,
              },
              sessionConfig.sessionSecret,
              600,
              now(),
            );

            return buildEnvelope(requestContext.requestId, {
              authUrl: buildDiscordOAuthAuthorizeUrl({
                clientId: discordOAuthConfig.clientId,
                prompt: body.prompt,
                redirectUri: discordOAuthConfig.redirectUri,
                scopes: discordOAuthConfig.scopes,
                state,
              }),
              cookie: {
                name: sessionConfig.cookieName,
                options: createSessionCookieOptions({
                  sameSite: "lax",
                  secure: sessionConfig.secureCookies,
                  ttlSeconds: sessionConfig.sessionTtlSeconds,
                }),
              },
              flowStatus: "oauth_state_issued",
              state,
            });
          },
          {
            body: t.Object({
              guildId: t.String({ minLength: 1 }),
              prompt: t.Optional(t.Union([t.Literal("consent"), t.Literal("none")])),
              redirectTo: t.String({ minLength: 1 }),
              userId: t.String({ minLength: 1 }),
            }),
          },
        )
        .get(
          "/discord/callback",
          ({ query, requestContext, set }) => {
            const state = verifyDiscordOAuthState(query.state, sessionConfig.sessionSecret, now());
            set.status = 202;

            return buildEnvelope(requestContext.requestId, {
              callbackStatus: "state_verified_code_exchange_pending",
              cookie: {
                name: sessionConfig.cookieName,
                options: createSessionCookieOptions({
                  sameSite: "lax",
                  secure: sessionConfig.secureCookies,
                  ttlSeconds: sessionConfig.sessionTtlSeconds,
                }),
              },
              state: {
                guildId: state.guildId,
                redirectTo: state.redirectTo,
                userId: state.userId,
              },
            });
          },
          {
            query: t.Object({
              code: t.String({ minLength: 1 }),
              state: t.String({ minLength: 1 }),
            }),
          },
        )
        .post("/logout", ({ requestContext, set }) => {
          set.status = 202;
          return buildEnvelope(requestContext.requestId, {
            flowStatus: "logout_acknowledged_session_store_pending",
          });
        })
        .get("/session", () => {
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "Session persistence is not wired in api-domain-spine yet.",
            true,
          );
        }),
    )
    .group("/guilds/:guildId", (app) =>
      app
        .get("/policy", ({ params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);

          return buildEnvelope(requestContext.requestId, {
            guildId: params.guildId,
            policy: defaultServerPolicy(env),
            readModelStatus: "env_default_policy",
          });
        })
        .put("/policy", ({ body, params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          const maxAutomaticAction = body.maxAutomaticAction
            ? requireKnownAction(body.maxAutomaticAction, "maxAutomaticAction")
            : policyClampConfig.maxAutomaticAction;

          const artifacts = buildWriteArtifacts({
            aggregateId: params.guildId,
            aggregateType: "guild_policy",
            auditRefs: [createAuditRef(requestContext.requestId, "guild_policy", "update")],
            canonicalMutations: [
              {
                dataRef: `${params.guildId}:policy`,
                operation: "insert",
                primaryKey: "policy_version_id",
                table: "guild_policy_versions",
              },
              {
                dataRef: `${params.guildId}:audit`,
                operation: "insert",
                primaryKey: "audit_record_id",
                table: "audit_records",
              },
            ],
            idempotencyKey: request.headers.get("x-idempotency-key") ?? `guild-policy:${params.guildId}:${requestContext.requestId}`,
            kind: "guild.policy.updated",
            payload: {
              actorUserId: body.actorUserId,
              guildId: params.guildId,
              maxAutomaticAction,
              routeGroup: "guild-config",
            },
            requestContext,
            scope: `guild-policy:${params.guildId}`,
            stream: "projection.refresh",
            transactionName: "guild_policy_update",
          });

          set.status = 202;
          return buildEnvelope(requestContext.requestId, {
            persistence: "planned_not_persisted",
            policy: {
              ...body,
              guildId: params.guildId,
              maxAutomaticAction,
            },
            queueEnvelope: artifacts.queueEnvelope,
            writePlan: artifacts.writePlan,
          });
        }, { body: policyBodySchema })
        .put(
          "/verification",
          ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            let providerConfig: VerificationProviderConfiguration;
            try {
              providerConfig = resolveVerificationProviderConfiguration({
                availableCatalog: verificationProviderCatalog,
                defaultProviderId: body.defaultProviderId,
                enabledProviderIds: body.enabledProviderIds,
              });
            } catch (error) {
              throw new ApiRouteError(
                400,
                "validation_failed",
                error instanceof Error ? error.message : "Verification provider configuration is invalid.",
              );
            }
            const artifacts = buildWriteArtifacts({
              aggregateId: params.guildId,
              aggregateType: "verification_requirement",
              auditRefs: [createAuditRef(requestContext.requestId, "verification_requirement", "update")],
              canonicalMutations: [
                {
                  dataRef: `${params.guildId}:verification`,
                  operation: "insert",
                  primaryKey: "requirement_id",
                  table: "verification_requirements",
                },
                {
                  dataRef: `${params.guildId}:audit`,
                  operation: "insert",
                  primaryKey: "audit_record_id",
                  table: "audit_records",
                },
              ],
              idempotencyKey:
                request.headers.get("x-idempotency-key") ?? `verification-config:${params.guildId}:${requestContext.requestId}`,
              kind: "guild.verification.updated",
              payload: {
                actorUserId: body.actorUserId,
                defaultProviderId: providerConfig.defaultProviderId,
                enabledProviderIds: providerConfig.enabledProviderIds,
                guildId: params.guildId,
                suspiciousRoleIds: body.suspiciousRoleIds ?? [],
                trustedRoleIds: body.trustedRoleIds ?? [],
              },
              requestContext,
              scope: `guild-verification:${params.guildId}`,
              stream: "verification.events",
              transactionName: "guild_verification_update",
            });

            set.status = 202;
            return buildEnvelope(requestContext.requestId, {
              persistence: "planned_not_persisted",
              queueEnvelope: artifacts.queueEnvelope,
              verificationConfig: {
                availableProviderIds: providerConfig.availableProviderIds,
                defaultProviderId: providerConfig.defaultProviderId,
                enabledProviderIds: providerConfig.enabledProviderIds,
                fallbackRoles: body.trustedRoleIds ?? [],
                guildId: params.guildId,
                suspiciousRoleIds: body.suspiciousRoleIds ?? [],
              },
              writePlan: artifacts.writePlan,
            });
          },
          { body: verificationConfigSchema },
        )
        .put(
          "/channels",
          async ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            const channelConfig = {
              auditLogChannelId: body.auditLogChannelId ?? undefined,
              moderationLogChannelId: body.moderationLogChannelId ?? undefined,
              moderatorAlertChannelId: body.moderatorAlertChannelId,
              reviewChannelId: body.reviewChannelId ?? undefined,
            };
            const artifacts = buildWriteArtifacts({
              aggregateId: params.guildId,
              aggregateType: "guild_channel_config",
              auditRefs: [createAuditRef(requestContext.requestId, "guild_channel_config", "update")],
              canonicalMutations: [
                {
                  dataRef: `${params.guildId}:channels`,
                  operation: "insert",
                  primaryKey: "guild_id",
                  table: "guild_channel_configs",
                },
                {
                  dataRef: `${params.guildId}:audit`,
                  operation: "insert",
                  primaryKey: "audit_record_id",
                  table: "audit_records",
                },
              ],
              idempotencyKey:
                request.headers.get("x-idempotency-key") ?? `guild-channel-config:${params.guildId}:${requestContext.requestId}`,
              kind: "guild.channels.updated",
              payload: {
                actorUserId: body.actorUserId,
                auditLogChannelId: channelConfig.auditLogChannelId ?? null,
                guildId: params.guildId,
                moderationLogChannelId: channelConfig.moderationLogChannelId ?? null,
                moderatorAlertChannelId: channelConfig.moderatorAlertChannelId,
                reviewChannelId: channelConfig.reviewChannelId ?? null,
                routeGroup: "guild-config",
              },
              requestContext,
              requestFingerprint: JSON.stringify({
                auditLogChannelId: channelConfig.auditLogChannelId ?? null,
                moderationLogChannelId: channelConfig.moderationLogChannelId ?? null,
                moderatorAlertChannelId: channelConfig.moderatorAlertChannelId,
                reviewChannelId: channelConfig.reviewChannelId ?? null,
              }),
              scope: `guild-channel-config:${params.guildId}`,
              stream: "projection.refresh",
              transactionName: "guild_channel_config_update",
            });

            const persisted = await guildChannelConfigRepository.upsertConfig({
              artifacts: {
                idempotency: artifacts.idempotency,
                queueEnvelope: artifacts.queueEnvelope,
              },
              body: {
                actorUserId: body.actorUserId,
                ...channelConfig,
              },
              guildId: params.guildId,
              requestFingerprint: artifacts.requestFingerprint,
              traceId: requestContext.traceContext.traceId,
            });

            set.status = 200;
            return buildEnvelope(requestContext.requestId, persisted);
          },
          { body: channelConfigSchema },
        )
        .get("/cases", async ({ params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          const items = await reportCasesRepository.listCases({
            guildId: params.guildId,
          });

          return buildEnvelope(requestContext.requestId, {
            items,
            readModelStatus: "canonical_postgres",
            scope: { guildId: params.guildId },
            source: "canonical_postgres_cases",
          });
        })
        .get("/cases/:caseId", async ({ params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          const caseDetail = await reportCasesRepository.getCaseDetail({
            caseId: params.caseId,
            guildId: params.guildId,
          });

          if (!caseDetail) {
            throw new ApiRouteError(404, "not_found", `Case ${params.caseId} was not found in guild ${params.guildId}.`);
          }

          return buildEnvelope(requestContext.requestId, {
            ...caseDetail,
            readModelStatus: "canonical_postgres",
            scope: { caseId: params.caseId, guildId: params.guildId },
            source: "canonical_postgres_case_detail",
          });
        })
        .post(
          "/cases/:caseId/review",
          async ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            if (!isKnownValue(body.outcome, caseOutcomeKinds)) {
              throw new ApiRouteError(
                400,
                "validation_failed",
                `outcome must be one of: ${caseOutcomeKinds.join(", ")}.`,
              );
            }

            const artifacts = buildWriteArtifacts({
              aggregateId: params.caseId,
              aggregateType: "case",
              auditRefs: [createAuditRef(requestContext.requestId, "case", "review")],
              canonicalMutations: [
                {
                  dataRef: `${params.caseId}:event`,
                  operation: "insert",
                  primaryKey: "case_event_id",
                  table: "case_events",
                },
                {
                  dataRef: `${params.caseId}:outcome`,
                  operation: "insert",
                  primaryKey: "outcome_id",
                  table: "case_outcomes",
                },
              ],
              idempotencyKey: request.headers.get("x-idempotency-key") ?? `case-review:${params.caseId}:${requestContext.requestId}`,
              kind: "case.review.recorded",
              payload: {
                actorUserId: body.actorUserId,
                caseId: params.caseId,
                guildId: params.guildId,
                outcome: body.outcome,
              },
              requestContext,
              scope: `case-review:${params.caseId}`,
              stream: "learning.feedback",
              transactionName: "case_review_record",
            });

            let persisted: Awaited<ReturnType<typeof reportCasesRepository.recordCaseReview>>;
            try {
              persisted = await reportCasesRepository.recordCaseReview({
                artifacts: {
                  idempotency: {
                    key: artifacts.idempotency.key,
                    requestId: artifacts.idempotency.requestId,
                    scope: artifacts.idempotency.scope,
                  },
                  queueEnvelope: {
                    canonicalRef: artifacts.queueEnvelope.canonicalRef,
                    kind: artifacts.queueEnvelope.kind,
                    messageId: artifacts.queueEnvelope.messageId,
                    occurredAt: artifacts.queueEnvelope.occurredAt,
                    payload: artifacts.queueEnvelope.payload as Record<string, unknown>,
                    producer: {
                      serviceName: artifacts.queueEnvelope.producer.serviceName,
                    },
                    requestId: artifacts.queueEnvelope.requestId,
                    schemaVersion: artifacts.queueEnvelope.schemaVersion,
                    stream: artifacts.queueEnvelope.stream,
                    traceparent: artifacts.queueEnvelope.traceparent,
                  },
                },
                body: {
                  actorUserId: body.actorUserId,
                  confidence: body.confidence,
                  outcome: body.outcome,
                  rationale: body.rationale,
                  reasonCodes: body.reasonCodes,
                },
                caseId: params.caseId,
                guildId: params.guildId,
                traceId: requestContext.traceContext.traceId,
              });
            } catch (error) {
              if (error instanceof Error && error.message.includes("was not found")) {
                throw new ApiRouteError(404, "not_found", error.message);
              }

              throw error;
            }

            const learningCaseOutcome = {
              caseId: persisted.review.caseId,
              confidence: persisted.review.confidence,
              decidedAt: new Date(now()).toISOString(),
              decidedBy: persisted.review.actorUserId,
              evidenceRefs: persisted.review.evidenceRefs,
              guildId: persisted.review.guildId,
              outcome: persisted.review.outcome,
              reasonCodes: persisted.review.reasonCodes,
              subjectUserIdHash: await hashSubjectUserId(persisted.review.subjectUserId),
            } satisfies LearningServiceCaseOutcome;

            let learning = {
              accepted: false,
              appliedSignalCount: 0,
              candidateSignals: [],
              notes: ["Learning ingestion is pending retry from the canonical learning.feedback outbox event."],
              status: "no_reusable_signal",
              suppressedSignalCount: 0,
            } as Awaited<ReturnType<typeof reportCasesRepository.applyLearningOutcome>>;

            try {
              const learningSummary = await learningServiceClient.ingestCaseOutcome(
                learningCaseOutcome,
                requestContext,
              );
              learning = await reportCasesRepository.applyLearningOutcome({
                caseId: params.caseId,
                guildId: params.guildId,
                learningSummary: {
                  accepted: learningSummary.accepted,
                  candidateSignals: learningSummary.candidateSignals,
                  notes: learningSummary.notes,
                },
                outcome: body.outcome,
                outcomeId: persisted.review.outcomeId,
                reasonCodes: body.reasonCodes,
              });
            } catch (error) {
              logger.error(JSON.stringify(createStructuredErrorFields({
                environment: identity.environment,
                release: identity.release,
                requestId: requestContext.requestId,
                serviceName: identity.serviceName,
                traceContext: requestContext.traceContext,
              }, error, {
                caseId: params.caseId,
                event: "learning.ingest.degraded",
                guildId: params.guildId,
              })));
            }

            set.status = 201;
            return buildEnvelope(requestContext.requestId, {
              learning,
              persistence: persisted.persistence,
              queueDelivery: persisted.queueDelivery,
              queueEnvelope: artifacts.queueEnvelope,
              review: persisted.review,
            });
          },
          { body: caseReviewSchema },
        )
        .post(
          "/cases/:caseId/appeal",
          ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            const artifacts = buildWriteArtifacts({
              aggregateId: params.caseId,
              aggregateType: "appeal",
              auditRefs: [createAuditRef(requestContext.requestId, "appeal", "submit")],
              canonicalMutations: [
                {
                  dataRef: `${params.caseId}:appeal`,
                  operation: "insert",
                  primaryKey: "appeal_id",
                  table: "appeals",
                },
                {
                  dataRef: `${params.caseId}:event`,
                  operation: "insert",
                  primaryKey: "case_event_id",
                  table: "case_events",
                },
              ],
              idempotencyKey: request.headers.get("x-idempotency-key") ?? `appeal:${params.caseId}:${requestContext.requestId}`,
              kind: "case.appeal.submitted",
              payload: {
                caseId: params.caseId,
                guildId: params.guildId,
                subjectUserId: body.subjectUserId,
              },
              requestContext,
              scope: `case-appeal:${params.caseId}`,
              stream: "learning.feedback",
              transactionName: "case_appeal_submit",
            });

            set.status = 202;
            return buildEnvelope(requestContext.requestId, {
              appeal: {
                ...body,
                caseId: params.caseId,
                guildId: params.guildId,
                status: "submitted",
              },
              persistence: "planned_not_persisted",
              queueEnvelope: artifacts.queueEnvelope,
              writePlan: artifacts.writePlan,
            });
          },
          { body: appealSchema },
        )
        .post("/reports", async ({ body, params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          if (!isKnownValue(body.intakeSource, reportIntakeSources)) {
            throw new ApiRouteError(
              400,
              "validation_failed",
              `intakeSource must be one of: ${reportIntakeSources.join(", ")}.`,
            );
          }

          const reportId = crypto.randomUUID();
          const caseId = body.openCase === false ? undefined : crypto.randomUUID();
          const canonicalMutations = [
            {
              dataRef: `${reportId}:report`,
              operation: "insert" as const,
              primaryKey: "report_id",
              table: "reports",
            },
          ];

          if (caseId) {
            canonicalMutations.unshift({
              dataRef: `${caseId}:case`,
              operation: "insert",
              primaryKey: "case_id",
              table: "cases",
            });
            canonicalMutations.push({
              dataRef: `${reportId}:event`,
              operation: "insert",
              primaryKey: "case_event_id",
              table: "case_events",
            });
          }

          const artifacts = buildWriteArtifacts({
            aggregateId: caseId ?? reportId,
            aggregateType: caseId ? "case" : "report",
            auditRefs: [createAuditRef(requestContext.requestId, "report", "intake")],
            canonicalMutations,
            idempotencyKey:
              request.headers.get("x-idempotency-key") ?? `report:${params.guildId}:${body.triggerFingerprint}:${body.reporterUserId}`,
            kind: "report.received",
            payload: {
              caseId,
              guildId: params.guildId,
              reportId,
              subjectUserId: body.subjectUserId,
            },
            requestFingerprint: body.triggerFingerprint,
            requestContext,
            scope: `report-intake:${params.guildId}`,
            stream: "risk.ingest",
            transactionName: "report_intake",
          });

          const persisted = await reportCasesRepository.createReport({
            artifacts,
            body: {
              intakeSource: body.intakeSource,
              openCase: body.openCase !== false,
              reportReason: body.reportReason,
              reporterNotes: body.reporterNotes,
              reporterUserId: body.reporterUserId,
              subjectUserId: body.subjectUserId,
              triggerFingerprint: body.triggerFingerprint,
            },
            guildId: params.guildId,
            proposedCaseId: caseId,
            reportId,
            traceId: requestContext.traceContext.traceId,
          });

          set.status = 201;
          return buildEnvelope(requestContext.requestId, {
            ...persisted,
            queueEnvelope: artifacts.queueEnvelope,
            writePlan: artifacts.writePlan,
          });
        }, { body: reportBodySchema })
        .post(
          "/reports/:reportId/evidence",
          async ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            if (!isKnownValue(body.evidenceType, evidenceKinds)) {
              throw new ApiRouteError(
                400,
                "validation_failed",
                `evidenceType must be one of: ${evidenceKinds.join(", ")}.`,
              );
            }
            const canonicalEvidence = requireMessageLinkEvidence({
              ...body,
              guildId: params.guildId,
            });

            const evidenceId = crypto.randomUUID();
            const artifacts = buildWriteArtifacts({
              aggregateId: evidenceId,
              aggregateType: "evidence",
              auditRefs: [createAuditRef(requestContext.requestId, "evidence", "attach")],
              canonicalMutations: [
                {
                  dataRef: `${evidenceId}:evidence`,
                  operation: "insert",
                  primaryKey: "evidence_id",
                  table: "evidence_records",
                },
                {
                  dataRef: `${params.reportId}:event`,
                  operation: "insert",
                  primaryKey: "case_event_id",
                  table: "case_events",
                },
              ],
              idempotencyKey:
                request.headers.get("x-idempotency-key")
                  ?? `report-evidence:${params.reportId}:${body.evidenceType}:${canonicalEvidence.messageId}`,
              kind: "report.evidence.attached",
              payload: {
                evidenceId,
                guildId: params.guildId,
                reportId: params.reportId,
              },
              requestContext,
              scope: `report-evidence:${params.reportId}`,
              stream: "evidence.ingest",
              transactionName: "report_evidence_attach",
            });

            let persisted;
            try {
              persisted = await reportCasesRepository.attachMessageEvidence({
                artifacts,
                body: {
                  actorUserId: body.actorUserId,
                  captureSource: body.captureSource,
                  channelId: canonicalEvidence.channelId,
                  externalRef: canonicalEvidence.externalRef,
                  messageId: canonicalEvidence.messageId,
                  messagePreview: body.messagePreview,
                  subjectUserId: canonicalEvidence.subjectUserId,
                },
                evidenceId,
                guildId: params.guildId,
                reportId: params.reportId,
                requestFingerprint: canonicalEvidence.messageId,
                traceId: requestContext.traceContext.traceId,
              });
            } catch (error) {
              if (error instanceof Error && error.message.includes("was not found")) {
                throw new ApiRouteError(404, "not_found", error.message);
              }

              throw error;
            }

            set.status = 201;
            return buildEnvelope(requestContext.requestId, {
              ...persisted,
              queueEnvelope: artifacts.queueEnvelope,
              writePlan: artifacts.writePlan,
            });
          },
          { body: evidenceSchema },
        )
        .post("/evidence/upload-url", ({ request, set }) => {
          ensureResponseContext(request, set);
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "Evidence upload brokering needs the storage todo before presigned URL issuance is safe.",
            true,
          );
        })
        .post(
          "/evidence/:evidenceId/redact",
          ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            const artifacts = buildWriteArtifacts({
              aggregateId: params.evidenceId,
              aggregateType: "evidence",
              auditRefs: [createAuditRef(requestContext.requestId, "evidence", "redact")],
              canonicalMutations: [
                {
                  dataRef: `${params.evidenceId}:derivative`,
                  operation: "insert",
                  primaryKey: "derivative_id",
                  table: "blob_derivatives",
                },
                {
                  dataRef: `${params.evidenceId}:audit`,
                  operation: "insert",
                  primaryKey: "audit_record_id",
                  table: "audit_records",
                },
              ],
              idempotencyKey:
                request.headers.get("x-idempotency-key") ?? `evidence-redact:${params.evidenceId}:${requestContext.requestId}`,
              kind: "evidence.redaction.requested",
              payload: {
                actorUserId: body.actorUserId,
                evidenceId: params.evidenceId,
                guildId: params.guildId,
              },
              requestContext,
              scope: `evidence-redact:${params.evidenceId}`,
              stream: "evidence.ingest",
              transactionName: "evidence_redaction_request",
            });

            set.status = 202;
            return buildEnvelope(requestContext.requestId, {
              persistence: "planned_not_persisted",
              queueEnvelope: artifacts.queueEnvelope,
              redactionRequest: {
                actorUserId: body.actorUserId,
                evidenceId: params.evidenceId,
                guildId: params.guildId,
              },
              writePlan: artifacts.writePlan,
            });
          },
          {
            body: t.Object({
              actorUserId: t.String({ minLength: 1 }),
            }),
          },
        )
        .post("/verification/sessions", async ({ body, params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          const sessionId = crypto.randomUUID();
          const challengeId = crypto.randomUUID();
          const challengeExpiresAt = new Date(now() + 300_000).toISOString();
          const challengeToken = issueVerifierChallengeToken(
            {
              challengeId,
              guildId: params.guildId,
              requiredCapabilities: body.requiredCapabilities,
              sessionId,
              userId: body.userId,
            },
            sessionConfig.sessionSecret,
            300,
            now(),
          );
          await verificationSessionsRepository.createSession({
            challengeExpiresAt,
            challengeId,
            guildId: params.guildId,
            initiatedBy: body.initiatedBy ?? "system",
            requiredCapabilities: body.requiredCapabilities,
            sessionId,
            userId: body.userId,
          });
          const artifacts = buildWriteArtifacts({
            aggregateId: sessionId,
            aggregateType: "verification_session",
            auditRefs: [createAuditRef(requestContext.requestId, "verification_session", "create")],
            canonicalMutations: [
              {
                dataRef: `${sessionId}:session`,
                operation: "insert",
                primaryKey: "session_id",
                table: "verification_sessions",
              },
              {
                dataRef: `${sessionId}:receipt`,
                operation: "insert",
                primaryKey: "idempotency_receipt_id",
                table: "idempotency_receipts",
              },
            ],
            idempotencyKey:
              request.headers.get("x-idempotency-key") ?? `verification-session:${params.guildId}:${body.userId}`,
            kind: "verification.session.created",
            payload: {
              guildId: params.guildId,
              caseId: body.caseId,
              requiredCapabilities: body.requiredCapabilities,
              sessionId,
              userId: body.userId,
            },
            requestContext,
            scope: `verification-session:${params.guildId}`,
            stream: "verification.events",
            transactionName: "verification_session_create",
          });

          set.status = 201;
          return buildEnvelope(requestContext.requestId, {
            challengeToken,
            persistence: "persisted",
            queueEnvelope: artifacts.queueEnvelope,
              session: {
                caseId: body.caseId,
                challengeId,
                challengeExpiresAt,
                guildId: params.guildId,
                initiatedBy: body.initiatedBy ?? "system",
                requiredCapabilities: body.requiredCapabilities,
                sessionId,
              state: "challenge_issued",
              userId: body.userId,
            },
            writePlan: artifacts.writePlan,
          });
        }, { body: verificationSessionSchema })
        .get("/audit", ({ params, request, set }) =>
          buildReadModelPendingEnvelope(ensureResponseContext(request, set), "audit", { guildId: params.guildId }),
        )
        .get("/risk-queue", async ({ params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          const items = await reportCasesRepository.listRiskQueue({
            guildId: params.guildId,
          });
          return buildEnvelope(requestContext.requestId, {
            items,
            readModelStatus: "canonical_postgres",
            scope: { guildId: params.guildId },
            source: "risk_queue_canonical",
          });
        })
        .get("/users/:userId/profile", ({ request, set }) => {
          ensureResponseContext(request, set);
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "User profile projections are pending Electric-backed read models.",
            true,
          );
        })
        .group("/moderation", (moderationApp) => {
          const moderationHandler =
            (fixedAction?: HumanifyAction) =>
            (context: any) => {
              const { body, params, request, set } = context;
              const requestContext = ensureResponseContext(request, set);
              const requestedAction = fixedAction ?? requireKnownAction(body.requestedAction ?? "", "requestedAction");
              const riskDecision: PolicyRiskDecision = {
                confidence: body.riskDecision.confidence,
                evidenceRefs: body.riskDecision.evidenceRefs,
                guildId: params.guildId,
                recommendedAction: requireKnownAction(body.riskDecision.recommendedAction, "riskDecision.recommendedAction"),
                reasonCodes: body.riskDecision.reasonCodes,
                score: body.riskDecision.score,
                userId: body.subjectUserId,
              };
              const capabilityContext: CapabilityContext = body.capabilityContext;
              const caseContext: CaseContext = body.caseContext;
              const serverPolicy = mergeServerPolicy(env, body.serverPolicy);
              const policyDecision = evaluatePolicy({
                capabilityContext,
                caseContext,
                riskDecision,
                serverPolicy,
              });

              if (policyDecision.allowedAction !== requestedAction) {
                throw new ApiRouteError(
                  403,
                  "forbidden",
                  `Requested moderation action ${requestedAction} is not allowed after Bun policy evaluation (${policyDecision.blockedReasons.join(", ")}).`,
                );
              }

              const executionPlan = resolveDiscordExecutionPlan(policyDecision.allowedAction, capabilityContext);
              const auditReason = createDiscordAuditReason({
                action: policyDecision.allowedAction,
                caseId: body.caseId,
                reasonCodes: riskDecision.reasonCodes,
                requestId: requestContext.requestId,
              });
              const artifacts = buildWriteArtifacts({
                aggregateId: body.caseId,
                aggregateType: "moderation_action",
                auditRefs: [createAuditRef(requestContext.requestId, "moderation", requestedAction)],
                canonicalMutations: [
                  {
                    dataRef: `${body.caseId}:recommendation`,
                    operation: "insert",
                    primaryKey: "recommendation_id",
                    table: "action_recommendations",
                  },
                  {
                    dataRef: `${body.caseId}:execution`,
                    operation: "insert",
                    primaryKey: "action_execution_receipt_id",
                    table: "action_execution_receipts",
                  },
                  {
                    dataRef: `${body.caseId}:audit`,
                    operation: "insert",
                    primaryKey: "audit_record_id",
                    table: "audit_records",
                  },
                ],
                idempotencyKey:
                  request.headers.get("x-idempotency-key") ?? `moderation:${requestedAction}:${body.caseId}:${requestContext.requestId}`,
                kind: `moderation.${requestedAction}.approved`,
                payload: {
                  action: requestedAction,
                  caseId: body.caseId,
                  guildId: params.guildId,
                  subjectUserId: body.subjectUserId,
                },
                requestContext,
                scope: `moderation:${body.caseId}`,
                stream: "policy.actions",
                transactionName: `moderation_${requestedAction}_approve`,
              });

              set.status = 202;
              return buildEnvelope(requestContext.requestId, {
                auditReason,
                durability: "planned_not_persisted",
                executionPlan,
                executorState: executionPlan.executable
                  ? "approved_but_backend_commit_pending"
                  : "approved_but_execution_blocked",
                policyDecision,
                queueEnvelope: artifacts.queueEnvelope,
                writePlan: artifacts.writePlan,
              });
            };

          return moderationApp
            .post("/approve", moderationHandler(), { body: moderationBodySchema })
            .post("/quarantine", moderationHandler("quarantine"), { body: moderationBodySchema })
            .post("/timeout", moderationHandler("timeout"), { body: moderationBodySchema })
            .post("/kick", moderationHandler("kick"), { body: moderationBodySchema })
            .post("/ban", moderationHandler("ban"), { body: moderationBodySchema });
        }),
    )
    .post(
      "/verification/challenges/:challengeId/complete",
      async ({ body, params, request, requestContext, set }) => {
        const verified = verifyVerifierChallengeToken(body.token, sessionConfig.sessionSecret, now());
        const providerId = requireKnownVerificationProvider(body.providerId, "providerId", verificationProviderCatalog.ids());
        const providerDefinition = verificationProviderCatalog.require(providerId);
        const optionRuntime = getApiVerificationOptionRuntime(providerId);
        const requestedClaims = requireKnownHumanifyClaims(body.requestedClaims, "requestedClaims", supportedHumanifyClaimIds);
        const providerFlowConfigured = optionRuntime.isConfigured(verificationOptionEnvironment);
        const providerStartToken = providerDefinition.role === "reusable_proof_backend"
          ? issueReusableProofStartToken(
            {
              challengeId: params.challengeId,
              guildId: body.guildId,
              providerId,
              requiredCapabilities: verified.requiredCapabilities,
              requestedClaims,
              sessionId: body.sessionId,
              userId: body.userId,
            },
            sessionConfig.sessionSecret,
            900,
            now(),
          )
          : undefined;

        if (!verificationProviderSupportsClaims(providerDefinition, requestedClaims)) {
          throw new ApiRouteError(
            400,
            "validation_failed",
            `providerId "${providerId}" does not support the requestedClaims set.`,
          );
        }

        if (verified.challengeId !== params.challengeId) {
          throw new ApiRouteError(400, "validation_failed", "Challenge token does not match the requested challengeId.");
        }

        if (verified.sessionId !== body.sessionId) {
          throw new ApiRouteError(400, "validation_failed", "Challenge token does not match the requested sessionId.");
        }

        if (verified.guildId !== body.guildId) {
          throw new ApiRouteError(400, "validation_failed", "Challenge token does not match the requested guildId.");
        }

        if (verified.userId !== body.userId) {
          throw new ApiRouteError(400, "validation_failed", "Challenge token does not match the requested userId.");
        }

        if (optionRuntime.completeChallenge) {
          const updatedSession = await optionRuntime.completeChallenge({
            challengeId: params.challengeId,
            provider: providerDefinition,
            requestedClaims,
            requiredCapabilities: verified.requiredCapabilities,
            runtimeEnvironment: verificationOptionEnvironment,
            sessionId: body.sessionId,
            token: body.token,
            verificationSessionsRepository,
          });
          set.status = 201;
          return buildEnvelope(requestContext.requestId, {
            challenge: {
              challengeId: params.challengeId,
              guildId: body.guildId,
              sessionId: body.sessionId,
              userId: body.userId,
              verified: true,
            },
            persistence: "persisted",
            providerBoundary: {
              ...buildProviderBoundaryFromRecord(updatedSession, verificationProviderCatalog),
              requiredCapabilities: verified.requiredCapabilities,
            },
            session: buildVerificationSessionFromRecord(updatedSession),
          });
        }

        const artifacts = buildWriteArtifacts({
          aggregateId: body.sessionId,
          aggregateType: "verification_session",
          auditRefs: [createAuditRef(requestContext.requestId, "verification_session", "complete_challenge")],
          canonicalMutations: [
            {
              dataRef: `${body.sessionId}:session`,
              operation: "update",
              primaryKey: "session_id",
              table: "verification_sessions",
            },
          ],
          idempotencyKey:
            request.headers.get("x-idempotency-key") ?? `verification-challenge:${params.challengeId}:${requestContext.requestId}`,
          kind: "verification.challenge.completed",
          payload: {
            challengeId: params.challengeId,
            guildId: body.guildId,
            providerId,
            requestedClaims,
            sessionId: body.sessionId,
            userId: body.userId,
          },
          requestContext,
          scope: `verification-challenge:${params.challengeId}`,
          stream: "verification.events",
          transactionName: "verification_challenge_complete",
        });

        set.status = 202;
        return buildEnvelope(requestContext.requestId, {
          challenge: {
            challengeId: params.challengeId,
            guildId: body.guildId,
            sessionId: body.sessionId,
            userId: body.userId,
            verified: true,
          },
          persistence: "planned_not_persisted",
          providerBoundary: {
            handoffKind: providerDefinition.integration.handoffKind,
            nextStep: providerDefinition.integration.completionMode,
            providerFlowConfigured,
            providerServerEndpoint: providerDefinition.integration.serverEndpointPath,
            providerStartEndpoint: providerStartToken
              ? buildReusableProofProviderStartEndpoint(body.sessionId, providerId)
              : undefined,
            providerStartToken,
            releaseEligible: false,
            requestedClaims,
            requiredCapabilities: verified.requiredCapabilities,
            selectedProvider: providerId,
            serverVerificationNote: providerDefinition.integration.serverVerificationNote,
            status: "pending_provider_verification",
          },
          queueEnvelope: artifacts.queueEnvelope,
          session: buildDerivedVerificationSession(verified, "provider_pending"),
          writePlan: artifacts.writePlan,
        });
      },
      {
        body: t.Object({
          guildId: t.String({ minLength: 1 }),
          providerId: t.String({ minLength: 1 }),
          requestedClaims: t.Array(t.String({ minLength: 1 })),
          sessionId: t.String({ minLength: 1 }),
          token: t.String({ minLength: 1 }),
          userId: t.String({ minLength: 1 }),
        }),
      },
    )
    .post(
      "/verification/sessions/:sessionId/providers/:providerId/start",
      async ({ body, params, requestContext, set }) => {
        const verifiedStart = verifyReusableProofStartToken(body.providerStartToken, sessionConfig.sessionSecret, now());
        const providerId = requireKnownVerificationProvider(params.providerId, "providerId", verificationProviderCatalog.ids());
        const providerDefinition = verificationProviderCatalog.require(providerId);
        const optionRuntime = getApiVerificationOptionRuntime(providerId);
        const backUrl = requireAbsoluteRequestUrl(body.backUrl, "backUrl");
        const finishUrl = requireAbsoluteRequestUrl(body.finishUrl, "finishUrl");

        if (verifiedStart.sessionId !== params.sessionId) {
          throw new ApiRouteError(400, "validation_failed", "Reusable-proof start token does not match the requested sessionId.");
        }

        if (verifiedStart.providerId !== providerId) {
          throw new ApiRouteError(400, "validation_failed", "Reusable-proof start token does not match the requested providerId.");
        }

        if (providerDefinition.role !== "reusable_proof_backend") {
          throw new ApiRouteError(400, "validation_failed", `providerId "${providerId}" is not a reusable-proof backend.`);
        }

        if (!optionRuntime.startReusableProof) {
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            `Reusable-proof start for "${providerId}" is not configured in this Humanify environment.`,
            true,
          );
        }

        const requestedClaims = requireKnownHumanifyClaims(
          verifiedStart.requestedClaims,
          "providerStartToken.requestedClaims",
          supportedHumanifyClaimIds,
        );
        const runtimeResult = await optionRuntime.startReusableProof({
          backUrl,
          challengeId: verifiedStart.challengeId,
          finishUrl,
          guildId: verifiedStart.guildId,
          now,
          provider: providerDefinition,
          providerStartToken: body.providerStartToken,
          requestContext,
          requiredCapabilities: verifiedStart.requiredCapabilities,
          requestedClaims,
          runtimeEnvironment: verificationOptionEnvironment,
          sessionConfig,
          sessionId: verifiedStart.sessionId,
          userId: verifiedStart.userId,
        });

        set.status = 202;
        return buildEnvelope(requestContext.requestId, {
          flow: runtimeResult.flow,
          persistence: "provider_request_created",
          providerBoundary: runtimeResult.boundary,
          session: {
            challengeExpiresAt: new Date(verifiedStart.exp * 1_000).toISOString(),
            challengeId: verifiedStart.challengeId,
            guildId: verifiedStart.guildId,
            releaseEligible: false,
            requiredCapabilities: verifiedStart.requiredCapabilities,
            sessionId: verifiedStart.sessionId,
            source: "signed_reusable_proof_start_token",
            state: "provider_pending",
            userId: verifiedStart.userId,
          },
        });
      },
      {
        body: t.Object({
          backUrl: t.Optional(t.String({ minLength: 1 })),
          finishUrl: t.Optional(t.String({ minLength: 1 })),
          providerStartToken: t.String({ minLength: 1 }),
        }),
      },
    )
    .get(
      "/verification/sessions/:sessionId",
      async ({ params, query, requestContext }) => {
        const verified = verifyVerifierChallengeToken(query.token, sessionConfig.sessionSecret, now());

        if (verified.sessionId !== params.sessionId) {
          throw new ApiRouteError(400, "validation_failed", "Challenge token does not match the requested sessionId.");
        }

        const persistedSession = await verificationSessionsRepository.getSession(params.sessionId);
          if (persistedSession) {
            return buildEnvelope(requestContext.requestId, {
              providerBoundary: buildProviderBoundaryFromRecord(persistedSession, verificationProviderCatalog),
              persistence: "persisted",
              reusableCredentialBridge: readReusableCredentialBridgeFromRecord(persistedSession),
              session: buildVerificationSessionFromRecord(persistedSession),
            verification: readVerificationSummaryFromRecord(persistedSession),
          });
        }

        return buildEnvelope(requestContext.requestId, {
          providerBoundary: {
            nextStep: "complete_challenge",
            providerFlowConfigured: false,
            releaseEligible: false,
            status: "challenge_link_verified",
          },
          persistence: "derived_from_signed_challenge",
          session: buildDerivedVerificationSession(verified, "challenge_issued"),
        });
      },
      {
        query: t.Object({
          token: t.String({ minLength: 1 }),
        }),
      },
    )
    .post(
      "/verification/providers/:providerId/proof",
      async ({ body, params, requestContext, set }) => {
        const verifiedSession = verifyReusableProofSessionToken(body.providerSessionToken, sessionConfig.sessionSecret, now());
        const providerId = requireKnownVerificationProvider(params.providerId, "providerId", verificationProviderCatalog.ids());
        const providerDefinition = verificationProviderCatalog.require(providerId);
        const optionRuntime = getApiVerificationOptionRuntime(providerId);

        if (verifiedSession.providerId !== providerId) {
          throw new ApiRouteError(400, "validation_failed", "Reusable-proof session token does not match the requested providerId.");
        }

        if (providerDefinition.role !== "reusable_proof_backend") {
          throw new ApiRouteError(400, "validation_failed", `providerId "${providerId}" is not a reusable-proof backend.`);
        }

        if (!optionRuntime.verifyReusableProof) {
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            `Reusable-proof verification for "${providerId}" is not configured in this Humanify environment.`,
            true,
          );
        }

        const requestedClaims = requireKnownHumanifyClaims(
          verifiedSession.requestedClaims,
          "providerSessionToken.requestedClaims",
          supportedHumanifyClaimIds,
        );
        const runtimeResult = await optionRuntime.verifyReusableProof({
          now,
          provider: providerDefinition,
          providerSessionId: verifiedSession.providerSessionId,
          providerSessionToken: body.providerSessionToken,
          requestContext,
          requiredCapabilities: verifiedSession.requiredCapabilities,
          requestedClaims,
          runtimeEnvironment: verificationOptionEnvironment,
          sessionId: verifiedSession.sessionId,
          verificationSessionsRepository,
        });

        set.status = 200;
        return buildEnvelope(requestContext.requestId, {
          persistence: "persisted",
          providerBoundary: {
            ...buildProviderBoundaryFromRecord(runtimeResult.updatedSession, verificationProviderCatalog),
            providerFlowConfigured: true,
            providerSessionToken: body.providerSessionToken,
            requiredCapabilities: verifiedSession.requiredCapabilities,
          },
          session: buildVerificationSessionFromRecord(runtimeResult.updatedSession),
          verification: {
            ...readVerificationSummaryFromRecord(runtimeResult.updatedSession),
            proofReceipt: runtimeResult.normalizedResult.evidence,
            providerId,
            providerSessionId: verifiedSession.providerSessionId,
            status: runtimeResult.normalizedResult.status,
          },
        });
      },
      {
        body: t.Object({
          providerSessionToken: t.String({ minLength: 1 }),
        }),
      },
    )
    .post(
      "/verification/sessions/:sessionId/release",
      ({ body, params }) => {
        const verified = verifyVerifierChallengeToken(body.token, sessionConfig.sessionSecret, now());

        if (verified.sessionId !== params.sessionId || verified.guildId !== body.guildId || verified.userId !== body.userId) {
          throw new ApiRouteError(400, "validation_failed", "Release request must match the signed verification challenge.");
        }

        throw new ApiRouteError(
          409,
          "conflict",
          "Verification release stays blocked until Humanify verifies the selected provider handoff against canonical state.",
        );
      },
      {
        body: t.Object({
          guildId: t.String({ minLength: 1 }),
          token: t.String({ minLength: 1 }),
          userId: t.String({ minLength: 1 }),
        }),
      },
    )
    .group("/callbacks", (app) =>
      app
        .post("/discord/interactions", () => {
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "Discord interaction signature verification will land with the bot executor and callback wiring todos.",
            true,
          );
        })
        .post("/providers/:providerId", async ({ params, request, requestContext, set }) => {
          const providerId = requireKnownVerificationProvider(params.providerId, "providerId", verificationProviderCatalog.ids());
          const providerDefinition = verificationProviderCatalog.require(providerId);
          const optionRuntime = getApiVerificationOptionRuntime(providerId);

          if (!optionRuntime.handleCallback) {
            throw new ApiRouteError(
              503,
              "dependency_unavailable",
              `Provider callbacks for "${providerId}" are not configured in this Humanify environment.`,
              true,
            );
          }

          const rawBody = await request.text();
          const updatedSession = await optionRuntime.handleCallback({
            now,
            provider: providerDefinition,
            rawBody,
            requestContext,
            requestHeaders: request.headers,
            runtimeEnvironment: verificationOptionEnvironment,
            verificationSessionsRepository,
          });

          set.status = 200;
          return buildEnvelope(requestContext.requestId, {
            persistence: "persisted",
            providerBoundary: buildProviderBoundaryFromRecord(updatedSession, verificationProviderCatalog),
            reusableCredentialBridge: readReusableCredentialBridgeFromRecord(updatedSession),
            session: buildVerificationSessionFromRecord(updatedSession),
            verification: updatedSession.resultSummary,
          });
        }),
    );
}

export type HumanifyApiApp = ReturnType<typeof createApiApp>;
