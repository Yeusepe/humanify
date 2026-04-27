/**
 * Purpose: Publishes or updates Humanify moderator warning cards from the Temporal scan worker using Discord REST.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\discord-bot.md
 * - docs\api.md
 * - docs\architecture.md
 * External references:
 * - https://discord.com/developers/docs/resources/channel#create-message
 * - https://discord.com/developers/docs/resources/channel#edit-message
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

import { createRequestTelemetryContext, type RequestTelemetryContext } from "@humanify/telemetry";

import {
  type ScanWorkerApiClient,
  type ScanWorkerCaseWarningCardReadResponse,
  ScanWorkerApiRequestError,
} from "./api-client";

export type ModeratorWarningMessageRuntime = {
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  editMessage(channelId: string, messageId: string, content: string): Promise<void>;
  sendMessage(channelId: string, content: string): Promise<{
    messageId: string;
  }>;
};

export type ModeratorWarningSyncResult = {
  note: string;
  status: "failed" | "posted" | "skipped" | "updated";
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function truncatePlainText(value: string | undefined, maxLength = 160) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function truncateMessageContent(value: string, maxLength = 1_990) {
  const normalized = value.replace(/\r/g, "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildModeratorWarningCardContent(card: ScanWorkerCaseWarningCardReadResponse) {
  const lines = [
    "⚠️ Humanify advisory warning",
    `Case: \`${card.case.caseId}\``,
    `Suspected user: <@${card.case.subjectUserId}> (\`${card.case.subjectUserId}\`)`,
    `Case status: ${card.case.status}. Severity: ${card.case.severity}/10. Reason: ${truncatePlainText(card.case.reason, 120) ?? "No case reason recorded."}`,
  ];

  const reportSummary = [
    `Reports: ${formatCountLabel(card.reportsSummary.reportCount, "report", "reports")} from ${formatCountLabel(card.reportsSummary.reporterCount, "reporter", "reporters")}.`,
  ];
  if (card.reportsSummary.latestReportReason) {
    reportSummary.push(`Latest report note: ${truncatePlainText(card.reportsSummary.latestReportReason, 140)}.`);
  }
  lines.push(reportSummary.join(" "));

  const evidenceSummary = [
    `Evidence: ${formatCountLabel(card.evidenceSummary.evidenceCount, "linked item", "linked items")}.`,
  ];
  if (card.evidenceSummary.latestEvidence?.messagePreview) {
    evidenceSummary.push(`Latest preview: "${truncatePlainText(card.evidenceSummary.latestEvidence.messagePreview, 140)}".`);
  }
  lines.push(evidenceSummary.join(" "));

  if (card.verification) {
    const verificationParts = [
      `Verification: ${card.verification.state}${card.verification.providerId ? ` via ${card.verification.providerId}` : ""}.`,
      `Linkage: ${card.verification.caseLinkage === "case_linked" ? "case-linked" : "latest subject session fallback"}.`,
    ];
    if (card.verification.providerStatus) {
      verificationParts.push(`Provider status: ${card.verification.providerStatus}.`);
    }
    const satisfiedClaims = readStringArray(asRecord(card.verification.summary)?.satisfiedClaims);
    if (satisfiedClaims.length > 0) {
      verificationParts.push(`Satisfied claims: ${satisfiedClaims.join(", ")}.`);
    }
    lines.push(verificationParts.join(" "));
  } else {
    lines.push("Verification: none linked to this case yet.");
  }

  if (card.reusableCredentialBridge) {
    const bridge = asRecord(card.reusableCredentialBridge);
    const bridgeStatus = readString(bridge?.status);
    const targetProvider = readString(bridge?.targetProvider);
    const approvedClaims = readStringArray(bridge?.approvedClaims);
    const bridgeParts = [
      `Reusable proof handoff: ${bridgeStatus ?? "present"}${targetProvider ? ` via ${targetProvider}` : ""}.`,
    ];
    if (approvedClaims.length > 0) {
      bridgeParts.push(`Approved claims: ${approvedClaims.join(", ")}.`);
    }
    lines.push(bridgeParts.join(" "));
  }

  if (card.faceCheck) {
    const faceParts = [
      `Face check: ${card.faceCheck.passed ? "passed" : card.faceCheck.performed ? "performed but not passed" : "not completed"}.`,
      `Source: ${card.faceCheck.source.replaceAll("_", " ")}.`,
    ];
    if (card.faceCheck.satisfiesFaceVerificationRequirement !== undefined) {
      faceParts.push(
        `Satisfies face-check requirement: ${card.faceCheck.satisfiesFaceVerificationRequirement ? "yes" : "no"}.`,
      );
    }
    lines.push(faceParts.join(" "));
  }

  lines.push("Advisory only: Humanify has not taken automatic enforcement from this warning.");

  return truncateMessageContent(lines.join("\n"));
}

function isDiscordMissingMessageError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 10_008;
}

export function createDiscordRestWarningRuntime(rest: REST): ModeratorWarningMessageRuntime {
  return {
    async deleteMessage(channelId, messageId) {
      await rest.delete(Routes.channelMessage(channelId, messageId));
    },
    async editMessage(channelId, messageId, content) {
      await rest.patch(Routes.channelMessage(channelId, messageId), {
        body: {
          allowed_mentions: { parse: [] },
          content,
        },
      });
    },
    async sendMessage(channelId, content) {
      const message = await rest.post(Routes.channelMessages(channelId), {
        body: {
          allowed_mentions: { parse: [] },
          content,
        },
      }) as { id: string };
      return {
        messageId: message.id,
      };
    },
  };
}

export async function syncModeratorWarningCard(input: {
  actorService: string;
  apiClient: ScanWorkerApiClient;
  caseId: string;
  guildId: string;
  messageRuntime: ModeratorWarningMessageRuntime;
  requestTelemetry?: RequestTelemetryContext;
}): Promise<ModeratorWarningSyncResult> {
  const requestTelemetry = input.requestTelemetry ?? createRequestTelemetryContext();
  const channelConfig = await input.apiClient.getGuildChannelConfig(input.guildId, requestTelemetry);
  const moderatorAlertChannelId = channelConfig.channelConfig.moderatorAlertChannelId;
  if (!moderatorAlertChannelId || channelConfig.persistence !== "persisted") {
    return {
      note: "Moderator warning was not published because the canonical alert channel is not configured.",
      status: "skipped",
    };
  }

  let warningCard: ScanWorkerCaseWarningCardReadResponse;
  try {
    warningCard = await input.apiClient.getCaseWarningCard(input.guildId, input.caseId, requestTelemetry);
  } catch (error) {
    if (error instanceof ScanWorkerApiRequestError && error.status === 404) {
      return {
        note: `Moderator warning was not published because case ${input.caseId} has no warning card yet.`,
        status: "skipped",
      };
    }

    return {
      note: `Moderator warning was not published because Humanify could not load the warning card: ${error instanceof Error ? error.message : "unknown error"}.`,
      status: "failed",
    };
  }

  const content = buildModeratorWarningCardContent(warningCard);
  const activeAlertRef =
    warningCard.alertMessageRef?.messageState === "active" ? warningCard.alertMessageRef : undefined;

  if (activeAlertRef && activeAlertRef.channelId === moderatorAlertChannelId) {
    try {
      await input.messageRuntime.editMessage(moderatorAlertChannelId, activeAlertRef.messageId, content);
      await input.apiClient.updateWarningCardAlertMessage(input.guildId, input.caseId, {
        actorService: input.actorService,
        channelId: moderatorAlertChannelId,
        messageId: activeAlertRef.messageId,
        messageState: "active",
      }, requestTelemetry);

      return {
        note: `Moderator warning updated in <#${moderatorAlertChannelId}> for case ${input.caseId}.`,
        status: "updated",
      };
    } catch (error) {
      if (!isDiscordMissingMessageError(error)) {
        return {
          note: `Moderator warning was not updated because Discord rejected the stored alert message: ${error instanceof Error ? error.message : "unknown error"}.`,
          status: "failed",
        };
      }
    }
  }

  try {
    const sentMessage = await input.messageRuntime.sendMessage(moderatorAlertChannelId, content);

    try {
      await input.apiClient.updateWarningCardAlertMessage(input.guildId, input.caseId, {
        actorService: input.actorService,
        channelId: moderatorAlertChannelId,
        messageId: sentMessage.messageId,
        messageState: "active",
      }, requestTelemetry);
    } catch (error) {
      await input.messageRuntime.deleteMessage(moderatorAlertChannelId, sentMessage.messageId).catch(() => undefined);
      return {
        note: `Moderator warning was not published because Humanify could not persist the alert reference: ${error instanceof Error ? error.message : "unknown error"}.`,
        status: "failed",
      };
    }

    return {
      note: `Moderator warning posted in <#${moderatorAlertChannelId}> for case ${input.caseId}.`,
      status: "posted",
    };
  } catch (error) {
    return {
      note: `Moderator warning was not published because Discord delivery failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      status: "failed",
    };
  }
}
