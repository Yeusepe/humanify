/**
 * Purpose: Verifies API shapes needed by the first real Discord bot intake flow remain honest and message-context aware.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\discord-bot.md
 * - docs\verification.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://elysiajs.com/essential/validation
 * Tests:
 * - apps/api-bun/src/app.bot-intake.test.ts
 */

import { expect, test } from "bun:test";

import { createApiApp } from "./app";
import { createInMemoryGuildChannelConfigRepository, createInMemoryReportCasesRepository } from "./test-support";

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
    guildChannelConfigRepository: createInMemoryGuildChannelConfigRepository(),
    now: () => fixedNow,
    reportCasesRepository: createInMemoryReportCasesRepository(),
  });
}

test("report evidence intake accepts canonical Discord message metadata", async () => {
  const app = createTestApp();
  const createResponse = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        intakeSource: "message_context",
        openCase: true,
        reportReason: "spam link",
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
        reportId: string;
      };
    };
  };
  const response = await app.handle(
    new Request(`http://humanify.local/guilds/guild_123/reports/${created.data.report.reportId}/evidence`, {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_123",
        messageId: "message_123",
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      evidence: {
        channelId: string;
        externalRef: string;
        messageId: string;
        subjectUserId: string;
      };
      processingState: string;
    };
  };

  expect(response.status).toBe(201);
  expect(json.data.evidence).toMatchObject({
    channelId: "channel_123",
    externalRef: "https://discord.com/channels/guild_123/channel_123/message_123",
    messageId: "message_123",
    subjectUserId: "user_123",
  });
  expect(json.data.processingState).toBe("message_link_canonical");
});

test("report evidence intake rejects non-canonical message links", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports/report_123/evidence", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://evil.example/channels/guild_123/channel_123/message_123",
        messageId: "message_123",
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

  expect(response.status).toBe(400);
  expect(json.errorCode).toBe("validation_failed");
  expect(json.message).toContain("canonical");
});
