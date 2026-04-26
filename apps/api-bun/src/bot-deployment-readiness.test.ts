/**
 * Purpose: Measures whether the current Humanify stack is ready to catch likely bots in a live server by asserting the implemented advisory and enforcement boundaries.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\discord-bot.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://developer.mozilla.org/docs/Web/API/Fetch_API
 * Tests:
 * - apps/api-bun/src/bot-deployment-readiness.test.ts
 */

import { expect, test } from "bun:test";

import { decideApprovedActionExecution } from "../../bot-bun/src/index";
import { createApiApp } from "./app";
import { createInMemoryReportCasesRepository } from "./test-support";

const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
const testEnv = {
  DISCORD_CLIENT_ID: "client_123",
  DISCORD_CLIENT_SECRET: "secret_123",
  DISCORD_REDIRECT_URI: "https://humanify.test/auth/discord/callback",
  HUMANIFY_ENVIRONMENT: "test",
  HUMANIFY_MAX_AUTOMATIC_ACTION: "quarantine",
  HUMANIFY_POSTGRES_URL: "postgres://humanify:secret@localhost:5432/humanify",
  HUMANIFY_REDIS_URL: "redis://localhost:6379",
  HUMANIFY_SECURE_COOKIES: "false",
  HUMANIFY_SERVICE_NAME: "api-bun",
  HUMANIFY_SESSION_SECRET: "session-secret",
} satisfies Record<string, string | undefined>;

function createTestApp() {
  return createApiApp({
    env: testEnv,
    now: () => fixedNow,
    reportCasesRepository: createInMemoryReportCasesRepository(),
  });
}

test("likely bot reports reach the risk queue as advisory signals rather than automatic catches", async () => {
  const app = createTestApp();
  const triggerFingerprint = "discord-message:guild_123:channel_raid:message_raid";

  for (const reporterUserId of ["trusted_mod", "reporter_two", "reporter_three"]) {
    await app.handle(
      new Request("http://humanify.local/guilds/guild_123/reports", {
        body: JSON.stringify({
          intakeSource: "message_context",
          openCase: true,
          reportReason: "possible raid bot burst",
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
        subjectUserId: string;
        trustSignals: {
          uniqueReporterCount: number;
        };
      }>;
    };
  };

  expect(riskQueueResponse.status).toBe(200);
  expect(riskQueue.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      advisoryOnly: true,
      anomalySignals: expect.arrayContaining(["coordinated_report_burst"]),
      subjectUserId: "burst_user",
      trustSignals: expect.objectContaining({
        uniqueReporterCount: 3,
      }),
    }),
  ]));
});

test("high-risk bot containment is still not deploy-ready for autonomous enforcement while moderation approvals remain planning-only", async () => {
  const app = createTestApp();
  const moderationResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/moderation/quarantine", {
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
        caseId: "case_bot_123",
        riskDecision: {
          confidence: 0.99,
          evidenceRefs: ["message_123"],
          recommendedAction: "quarantine",
          reasonCodes: ["behavior_pattern_match", "coordinated_report_burst"],
          score: 9,
        },
        serverPolicy: {
          allowAutoBan: false,
          maxAutomaticAction: "quarantine",
          quarantineAtOrAbove: 7,
          verificationRequiredAtOrAbove: 6,
        },
        subjectUserId: "user_bot_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const moderation = (await moderationResponse.json()) as {
    data: {
      durability: string;
      executionPlan: {
        executable: boolean;
        resolvedAction: "quarantine";
      };
      executorState: string;
    };
  };

  expect(moderationResponse.status).toBe(202);
  expect(moderation.data.durability).toBe("planned_not_persisted");
  expect(moderation.data.executorState).toBe("approved_but_backend_commit_pending");
  expect(
    decideApprovedActionExecution({
      approval: {
        auditReason: "case:case_bot_123 action:quarantine request:req_123 reasons:behavior_pattern_match",
        durability: moderation.data.durability,
        executionPlan: moderation.data.executionPlan,
      },
      capabilities: {
        canBan: true,
        canKick: true,
        canManageRoles: true,
        canTimeout: true,
      },
      requestedAction: "quarantine",
    }),
  ).toEqual({
    executable: false,
    reason: "backend_commit_pending",
    resolvedAction: "quarantine",
  });
});
