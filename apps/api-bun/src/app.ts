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
  issueVerifierChallengeToken,
  verifyDiscordOAuthState,
  verifyVerifierChallengeToken,
} from "@humanify/auth";
import {
  loadDataPlaneConfig,
  loadDiscordOAuthConfig,
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
  createIdempotencyReceipt,
  createOutboxEvent,
  parsePostgresConnectionString,
  planCanonicalWrite,
  redactPostgresConnectionString,
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
  createStructuredLogFields,
  createTelemetryBootstrap,
  createTraceContext,
  extractTraceContext,
  formatTraceParent,
  type TraceContext,
} from "@humanify/telemetry";

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

type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_failed"
  | "conflict"
  | "not_found"
  | "rate_limited"
  | "provider_callback_invalid"
  | "dependency_unavailable"
  | "internal_error";

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

export type ApiAppOptions = {
  env?: EnvSource;
  now?: () => number;
};

class ApiRouteError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: ApiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiRouteError";
  }
}

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

function buildEnvelope<TData>(requestId: string, data: TData): ApiEnvelope<TData> {
  return {
    contractVersion: humanifyContractVersion,
    data,
    requestId,
  };
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
  const requestId = getHeaderRecordValue(set.headers, "x-request-id") ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
  const incomingTrace = extractTraceContext(request.headers);
  const traceContext = incomingTrace ?? createTraceContext();

  set.headers["x-request-id"] = requestId;
  set.headers.traceparent = formatTraceParent(traceContext);

  return {
    requestId,
    traceContext,
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

export function createApiApp(options: ApiAppOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const identity = loadServiceIdentityConfig(env, { serviceName: "@humanify/api-bun" });
  const telemetry = createTelemetryBootstrap(identity);

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
    initiatedBy: t.Optional(t.String({ minLength: 1 })),
    requiredCapabilities: t.Array(t.String({ minLength: 1 })),
    userId: t.String({ minLength: 1 }),
  });

  const evidenceSchema = t.Object({
    actorUserId: t.String({ minLength: 1 }),
    captureSource: t.String({ minLength: 1 }),
    evidenceType: t.String({ minLength: 1 }),
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
    .derive(({ request, set }) => ({
      requestContext: ensureResponseContext(request, set),
    }))
    .onError(({ code, error, request, set }) => {
      const requestContext = ensureResponseContext(request, set);

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
        identity.environment === "production" ? "Internal API error." : (error instanceof Error ? error.message : String(error)),
        false,
      );
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
      let dataPlaneSummary: Record<string, unknown>;

      try {
        const dataPlane = loadDataPlaneConfig(env);
        const postgres = parsePostgresConnectionString(dataPlane.postgresUrl);

        dataPlaneSummary = {
          configured: true,
          postgres: {
            database: postgres.database,
            hostname: postgres.hostname,
            redactedUrl: redactPostgresConnectionString(dataPlane.postgresUrl),
          },
          redis: redactUrlSecret(dataPlane.redisUrl),
        };
      } catch {
        dataPlaneSummary = { configured: false };
      }

      let oauthSummary: Record<string, unknown>;
      try {
        oauthSummary = summarizeConfigForLogs(loadDiscordOAuthConfig(env));
      } catch {
        oauthSummary = { configured: false };
      }

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
        dataPlane: dataPlaneSummary,
        oauth: oauthSummary,
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
            const oauth = loadDiscordOAuthConfig(env);
            const session = loadSessionConfig(env);
            const state = issueDiscordOAuthState(
              {
                guildId: body.guildId,
                redirectTo: body.redirectTo,
                stateId: crypto.randomUUID(),
                userId: body.userId,
              },
              session.sessionSecret,
              600,
              now(),
            );

            return buildEnvelope(requestContext.requestId, {
              authUrl: buildDiscordOAuthAuthorizeUrl({
                clientId: oauth.clientId,
                prompt: body.prompt,
                redirectUri: oauth.redirectUri,
                scopes: oauth.scopes,
                state,
              }),
              cookie: {
                name: session.cookieName,
                options: createSessionCookieOptions({
                  sameSite: "lax",
                  secure: session.secureCookies,
                  ttlSeconds: session.sessionTtlSeconds,
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
            const session = loadSessionConfig(env);
            const state = verifyDiscordOAuthState(query.state, session.sessionSecret, now());
            set.status = 202;

            return buildEnvelope(requestContext.requestId, {
              callbackStatus: "state_verified_code_exchange_pending",
              cookie: {
                name: session.cookieName,
                options: createSessionCookieOptions({
                  sameSite: "lax",
                  secure: session.secureCookies,
                  ttlSeconds: session.sessionTtlSeconds,
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
            : loadPolicyClampConfig(env).maxAutomaticAction;

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
                guildId: params.guildId,
                requiredCapabilities: body.suspiciousRoleIds ?? [],
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
                fallbackRoles: body.trustedRoleIds ?? [],
                guildId: params.guildId,
                suspiciousRoleIds: body.suspiciousRoleIds ?? [],
              },
              writePlan: artifacts.writePlan,
            });
          },
          { body: policyBodySchema },
        )
        .put("/channels", ({ request, set }) => {
          ensureResponseContext(request, set);
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "Channel configuration persistence is pending the dashboard and bot executor todos.",
            true,
          );
        })
        .get("/cases", ({ params, request, set }) =>
          buildReadModelPendingEnvelope(ensureResponseContext(request, set), "cases", { guildId: params.guildId }),
        )
        .get("/cases/:caseId", ({ request, set }) => {
          ensureResponseContext(request, set);
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "Case detail reads will land once Postgres-backed projections are materialized.",
            true,
          );
        })
        .post(
          "/cases/:caseId/review",
          ({ body, params, request, set }) => {
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

            set.status = 202;
            return buildEnvelope(requestContext.requestId, {
              persistence: "planned_not_persisted",
              queueEnvelope: artifacts.queueEnvelope,
              review: {
                ...body,
                caseId: params.caseId,
                guildId: params.guildId,
              },
              writePlan: artifacts.writePlan,
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
        .post("/reports", ({ body, params, request, set }) => {
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
            {
              dataRef: `${reportId}:event`,
              operation: "insert" as const,
              primaryKey: "case_event_id",
              table: "case_events",
            },
          ];

          if (caseId) {
            canonicalMutations.unshift({
              dataRef: `${caseId}:case`,
              operation: "insert",
              primaryKey: "case_id",
              table: "cases",
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

          set.status = 202;
          return buildEnvelope(requestContext.requestId, {
            persistence: "planned_not_persisted",
            queueEnvelope: artifacts.queueEnvelope,
            report: {
              ...body,
              caseId,
              guildId: params.guildId,
              reportId,
            },
            writePlan: artifacts.writePlan,
          });
        }, { body: reportBodySchema })
        .post(
          "/reports/:reportId/evidence",
          ({ body, params, request, set }) => {
            const requestContext = ensureResponseContext(request, set);
            if (!isKnownValue(body.evidenceType, evidenceKinds)) {
              throw new ApiRouteError(
                400,
                "validation_failed",
                `evidenceType must be one of: ${evidenceKinds.join(", ")}.`,
              );
            }

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
                request.headers.get("x-idempotency-key") ?? `report-evidence:${params.reportId}:${requestContext.requestId}`,
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

            set.status = 202;
            return buildEnvelope(requestContext.requestId, {
              evidence: {
                ...body,
                evidenceId,
                guildId: params.guildId,
                reportId: params.reportId,
              },
              persistence: "planned_not_persisted",
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
        .post("/verification/sessions", ({ body, params, request, set }) => {
          const requestContext = ensureResponseContext(request, set);
          const session = loadSessionConfig(env);
          const sessionId = crypto.randomUUID();
          const challengeId = crypto.randomUUID();
          const challengeToken = issueVerifierChallengeToken(
            {
              challengeId,
              guildId: params.guildId,
              sessionId,
              userId: body.userId,
            },
            session.sessionSecret,
            300,
            now(),
          );
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
              requiredCapabilities: body.requiredCapabilities,
              sessionId,
              userId: body.userId,
            },
            requestContext,
            scope: `verification-session:${params.guildId}`,
            stream: "verification.events",
            transactionName: "verification_session_create",
          });

          set.status = 202;
          return buildEnvelope(requestContext.requestId, {
            challengeToken,
            persistence: "planned_not_persisted",
            queueEnvelope: artifacts.queueEnvelope,
            session: {
              challengeId,
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
        .get("/risk-queue", ({ params, request, set }) =>
          buildReadModelPendingEnvelope(ensureResponseContext(request, set), "risk_queue", { guildId: params.guildId }),
        )
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
                executionPlan,
                persistence: executionPlan.executable ? "approved_for_executor_queue" : "policy_approved_but_not_executable",
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
      ({ body, params, request, requestContext, set }) => {
        const session = loadSessionConfig(env);
        const verified = verifyVerifierChallengeToken(body.token, session.sessionSecret, now());

        if (verified.challengeId !== params.challengeId) {
          throw new ApiRouteError(400, "validation_failed", "Challenge token does not match the requested challengeId.");
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
          queueEnvelope: artifacts.queueEnvelope,
          writePlan: artifacts.writePlan,
        });
      },
      {
        body: t.Object({
          guildId: t.String({ minLength: 1 }),
          sessionId: t.String({ minLength: 1 }),
          token: t.String({ minLength: 1 }),
          userId: t.String({ minLength: 1 }),
        }),
      },
    )
    .get("/verification/sessions/:sessionId", () => {
      throw new ApiRouteError(
        503,
        "dependency_unavailable",
        "Verification session reads need canonical persistence before lookup is honest.",
        true,
      );
    })
    .post(
      "/verification/sessions/:sessionId/release",
      ({ body, params, request, requestContext, set }) => {
        const artifacts = buildWriteArtifacts({
          aggregateId: params.sessionId,
          aggregateType: "verification_session",
          auditRefs: [createAuditRef(requestContext.requestId, "verification_session", "release")],
          canonicalMutations: [
            {
              dataRef: `${params.sessionId}:session`,
              operation: "update",
              primaryKey: "session_id",
              table: "verification_sessions",
            },
            {
              dataRef: `${params.sessionId}:audit`,
              operation: "insert",
              primaryKey: "audit_record_id",
              table: "audit_records",
            },
          ],
          idempotencyKey:
            request.headers.get("x-idempotency-key") ?? `verification-release:${params.sessionId}:${requestContext.requestId}`,
          kind: "verification.session.release_requested",
          payload: {
            guildId: body.guildId,
            sessionId: params.sessionId,
            userId: body.userId,
          },
          requestContext,
          scope: `verification-release:${params.sessionId}`,
          stream: "policy.actions",
          transactionName: "verification_session_release",
        });

        set.status = 202;
        return buildEnvelope(requestContext.requestId, {
          persistence: "planned_not_persisted",
          queueEnvelope: artifacts.queueEnvelope,
          release: {
            guildId: body.guildId,
            sessionId: params.sessionId,
            userId: body.userId,
          },
          writePlan: artifacts.writePlan,
        });
      },
      {
        body: t.Object({
          guildId: t.String({ minLength: 1 }),
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
        .post("/providers/:providerId", () => {
          throw new ApiRouteError(
            503,
            "dependency_unavailable",
            "Provider callbacks stay disabled until a concrete provider doc and signature contract are added.",
            true,
          );
        }),
    );
}

export type HumanifyApiApp = ReturnType<typeof createApiApp>;
