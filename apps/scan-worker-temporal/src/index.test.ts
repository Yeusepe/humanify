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

import { buildTemporalWorkflowId } from "./index";
import { createEmptyScanSummary, discordSnowflakeToTimestamp, mergeScanSummary, processMemberScanCandidate } from "./scan-runtime";

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
    lastScannedUserId: "user_1",
    notes: ["note-1"],
    processedMemberCount: 1,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  });
  const merged = mergeScanSummary(summary, {
    lastScannedUserId: "user_2",
    notes: ["note-2"],
    processedMemberCount: 2,
    suspiciousFindings: [{
      caseId: "case_123",
      reasonCodes: ["account_age_lt_24h"],
      userId: "user_2",
    }],
    suspiciousMemberCount: 1,
  });

  expect(merged).toEqual({
    lastScannedUserId: "user_2",
    notes: ["note-1", "note-2"],
    processedMemberCount: 3,
    suspiciousFindings: [{
      caseId: "case_123",
      reasonCodes: ["account_age_lt_24h"],
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
      triggerFingerprint: "member-scan:guild_123:user_123:account_age_lt_24h",
    }),
    guildId: "guild_123",
  }]);
  expect(warningCalls).toEqual([{
    caseId: "case_123",
    guildId: "guild_123",
    requestTelemetry: expect.any(Object),
  }]);
  expect(result).toEqual({
    lastScannedUserId: "user_123",
    notes: ["Moderator warning posted in <#alerts> for case case_123."],
    processedMemberCount: 1,
    suspiciousFindings: [{
      caseId: "case_123",
      reasonCodes: ["account_age_lt_24h"],
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
    lastScannedUserId: "user_123",
    notes: [],
    processedMemberCount: 1,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  });
});
