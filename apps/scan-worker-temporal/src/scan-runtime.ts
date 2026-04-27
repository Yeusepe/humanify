/**
 * Purpose: Applies the shared Humanify member-scan heuristic and accumulates canonical scan summaries for Temporal activities.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * External references:
 * - https://discord.com/developers/docs/reference#snowflakes
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import {
  buildMemberScanReportReason,
  buildMemberScanReporterNotes,
  evaluateMemberScanSnapshot,
  type MemberScanSnapshot,
} from "@humanify/discord-core/member-scan";
import type { GuildScanRequestSummary } from "@humanify/db";
import { createRequestTelemetryContext, type RequestTelemetryContext } from "@humanify/telemetry";

import type { ScanWorkerApiClient } from "./api-client.ts";
import type { ModeratorWarningSyncResult } from "./moderator-warning.ts";

export type ScanSummaryDelta = {
  highestObservedScore: number;
  lastScannedUserId: string;
  notes: string[];
  processedMemberCount: number;
  suspiciousFindings: GuildScanRequestSummary["suspiciousFindings"];
  suspiciousMemberCount: number;
};

export function createEmptyScanSummary(): GuildScanRequestSummary {
  return {
    highestObservedScore: 0,
    notes: [],
    processedMemberCount: 0,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  };
}

export function mergeScanSummary(
  current: GuildScanRequestSummary,
  delta: Pick<GuildScanRequestSummary, "highestObservedScore" | "lastScannedUserId" | "notes" | "processedMemberCount" | "suspiciousFindings" | "suspiciousMemberCount">,
): GuildScanRequestSummary {
  return {
    completedAt: current.completedAt,
    highestObservedScore: Math.max(current.highestObservedScore, delta.highestObservedScore),
    lastScannedUserId: delta.lastScannedUserId,
    notes: [...current.notes, ...delta.notes],
    processedMemberCount: current.processedMemberCount + delta.processedMemberCount,
    suspiciousFindings: [...current.suspiciousFindings, ...delta.suspiciousFindings],
    suspiciousMemberCount: current.suspiciousMemberCount + delta.suspiciousMemberCount,
  };
}

export function discordSnowflakeToTimestamp(snowflake: string): number {
  return Number((BigInt(snowflake) >> 22n) + 1_420_070_400_000n);
}

function buildScanTriggerFingerprint(guildId: string, userId: string, reasonCodes: readonly string[]) {
  return `member-scan:${guildId}:${userId}:${reasonCodes.join("+")}`;
}

export async function processMemberScanCandidate(input: {
  apiClient: Pick<ScanWorkerApiClient, "createReport">;
  guildId: string;
  now: number;
  requestedByUserId: string;
  requestTelemetry?: RequestTelemetryContext;
  snapshot: MemberScanSnapshot;
  syncWarningCard?: (input: {
    caseId: string;
    guildId: string;
    requestTelemetry?: RequestTelemetryContext;
  }) => Promise<ModeratorWarningSyncResult>;
}): Promise<ScanSummaryDelta> {
  const requestTelemetry = input.requestTelemetry ?? createRequestTelemetryContext();
  const evaluation = evaluateMemberScanSnapshot({
    now: input.now,
    snapshot: input.snapshot,
  });

  const base: ScanSummaryDelta = {
    highestObservedScore: evaluation.score,
    lastScannedUserId: input.snapshot.userId,
    notes: [],
    processedMemberCount: 1,
    suspiciousFindings: [],
    suspiciousMemberCount: 0,
  };
  if (!evaluation.shouldOpenCase) {
    return base;
  }

  const report = await input.apiClient.createReport(input.guildId, {
    intakeSource: "detector_bridge",
    openCase: true,
    reportReason: buildMemberScanReportReason(evaluation),
    reporterNotes: `${buildMemberScanReporterNotes(evaluation)} Durable Temporal-backed member scan source: shared member scorer.`,
    reporterUserId: input.requestedByUserId,
    subjectUserId: input.snapshot.userId,
    triggerFingerprint: buildScanTriggerFingerprint(input.guildId, input.snapshot.userId, evaluation.reasonCodes),
  }, requestTelemetry);

  const notes = [...base.notes];
  if (report.report.caseId && input.syncWarningCard) {
    const syncResult = await input.syncWarningCard({
      caseId: report.report.caseId,
      guildId: input.guildId,
      requestTelemetry,
    });
    notes.push(syncResult.note);
  }

  return {
    ...base,
    notes,
    suspiciousFindings: [{
      caseId: report.report.caseId,
      reasonCodes: evaluation.reasonCodes,
      score: evaluation.score,
      userId: input.snapshot.userId,
    }],
    suspiciousMemberCount: 1,
  };
}
