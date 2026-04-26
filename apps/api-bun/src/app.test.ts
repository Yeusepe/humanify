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

import { expect, test } from "bun:test";

import { humanifyContractVersion } from "@humanify/contracts";
import { extractTraceContext } from "@humanify/telemetry";

import { createApiApp, type LearningServiceClient } from "./app";
import { createInMemoryReportCasesRepository } from "./test-support";

const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);

const testEnv = {
  DISCORD_CLIENT_ID: "client_123",
  DISCORD_CLIENT_SECRET: "secret_123",
  DISCORD_REDIRECT_URI: "https://humanify.test/auth/discord/callback",
  HUMANIFY_ENVIRONMENT: "test",
  HUMANIFY_MAX_AUTOMATIC_ACTION: "quarantine",
  HUMANIFY_POSTGRES_URL: "postgres://humanify:secret@localhost:5432/humanify",
  HUMANIFY_REDIST_URL: undefined,
  HUMANIFY_REDIS_URL: "redis://localhost:6379",
  HUMANIFY_RELEASE: "test-suite",
  HUMANIFY_SECURE_COOKIES: "false",
  HUMANIFY_SERVICE_NAME: "api-bun",
  HUMANIFY_SESSION_COOKIE_NAME: "humanify_session",
  HUMANIFY_SESSION_SECRET: "session-secret",
  HUMANIFY_SESSION_TTL_SECONDS: "3600",
} satisfies Record<string, string | undefined>;

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

function createTestApp(
  reportCasesRepository = createInMemoryReportCasesRepository(),
  learningServiceClient = createFakeLearningServiceClient(),
) {
  return createApiApp({
    env: testEnv,
    learningServiceClient,
    now: () => fixedNow,
    reportCasesRepository,
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
  const app = createTestApp(repository);
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

test("case review persists canonical outcomes and applies learned candidates from moderator-confirmed evidence", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp(repository);
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

test("case review keeps canonical outcomes durable when learning-rs is unavailable", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp(repository, {
    async ingestCaseOutcome() {
      throw new Error("service unavailable");
    },
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

test("verification session creation returns an honest planned write plus challenge token", async () => {
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

  expect(response.status).toBe(202);
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
      callbackBoundary: {
        providerCallbacksConfigured: boolean;
      };
      persistence: string;
      session: {
        requiredCapabilities: string[];
        state: string;
      };
    };
  };

  expect(response.status).toBe(200);
  expect(json.data.persistence).toBe("derived_from_signed_challenge");
  expect(json.data.session.state).toBe("challenge_issued");
  expect(json.data.session.requiredCapabilities).toEqual(["captcha", "human_presence"]);
  expect(json.data.callbackBoundary.providerCallbacksConfigured).toBe(false);
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

test("verification release stays blocked until provider callbacks can prove a passed session", async () => {
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
  expect(json.message).toContain("provider callback");
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
