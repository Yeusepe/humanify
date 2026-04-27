/**
 * Purpose: Runs durable Temporal workflows for single-member and full-guild Humanify scans.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\discord-bot.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://typescript.temporal.io/api/namespaces/workflow
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { proxyActivities } from "@temporalio/workflow";

import type { GuildScanRequestSummary } from "@humanify/db";

import type { ScanActivities } from "./activities";
import { createEmptyScanSummary, mergeScanSummary } from "./scan-runtime";

export type RunGuildScanWorkflowInput = {
  guildId: string;
  requestedByUserId: string;
  scanRequestId: string;
  scope: "all_members" | "single_member";
  targetUserId?: string;
};

const activities = proxyActivities<ScanActivities>({
  retry: {
    maximumAttempts: 3,
  },
  startToCloseTimeout: "2 minutes",
});

export async function runGuildScanWorkflow(input: RunGuildScanWorkflowInput): Promise<GuildScanRequestSummary> {
  let summary = createEmptyScanSummary();

  try {
    await activities.markScanRunning({
      scanRequestId: input.scanRequestId,
      summary,
    });

    if (input.scope === "single_member") {
      if (!input.targetUserId) {
        throw new Error("Single-member scan workflows require a target user id.");
      }

      const singleMemberSummary = await activities.scanSingleMember({
        guildId: input.guildId,
        requestedByUserId: input.requestedByUserId,
        targetUserId: input.targetUserId,
      });
      summary = mergeScanSummary(summary, singleMemberSummary);
    } else {
      let afterUserId: string | undefined;

      while (true) {
        const page = await activities.scanMembersPage({
          afterUserId,
          guildId: input.guildId,
          requestedByUserId: input.requestedByUserId,
        });
        summary = mergeScanSummary(summary, page.summary);

        if (!page.hasMore || !page.nextAfterUserId) {
          break;
        }

        afterUserId = page.nextAfterUserId;
      }
    }

    await activities.markScanCompleted({
      scanRequestId: input.scanRequestId,
      summary,
    });
    return summary;
  } catch (error) {
    await activities.markScanFailed({
      errorMessage: error instanceof Error ? error.message : "Unknown scan workflow failure.",
      scanRequestId: input.scanRequestId,
      summary,
    });
    throw error;
  }
}
