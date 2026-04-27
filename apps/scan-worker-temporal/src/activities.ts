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

import type { GuildScanRequestRepository, GuildScanRequestSummary } from "@humanify/db";
import { createRequestTelemetryContext } from "@humanify/telemetry";

import type { ScanWorkerApiClient } from "./api-client";
import {
  createEmptyScanSummary,
  discordSnowflakeToTimestamp,
  mergeScanSummary,
  processMemberScanCandidate,
  type ScanSummaryDelta,
} from "./scan-runtime";
import { syncModeratorWarningCard, type ModeratorWarningMessageRuntime } from "./moderator-warning";

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
    guildId,
    userId: user.id,
  };
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
      return assertPresentRecord(
        await input.repository.markCompleted(activityInput),
        `Scan request ${activityInput.scanRequestId}`,
      );
    },
    async markScanFailed(activityInput: {
      errorMessage: string;
      scanRequestId: string;
      summary: GuildScanRequestSummary;
    }) {
      return assertPresentRecord(
        await input.repository.markFailed(activityInput),
        `Scan request ${activityInput.scanRequestId}`,
      );
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
