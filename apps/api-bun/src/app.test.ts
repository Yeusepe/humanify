/**
 * Purpose: Verifies the Elysia Bun API domain spine exposes validated route groups, safe policy clamps, and honest planning envelopes.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\verification.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://elysiajs.com/at-glance
 * - https://elysiajs.com/essential/validation
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";

import { humanifyContractVersion } from "@humanify/contracts";
import { extractTraceContext } from "@humanify/telemetry";

import {
  createApiApp,
  type LearningServiceClient,
  type PrivadoVerifierBackendClient,
  type VerificationRoleReleaseExecutor,
} from "./app";
import type { DiditClient } from "./didit";
import {
  createInMemoryGuildChannelConfigRepository,
  createInMemoryGuildScanRequestRepository,
  createInMemoryGuildVerificationConfigRepository,
  createInMemoryModeratorWarningCardsRepository,
  createInMemoryReportCasesRepository,
  createInMemoryVerificationSessionsRepository,
} from "./test-support";

const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);

const testEnv = {
  DISCORD_CLIENT_ID: "client_123",
  DISCORD_CLIENT_SECRET: "secret_123",
  DISCORD_REDIRECT_URI: "https://humanify.test/auth/discord/callback",
  HUMANIFY_ENVIRONMENT: "test",
  HUMANIFY_MAX_AUTOMATIC_ACTION: "quarantine",
  HUMANIFY_DIDIT_API_KEY: "didit_api_key",
  HUMANIFY_DIDIT_WEBHOOK_SECRET: "didit_webhook_secret",
  HUMANIFY_DIDIT_WORKFLOW_ID: "11111111-2222-3333-4444-555555555555",
  HUMANIFY_POSTGRES_URL: "postgres://humanify:secret@localhost:5432/humanify",
  HUMANIFY_REDIST_URL: undefined,
  HUMANIFY_REDIS_URL: "redis://localhost:6379",
  HUMANIFY_RELEASE: "test-suite",
  HUMANIFY_PRIVADO_ALLOWED_ISSUERS: undefined,
  HUMANIFY_PRIVADO_VERIFIER_BASE_URL: undefined,
  HUMANIFY_SECURE_COOKIES: "false",
  HUMANIFY_SERVICE_NAME: "api-bun",
  HUMANIFY_SESSION_COOKIE_NAME: "humanify_session",
  HUMANIFY_SESSION_SECRET: "session-secret",
  HUMANIFY_SESSION_TTL_SECONDS: "3600",
  HUMANIFY_VERIFIER_BASE_URL: "https://verifier.humanify.test",
} satisfies Record<string, string | undefined>;

const privadoEnabledTestEnv = {
  ...testEnv,
  HUMANIFY_PRIVADO_ALLOWED_ISSUERS: "did:issuer:age,did:issuer:nationality",
  HUMANIFY_PRIVADO_VERIFIER_BASE_URL: "https://verifier-backend.privado.id",
} satisfies Record<string, string | undefined>;

const claimBundleClaims: Record<string, string[]> = {
  humanify_id_age_and_nationality_v1: ["age_over_18", "nationality"],
  humanify_id_age_over_18_v1: ["age_over_18"],
  humanify_id_nationality_v1: ["nationality"],
};

function createFakeLearningServiceClient(): LearningServiceClient {
  return {
    async ingestCaseOutcome(outcome) {
      const type = outcome.outcome === "confirmed_bot"
        ? "behavior_pattern"
        : outcome.outcome === "confirmed_hacked_account"
          ? "server_trust"
          : "text_similarity";

      return {
        accepted: true,
        candidateSignals: outcome.outcome === "false_positive" || outcome.outcome === "dismissed" || outcome.outcome === "overturned"
          ? []
          : [{
            confidence: outcome.confidence,
            id: `candidate:${outcome.caseId}`,
            sourceCaseIds: [outcome.caseId],
            type,
            valueHash: outcome.subjectUserIdHash,
            weight: type === "behavior_pattern" ? 2 : 2.5,
          }],
        caseId: outcome.caseId,
        contractVersion: humanifyContractVersion,
        notes: ["learning service accepted the moderator-confirmed outcome."],
      };
    },
  };
}

function createFakeDiditClient(): DiditClient {
  let lastVendorData = "session_vendor_pending";

  return {
    async createSession(input) {
      lastVendorData = input.vendorData;
      return {
        callback: input.callbackUrl,
        sessionId: "didit_session_123",
        sessionStatus: "Not Started",
        verificationUrl: "https://verify.didit.me/session/didit_session_123",
        workflowId: input.workflowId,
      };
    },
    async deleteSession() {
      return {
        outcome: "deleted",
      };
    },
    async retrieveDecision(sessionId) {
      expect(sessionId).toBe("didit_session_123");
      return {
        decision: {
          idVerifications: [
            {
              age: 21,
              nationality: "ESP",
              status: "Approved",
            },
          ],
          livenessChecks: [
            {
              status: "Approved",
            },
          ],
          sessionId: "didit_session_123",
          status: "Approved",
        },
        metadata: {},
        sessionId: "didit_session_123",
        status: "Approved",
        vendorData: lastVendorData,
        workflowId: "11111111-2222-3333-4444-555555555555",
      };
    },
    verifyWebhookSignature(input) {
      const expected = createHmac("sha256", testEnv.HUMANIFY_DIDIT_WEBHOOK_SECRET!)
        .update(input.rawBody)
        .digest("hex");
      return input.signature === expected && input.timestamp === "1735689600";
    },
  };
}

function createFakePrivadoVerifierBackendClient(input: {
  createProofRequestResponse?: {
    qrCode: string;
    sessionID: string;
  };
  readProofStatusResponse?: {
    jwz?: string;
    jwzMetadata?: {
      nullifiers?: Array<{
        nullifier: string;
        nullifierSessionID: string;
        scopeID: number;
      }>;
      userDID: string;
      verifiablePresentations: Array<Record<string, unknown>>;
    };
    message?: string;
    status: "error" | "pending" | "success";
  };
} = {}): PrivadoVerifierBackendClient {
  let lastNullifierSessionId: string | undefined;

  return {
    async createProofRequest(request) {
      expect(request.scope.length).toBeGreaterThan(0);
      lastNullifierSessionId = request.scope[0]?.params?.nullifierSessionId;
      return input.createProofRequestResponse ?? {
        qrCode: "iden3comm://?request_uri=https%3A%2F%2Fverifier-backend.privado.id%2Fqr-store%3Fid%3Dproof_123",
        sessionID: "privado_backend_session_123",
      };
    },
    async readProofStatus(sessionId) {
      expect(sessionId).toBe("privado_backend_session_123");
      const response = input.readProofStatusResponse ?? {
        status: "pending",
      };

      if (response.jwzMetadata?.nullifiers) {
        return {
          ...response,
          jwzMetadata: {
            ...response.jwzMetadata,
            nullifiers: response.jwzMetadata.nullifiers.map((entry) => ({
              ...entry,
              nullifierSessionID: lastNullifierSessionId ?? entry.nullifierSessionID,
            })),
          },
        };
      }

      return response;
    },
  };
}

function createTestApp(input: {
  diditClient?: DiditClient;
  env?: Record<string, string | undefined>;
  guildChannelConfigRepository?: ReturnType<typeof createInMemoryGuildChannelConfigRepository>;
  guildScanRequestRepository?: ReturnType<typeof createInMemoryGuildScanRequestRepository>;
  guildVerificationConfigRepository?: ReturnType<typeof createInMemoryGuildVerificationConfigRepository>;
  learningServiceClient?: LearningServiceClient;
  moderatorWarningCardsRepository?: ReturnType<typeof createInMemoryModeratorWarningCardsRepository>;
  privadoVerifierBackendClient?: PrivadoVerifierBackendClient;
  reportCasesRepository?: ReturnType<typeof createInMemoryReportCasesRepository>;
  verificationRoleReleaseExecutor?: VerificationRoleReleaseExecutor;
  verificationSessionsRepository?: ReturnType<typeof createInMemoryVerificationSessionsRepository>;
} = {}) {
  const reportCasesRepository = input.reportCasesRepository ?? createInMemoryReportCasesRepository();
  const verificationSessionsRepository =
    input.verificationSessionsRepository ?? createInMemoryVerificationSessionsRepository();

  return createApiApp({
    env: input.env ?? testEnv,
    guildChannelConfigRepository: input.guildChannelConfigRepository ?? createInMemoryGuildChannelConfigRepository(),
    guildScanRequestRepository: input.guildScanRequestRepository ?? createInMemoryGuildScanRequestRepository(),
    guildVerificationConfigRepository:
      input.guildVerificationConfigRepository ?? createInMemoryGuildVerificationConfigRepository(),
    learningServiceClient: input.learningServiceClient ?? createFakeLearningServiceClient(),
    moderatorWarningCardsRepository:
      input.moderatorWarningCardsRepository ?? createInMemoryModeratorWarningCardsRepository({
        reportCasesRepository,
        verificationSessionsRepository,
      }),
    now: () => fixedNow,
    reportCasesRepository,
    verificationRoleReleaseExecutor: input.verificationRoleReleaseExecutor,
    verificationOptionRuntimeOverrides: {
      diditClient: input.diditClient ?? createFakeDiditClient(),
      privadoVerifierBackendClient: input.privadoVerifierBackendClient,
    },
    verificationSessionsRepository,
  });
}

async function persistVerificationConfig(
  repository: ReturnType<typeof createInMemoryGuildVerificationConfigRepository>,
  input: Partial<{
    defaultProviderId: string;
    defaultReusableProofBackendId: string;
    enabledProviderIds: string[];
    faceVerificationRequired: boolean;
    guildId: string;
    requiredBundleIds: string[];
    roleGrantBindings: Array<{ roleId: string; trigger: string }>;
    suspiciousRoleIds: string[];
    trustedRoleIds: string[];
  }> = {},
) {
  const guildId = input.guildId ?? "guild_123";
  const requiredBundleIds = input.requiredBundleIds ?? ["humanify_id_age_and_nationality_v1"];
  const faceVerificationRequired = input.faceVerificationRequired ?? false;
  const scope = crypto.randomUUID();

  await repository.upsertConfig({
    artifacts: {
      idempotency: {
        key: `guild-verification-config:${scope}`,
        requestId: `req_${scope}`,
        scope: `guild-verification-config:${guildId}`,
      },
      queueEnvelope: {
        canonicalRef: {
          aggregateId: guildId,
          aggregateType: "guild_verification_config",
          eventId: crypto.randomUUID(),
        },
        kind: "guild.verification.updated",
        messageId: crypto.randomUUID(),
        occurredAt: new Date(fixedNow).toISOString(),
        payload: {
          guildId,
        },
        producer: {
          serviceName: "api-bun",
        },
        requestId: `req_${scope}`,
        schemaVersion: "1",
        stream: "verification.events",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      },
    },
    body: {
      actorUserId: "mod_123",
      defaultProviderId: input.defaultProviderId ?? "didit",
      defaultReusableProofBackendId: input.defaultReusableProofBackendId,
      enabledProviderIds: input.enabledProviderIds ?? ["didit", "privado", "self", "world_id"],
      faceVerificationRequired,
      requiredBundleIds,
      requiredCapabilities: Array.from(new Set([
        ...requiredBundleIds.flatMap((bundleId) => claimBundleClaims[bundleId] ?? []),
        ...(faceVerificationRequired ? ["face_verification"] : []),
      ])),
      roleGrantBindings: input.roleGrantBindings ?? [],
      suspiciousRoleIds: input.suspiciousRoleIds ?? [],
      trustedRoleIds: input.trustedRoleIds ?? [],
    },
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
}

test("health route reports Bun-side API status", async () => {
  const app = createTestApp();
  const response = await app.handle(new Request("http://humanify.local/health"));
  const json = (await response.json()) as {
    contractVersion: string;
    status: string;
  };

  expect(response.status).toBe(200);
  expect(json).toEqual({
    contractVersion: humanifyContractVersion,
    status: "ok",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

test("service-info exposes the implemented domain route groups", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/service-info", {
      headers: {
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        "x-request-id": "req_incoming",
      },
    }),
  );
  const json = (await response.json()) as {
    contractVersion: string;
    data: {
      observability: {
        sentryDsn?: string;
        sentryTracesSampleRate: number;
      };
      routeGroups: string[];
    };
    requestId: string;
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.requestId).toBe("req_incoming");
  expect(json.data.routeGroups).toEqual(
    expect.arrayContaining([
      "auth",
      "guild-config",
      "scans",
      "cases",
      "reports",
      "verification",
      "moderation",
      "read-models",
    ]),
  );
  expect(json.data.observability.sentryTracesSampleRate).toBe(0);
  expect(response.headers.get("x-request-id")).toBe("req_incoming");
  expect(extractTraceContext(response.headers)?.traceId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("auth start builds a signed Discord OAuth bootstrap without inventing session completion", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/auth/discord/start", {
      body: JSON.stringify({
        guildId: "guild_123",
        redirectTo: "/dashboard/guild_123",
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    contractVersion: string;
    data: {
      authUrl: string;
      cookie: {
        name: string;
      };
      state: string;
    };
    requestId: string;
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(response.headers.get("x-request-id")).toBe(json.requestId);
  expect(json.data.cookie.name).toBe("humanify_session");
  expect(new URL(json.data.authUrl).origin).toBe("https://discord.com");
  expect(json.data.state).toContain(".");
});

test("policy writes produce a Postgres-first planning envelope", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/policy", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        allowAutoBan: false,
        maxAutomaticAction: "quarantine",
        quarantineAtOrAbove: 7,
        verificationRequiredAtOrAbove: 6,
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "policy-key-1",
      },
      method: "PUT",
    }),
  );
  const json = (await response.json()) as {
    contractVersion: string;
    data: {
      queueEnvelope: {
        stream: string;
      };
      writePlan: {
        canonicalMutations: Array<{
          table: string;
        }>;
        commitOrder: string[];
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.data.writePlan.commitOrder).toEqual(["postgres", "outbox", "redis-streams"]);
  expect(json.data.writePlan.canonicalMutations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: "guild_policy_versions" }),
      expect.objectContaining({ table: "audit_records" }),
    ]),
  );
  expect(json.data.queueEnvelope.stream).toBe("projection.refresh");
});

test("verification config persists canonical provider, bundle, and role policy", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        defaultProviderId: "didit",
        defaultReusableProofBackendId: "privado",
        enabledProviderIds: ["didit", "privado", "self"],
        faceVerificationRequired: true,
        requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
        roleGrantBindings: [
          { roleId: "role_human", trigger: "verified_human" },
          { roleId: "role_18", trigger: "age_over_18" },
        ],
        suspiciousRoleIds: ["role_suspicious"],
        trustedRoleIds: ["role_verified"],
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "verification-config-key-1",
      },
      method: "PUT",
    }),
  );
  const json = (await response.json()) as {
    data: {
      persistence: string;
      queueDelivery: string;
      verificationConfig: {
        availableBundles: Array<{
          bundleId: string;
        }>;
        availableProviderIds: string[];
        defaultProviderId: string;
        defaultReusableProofBackendId?: string;
        enabledProviderIds: string[];
        faceVerificationRequired: boolean;
        fallbackRoles: string[];
        requiredBundleIds: string[];
        roleGrantBindings: Array<{ roleId: string; trigger: string }>;
        source: string;
        suspiciousRoleIds: string[];
        trustedRoleIds: string[];
      };
    };
  };

  expect(response.status).toBe(200);
  expect(json.data.persistence).toBe("persisted");
  expect(json.data.queueDelivery).toBe("pending_outbox_publish");
  expect(json.data.verificationConfig.availableProviderIds).toEqual(["didit", "privado", "self", "world_id"]);
  expect(json.data.verificationConfig.enabledProviderIds).toEqual(["didit", "privado", "self"]);
  expect(json.data.verificationConfig.defaultProviderId).toBe("didit");
  expect(json.data.verificationConfig.defaultReusableProofBackendId).toBe("privado");
  expect(json.data.verificationConfig.faceVerificationRequired).toBe(true);
  expect(json.data.verificationConfig.requiredBundleIds).toEqual(["humanify_id_age_and_nationality_v1"]);
  expect(json.data.verificationConfig.roleGrantBindings).toEqual([
    { roleId: "role_human", trigger: "verified_human" },
    { roleId: "role_18", trigger: "age_over_18" },
  ]);
  expect(json.data.verificationConfig.availableBundles.map((bundle) => bundle.bundleId)).toEqual([
    "humanify_id_age_over_18_v1",
    "humanify_id_nationality_v1",
    "humanify_id_age_and_nationality_v1",
  ]);
  expect(json.data.verificationConfig.suspiciousRoleIds).toEqual(["role_suspicious"]);
  expect(json.data.verificationConfig.fallbackRoles).toEqual(["role_verified"]);
  expect(json.data.verificationConfig.trustedRoleIds).toEqual(["role_verified"]);
  expect(json.data.verificationConfig.source).toBe("persisted");

  const readResponse = await app.handle(new Request("http://humanify.local/guilds/guild_123/verification"));
  const readJson = (await readResponse.json()) as {
    data: {
      persistence: string;
      verificationConfig: {
        defaultProviderId: string;
        defaultReusableProofBackendId?: string;
        enabledProviderIds: string[];
        faceVerificationRequired: boolean;
        requiredBundleIds: string[];
        roleGrantBindings: Array<{ roleId: string; trigger: string }>;
        source: string;
        suspiciousRoleIds: string[];
        trustedRoleIds: string[];
      };
    };
  };

  expect(readResponse.status).toBe(200);
  expect(readJson.data.persistence).toBe("persisted");
  expect(readJson.data.verificationConfig).toMatchObject({
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado", "self"],
    faceVerificationRequired: true,
    requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
    roleGrantBindings: [
      { roleId: "role_human", trigger: "verified_human" },
      { roleId: "role_18", trigger: "age_over_18" },
    ],
    source: "persisted",
    suspiciousRoleIds: ["role_suspicious"],
    trustedRoleIds: ["role_verified"],
  });
});

test("verification config rejects defaults that are not enabled for the guild", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        defaultProviderId: "world_id",
        enabledProviderIds: ["didit", "self", "world_id"],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(400);
  expect(json.errorCode).toBe("validation_failed");
  expect(json.message).toContain('Default capture provider "world_id" must use the capture_provider role.');
});

test("verification session create and status expose the effective guild verification config snapshot", async () => {
  const guildVerificationConfigRepository = createInMemoryGuildVerificationConfigRepository();
  await persistVerificationConfig(guildVerificationConfigRepository, {
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
    suspiciousRoleIds: ["role_suspicious"],
    trustedRoleIds: ["role_verified"],
  });
  const app = createTestApp({
    guildVerificationConfigRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      verificationConfig: {
        defaultProviderId: string;
        defaultReusableProofBackendId?: string;
        enabledProviderIds: string[];
        faceVerificationRequired: boolean;
        requiredBundleIds: string[];
        source: string;
      };
      session: {
        sessionId: string;
      };
    };
  };

  expect(createResponse.status).toBe(201);
  expect(created.data.verificationConfig).toMatchObject({
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
    source: "persisted",
  });

  const statusResponse = await app.handle(
    new Request(
      `http://humanify.local/verification/sessions/${created.data.session.sessionId}?token=${encodeURIComponent(created.data.challengeToken)}`,
    ),
  );
  const statusJson = (await statusResponse.json()) as {
    data: {
      verificationConfig: {
        defaultProviderId: string;
        enabledProviderIds: string[];
        faceVerificationRequired: boolean;
        requiredBundleIds: string[];
        source: string;
      };
    };
  };

  expect(statusResponse.status).toBe(200);
  expect(statusJson.data.verificationConfig).toMatchObject({
    defaultProviderId: "didit",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
    source: "persisted",
  });
});

test("channel config persists moderator alert settings for setup and warning workflows", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/channels", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        auditLogChannelId: "channel_audit",
        moderationLogChannelId: "channel_warning_log",
        moderatorAlertChannelId: "channel_alerts",
        reviewChannelId: "channel_review",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "channel-config-key-1",
      },
      method: "PUT",
    }),
  );
  const json = (await response.json()) as {
    data?: {
      channelConfig: {
        auditLogChannelId?: string;
        moderationLogChannelId?: string;
        moderatorAlertChannelId: string;
        reviewChannelId?: string;
      };
      persistence: string;
      queueDelivery: string;
    };
    errorCode?: string;
    message?: string;
  };

  expect(response.status).toBe(200);
  expect(json.errorCode).toBeUndefined();
  expect(json.data?.persistence).toBe("persisted");
  expect(json.data?.queueDelivery).toBe("pending_outbox_publish");
  expect(json.data?.channelConfig).toEqual(
    expect.objectContaining({
      auditLogChannelId: "channel_audit",
      moderationLogChannelId: "channel_warning_log",
      moderatorAlertChannelId: "channel_alerts",
      reviewChannelId: "channel_review",
    }),
  );

  const readResponse = await app.handle(new Request("http://humanify.local/guilds/guild_123/channels"));
  const readJson = (await readResponse.json()) as {
    data?: {
      channelConfig: {
        auditLogChannelId?: string;
        guildId: string;
        moderationLogChannelId?: string;
        moderatorAlertChannelId?: string;
        reviewChannelId?: string;
        source: string;
      };
      persistence: string;
    };
  };

  expect(readResponse.status).toBe(200);
  expect(readJson.data?.persistence).toBe("persisted");
  expect(readJson.data?.channelConfig).toEqual(
    expect.objectContaining({
      auditLogChannelId: "channel_audit",
      moderationLogChannelId: "channel_warning_log",
      moderatorAlertChannelId: "channel_alerts",
      reviewChannelId: "channel_review",
      source: "persisted",
    }),
  );
});

test("channel config read stays honest when a guild has not saved setup channels yet", async () => {
  const app = createTestApp();
  const response = await app.handle(new Request("http://humanify.local/guilds/guild_123/channels"));
  const json = (await response.json()) as {
    data: {
      channelConfig: {
        auditLogChannelId?: string;
        guildId: string;
        moderationLogChannelId?: string;
        moderatorAlertChannelId?: string;
        reviewChannelId?: string;
        source: string;
      };
      persistence: string;
    };
  };

  expect(response.status).toBe(200);
  expect(json.data.persistence).toBe("not_configured");
  expect(json.data.channelConfig).toEqual({
    guildId: "guild_123",
    source: "not_configured",
  });
});

test("scan request create persists a canonical queued single-member scan", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/scans", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        scope: "single_member",
        targetUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "scan-request-key-1",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      persistence: string;
      queueDelivery: string;
      queueEnvelope: {
        stream: string;
      };
      scanRequest: {
        guildId: string;
        readModelStatus: string;
        requestedByUserId: string;
        scanRequestId: string;
        scope: string;
        status: string;
        summary: {
          highestObservedScore: number;
          notes: string[];
          processedMemberCount: number;
          suspiciousFindings: Array<unknown>;
          suspiciousMemberCount: number;
        };
        targetUserId?: string;
      };
      writePlan: {
        canonicalMutations: Array<{ table: string }>;
      };
    };
  };

  expect(response.status).toBe(201);
  expect(json.data.persistence).toBe("persisted");
  expect(json.data.queueDelivery).toBe("pending_outbox_publish");
  expect(json.data.queueEnvelope.stream).toBe("scan.requests");
  expect(json.data.scanRequest).toMatchObject({
    guildId: "guild_123",
    readModelStatus: "canonical_postgres",
    requestedByUserId: "mod_123",
    scope: "single_member",
    status: "pending",
    targetUserId: "user_123",
  });
  expect(json.data.scanRequest.summary).toEqual({
    highestObservedScore: 0,
    notes: [],
    processedMemberCount: 0,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  });
  expect(json.data.writePlan.canonicalMutations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: "guild_scan_requests" }),
      expect.objectContaining({ table: "audit_records" }),
    ]),
  );

  const readResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/scans/${json.data.scanRequest.scanRequestId}`),
  );
  const readJson = (await readResponse.json()) as {
    data: {
      scanRequest: {
        scope: string;
        status: string;
        targetUserId?: string;
      };
    };
  };

  expect(readResponse.status).toBe(200);
  expect(readJson.data.scanRequest).toMatchObject({
    scope: "single_member",
    status: "pending",
    targetUserId: "user_123",
  });
});

test("scan request validation rejects mismatched target scope combinations", async () => {
  const app = createTestApp();

  const missingTargetResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/scans", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        scope: "single_member",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const missingTargetJson = (await missingTargetResponse.json()) as {
    errorCode: string;
    message: string;
  };

  expect(missingTargetResponse.status).toBe(400);
  expect(missingTargetJson.errorCode).toBe("validation_failed");
  expect(missingTargetJson.message).toContain("targetUserId is required");

  const extraTargetResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/scans", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        scope: "all_members",
        targetUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const extraTargetJson = (await extraTargetResponse.json()) as {
    errorCode: string;
    message: string;
  };

  expect(extraTargetResponse.status).toBe(400);
  expect(extraTargetJson.errorCode).toBe("validation_failed");
  expect(extraTargetJson.message).toContain("must be omitted");
});

test("report intake validates request bodies and returns the documented error envelope", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        reportReason: "",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    requestId: string;
    retryable: boolean;
  };

  expect(response.status).toBe(400);
  expect(json.errorCode).toBe("validation_failed");
  expect(response.headers.get("x-request-id")).toBe(json.requestId);
  expect(json.retryable).toBe(false);
});

test("report intake persists a canonical case backbone that case reads can return honestly", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp({ reportCasesRepository: repository });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "spam link",
        reporterNotes: "repeated across channels",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      caseLinkage: {
        caseId?: string;
        disposition: string;
      };
      persistence: string;
      queueDelivery: string;
      report: {
        caseId?: string;
        reportId: string;
      };
    };
  };

  expect(createResponse.status).toBe(201);
  expect(created.data.persistence).toBe("persisted");
  expect(created.data.queueDelivery).toBe("pending_outbox_publish");
  expect(created.data.caseLinkage.disposition).toBe("created");
  expect(created.data.report.caseId).toBeTruthy();

  const listResponse = await app.handle(new Request("http://humanify.local/guilds/guild_123/cases"));
  const listed = (await listResponse.json()) as {
    data: {
      items: Array<{
        caseId: string;
        readModelStatus?: string;
        reportCount: number;
      }>;
      readModelStatus: string;
    };
  };

  expect(listResponse.status).toBe(200);
  expect(listed.data.readModelStatus).toBe("canonical_postgres");
  expect(listed.data.items).toEqual([
    expect.objectContaining({
      caseId: created.data.report.caseId,
      reportCount: 1,
    }),
  ]);

  const detailResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}`),
  );
  const detail = (await detailResponse.json()) as {
    data: {
      case: {
        caseId: string;
      };
      readModelStatus: string;
      reports: Array<{
        reportId: string;
      }>;
    };
  };

  expect(detailResponse.status).toBe(200);
  expect(detail.data.readModelStatus).toBe("canonical_postgres");
  expect(created.data.report.caseId).toBeTruthy();
  expect(detail.data.case.caseId).toBe(created.data.report.caseId ?? "");
  expect(detail.data.reports).toEqual([
    expect.objectContaining({
      reportId: created.data.report.reportId,
    }),
  ]);
});

test("warning card reads stay honest when no verification session or alert ref exists yet", async () => {
  const app = createTestApp();

  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "slash_command",
        openCase: true,
        reportReason: "suspicious DM link",
        reporterNotes: "asked for backup code",
        reporterUserId: "mod_123",
        subjectUserId: "user_456",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_456",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      report: {
        caseId?: string;
      };
    };
  };

  const warningResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/warning-card`),
  );
  const warningJson = (await warningResponse.json()) as {
    data: {
      alertMessageRef?: unknown;
      case: {
        caseId: string;
        subjectUserId: string;
      };
      evidenceSummary: {
        evidenceCount: number;
      };
      readModelStatus: string;
      reportsSummary: {
        reportCount: number;
      };
      verification?: unknown;
    };
  };

  expect(warningResponse.status).toBe(200);
  expect(warningJson.data.readModelStatus).toBe("canonical_postgres");
  expect(warningJson.data.case.caseId).toBe(created.data.report.caseId!);
  expect(warningJson.data.case.subjectUserId).toBe("user_456");
  expect(warningJson.data.reportsSummary.reportCount).toBe(1);
  expect(warningJson.data.evidenceSummary.evidenceCount).toBe(0);
  expect(warningJson.data.alertMessageRef).toBeUndefined();
  expect(warningJson.data.verification).toBeUndefined();
});

test("warning card reads join case-linked verification state, reusable bridge, face-check, and alert ref", async () => {
  const reportCasesRepository = createInMemoryReportCasesRepository();
  const verificationSessionsRepository = createInMemoryVerificationSessionsRepository();
  const app = createTestApp({
    reportCasesRepository,
    verificationSessionsRepository,
  });

  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "fake Nitro lure",
        reporterNotes: "same copy as prior scam",
        reporterUserId: "mod_123",
        subjectUserId: "user_789",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_789",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      report: {
        caseId?: string;
        reportId: string;
      };
    };
  };

  await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${created.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_789",
        messageId: "message_789",
        messagePreview: "Claim your free Nitro gift now",
        subjectUserId: "user_789",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  const verificationCreateResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        caseId: created.data.report.caseId,
        initiatedBy: "mod_123",
        requiredCapabilities: ["document_identity", "face_verification"],
        userId: "user_789",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const verificationCreated = (await verificationCreateResponse.json()) as {
    data: {
      session: {
        sessionId: string;
      };
    };
  };

  await verificationSessionsRepository.recordDiditResult({
    providerSessionId: "didit_warning_case_123",
    providerStatus: "Approved",
    purge: {
      attemptedAt: "2026-01-01T00:00:00.000Z",
      outcome: "deleted",
    },
    requestedClaims: ["age_over_18", "nationality"],
    reusableCredentialBridge: {
      artifactPayload: {
        approvedClaims: ["age_over_18", "nationality"],
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18"],
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
      artifactStatus: "issuer_handoff_required",
      bridgeId: "bridge_warning_case_123",
      expiresAt: "2026-01-01T01:00:00.000Z",
      summary: {
        approvedClaims: ["age_over_18", "nationality"],
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18"],
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
      providerReferenceId: "didit_warning_case_123",
      providerStatus: "Approved",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["age_over_18", "nationality", "face_verification"],
    },
    sessionId: verificationCreated.data.session.sessionId,
    state: "passed",
    webhook: {
      providerStatus: "Approved",
      timestamp: "1735689600",
      webhookType: "status.updated",
      workflowId: "11111111-2222-3333-4444-555555555555",
    },
  });

  const alertRefResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/warning-card/alert-message`, {
      body: JSON.stringify({
        actorService: "bot-bun",
        channelId: "channel_alerts",
        messageId: "message_alert_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
  );
  const alertRefJson = (await alertRefResponse.json()) as {
    data: {
      alertMessageRef: {
        messageUrl: string;
      };
      persistence: string;
    };
  };

  expect(alertRefResponse.status).toBe(200);
  expect(alertRefJson.data.persistence).toBe("persisted");
  expect(alertRefJson.data.alertMessageRef.messageUrl).toBe(
    "https://discord.com/channels/guild_123/channel_alerts/message_alert_123",
  );

  const warningResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/warning-card`),
  );
  const warningJson = (await warningResponse.json()) as {
    data: {
      alertMessageRef: {
        channelId: string;
        messageId: string;
        messageState: string;
      };
      case: {
        caseId: string;
      };
      evidenceSummary: {
        evidenceCount: number;
        latestEvidence?: {
          messagePreview?: string;
        };
      };
      faceCheck?: {
        passed: boolean;
        performed: boolean;
        source: string;
        satisfiesFaceVerificationRequirement?: boolean;
      };
      reportsSummary: {
        latestReportReason?: string;
        reportCount: number;
      };
      reusableCredentialBridge?: {
        status: string;
        targetProvider: string;
      };
      verification?: {
        caseLinkage: string;
        providerId?: string;
        sessionId: string;
        state: string;
        summary?: {
          faceVerificationPassed: boolean;
        };
      };
    };
  };

  expect(warningResponse.status).toBe(200);
  expect(warningJson.data.case.caseId).toBe(created.data.report.caseId!);
  expect(warningJson.data.reportsSummary.reportCount).toBe(1);
  expect(warningJson.data.reportsSummary.latestReportReason).toBe("fake Nitro lure");
  expect(warningJson.data.evidenceSummary.evidenceCount).toBe(1);
  expect(warningJson.data.evidenceSummary.latestEvidence?.messagePreview).toBe("Claim your free Nitro gift now");
  expect(warningJson.data.verification).toEqual(expect.objectContaining({
    caseLinkage: "case_linked",
    providerId: "didit",
    sessionId: verificationCreated.data.session.sessionId,
    state: "passed",
    summary: expect.objectContaining({
      faceVerificationPassed: true,
    }),
  }));
  expect(warningJson.data.reusableCredentialBridge).toEqual(expect.objectContaining({
    status: "issuer_handoff_required",
    targetProvider: "privado",
  }));
  expect(warningJson.data.faceCheck).toEqual(expect.objectContaining({
    passed: true,
    performed: true,
    source: "verification_summary",
  }));
  expect(warningJson.data.alertMessageRef).toEqual(expect.objectContaining({
    channelId: "channel_alerts",
    messageId: "message_alert_123",
    messageState: "active",
  }));
});

test("case review persists canonical outcomes and applies learned candidates from moderator-confirmed evidence", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp({ reportCasesRepository: repository });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "scam nitro link",
        reporterNotes: "repeated across channels",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      report: {
        caseId?: string;
        reportId: string;
      };
    };
  };

  await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${created.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_123",
        messageId: "message_123",
        messagePreview: "Claim your free Nitro gift now at http://scam.example",
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  const reviewResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/review`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        confidence: 0.93,
        outcome: "confirmed_scam",
        rationale: "Moderator confirmed a repeated Nitro scam message.",
        reasonCodes: ["similar_to_confirmed_scam_template"],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const reviewed = (await reviewResponse.json()) as {
    data: {
      learning: {
        accepted: boolean;
        appliedSignalCount: number;
        candidateSignals: Array<{
          reasonCode: string;
          text: string;
          type: string;
        }>;
        status: string;
      };
      persistence: string;
      queueDelivery: string;
      review: {
        evidenceRefs: string[];
        outcome: string;
        outcomeId: string;
      };
    };
  };

  expect(reviewResponse.status).toBe(201);
  expect(reviewed.data.persistence).toBe("persisted");
  expect(reviewed.data.queueDelivery).toBe("pending_outbox_publish");
  expect(reviewed.data.review.outcomeId).toBeTruthy();
  expect(reviewed.data.review.outcome).toBe("confirmed_scam");
  expect(reviewed.data.review.evidenceRefs).toHaveLength(1);
  expect(reviewed.data.learning.accepted).toBe(true);
  expect(reviewed.data.learning.status).toBe("applied");
  expect(reviewed.data.learning.appliedSignalCount).toBeGreaterThan(0);
  expect(reviewed.data.learning.candidateSignals).toEqual(expect.arrayContaining([
    expect.objectContaining({
      reasonCode: "similar_to_confirmed_scam_template",
      text: expect.stringContaining("claim your free nitro gift"),
      type: "text_similarity",
    }),
  ]));
});

test("risk queue returns canonical trust and anomaly enrichments without turning them into enforcement", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp({ reportCasesRepository: repository });

  const seedResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "nitro scam",
        reporterUserId: "trusted_mod",
        subjectUserId: "seed_user",
        triggerFingerprint: "discord-message:guild_123:channel_seed:message_seed",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const seeded = (await seedResponse.json()) as {
    data: {
      report: {
        caseId?: string;
        reportId: string;
      };
    };
  };

  await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${seeded.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "trusted_mod",
        captureSource: "discord_message_context",
        channelId: "channel_seed",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_seed/message_seed",
        messageId: "message_seed",
        messagePreview: "Claim your nitro prize now",
        subjectUserId: "seed_user",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${seeded.data.report.caseId}/review`, {
      body: JSON.stringify({
        actorUserId: "lead_mod",
        confidence: 0.93,
        outcome: "confirmed_scam",
        reasonCodes: ["similar_to_confirmed_scam_template"],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  const triggerFingerprint = "discord-message:guild_123:channel_raid:message_raid";
  for (const reporterUserId of ["trusted_mod", "reporter_two", "reporter_three"]) {
    await app.handle(
      new Request("http://humanify.local/guilds/guild_123/reports", {
        body: JSON.stringify({
          intakeSource: "message_context",
          openCase: true,
          reportReason: "coordinated scam burst",
          reporterUserId,
          subjectUserId: "burst_user",
          triggerFingerprint,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
  }

  const riskQueueResponse = await app.handle(new Request("http://humanify.local/guilds/guild_123/risk-queue"));
  const riskQueue = (await riskQueueResponse.json()) as {
    data: {
      items: Array<{
        advisoryOnly: boolean;
        anomalySignals: string[];
        caseId: string;
        subjectUserId: string;
        trustSignals: {
          reporterConsensusScore: number;
          subjectAnomalyScore: number;
          trustedReporterCount: number;
          uniqueReporterCount: number;
        };
      }>;
      readModelStatus: string;
      source: string;
    };
  };

  expect(riskQueueResponse.status).toBe(200);
  expect(riskQueue.data.readModelStatus).toBe("canonical_postgres");
  expect(riskQueue.data.source).toBe("risk_queue_canonical");
  expect(riskQueue.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      advisoryOnly: true,
      anomalySignals: expect.arrayContaining(["coordinated_report_burst", "trusted_reporter_consensus"]),
      subjectUserId: "burst_user",
      trustSignals: expect.objectContaining({
        reporterConsensusScore: 1 / 3,
        subjectAnomalyScore: expect.any(Number),
        trustedReporterCount: 1,
        uniqueReporterCount: 3,
      }),
    }),
  ]));
});

test("case review keeps canonical outcomes durable when learning-rs is unavailable", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp({
    learningServiceClient: {
      async ingestCaseOutcome() {
        throw new Error("service unavailable");
      },
    },
    reportCasesRepository: repository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "spam link",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_456",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      report: {
        caseId?: string;
      };
    };
  };

  const reviewResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/review`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        confidence: 0.8,
        outcome: "dismissed",
        reasonCodes: ["prior_false_positive"],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const reviewed = (await reviewResponse.json()) as {
    data: {
      learning: {
        accepted: boolean;
        notes: string[];
      };
      persistence: string;
      review: {
        outcomeId: string;
      };
    };
  };

  expect(reviewResponse.status).toBe(201);
  expect(reviewed.data.persistence).toBe("persisted");
  expect(reviewed.data.review.outcomeId).toBeTruthy();
  expect(reviewed.data.learning.accepted).toBe(false);
  expect(reviewed.data.learning.notes[0]).toContain("pending retry");
});

test("verification session creation persists a challenge token and canonical verification session", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "verification-key-1",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      challengeToken: string;
      queueEnvelope: {
        stream: string;
      };
      session: {
        guildId: string;
        state: string;
        userId: string;
      };
    };
  };

  expect(response.status).toBe(201);
  expect(json.data.session).toMatchObject({
    guildId: "guild_123",
    state: "challenge_issued",
    userId: "user_123",
  });
  expect(json.data.challengeToken).toContain(".");
  expect(json.data.queueEnvelope.stream).toBe("verification.events");
});

test("verification session reads derive honest context from the signed challenge token", async () => {
  const app = createTestApp();
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "human_presence"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(
      `http://humanify.local/verification/sessions/${created.data.session.sessionId}?token=${encodeURIComponent(created.data.challengeToken)}`,
    ),
  );
  const json = (await response.json()) as {
    data: {
      providerBoundary: {
        providerFlowConfigured: boolean;
      };
      persistence: string;
      session: {
        requiredCapabilities: string[];
        state: string;
      };
    };
  };

  expect(response.status).toBe(200);
  expect(json.data.persistence).toBe("persisted");
  expect(json.data.session.state).toBe("challenge_issued");
  expect(json.data.session.requiredCapabilities).toEqual(["captcha", "human_presence"]);
  expect(json.data.providerBoundary.providerFlowConfigured).toBe(false);
});

test("challenge completion rejects session mismatches instead of trusting body fields", async () => {
  const app = createTestApp();
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "self",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: "session_other",
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(400);
  expect(json.errorCode).toBe("validation_failed");
  expect(json.message).toContain("sessionId");
});

test("challenge completion rejects providers disabled by the persisted guild verification config", async () => {
  const guildVerificationConfigRepository = createInMemoryGuildVerificationConfigRepository();
  await persistVerificationConfig(guildVerificationConfigRepository, {
    enabledProviderIds: ["didit"],
    requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
  });
  const app = createTestApp({
    guildVerificationConfigRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "privado",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(403);
  expect(json.errorCode).toBe("forbidden");
  expect(json.message).toContain('providerId "privado" is not enabled');
});

test("challenge completion rejects reusable-proof providers when guild policy requires face verification", async () => {
  const guildVerificationConfigRepository = createInMemoryGuildVerificationConfigRepository();
  await persistVerificationConfig(guildVerificationConfigRepository, {
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
  });
  const app = createTestApp({
    guildVerificationConfigRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "privado",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(403);
  expect(json.errorCode).toBe("forbidden");
  expect(json.message).toContain("face verification");
});

test("challenge completion rejects claim bundles outside the persisted guild verification config", async () => {
  const guildVerificationConfigRepository = createInMemoryGuildVerificationConfigRepository();
  await persistVerificationConfig(guildVerificationConfigRepository, {
    enabledProviderIds: ["didit", "self"],
    requiredBundleIds: ["humanify_id_age_over_18_v1"],
  });
  const app = createTestApp({
    guildVerificationConfigRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "self",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(403);
  expect(json.errorCode).toBe("forbidden");
  expect(json.message).toContain("requiredBundleIds");
});

test("challenge completion carries provider choice and Humanify ID claims through the planning boundary", async () => {
  const app = createTestApp();
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "self",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      providerBoundary: {
        handoffKind: string;
        requestedClaims: string[];
        selectedProvider: string;
        serverVerificationNote: string;
        status: string;
      };
      session: {
        state: string;
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.data.providerBoundary.selectedProvider).toBe("self");
  expect(json.data.providerBoundary.requestedClaims).toEqual(["age_over_18", "nationality"]);
  expect(json.data.providerBoundary.handoffKind).toBe("server_verified_proof");
  expect(json.data.providerBoundary.status).toBe("pending_provider_verification");
  expect(json.data.providerBoundary.serverVerificationNote).toContain("server-side");
  expect(json.data.session.state).toBe("provider_pending");
});

test("didit challenge completion creates a backend Didit session and returns SDK launch data", async () => {
  const app = createTestApp();
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "document_identity"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "didit",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      persistence: string;
      providerBoundary: {
        launch: {
          mode: string;
          packageName: string;
          providerId: string;
          providerSessionId: string;
          providerStatus: string;
          url: string;
        };
        providerFlowConfigured: boolean;
        selectedProvider: string;
        status: string;
      };
      session: {
        state: string;
      };
    };
  };

  expect(response.status).toBe(201);
  expect(json.data.persistence).toBe("persisted");
  expect(json.data.providerBoundary.selectedProvider).toBe("didit");
  expect(json.data.providerBoundary.providerFlowConfigured).toBe(true);
  expect(json.data.providerBoundary.status).toBe("didit_session_created");
  expect(json.data.providerBoundary.launch).toEqual({
    mode: "didit_sdk",
    packageName: "@didit-protocol/sdk-web",
    providerId: "didit",
    providerSessionId: "didit_session_123",
    providerStatus: "Not Started",
    url: "https://verify.didit.me/session/didit_session_123",
  });
  expect(json.data.session.state).toBe("provider_pending");
});

test("didit callbacks verify the signature, reconcile the decision server-side, and mark the session passed", async () => {
  const verificationSessionsRepository = createInMemoryVerificationSessionsRepository();
  const diditClient = createFakeDiditClient();
  const app = createApiApp({
    env: testEnv,
    guildChannelConfigRepository: createInMemoryGuildChannelConfigRepository(),
    guildVerificationConfigRepository: createInMemoryGuildVerificationConfigRepository(),
    learningServiceClient: createFakeLearningServiceClient(),
    now: () => fixedNow,
    reportCasesRepository: createInMemoryReportCasesRepository(),
    verificationOptionRuntimeOverrides: {
      diditClient,
    },
    verificationSessionsRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "document_identity"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };
  await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "didit",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  const webhookBody = JSON.stringify({
    session_id: "didit_session_123",
    status: "Approved",
    timestamp: 1735689600,
    vendor_data: created.data.session.sessionId,
    webhook_type: "status.updated",
    workflow_id: testEnv.HUMANIFY_DIDIT_WORKFLOW_ID,
  });
  const webhookSignature = createHmac("sha256", testEnv.HUMANIFY_DIDIT_WEBHOOK_SECRET!)
    .update(webhookBody)
    .digest("hex");

  const webhookResponse = await app.handle(
    new Request("http://humanify.local/callbacks/providers/didit", {
      body: webhookBody,
      headers: {
        "content-type": "application/json",
        "x-signature-v2": webhookSignature,
        "x-timestamp": "1735689600",
      },
      method: "POST",
    }),
  );
  const webhookJson = (await webhookResponse.json()) as {
    data: {
      persistence: string;
      providerBoundary: {
        releaseEligible: boolean;
        status: string;
      };
      reusableCredentialBridge: {
        approvedClaims: string[];
        claims: {
          disclosedAttributes: {
            nationality?: string;
          };
          proofOnlyPredicates: string[];
        };
        contractVersion: string;
        custody: {
          storesDocumentImages: boolean;
          storesFullReusableCredential: boolean;
          storesRawDiditPayload: boolean;
        };
        durableAfterHandoff: {
          retainedFacts: string[];
        };
        handoff: {
          disclosedAttributeKeys: string[];
          proofOnlyClaimKeys: string[];
          requestedClaims: string[];
          targetBackend: string;
        };
        policyInputs: {
          faceVerification: {
            evidenceSource: string;
            passed: boolean;
            performed: boolean;
            satisfiesFaceVerificationRequirement: boolean;
          };
        };
        status: string;
        targetProvider: string;
        temporaryRetention: {
          expiresAt: string;
          retainedClaims: string[];
        };
      };
      session: {
        state: string;
      };
      verification: {
        faceVerificationPassed: boolean;
        faceVerificationPerformed: boolean;
      };
    };
  };

  expect(webhookResponse.status).toBe(200);
  expect(webhookJson.data.persistence).toBe("persisted");
  expect(webhookJson.data.session.state).toBe("passed");
  expect(webhookJson.data.providerBoundary.releaseEligible).toBe(true);
  expect(webhookJson.data.providerBoundary.status).toBe("provider_webhook_verified");
  expect(webhookJson.data.reusableCredentialBridge.status).toBe("issuer_handoff_required");
  expect(webhookJson.data.reusableCredentialBridge.targetProvider).toBe("privado");
  expect(webhookJson.data.reusableCredentialBridge.contractVersion).toBe("reusable_identity_handoff_v1");
  expect(webhookJson.data.reusableCredentialBridge.approvedClaims).toEqual([
    "age_over_18",
    "age_over_21",
    "nationality",
  ]);
  expect(webhookJson.data.reusableCredentialBridge.claims).toEqual({
    disclosedAttributes: {
      nationality: "ESP",
    },
    proofOnlyPredicates: ["age_over_18", "age_over_21"],
  });
  expect(webhookJson.data.reusableCredentialBridge.handoff.targetBackend).toBe("privado");
  expect(webhookJson.data.reusableCredentialBridge.handoff.disclosedAttributeKeys).toEqual(["nationality"]);
  expect(webhookJson.data.reusableCredentialBridge.handoff.proofOnlyClaimKeys).toEqual([
    "age_over_18",
    "age_over_21",
  ]);
  expect(webhookJson.data.reusableCredentialBridge.handoff.requestedClaims).toEqual([
    "age_over_18",
    "age_over_21",
    "nationality",
  ]);
  expect(webhookJson.data.reusableCredentialBridge.durableAfterHandoff.retainedFacts).toEqual([
    "sourceAttestationRef",
    "approvedClaims",
    "disclosedAttributes",
    "proofOnlyPredicates",
    "faceVerification",
    "targetProvider",
    "handoffAuditRef",
  ]);
  expect(webhookJson.data.reusableCredentialBridge.policyInputs.faceVerification).toEqual({
    evidenceSource: "capture_provider",
    passed: true,
    performed: true,
    satisfiesFaceVerificationRequirement: true,
  });
  expect(webhookJson.data.reusableCredentialBridge.custody).toEqual({
    storesDocumentImages: false,
    storesFullReusableCredential: false,
    storesRawDiditPayload: false,
  });
  expect(new Date(webhookJson.data.reusableCredentialBridge.temporaryRetention.expiresAt).getTime()).toBeGreaterThan(fixedNow);
  expect(webhookJson.data.reusableCredentialBridge.temporaryRetention.retainedClaims).toEqual([
    "age_over_18",
    "age_over_21",
    "nationality",
  ]);
  expect(webhookJson.data.verification.faceVerificationPerformed).toBe(true);
  expect(webhookJson.data.verification.faceVerificationPassed).toBe(true);

  const persistedRecord = await verificationSessionsRepository.getSession(created.data.session.sessionId);
  expect(persistedRecord).toMatchObject({
    providerStatus: {
      purge: {
        attemptedAt: new Date(fixedNow).toISOString(),
        outcome: "deleted",
      },
      requestedClaims: ["age_over_18", "nationality"],
      selectedProvider: "didit",
      status: "provider_webhook_verified",
      verifiedWebhook: {
        providerStatus: "Approved",
        timestamp: "1735689600",
        webhookType: "status.updated",
        workflowId: testEnv.HUMANIFY_DIDIT_WORKFLOW_ID,
      },
      workflowId: testEnv.HUMANIFY_DIDIT_WORKFLOW_ID,
    },
    resultSummary: {
      authoritativeSource: "didit_decision_api",
      faceVerificationPassed: true,
      faceVerificationPerformed: true,
      providerReferenceId: "didit_session_123",
      providerStatus: "Approved",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["document_identity", "age_over_18", "age_over_21", "nationality", "liveness", "face_verification"],
    },
    state: "passed",
  });
  expect(JSON.stringify(persistedRecord)).not.toContain("idVerifications");
  expect(JSON.stringify(persistedRecord)).not.toContain("livenessChecks");

  const statusResponse = await app.handle(
    new Request(
      `http://humanify.local/verification/sessions/${created.data.session.sessionId}?token=${encodeURIComponent(created.data.challengeToken)}`,
    ),
  );
  const statusJson = (await statusResponse.json()) as {
    data: {
      providerBoundary: {
        releaseEligible: boolean;
      };
      reusableCredentialBridge: {
        claims: {
          disclosedAttributes: {
            nationality?: string;
          };
        };
        status: string;
        targetProvider: string;
      };
      session: {
        state: string;
      };
      verification: {
        faceVerificationPassed: boolean;
        faceVerificationPerformed: boolean;
        providerReferenceId: string;
        satisfiedClaims: string[];
      };
    };
  };

  expect(statusResponse.status).toBe(200);
  expect(statusJson.data.session.state).toBe("passed");
  expect(statusJson.data.providerBoundary.releaseEligible).toBe(true);
  expect(statusJson.data.reusableCredentialBridge.status).toBe("issuer_handoff_required");
  expect(statusJson.data.reusableCredentialBridge.targetProvider).toBe("privado");
  expect(statusJson.data.reusableCredentialBridge.claims.disclosedAttributes.nationality).toBe("ESP");
  expect(statusJson.data.verification).toMatchObject({
    faceVerificationPassed: true,
    faceVerificationPerformed: true,
    providerReferenceId: "didit_session_123",
    satisfiedClaims: ["document_identity", "age_over_18", "age_over_21", "nationality", "liveness", "face_verification"],
  });
});

test("didit callbacks reject invalid signatures before mutating canonical session state", async () => {
  const verificationSessionsRepository = createInMemoryVerificationSessionsRepository();
  const app = createTestApp({
    verificationSessionsRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "document_identity"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };
  await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "didit",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  const webhookResponse = await app.handle(
    new Request("http://humanify.local/callbacks/providers/didit", {
      body: JSON.stringify({
        session_id: "didit_session_123",
        status: "Approved",
        vendor_data: created.data.session.sessionId,
      }),
      headers: {
        "content-type": "application/json",
        "x-signature-v2": "not-valid",
        "x-timestamp": "1735689600",
      },
      method: "POST",
    }),
  );
  const webhookJson = await webhookResponse.json() as {
    errorCode: string;
  };

  expect(webhookResponse.status).toBe(401);
  expect(webhookJson.errorCode).toBe("provider_callback_invalid");
  expect(await verificationSessionsRepository.getSession(created.data.session.sessionId)).toMatchObject({
    providerStatus: {
      status: "didit_session_created",
    },
    resultSummary: {},
    state: "provider_pending",
  });
});

test("challenge completion accepts a consumer-selected age-only proof bundle", async () => {
  const app = createTestApp();
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "self",
        requestedClaims: ["age_over_18"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      providerBoundary: {
        requestedClaims: string[];
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.data.providerBoundary.requestedClaims).toEqual(["age_over_18"]);
});

test("challenge completion exposes a reusable-proof start contract when Privado is configured", async () => {
  const app = createTestApp({
    env: privadoEnabledTestEnv,
    privadoVerifierBackendClient: createFakePrivadoVerifierBackendClient(),
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = await createResponse.json() as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "privado",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = await response.json() as {
    data: {
      providerBoundary: {
        providerFlowConfigured: boolean;
        providerStartEndpoint?: string;
        providerStartToken?: string;
        selectedProvider: string;
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.data.providerBoundary.selectedProvider).toBe("privado");
  expect(json.data.providerBoundary.providerFlowConfigured).toBe(true);
  expect(json.data.providerBoundary.providerStartEndpoint).toBe(
    `/verification/sessions/${created.data.session.sessionId}/providers/privado/start`,
  );
  expect(json.data.providerBoundary.providerStartToken).toContain(".");
});

test("Privado reusable-proof start returns a wallet launch and signed provider session token", async () => {
  const app = createTestApp({
    env: privadoEnabledTestEnv,
    privadoVerifierBackendClient: createFakePrivadoVerifierBackendClient(),
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = await createResponse.json() as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };
  const completeResponse = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "privado",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const completed = await completeResponse.json() as {
    data: {
      providerBoundary: {
        providerStartToken: string;
      };
    };
  };

  const response = await app.handle(
    new Request(
      `http://humanify.local/verification/sessions/${created.data.session.sessionId}/providers/privado/start`,
      {
        body: JSON.stringify({
          backUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
          finishUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
          providerStartToken: completed.data.providerBoundary.providerStartToken,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    ),
  );
  const json = await response.json() as {
    data: {
      flow: {
        providerSessionId: string;
        providerSessionToken: string;
        request: {
          scope: Array<{
            query: {
              type: string;
            };
          }>;
        };
        universalLink: string;
      };
      providerBoundary: {
        status: string;
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.data.flow.providerSessionId).toBe("privado_backend_session_123");
  expect(json.data.flow.providerSessionToken).toContain(".");
  expect(json.data.flow.universalLink).toContain("https://wallet.privado.id/#request_uri=");
  expect(json.data.flow.request.scope.map((entry) => entry.query.type)).toEqual([
    "KYCAgeCredential",
    "KYCCountryOfResidenceCredential",
  ]);
  expect(json.data.providerBoundary.status).toBe("proof_request_created");
});

test("Privado proof verification reduces backend status to predicates, nullifiers, and minimal receipt refs", async () => {
  let expectedNullifierSessionId = "";
  const verificationSessionsRepository = createInMemoryVerificationSessionsRepository();
  const app = createTestApp({
    env: privadoEnabledTestEnv,
    privadoVerifierBackendClient: {
      async createProofRequest(request) {
        expect(request.scope.length).toBeGreaterThan(0);
        return {
          qrCode: "iden3comm://?request_uri=https%3A%2F%2Fverifier-backend.privado.id%2Fqr-store%3Fid%3Dproof_123",
          sessionID: "privado_backend_session_123",
        };
      },
      async readProofStatus(sessionId) {
        expect(sessionId).toBe("privado_backend_session_123");
        return {
          jwz: "proof-token",
          jwzMetadata: {
            nullifiers: [
              {
                nullifier: "nullifier_age",
                nullifierSessionID: expectedNullifierSessionId,
                scopeID: 1,
              },
              {
                nullifier: "nullifier_country",
                nullifierSessionID: expectedNullifierSessionId,
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
        };
      },
    },
    verificationSessionsRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha", "age_over_18"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = await createResponse.json() as {
    data: {
      challengeToken: string;
      session: {
        challengeId: string;
        sessionId: string;
      };
    };
  };
  expectedNullifierSessionId = created.data.session.sessionId;
  const completeResponse = await app.handle(
    new Request(`http://humanify.local/verification/challenges/${created.data.session.challengeId}/complete`, {
      body: JSON.stringify({
        guildId: "guild_123",
        providerId: "privado",
        requestedClaims: ["age_over_18", "nationality"],
        sessionId: created.data.session.sessionId,
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const completed = await completeResponse.json() as {
    data: {
      providerBoundary: {
        providerStartToken: string;
      };
    };
  };
  const startResponse = await app.handle(
    new Request(
      `http://humanify.local/verification/sessions/${created.data.session.sessionId}/providers/privado/start`,
      {
        body: JSON.stringify({
          providerStartToken: completed.data.providerBoundary.providerStartToken,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    ),
  );
  const started = await startResponse.json() as {
    data: {
      flow: {
        providerSessionToken: string;
      };
    };
  };

  const response = await app.handle(
    new Request("http://humanify.local/verification/providers/privado/proof", {
      body: JSON.stringify({
        providerSessionToken: started.data.flow.providerSessionToken,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = await response.json() as {
    data: {
      persistence: string;
      providerBoundary: {
        releaseEligible: boolean;
        status: string;
      };
      session: {
        state: string;
      };
      verification: {
        nullifierRefs: string[];
        proofReceipt: {
          nullifiers: Array<{
            nullifier: string;
          }>;
          proofReceiptHash?: string;
          proofReceiptRef?: string;
        };
        proofReceiptHash?: string;
        proofReceiptRef?: string;
        satisfiedClaims: string[];
        status: string;
      };
    };
  };

  expect(response.status).toBe(200);
  expect(json.data.persistence).toBe("persisted");
  expect(json.data.providerBoundary.releaseEligible).toBe(true);
  expect(json.data.providerBoundary.status).toBe("provider_proof_verified");
  expect(json.data.session.state).toBe("passed");
  expect(json.data.verification.status).toBe("verified");
  expect(json.data.verification.satisfiedClaims).toEqual(["age_over_18", "nationality"]);
  expect(json.data.verification.proofReceipt.proofReceiptRef).toBe("privado:session:privado_backend_session_123");
  expect(json.data.verification.proofReceipt.proofReceiptHash).toContain("sha256:");
  expect(json.data.verification.proofReceiptRef).toBe("privado:session:privado_backend_session_123");
  expect(json.data.verification.proofReceiptHash).toContain("sha256:");
  expect(json.data.verification.nullifierRefs).toEqual(["nullifier_age", "nullifier_country"]);
  expect(json.data.verification.proofReceipt.nullifiers.map((entry) => entry.nullifier)).toEqual([
    "nullifier_age",
    "nullifier_country",
  ]);
  expect(await verificationSessionsRepository.getSession(created.data.session.sessionId)).toMatchObject({
    providerStatus: {
      providerSessionId: "privado_backend_session_123",
      requestedClaims: ["age_over_18", "nationality"],
      selectedProvider: "privado",
      status: "provider_proof_verified",
    },
    resultSummary: {
      authoritativeSource: "privado_verifier_backend_status",
      nullifierRefs: ["nullifier_age", "nullifier_country"],
      proofReceiptRef: "privado:session:privado_backend_session_123",
      providerReferenceId: "privado_backend_session_123",
      providerStatus: "success",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["age_over_18", "nationality"],
      trustedIssuerScopes: ["did:issuer:age", "did:issuer:nationality"],
      verifiablePresentationCount: 2,
    },
    state: "passed",
  });

  const statusResponse = await app.handle(
    new Request(
      `http://humanify.local/verification/sessions/${created.data.session.sessionId}?token=${encodeURIComponent(created.data.challengeToken)}`,
    ),
  );
  const statusJson = await statusResponse.json() as {
    data: {
      providerBoundary: {
        handoffKind: string;
        providerServerEndpoint: string;
        releaseEligible: boolean;
        selectedProvider: string;
        status: string;
      };
      session: {
        state: string;
      };
      verification: {
        nullifierRefs: string[];
        proofReceiptHash?: string;
        proofReceiptRef?: string;
        satisfiedClaims: string[];
      };
    };
  };

  expect(statusResponse.status).toBe(200);
  expect(statusJson.data.session.state).toBe("passed");
  expect(statusJson.data.providerBoundary.handoffKind).toBe("server_verified_proof");
  expect(statusJson.data.providerBoundary.providerServerEndpoint).toBe("/verification/providers/privado/proof");
  expect(statusJson.data.providerBoundary.releaseEligible).toBe(true);
  expect(statusJson.data.providerBoundary.selectedProvider).toBe("privado");
  expect(statusJson.data.providerBoundary.status).toBe("provider_proof_verified");
  expect(statusJson.data.verification.nullifierRefs).toEqual(["nullifier_age", "nullifier_country"]);
  expect(statusJson.data.verification.proofReceiptRef).toBe("privado:session:privado_backend_session_123");
  expect(statusJson.data.verification.proofReceiptHash).toContain("sha256:");
  expect(statusJson.data.verification.satisfiedClaims).toEqual(["age_over_18", "nationality"]);
});

test("verification release applies configured Discord role grants after a passed session", async () => {
  const verificationConfigRepository = createInMemoryGuildVerificationConfigRepository();
  const verificationSessionsRepository = createInMemoryVerificationSessionsRepository();
  await persistVerificationConfig(verificationConfigRepository, {
    roleGrantBindings: [
      { roleId: "role_human", trigger: "verified_human" },
      { roleId: "role_18", trigger: "age_over_18" },
      { roleId: "role_21", trigger: "age_over_21" },
    ],
  });
  const appliedRoleCalls: Array<{
    auditLogReason: string;
    guildId: string;
    roleIds: string[];
    userId: string;
  }> = [];
  const app = createTestApp({
    guildVerificationConfigRepository: verificationConfigRepository,
    verificationRoleReleaseExecutor: {
      async applyRoleGrants(input) {
        appliedRoleCalls.push({
          auditLogReason: input.auditLogReason,
          guildId: input.guildId,
          roleIds: [...input.roleIds],
          userId: input.userId,
        });
      },
    },
    verificationSessionsRepository,
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        sessionId: string;
      };
    };
  };

  await verificationSessionsRepository.recordReusableProofResult({
    providerId: "privado",
    providerSessionId: "privado_backend_session_123",
    requestedClaims: ["age_over_18", "age_over_21"],
    resultSummary: {
      authoritativeSource: "privado_verifier_backend_status",
      message: "Proof verified.",
      satisfiedClaims: ["age_over_18", "age_over_21"],
      status: "verified",
    },
    sessionId: created.data.session.sessionId,
    state: "passed",
  });

  const response = await app.handle(
    new Request(`http://humanify.local/verification/sessions/${created.data.session.sessionId}/release`, {
      body: JSON.stringify({
        guildId: "guild_123",
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      providerBoundary: {
        nextStep: string;
        releaseEligible: boolean;
        status: string;
      };
      release: {
        appliedRoleIds: string[];
        releasedAt: string;
        triggerKeys: string[];
      };
      session: {
        state: string;
      };
    };
  };

  expect(response.status).toBe(200);
  expect(appliedRoleCalls).toEqual([
    expect.objectContaining({
      guildId: "guild_123",
      roleIds: ["role_human", "role_18", "role_21"],
      userId: "user_123",
    }),
  ]);
  expect(json.data.providerBoundary.nextStep).toBe("released");
  expect(json.data.providerBoundary.releaseEligible).toBe(false);
  expect(json.data.providerBoundary.status).toBe("released");
  expect(json.data.release.appliedRoleIds).toEqual(["role_human", "role_18", "role_21"]);
  expect(json.data.release.triggerKeys).toEqual(["verified_human", "age_over_18", "age_over_21"]);
  expect(json.data.release.releasedAt).toBeTruthy();
  expect(json.data.session.state).toBe("released");
});

test("verification release stays blocked until server-side provider verification can prove a passed session", async () => {
  const app = createTestApp({
    verificationRoleReleaseExecutor: {
      async applyRoleGrants() {
        throw new Error("release should not run for an unpassed session");
      },
    },
  });
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = (await createResponse.json()) as {
    data: {
      challengeToken: string;
      session: {
        sessionId: string;
      };
    };
  };

  const response = await app.handle(
    new Request(`http://humanify.local/verification/sessions/${created.data.session.sessionId}/release`, {
      body: JSON.stringify({
        guildId: "guild_123",
        token: created.data.challengeToken,
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(409);
  expect(json.errorCode).toBe("conflict");
  expect(json.message).toContain("provider handoff");
});

test("moderation routes refuse actions that exceed Bun policy clamps", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/moderation/ban", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        capabilityContext: {
          canBan: true,
          canKick: true,
          canManageRoles: true,
          canTimeout: true,
        },
        caseContext: {
          appealOpen: false,
          existingOpenCase: false,
          verificationStatus: "unknown",
        },
        caseId: "case_123",
        riskDecision: {
          confidence: 0.99,
          evidenceRefs: [],
          recommendedAction: "ban",
          reasonCodes: ["behavior_raid_spike"],
          score: 10,
        },
        serverPolicy: {
          allowAutoBan: false,
          maxAutomaticAction: "quarantine",
        },
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(403);
  expect(json.errorCode).toBe("forbidden");
  expect(json.message).toContain("server_policy_clamp");
});

test("contracts summary route exposes the shared schema metadata", async () => {
  const app = createTestApp();
  const response = await app.handle(new Request("http://humanify.local/contracts/summary"));
  const json = (await response.json()) as {
    contractVersion: string;
    schemaPath: string;
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.schemaPath).toBe("docs\\contracts\\humanify-contracts.schema.json");
});

test("api main file keeps provider-specific branching inside dedicated runtimes", () => {
  const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

  expect(source).not.toContain('providerId === "didit"');
  expect(source).not.toContain('providerId === "privado"');
  expect(source).not.toContain('providerId !== "privado"');
  expect(source).not.toContain('selectedProvider === "didit"');
  expect(source).not.toContain('selectedProvider === "privado"');
  expect(source).not.toContain('params.providerId !== "didit"');
  expect(source).not.toContain("buildPrivadoWalletLaunch");
  expect(source).not.toContain("createPrivadoReusableCredentialBridge");
  expect(source).not.toContain("createPrivadoVerificationPlan");
  expect(source).not.toContain("normalizePrivadoVerificationResult");
});
