/**
 * Purpose: Covers the Temporal scan worker's durable member-scan helpers without requiring a live Temporal server.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://discord.com/developers/docs/reference#snowflakes
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { expect, test } from "bun:test";

import { createScanActivities } from "./activities";
import { buildTemporalWorkflowId } from "./index";
import { createEmptyScanSummary, discordSnowflakeToTimestamp, mergeScanSummary, processMemberScanCandidate } from "./scan-runtime";

function toComponentJson(component: unknown): Record<string, unknown> {
  if (typeof component === "object" && component !== null && "toJSON" in component && typeof (component as { toJSON?: unknown }).toJSON === "function") {
    return ((component as { toJSON(): Record<string, unknown> }).toJSON());
  }

  return component as Record<string, unknown>;
}

function extractDiscordMessageText(payload: { components?: readonly unknown[] }) {
  const lines: string[] = [];
  const walk = (components: readonly unknown[] | undefined) => {
    for (const component of components ?? []) {
      const json = toComponentJson(component);
      if (typeof json.content === "string" && json.content.length > 0) {
        lines.push(json.content);
      }

      if (Array.isArray(json.components)) {
        walk(json.components);
      }
    }
  };

  walk(payload.components);
  return lines.join("\n");
}

test("Temporal workflow ids stay stable for the canonical scan request id", () => {
  expect(buildTemporalWorkflowId("scan_request_123")).toBe("guild-scan:scan_request_123");
});

test("Discord snowflakes decode back into millisecond timestamps", () => {
  const expectedTimestamp = 1_462_015_105_796;
  const snowflake = (BigInt(expectedTimestamp - 1_420_070_400_000) << 22n).toString();

  expect(discordSnowflakeToTimestamp(snowflake)).toBe(expectedTimestamp);
});

test("scan summary merging accumulates processed members and suspicious findings", () => {
  const summary = mergeScanSummary(createEmptyScanSummary(), {
    highestObservedScore: 2,
    lastScannedUserId: "user_1",
    notes: ["note-1"],
    processedMemberCount: 1,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  });
  const merged = mergeScanSummary(summary, {
    highestObservedScore: 8,
    lastScannedUserId: "user_2",
    notes: ["note-2"],
    processedMemberCount: 2,
    suspiciousFindings: [{
      caseId: "case_123",
      reasonCodes: ["account_age_lt_24h"],
      score: 8,
      userId: "user_2",
    }],
    suspiciousMemberCount: 1,
  });

  expect(merged).toEqual({
    highestObservedScore: 8,
    lastScannedUserId: "user_2",
    notes: ["note-1", "note-2"],
    processedMemberCount: 3,
    suspiciousFindings: [{
      caseId: "case_123",
      reasonCodes: ["account_age_lt_24h"],
      score: 8,
      userId: "user_2",
    }],
    suspiciousMemberCount: 1,
  });
});

test("processing a suspicious member opens a canonical report and syncs the moderator warning", async () => {
  const apiCalls: unknown[] = [];
  const warningCalls: unknown[] = [];

  const result = await processMemberScanCandidate({
    apiClient: {
      async createReport(guildId, body) {
        apiCalls.push({ body, guildId });
        return {
          persistence: "persisted",
          report: {
            caseId: "case_123",
            reportId: "report_123",
          },
        };
      },
    },
    guildId: "guild_123",
    now: Date.UTC(2026, 0, 1, 0, 0, 0),
    requestedByUserId: "moderator_123",
    snapshot: {
      avatar: null,
      createdTimestamp: Date.UTC(2025, 11, 31, 23, 0, 0),
      guildId: "guild_123",
      userId: "user_123",
    },
    syncWarningCard: async (input) => {
      warningCalls.push(input);
      return {
        note: "Moderator warning posted in <#alerts> for case case_123.",
        status: "posted",
      };
    },
  });

  expect(apiCalls).toEqual([{
    body: expect.objectContaining({
      intakeSource: "detector_bridge",
      openCase: true,
      reporterUserId: "moderator_123",
      subjectUserId: "user_123",
      triggerFingerprint: "member-scan:guild_123:user_123:account_age_lt_24h+profile_missing_avatar",
    }),
    guildId: "guild_123",
  }]);
  expect(warningCalls).toEqual([{
    caseId: "case_123",
    guildId: "guild_123",
    requestTelemetry: expect.any(Object),
  }]);
  expect(result).toEqual({
    highestObservedScore: 8,
    lastScannedUserId: "user_123",
    notes: ["Moderator warning posted in <#alerts> for case case_123."],
    processedMemberCount: 1,
    suspiciousFindings: [{
      caseId: "case_123",
      reasonCodes: ["account_age_lt_24h", "profile_missing_avatar"],
      score: 8,
      userId: "user_123",
    }],
    suspiciousMemberCount: 1,
  });
});

test("processing a non-suspicious member keeps the scan advisory-only without opening a report", async () => {
  const result = await processMemberScanCandidate({
    apiClient: {
      async createReport() {
        throw new Error("non-suspicious members must not open reports");
      },
    },
    guildId: "guild_123",
    now: Date.UTC(2026, 0, 8, 0, 0, 0),
    requestedByUserId: "moderator_123",
    snapshot: {
      avatar: "avatar_hash",
      createdTimestamp: Date.UTC(2025, 0, 1, 0, 0, 0),
      guildId: "guild_123",
      userId: "user_123",
    },
  });

  expect(result).toEqual({
    highestObservedScore: 0,
    lastScannedUserId: "user_123",
    notes: [],
    processedMemberCount: 1,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  });
});

test("processing a mature sparse test-profile member still opens a canonical report", async () => {
  const apiCalls: unknown[] = [];

  const result = await processMemberScanCandidate({
    apiClient: {
      async createReport(guildId, body) {
        apiCalls.push({ body, guildId });
        return {
          persistence: "persisted",
          report: {
            caseId: "case_456",
            reportId: "report_456",
          },
        };
      },
    },
    guildId: "guild_123",
    now: Date.UTC(2026, 3, 27, 15, 17, 10),
    requestedByUserId: "moderator_123",
    snapshot: {
      avatar: null,
      createdTimestamp: Date.UTC(2025, 9, 3, 0, 30, 23),
      guildId: "guild_123",
      userId: "1423467182293258252",
      username: "yeusepetest_69399",
    },
  });

  expect(apiCalls).toEqual([{
    body: expect.objectContaining({
      reporterNotes: expect.stringContaining("Advisory member-scan score: 4/10"),
      reportReason: expect.stringContaining("synthetic-looking"),
      subjectUserId: "1423467182293258252",
    }),
    guildId: "guild_123",
  }]);
  expect(result.suspiciousMemberCount).toBe(1);
  expect(result.highestObservedScore).toBe(4);
  expect(result.suspiciousFindings).toEqual([{
    caseId: "case_456",
    reasonCodes: ["profile_missing_avatar", "profile_test_handle_pattern"],
    score: 4,
    userId: "1423467182293258252",
  }]);
});

test("marking a scan completed posts a moderator-visible summary to the configured log channel", async () => {
  const sentMessages: Array<{ channelId: string; payload: { components?: readonly unknown[] } }> = [];
  const activities = createScanActivities({
    actorService: "scan-worker-temporal",
    apiClient: {
      async createReport() {
        throw new Error("completion summaries must not open reports");
      },
      async getCaseWarningCard() {
        throw new Error("completion summaries must not read warning cards");
      },
      async getGuildChannelConfig(guildId) {
        return {
          channelConfig: {
            guildId,
            moderationLogChannelId: "channel_mod_log",
            moderatorAlertChannelId: "channel_alerts",
            reviewChannelId: "channel_review",
            source: "persisted",
          },
          persistence: "persisted",
        };
      },
      async updateWarningCardAlertMessage() {
        throw new Error("completion summaries must not update warning-card alert refs");
      },
    },
    messageRuntime: {
      async deleteMessage() {},
      async editMessage() {},
      async sendMessage(channelId, payload) {
        sentMessages.push({ channelId, payload });
        return { messageId: "message_123" };
      },
    },
    repository: {
      async claimNextQueuedRequest() {
        throw new Error("claimNextQueuedRequest is not used by markScanCompleted");
      },
      async close() {},
      async createScanRequest() {
        throw new Error("createScanRequest is not used by markScanCompleted");
      },
      async getScanRequest() {
        throw new Error("getScanRequest is not used by markScanCompleted");
      },
      async markCompleted(input) {
        return {
          createdAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          guildId: "guild_123",
          requestedByUserId: "moderator_123",
          scanRequestId: input.scanRequestId,
          scope: "all_members" as const,
          startedAt: "2026-01-01T00:00:10.000Z",
          status: "completed" as const,
          summary: input.summary,
          updatedAt: "2026-01-01T00:01:00.000Z",
        };
      },
      async markFailed() {
        throw new Error("markFailed is not used by markScanCompleted");
      },
      async markRunning() {
        throw new Error("markRunning is not used by markScanCompleted");
      },
    },
    rest: {} as never,
  });

  const result = await activities.markScanCompleted({
    scanRequestId: "scan_request_123",
    summary: {
      highestObservedScore: 8,
      notes: ["Moderator warning posted in <#alerts> for case case_123."],
      processedMemberCount: 42,
      suspiciousFindings: [{
        caseId: "case_123",
        reasonCodes: ["account_age_lt_24h"],
        score: 8,
        userId: "user_123",
      }],
      suspiciousMemberCount: 1,
    },
  });

  expect(result.status).toBe("completed");
  expect(sentMessages).toEqual([
    expect.objectContaining({
      channelId: "channel_mod_log",
    }),
  ]);
  const scanText = extractDiscordMessageText(sentMessages[0]!.payload);
  expect(scanText).toContain("scan_request_123");
  expect(scanText).toContain("42");
  expect(scanText).toContain("1 suspicious");
  expect(scanText).toContain("8/10");
});

test("the Node-based worker entrypoint can be imported without ESM resolution failures", () => {
  const result = Bun.spawnSync([
    "node",
    "--input-type=module",
    "--experimental-strip-types",
    "-e",
    "const mod = await import('./apps/scan-worker-temporal/src/index.ts'); console.log(typeof mod.buildTemporalWorkflowId);",
  ], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.stdout).toString("utf8").trim()).toBe("function");
});
