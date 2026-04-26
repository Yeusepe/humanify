/**
 * Purpose: Exercises the first cross-boundary adversarial and end-to-end flows across the real Bun API, Discord bot intake, verifier signed-link helpers, and canonical report/case test repository.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\discord-bot.md
 * - docs\verification.md
 * - docs\cases-and-reports.md
 * - docs\learning.md
 * - docs\observability-security.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://discord.js.org/docs/packages/discord.js/main
 * - https://developer.mozilla.org/docs/Web/API/Fetch_API
 * Tests:
 * - apps/api-bun/src/adversarial-e2e.test.ts
 */

import { expect, test } from "bun:test";

import { parseComponentCustomId } from "@humanify/discord-core";

import { createBotApiClient, createInteractionHandler, decideApprovedActionExecution } from "../../bot-bun/src/index";
import { completeVerificationChallenge, fetchVerificationSession } from "../../verifier-start/src/verification-flow";
import { createApiApp, type HumanifyApiApp, type LearningServiceClient } from "./app";
import {
  createInMemoryGuildChannelConfigRepository,
  createInMemoryGuildVerificationConfigRepository,
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
  HUMANIFY_POSTGRES_URL: "postgres://humanify:secret@localhost:5432/humanify",
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
      return {
        accepted: true,
        candidateSignals: outcome.outcome === "false_positive" || outcome.outcome === "dismissed" || outcome.outcome === "overturned"
          ? []
          : [{
            confidence: outcome.confidence,
            id: `candidate:${outcome.caseId}`,
            sourceCaseIds: [outcome.caseId],
            type: "text_similarity",
            valueHash: outcome.subjectUserIdHash,
            weight: 2.5,
          }],
        caseId: outcome.caseId,
        contractVersion: "0.1.0",
        notes: ["learning service accepted the moderator-confirmed outcome."],
      };
    },
  };
}

function createTestApp(
  repository = createInMemoryReportCasesRepository(),
  learningServiceClient = createFakeLearningServiceClient(),
) {
  return createApiApp({
    env: testEnv,
    guildChannelConfigRepository: createInMemoryGuildChannelConfigRepository(),
    guildVerificationConfigRepository: createInMemoryGuildVerificationConfigRepository(),
    learningServiceClient,
    now: () => fixedNow,
    reportCasesRepository: repository,
    verificationSessionsRepository: createInMemoryVerificationSessionsRepository(),
  });
}

function createAppFetch(app: HumanifyApiApp): typeof fetch {
  return Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request
        ? input
        : new Request(input.toString(), init);

      return await app.handle(request);
    },
    {
      preconnect() {
        return;
      },
    },
  ) as typeof fetch;
}

async function readJson<T>(response: Response) {
  return await response.json() as T;
}

test("message-context intake, verifier signed links, and moderation planning stay honest across bot, API, and verifier boundaries", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp(repository);
  const fetchFn = createAppFetch(app);
  const apiClient = createBotApiClient({
    apiBaseUrl: "http://humanify.local",
    fetchFn,
  });
  const handler = createInteractionHandler({ apiClient });
  const replies: unknown[] = [];

  await handler({
    commandName: "Report message to Humanify",
    guildId: "guild_123",
    inGuild: () => true,
    isButton: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => true,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    targetMessage: {
      author: { id: "user_123" },
      channelId: "channel_123",
      content: "Claim your free Nitro gift now at http://scam.example",
      id: "message_123",
    },
    user: { id: "mod_123" },
  } as any);

  const intakeReply = replies[0] as {
    components: Array<{ toJSON(): { components: Array<{ custom_id?: string }> } }>;
    content: string;
  };
  const verificationShortcut = intakeReply.components[0]?.toJSON().components[0]?.custom_id ?? "";
  const parsedShortcut = parseComponentCustomId(verificationShortcut);
  const [caseId, userId] = parsedShortcut.entityId.split("~");

  expect(intakeReply.content).toContain("Canonical Postgres state was recorded");
  expect(parsedShortcut).toMatchObject({
    entityId: expect.stringContaining("~"),
    guildId: "guild_123",
    kind: "verification_start",
  });

  const casesResponse = await app.handle(new Request("http://humanify.local/guilds/guild_123/cases"));
  const listed = await readJson<{
    data: {
      items: Array<{
        caseId: string;
        evidenceCount: number;
        reportCount: number;
      }>;
      readModelStatus: string;
    };
  }>(casesResponse);

  expect(casesResponse.status).toBe(200);
  expect(listed.data.readModelStatus).toBe("canonical_postgres");
  expect(listed.data.items).toEqual([
    expect.objectContaining({
      caseId,
      evidenceCount: 1,
      reportCount: 1,
    }),
  ]);

  const verification = await apiClient.createVerificationSession("guild_123", {
    caseId,
    initiatedBy: "mod_123",
    requiredCapabilities: ["captcha"],
    userId,
  });

  expect(verification.persistence).toBe("persisted");

  const session = await fetchVerificationSession(fetchFn, {
    apiBaseUrl: "http://humanify.local",
    sessionId: verification.session.sessionId,
    token: verification.challengeToken,
  });

  expect(session.persistence).toBe("persisted");
  expect(session.session).toMatchObject({
    sessionId: verification.session.sessionId,
    state: "challenge_issued",
    userId,
  });

  const completed = await completeVerificationChallenge(fetchFn, {
    apiBaseUrl: "http://humanify.local",
    challengeId: verification.session.challengeId,
    guildId: "guild_123",
    providerId: "self",
    requestedClaims: ["age_over_18", "nationality"],
    sessionId: verification.session.sessionId,
    token: verification.challengeToken,
    userId,
  });

  expect(completed.persistence).toBe("planned_not_persisted");
  expect(completed.providerBoundary.status).toBe("pending_provider_verification");

  const releaseResponse = await app.handle(
    new Request(`http://humanify.local/verification/sessions/${verification.session.sessionId}/release`, {
      body: JSON.stringify({
        guildId: "guild_123",
        token: verification.challengeToken,
        userId,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const releaseError = await readJson<{
    errorCode: string;
    message: string;
  }>(releaseResponse);

  expect(releaseResponse.status).toBe(409);
  expect(releaseError.errorCode).toBe("conflict");
  expect(releaseError.message).toContain("provider handoff");

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
          existingOpenCase: true,
          verificationStatus: "pending",
        },
        caseId,
        riskDecision: {
          confidence: 0.92,
          evidenceRefs: ["message_123"],
          recommendedAction: "quarantine",
          reasonCodes: ["similar_to_confirmed_scam_template"],
          score: 8,
        },
        serverPolicy: {
          allowAutoBan: false,
          maxAutomaticAction: "quarantine",
          quarantineAtOrAbove: 7,
          verificationRequiredAtOrAbove: 6,
        },
        subjectUserId: userId,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const moderation = await readJson<{
    data: {
      auditReason: string;
      durability: string;
      executionPlan: {
        executable: boolean;
        resolvedAction: "quarantine";
      };
    };
  }>(moderationResponse);

  expect(moderationResponse.status).toBe(202);
  expect(decideApprovedActionExecution({
    approval: moderation.data,
    capabilities: {
      canBan: true,
      canKick: true,
      canManageRoles: true,
      canTimeout: true,
    },
    requestedAction: "quarantine",
  })).toEqual({
    executable: false,
    reason: "backend_commit_pending",
    resolvedAction: "quarantine",
  });
});

test("duplicate report and evidence submissions reuse idempotency receipts instead of creating extra canonical rows", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp(repository);

  const firstReportResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "raid invite spam",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "report-key-1",
      },
      method: "POST",
    }),
  );
  const secondReportResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "raid invite spam",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "report-key-1",
      },
      method: "POST",
    }),
  );
  const firstReport = await readJson<{
    data: {
      report: {
        caseId?: string;
        reportId: string;
      };
    };
  }>(firstReportResponse);
  const secondReport = await readJson<typeof firstReport>(secondReportResponse);

  expect(firstReportResponse.status).toBe(201);
  expect(secondReportResponse.status).toBe(201);
  expect(secondReport.data.report).toEqual(firstReport.data.report);

  const firstEvidenceResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${firstReport.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_123",
        messageId: "message_123",
        messagePreview: "raid invite spam",
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "evidence-key-1",
      },
      method: "POST",
    }),
  );
  const secondEvidenceResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${firstReport.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_123",
        messageId: "message_123",
        messagePreview: "raid invite spam",
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "evidence-key-1",
      },
      method: "POST",
    }),
  );
  const firstEvidence = await readJson<{
    data: {
      evidence: {
        evidenceId: string;
      };
    };
  }>(firstEvidenceResponse);
  const secondEvidence = await readJson<typeof firstEvidence>(secondEvidenceResponse);

  expect(firstEvidenceResponse.status).toBe(201);
  expect(secondEvidenceResponse.status).toBe(201);
  expect(secondEvidence.data.evidence.evidenceId).toBe(firstEvidence.data.evidence.evidenceId);

  const detailResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${firstReport.data.report.caseId}`),
  );
  const detail = await readJson<{
    data: {
      evidence: Array<{ evidenceId: string }>;
      reports: Array<{ reportId: string }>;
    };
  }>(detailResponse);

  expect(detailResponse.status).toBe(200);
  expect(detail.data.reports).toHaveLength(1);
  expect(detail.data.evidence).toHaveLength(1);
});

test("false-positive review replays suppress learned candidates and leave the case in an honest dismissed state", async () => {
  const repository = createInMemoryReportCasesRepository();
  const app = createTestApp(repository);

  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "free nitro scam",
        reporterNotes: "same scam copy",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_999",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const created = await readJson<{
    data: {
      report: {
        caseId?: string;
        reportId: string;
      };
    };
  }>(createResponse);

  await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${created.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_999",
        messageId: "message_999",
        messagePreview: "Claim your free Nitro gift now at http://scam.example",
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  const confirmedResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/review`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        confidence: 0.94,
        outcome: "confirmed_scam",
        rationale: "confirmed",
        reasonCodes: ["similar_to_confirmed_scam_template"],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const confirmed = await readJson<{
    data: {
      learning: {
        appliedSignalCount: number;
      };
    };
  }>(confirmedResponse);

  expect(confirmedResponse.status).toBe(201);
  expect(confirmed.data.learning.appliedSignalCount).toBeGreaterThan(0);
  expect(await repository.listLearnedSignalCandidates({ guildId: "guild_123" })).not.toHaveLength(0);

  const suppressedResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}/review`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        confidence: 0.78,
        outcome: "false_positive",
        reasonCodes: ["prior_false_positive"],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const suppressed = await readJson<{
    data: {
      learning: {
        status: string;
        suppressedSignalCount: number;
      };
      review: {
        outcome: string;
      };
    };
  }>(suppressedResponse);

  expect(suppressedResponse.status).toBe(201);
  expect(suppressed.data.review.outcome).toBe("false_positive");
  expect(suppressed.data.learning.status).toBe("applied");
  expect(suppressed.data.learning.suppressedSignalCount).toBeGreaterThan(0);
  expect(await repository.listLearnedSignalCandidates({ guildId: "guild_123" })).toEqual([]);

  const detailResponse = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/cases/${created.data.report.caseId}`),
  );
  const detail = await readJson<{
    data: {
      case: {
        status: string;
      };
    };
  }>(detailResponse);

  expect(detail.data.case.status).toBe("dismissed");
});
