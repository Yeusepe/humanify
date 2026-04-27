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

import { buildComponentCustomId } from "@humanify/discord-core";
import { createHumanifyMessagePayload, type HumanifyMessageSection } from "@humanify/discord-core/message-ui";
import { createRequestTelemetryContext, type RequestTelemetryContext } from "@humanify/telemetry";

import {
  type ScanWorkerApiClient,
  type ScanWorkerCaseWarningCardReadResponse,
  ScanWorkerApiRequestError,
} from "./api-client.ts";

export type ModeratorWarningMessageRuntime = {
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  editMessage(channelId: string, messageId: string, payload: ReturnType<typeof createHumanifyMessagePayload>): Promise<void>;
  sendMessage(channelId: string, payload: ReturnType<typeof createHumanifyMessagePayload>): Promise<{
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

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function createVerificationShortcutActionRow(guildId: string, caseId: string, userId: string) {
  return {
    components: [
      {
        custom_id: buildComponentCustomId({
          entityId: `${caseId}~${userId}`,
          guildId,
          kind: "verification_start",
        }),
        label: "Start verification",
        style: 1,
        type: 2,
      },
    ],
    type: 1,
  } as const;
}

export function buildModeratorWarningCardContent(guildId: string, card: ScanWorkerCaseWarningCardReadResponse) {
  const sections: HumanifyMessageSection[] = [{
    title: "Case snapshot",
    lines: [
      `**Suspected user:** <@${card.case.subjectUserId}> (\`${card.case.subjectUserId}\`)`,
      `**Status:** ${card.case.status}`,
      `**Severity:** ${card.case.severity}/10`,
      `**Reason:** ${truncatePlainText(card.case.reason, 120) ?? "No case reason recorded."}`,
    ],
  }, {
    title: "Reporter activity",
    lines: [
      `${formatCountLabel(card.reportsSummary.reportCount, "report", "reports")} from ${formatCountLabel(card.reportsSummary.reporterCount, "reporter", "reporters")}.`,
      ...(card.reportsSummary.latestReportReason
        ? [`Latest report note: ${truncatePlainText(card.reportsSummary.latestReportReason, 140)}.`]
        : []),
    ],
  }, {
    title: "Evidence",
    lines: [
      `${formatCountLabel(card.evidenceSummary.evidenceCount, "linked item", "linked items")}.`,
      ...(card.evidenceSummary.latestEvidence?.messagePreview
        ? [`Latest preview: "${truncatePlainText(card.evidenceSummary.latestEvidence.messagePreview, 140)}".`]
        : []),
    ],
  }];

  if (card.verification) {
    const satisfiedClaims = readStringArray(asRecord(card.verification.summary)?.satisfiedClaims);
    sections.push({
      title: "Verification",
      lines: [
        `State: ${card.verification.state}${card.verification.providerId ? ` via ${card.verification.providerId}` : ""}.`,
        `Linkage: ${card.verification.caseLinkage === "case_linked" ? "case-linked" : "latest subject session fallback"}.`,
        ...(card.verification.providerStatus ? [`Provider status: ${card.verification.providerStatus}.`] : []),
        ...(satisfiedClaims.length > 0 ? [`Satisfied claims: ${satisfiedClaims.join(", ")}.`] : []),
      ],
    });
  } else {
    sections.push({
      title: "Verification",
      lines: ["No linked verification session yet."],
    });
  }

  if (card.reusableCredentialBridge) {
    const bridge = asRecord(card.reusableCredentialBridge);
    const bridgeStatus = readString(bridge?.status);
    const targetProvider = readString(bridge?.targetProvider);
    const approvedClaims = readStringArray(bridge?.approvedClaims);
    sections.push({
      title: "Reusable proof handoff",
      lines: [
        `${bridgeStatus ?? "present"}${targetProvider ? ` via ${targetProvider}` : ""}.`,
        ...(approvedClaims.length > 0 ? [`Approved claims: ${approvedClaims.join(", ")}.`] : []),
      ],
    });
  }

  if (card.faceCheck) {
    sections.push({
      title: "Face check",
      lines: [
        `${card.faceCheck.passed ? "Passed" : card.faceCheck.performed ? "Performed but not passed" : "Not completed"}.`,
        `Source: ${card.faceCheck.source.replaceAll("_", " ")}.`,
        ...(card.faceCheck.satisfiesFaceVerificationRequirement !== undefined
          ? [`Satisfies requirement: ${card.faceCheck.satisfiesFaceVerificationRequirement ? "yes" : "no"}.`]
          : []),
      ],
    });
  }

  sections.push({
    title: "Operator note",
    lines: ["Advisory only. Humanify has not taken automatic enforcement from this warning."],
  });

  return createHumanifyMessagePayload({
    actionRows: [createVerificationShortcutActionRow(guildId, card.case.caseId, card.case.subjectUserId)],
    sections,
    summary: `Case \`${card.case.caseId}\` is open for review and can be advanced directly from this card.`,
    title: "Humanify advisory warning",
    tone: "warning",
  });
}

function isDiscordMissingMessageError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 10_008;
}

export function createDiscordRestWarningRuntime(rest: REST): ModeratorWarningMessageRuntime {
  const serializePayload = (payload: ReturnType<typeof createHumanifyMessagePayload>, includeFlags: boolean) => ({
    allowed_mentions: { parse: [] },
    components: payload.components.map((component) => component.toJSON()),
    ...(!includeFlags || payload.flags === undefined ? {} : { flags: payload.flags }),
  });

  return {
    async deleteMessage(channelId, messageId) {
      await rest.delete(Routes.channelMessage(channelId, messageId));
    },
    async editMessage(channelId, messageId, payload) {
      await rest.patch(Routes.channelMessage(channelId, messageId), {
        body: serializePayload(payload, false),
      });
    },
    async sendMessage(channelId, payload) {
      const message = await rest.post(Routes.channelMessages(channelId), {
        body: serializePayload(payload, true),
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

  const payload = buildModeratorWarningCardContent(input.guildId, warningCard);
  const activeAlertRef =
    warningCard.alertMessageRef?.messageState === "active" ? warningCard.alertMessageRef : undefined;

  if (activeAlertRef && activeAlertRef.channelId === moderatorAlertChannelId) {
    try {
      await input.messageRuntime.editMessage(moderatorAlertChannelId, activeAlertRef.messageId, payload);
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
    const sentMessage = await input.messageRuntime.sendMessage(moderatorAlertChannelId, payload);

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
