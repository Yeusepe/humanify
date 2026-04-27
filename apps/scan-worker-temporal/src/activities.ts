/**
 * Purpose: Executes Discord REST member scans, opens canonical reports, and updates canonical scan-request state for Temporal workflows.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\discord-bot.md
 * External references:
 * - https://discord.com/developers/docs/resources/guild#get-guild-member
 * - https://discord.com/developers/docs/resources/guild#list-guild-members
 * - https://typescript.temporal.io/api/namespaces/activity
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { REST } from "@discordjs/rest";
import type { APIGuildMember } from "discord-api-types/v10";
import { Routes } from "discord-api-types/v10";

import type { GuildScanRequestRecord, GuildScanRequestRepository, GuildScanRequestSummary } from "@humanify/db";
import { createHumanifyMessagePayload, type HumanifyMessageSection } from "@humanify/discord-core/message-ui";
import { createRequestTelemetryContext } from "@humanify/telemetry";

import type { ScanWorkerApiClient } from "./api-client.ts";
import {
  createEmptyScanSummary,
  discordSnowflakeToTimestamp,
  mergeScanSummary,
  processMemberScanCandidate,
  type ScanSummaryDelta,
} from "./scan-runtime.ts";
import { syncModeratorWarningCard, type ModeratorWarningMessageRuntime } from "./moderator-warning.ts";

export type ScanSingleMemberActivityInput = {
  guildId: string;
  requestedByUserId: string;
  targetUserId: string;
};

export type ScanMembersPageActivityInput = {
  afterUserId?: string;
  guildId: string;
  limit?: number;
  requestedByUserId: string;
};

export type ScanMembersPageActivityResult = {
  hasMore: boolean;
  nextAfterUserId?: string;
  summary: GuildScanRequestSummary;
};

function assertPresentRecord<TValue>(value: TValue | undefined, entityName: string) {
  if (!value) {
    throw new Error(`${entityName} no longer exists in canonical Postgres state.`);
  }

  return value;
}

function mapMemberSnapshot(guildId: string, member: APIGuildMember) {
  const user = member.user;
  if (!user) {
    return undefined;
  }

  return {
    avatar: user.avatar,
    createdTimestamp: discordSnowflakeToTimestamp(user.id),
    globalName: user.global_name,
    guildId,
    userId: user.id,
    username: user.username,
  };
}

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatScanFindings(summary: GuildScanRequestSummary) {
  if (summary.suspiciousFindings.length === 0) {
    return ["No suspicious findings were recorded."];
  }

  return summary.suspiciousFindings.slice(0, 5).map((finding) => {
    const caseRef = finding.caseId ? `case \`${finding.caseId}\`` : "no case yet";
    return `- <@${finding.userId}> • ${caseRef} • score ${finding.score}/10 • reasons: ${finding.reasonCodes.join(", ")}`;
  });
}

function buildScanOutcomeMessage(record: GuildScanRequestRecord) {
  const scopeLine = record.scope === "single_member" && record.targetUserId
    ? `Single-member scan for <@${record.targetUserId}>`
    : "Full server member scan";
  const sections: HumanifyMessageSection[] = [{
    title: "Workflow state",
    lines: [
      `Request: \`${record.scanRequestId}\``,
      `Scope: ${scopeLine}`,
      `Requested by: <@${record.requestedByUserId}>`,
      `Processed: ${formatCountLabel(record.summary.processedMemberCount, "member", "members")}.`,
      `Highest observed advisory score: ${record.summary.highestObservedScore}/10.`,
      `Detected: ${record.summary.suspiciousMemberCount} suspicious ${record.summary.suspiciousMemberCount === 1 ? "match" : "matches"}.`,
    ],
  }, {
    title: "Findings",
    lines: formatScanFindings(record.summary),
  }];

  if (record.errorMessage) {
    sections.push({
      title: "Failure detail",
      lines: [record.errorMessage],
    });
  }

  if (record.summary.notes.length > 0) {
    sections.push({
      title: `Notes (${Math.min(record.summary.notes.length, 3)} of ${record.summary.notes.length})`,
      lines: record.summary.notes.slice(0, 3).map((note) => `- ${note}`),
    });
  }

  return createHumanifyMessagePayload({
    sections,
    summary: record.status === "failed"
      ? "The durable scan run stopped before completing. Review the failure details below."
      : "The durable scan run finished and Humanify has already refreshed any warning cards it opened.",
    title: record.status === "failed" ? "Humanify durable scan failed" : "Humanify durable scan completed",
    tone: record.status === "failed" ? "danger" : "success",
  });
}

async function publishScanOutcome(input: {
  apiClient: ScanWorkerApiClient;
  messageRuntime: ModeratorWarningMessageRuntime;
  record: GuildScanRequestRecord;
}) {
  const channelConfig = await input.apiClient.getGuildChannelConfig(
    input.record.guildId,
    createRequestTelemetryContext(),
  );

  if (channelConfig.persistence !== "persisted") {
    throw new Error(
      `Scan ${input.record.scanRequestId} cannot publish its moderator summary because guild channels are not configured.`,
    );
  }

  const channelId = channelConfig.channelConfig.moderationLogChannelId
    ?? channelConfig.channelConfig.reviewChannelId
    ?? channelConfig.channelConfig.moderatorAlertChannelId;
  if (!channelId) {
    throw new Error(
      `Scan ${input.record.scanRequestId} cannot publish its moderator summary because no moderator-visible channel is configured.`,
    );
  }

  await input.messageRuntime.sendMessage(channelId, buildScanOutcomeMessage(input.record));
}

export function createScanActivities(input: {
  actorService: string;
  apiClient: ScanWorkerApiClient;
  messageRuntime: ModeratorWarningMessageRuntime;
  repository: GuildScanRequestRepository;
  rest: REST;
}) {
  const syncWarningCard = async (warningInput: {
    caseId: string;
    guildId: string;
  }) =>
    syncModeratorWarningCard({
      actorService: input.actorService,
      apiClient: input.apiClient,
      caseId: warningInput.caseId,
      guildId: warningInput.guildId,
      messageRuntime: input.messageRuntime,
      requestTelemetry: createRequestTelemetryContext(),
    });

  return {
    async markScanCompleted(activityInput: {
      scanRequestId: string;
      summary: GuildScanRequestSummary;
    }) {
      const completed = assertPresentRecord(
        await input.repository.markCompleted(activityInput),
        `Scan request ${activityInput.scanRequestId}`,
      );
      await publishScanOutcome({
        apiClient: input.apiClient,
        messageRuntime: input.messageRuntime,
        record: completed,
      });
      return completed;
    },
    async markScanFailed(activityInput: {
      errorMessage: string;
      scanRequestId: string;
      summary: GuildScanRequestSummary;
    }) {
      const failed = assertPresentRecord(
        await input.repository.markFailed(activityInput),
        `Scan request ${activityInput.scanRequestId}`,
      );
      await publishScanOutcome({
        apiClient: input.apiClient,
        messageRuntime: input.messageRuntime,
        record: failed,
      });
      return failed;
    },
    async markScanRunning(activityInput: {
      scanRequestId: string;
      summary: GuildScanRequestSummary;
    }) {
      return assertPresentRecord(
        await input.repository.markRunning(activityInput),
        `Scan request ${activityInput.scanRequestId}`,
      );
    },
    async scanMembersPage(activityInput: ScanMembersPageActivityInput): Promise<ScanMembersPageActivityResult> {
      const limit = Math.min(Math.max(activityInput.limit ?? 1000, 1), 1000);
      const members = await input.rest.get(Routes.guildMembers(activityInput.guildId), {
        query: new URLSearchParams({
          ...(activityInput.afterUserId ? { after: activityInput.afterUserId } : {}),
          limit: String(limit),
        }),
      }) as APIGuildMember[];

      let deltaSummary = createEmptyScanSummary();
      for (const member of members) {
        const snapshot = mapMemberSnapshot(activityInput.guildId, member);
        if (!snapshot) {
          deltaSummary = mergeScanSummary(deltaSummary, {
            highestObservedScore: 0,
            lastScannedUserId: activityInput.afterUserId ?? "unknown",
            notes: ["Discord returned a guild member entry without a user payload during /scan-all processing."],
            processedMemberCount: 0,
            suspiciousFindings: [],
            suspiciousMemberCount: 0,
          });
          continue;
        }

        const delta = await processMemberScanCandidate({
          apiClient: input.apiClient,
          guildId: activityInput.guildId,
          now: Date.now(),
          requestedByUserId: activityInput.requestedByUserId,
          requestTelemetry: createRequestTelemetryContext(),
          snapshot,
          syncWarningCard,
        });
        deltaSummary = mergeScanSummary(deltaSummary, delta);
      }

      const nextAfterUserId = members.at(-1)?.user?.id;
      return {
        hasMore: members.length === limit && Boolean(nextAfterUserId),
        nextAfterUserId,
        summary: deltaSummary,
      };
    },
    async scanSingleMember(activityInput: ScanSingleMemberActivityInput): Promise<ScanSummaryDelta> {
      const member = await input.rest.get(
        Routes.guildMember(activityInput.guildId, activityInput.targetUserId),
      ) as APIGuildMember;
      const snapshot = mapMemberSnapshot(activityInput.guildId, member);
      if (!snapshot) {
        throw new Error(
          `Discord returned no user payload for guild ${activityInput.guildId} member ${activityInput.targetUserId}.`,
        );
      }

      return processMemberScanCandidate({
        apiClient: input.apiClient,
        guildId: activityInput.guildId,
        now: Date.now(),
        requestedByUserId: activityInput.requestedByUserId,
        requestTelemetry: createRequestTelemetryContext(),
        snapshot,
        syncWarningCard,
      });
    },
  };
}

export type ScanActivities = ReturnType<typeof createScanActivities>;
