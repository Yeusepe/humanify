/**
 * Purpose: Boots the Bun-side Discord client shell, registers Humanify intake commands, and routes Discord interactions through the Bun-authoritative API.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\verification.md
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://discord.js.org/docs/packages/discord.js/main
 * - https://discord.com/developers/docs/intro
 * - https://discord.com/developers/docs/interactions/application-commands
 * - https://bun.sh/docs/runtime/env
 * Tests:
 * - apps/bot-bun/src/index.test.ts
 */

import { createHash } from "node:crypto";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  Events,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type ClientOptions,
  type GuildMember,
  type Interaction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type Message,
  type MessageContextMenuCommandInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";

import { loadBotApiConfig, loadBotTokenConfig, loadObservabilityConfig, loadServiceIdentityConfig } from "@humanify/config";
import { humanifyActionLadder, humanifyContractVersion } from "@humanify/contracts";
import {
  authorizeAdminOnlyBotAction,
  authorizeTrustedModeratorOnlyBotAction,
  buildMemberScanReportReason,
  buildMemberScanReporterNotes,
  buildComponentCustomId,
  createDiscordAuditReason,
  buildSetupFlowCustomId,
  createBotGatewayIntents,
  createHumanifyApplicationCommands,
  evaluateMemberScanSnapshot,
  humanifyBotCommandNames,
  parseComponentCustomId,
  parseSetupFlowCustomId,
  resolveDiscordExecutionPlan,
  type DiscordExecutionCapabilities,
  type DiscordExecutionPlan,
  type SetupFlowAction,
} from "@humanify/discord-core";
import {
  createHumanifyMessageContainer,
  createHumanifyMessagePayload,
  type HumanifyMessageSection,
  type HumanifyMessageTone,
} from "@humanify/discord-core/message-ui";
import {
  createRequestTelemetryContext,
  createStructuredErrorFields,
  createStructuredLogFields,
  createTelemetryBootstrap,
  injectRequestTelemetryHeaders,
  type RequestTelemetryContext,
} from "@humanify/telemetry";

export const botRuntimeSummary = {
  commandCount: createHumanifyApplicationCommands().length,
  contractVersion: humanifyContractVersion,
  gatewayIntentCount: createBotGatewayIntents().length,
  supportedActionCount: humanifyActionLadder.length,
};

export type BotReportBody = {
  intakeSource: "detector_bridge" | "internal" | "message_context" | "slash_command";
  openCase: boolean;
  reportReason: string;
  reporterNotes?: string;
  reporterUserId: string;
  subjectUserId: string;
  triggerFingerprint: string;
};

export type BotReportResponse = {
  persistence: string;
  report: {
    caseId?: string;
    reportId: string;
  };
};

export type BotEvidenceBody = {
  actorUserId: string;
  captureSource: string;
  channelId?: string;
  evidenceType: string;
  externalRef?: string;
  messageId?: string;
  messagePreview?: string;
  subjectUserId?: string;
};

export type BotEvidenceResponse = {
  evidence: {
    evidenceId: string;
  };
  persistence: string;
};

export type BotVerificationSessionBody = {
  caseId?: string;
  initiatedBy: string;
  requiredCapabilities: string[];
  userId: string;
};

export type BotVerificationSessionResponse = {
  challengeToken: string;
  persistence: string;
  session: {
    caseId?: string;
    challengeId: string;
    guildId: string;
    sessionId: string;
    state: string;
    userId: string;
  };
};

export type BotScanRequestBody = {
  actorUserId: string;
  scope: "all_members" | "single_member";
  targetUserId?: string;
};

export type BotScanRequestResponse = {
  persistence: string;
  queueDelivery: string;
  scanRequest: {
    claimedAt?: string;
    createdAt: string;
    errorMessage?: string;
    finishedAt?: string;
    guildId: string;
    readModelStatus: string;
    requestedByUserId: string;
    scanRequestId: string;
    scope: "all_members" | "single_member";
    scopeRef: {
      guildId: string;
      scanRequestId: string;
    };
    startedAt?: string;
    status: "claimed" | "completed" | "failed" | "pending" | "running";
    summary: {
      completedAt?: string;
      highestObservedScore: number;
      lastScannedUserId?: string;
      notes: string[];
      processedMemberCount: number;
      suspiciousFindings: Array<{
        caseId?: string;
        reasonCodes: string[];
        score: number;
        userId: string;
      }>;
      suspiciousMemberCount: number;
    };
    targetUserId?: string;
    temporalTaskQueue?: string;
    updatedAt: string;
    workflowId?: string;
  };
};

export type BotSetupBundle = {
  bestFor: string;
  bundleId: string;
  claims: string[];
  futureExtensions: string[];
  operatorStorageGuarantees: string[];
  summary: string;
  title: string;
};

export type BotGuildChannelConfigReadResponse = {
  channelConfig: {
    auditLogChannelId?: string;
    guildId: string;
    moderationLogChannelId?: string;
    moderatorAlertChannelId?: string;
    reviewChannelId?: string;
    source: "not_configured" | "persisted";
  };
  persistence: "not_configured" | "persisted";
};

export type BotGuildChannelConfigWriteBody = {
  actorUserId: string;
  auditLogChannelId?: string;
  moderationLogChannelId?: string;
  moderatorAlertChannelId: string;
  reviewChannelId?: string;
};

export type BotGuildChannelConfigWriteResponse = {
  channelConfig: {
    auditLogChannelId?: string;
    createdAt: string;
    guildId: string;
    moderationLogChannelId?: string;
    moderatorAlertChannelId: string;
    reviewChannelId?: string;
    updatedAt: string;
  };
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
};

export type BotGuildVerificationConfig = {
  availableBundles: BotSetupBundle[];
  availableProviderIds: string[];
  defaultProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledProviderIds: string[];
  faceVerificationRequired: boolean;
  fallbackRoles: string[];
  guildId: string;
  roleGrantBindings: BotVerificationRoleGrantBinding[];
  requiredBundleIds: string[];
  requiredBundles: BotSetupBundle[];
  source: "catalog_default" | "persisted";
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
};

export type BotVerificationRoleGrantBinding = {
  roleId: string;
  trigger: "age_over_18" | "age_over_21" | "verified_human";
};

export type BotGuildVerificationConfigReadResponse = {
  persistence: "catalog_default" | "persisted";
  verificationConfig: BotGuildVerificationConfig;
};

export type BotGuildVerificationConfigWriteBody = {
  actorUserId: string;
  defaultProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledProviderIds: string[];
  faceVerificationRequired: boolean;
  roleGrantBindings: BotVerificationRoleGrantBinding[];
  requiredBundleIds: string[];
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
};

export type BotGuildVerificationConfigWriteResponse = {
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
  verificationConfig: BotGuildVerificationConfig;
};

export type BotWarningAlertMessageRef = {
  caseId: string;
  channelId: string;
  createdAt: string;
  lastActorService: string;
  messageId: string;
  messageState: "active" | "deleted";
  messageUrl: string;
  subjectUserId: string;
  updatedAt: string;
};

export type BotCaseWarningCardReadResponse = {
  alertMessageRef?: BotWarningAlertMessageRef;
  case: {
    caseId: string;
    closedAt?: string;
    openedAt: string;
    reason: string;
    severity: number;
    status: string;
    subjectUserId: string;
  };
  evidenceSummary: {
    evidenceCount: number;
    latestEvidence?: {
      channelId?: string;
      createdAt: string;
      evidenceId: string;
      externalRef?: string;
      messageId?: string;
      messagePreview?: string;
    };
  };
  faceCheck?: {
    passed: boolean;
    performed: boolean;
    satisfiesFaceVerificationRequirement?: boolean;
    source: "reusable_credential_bridge" | "verification_summary";
  };
  readModelStatus: "canonical_postgres";
  reportsSummary: {
    latestReportAt?: string;
    latestReportReason?: string;
    reportCount: number;
    reporterCount: number;
  };
  reusableCredentialBridge?: Record<string, unknown>;
  scope: {
    caseId: string;
    guildId: string;
  };
  source: "canonical_postgres_warning_card";
  verification?: {
    caseLinkage: "case_linked" | "subject_latest";
    initiatedBy: string;
    providerId?: string;
    providerStatus?: string;
    sessionId: string;
    state: string;
    summary?: Record<string, unknown>;
    updatedAt: string;
  };
};

export type BotWarningAlertMessageWriteBody = {
  actorService: string;
  channelId: string;
  messageId: string;
  messageState?: "active" | "deleted";
};

export type BotWarningAlertMessageWriteResponse = {
  alertMessageRef: BotWarningAlertMessageRef;
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
};

export type ApprovedActionExecutionDecision = DiscordExecutionPlan;

export type ApprovedActionEnvelope = {
  auditReason: string;
  durability: string;
  executionPlan: DiscordExecutionPlan;
};

type HumanifyDiscordMessagePayload = {
  components: Array<ReturnType<typeof createHumanifyMessageContainer>>;
  flags?: number;
};

export type ModeratorWarningMessageRuntime = {
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  editMessage(channelId: string, messageId: string, payload: HumanifyDiscordMessagePayload): Promise<void>;
  sendMessage(channelId: string, payload: HumanifyDiscordMessagePayload): Promise<{
    messageId: string;
  }>;
};

export type ModeratorWarningSyncResult = {
  note: string;
  status: "failed" | "posted" | "skipped" | "updated";
};

export type BotApiClient = {
  attachReportEvidence(
    guildId: string,
    reportId: string,
    body: BotEvidenceBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotEvidenceResponse>;
  createReport(guildId: string, body: BotReportBody, requestTelemetry?: RequestTelemetryContext): Promise<BotReportResponse>;
  createScanRequest(
    guildId: string,
    body: BotScanRequestBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotScanRequestResponse>;
  createVerificationSession(
    guildId: string,
    body: BotVerificationSessionBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotVerificationSessionResponse>;
  getCaseWarningCard(
    guildId: string,
    caseId: string,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotCaseWarningCardReadResponse>;
  getGuildChannelConfig(guildId: string, requestTelemetry?: RequestTelemetryContext): Promise<BotGuildChannelConfigReadResponse>;
  getGuildVerificationConfig(
    guildId: string,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotGuildVerificationConfigReadResponse>;
  updateGuildChannelConfig(
    guildId: string,
    body: BotGuildChannelConfigWriteBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotGuildChannelConfigWriteResponse>;
  updateGuildVerificationConfig(
    guildId: string,
    body: BotGuildVerificationConfigWriteBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotGuildVerificationConfigWriteResponse>;
  updateWarningCardAlertMessage(
    guildId: string,
    caseId: string,
    body: BotWarningAlertMessageWriteBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotWarningAlertMessageWriteResponse>;
};

export type CreateInteractionHandlerOptions = {
  apiClient: BotApiClient;
  syncModeratorWarningCard?: (input: {
    apiClient: BotApiClient;
    caseId: string;
    guildId: string;
    requestTelemetry?: RequestTelemetryContext;
  }) => Promise<ModeratorWarningSyncResult>;
  verifierBaseUrl?: string;
};

export type CreatePassiveEventHandlerOptions = {
  apiClient: BotApiClient;
  botActorUserId: string | (() => string | undefined);
  enableMemberJoinSignals: boolean;
  enableMessageSignals: boolean;
  messageRuntime: ModeratorWarningMessageRuntime;
  now?: () => number;
  syncModeratorWarningCard?: CreateInteractionHandlerOptions["syncModeratorWarningCard"];
};

export type PassiveEventHandler = {
  handleGuildMemberAdd(member: GuildMember): Promise<void>;
  handleMessageCreate(message: Message): Promise<void>;
};

type LoggerLike = Pick<Console, "error" | "info">;

function createAuthorizationFailureMessage(scope: "admin_only" | "trusted_moderator_only") {
  if (scope === "admin_only") {
    return "Only server admins can run Humanify setup.";
  }

  return "Only trusted moderators can open cases or verify other members.";
}

async function requireAdminOnlyAction(
  interaction: {
    memberPermissions?: unknown;
    reply(options: InteractionReplyOptions): Promise<unknown>;
  },
) {
  const authorization = authorizeAdminOnlyBotAction(interaction.memberPermissions as never);
  if (authorization.authorized) {
    return true;
  }

  await replyEphemeral(interaction, {
    content: createAuthorizationFailureMessage(authorization.scope),
  });
  return false;
}

async function requireTrustedModeratorAction(
  interaction: {
    memberPermissions?: unknown;
    reply(options: InteractionReplyOptions): Promise<unknown>;
  },
) {
  const authorization = authorizeTrustedModeratorOnlyBotAction(interaction.memberPermissions as never);
  if (authorization.authorized) {
    return true;
  }

  await replyEphemeral(interaction, {
    content: createAuthorizationFailureMessage(authorization.scope),
  });
  return false;
}

function buildDiscordMessageUrl(guildId: string, channelId: string, messageId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

const passiveDuplicateWindowMs = 2 * 60 * 1_000;
const passiveDuplicateThreshold = 3;
const passiveMentionBurstThreshold = 5;

type PassiveMessageState = {
  duplicateMessageCounters: Map<string, { count: number; lastSeenAt: number }>;
  seenMessageCounts: Map<string, number>;
};

function createPassiveMessageState(): PassiveMessageState {
  return {
    duplicateMessageCounters: new Map(),
    seenMessageCounts: new Map(),
  };
}

function normalizeMessageContent(content: string) {
  return content.replace(/\s+/gu, " ").trim().toLowerCase();
}

function hashPassiveFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function prunePassiveDuplicateCounters(state: PassiveMessageState, now: number) {
  for (const [key, counter] of state.duplicateMessageCounters) {
    if (now - counter.lastSeenAt > passiveDuplicateWindowMs) {
      state.duplicateMessageCounters.delete(key);
    }
  }
}

function extractMessageReasonCodes(message: Message, state: PassiveMessageState, now: number) {
  const guildId = message.guildId;
  if (!guildId) {
    return {
      duplicateContentHash: undefined,
      reasonCodes: [] as string[],
    };
  }

  const reasonCodes: string[] = [];
  const memberKey = `${guildId}:${message.author.id}`;
  const priorMessageCount = state.seenMessageCounts.get(memberKey) ?? 0;
  const normalizedContent = normalizeMessageContent(message.content);
  const hasLink = /https?:\/\/\S+/iu.test(message.content);
  if (priorMessageCount === 0 && hasLink) {
    reasonCodes.push("first_message_link");
  }

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount >= passiveMentionBurstThreshold) {
    reasonCodes.push("mention_burst");
  }

  let duplicateContentHash: string | undefined;
  if (normalizedContent.length >= 24) {
    prunePassiveDuplicateCounters(state, now);
    duplicateContentHash = hashPassiveFingerprint(normalizedContent);
    const duplicateKey = `${guildId}:${message.author.id}:${duplicateContentHash}`;
    const existing = state.duplicateMessageCounters.get(duplicateKey);
    if (existing && now - existing.lastSeenAt <= passiveDuplicateWindowMs) {
      existing.count += 1;
      existing.lastSeenAt = now;
      if (existing.count >= passiveDuplicateThreshold) {
        reasonCodes.push("duplicate_message_pattern");
      }
    } else {
      state.duplicateMessageCounters.set(duplicateKey, {
        count: 1,
        lastSeenAt: now,
      });
    }
  }

  state.seenMessageCounts.set(memberKey, priorMessageCount + 1);

  return {
    duplicateContentHash,
    reasonCodes,
  };
}

function evaluateJoinSignals(member: GuildMember, now: number) {
  return evaluateMemberScanSnapshot({
    now,
    snapshot: {
      avatar: member.user.avatar,
      createdTimestamp: member.user.createdTimestamp,
      globalName: member.user.globalName,
      guildId: member.guild.id,
      userId: member.user.id,
      username: member.user.username,
    },
  });
}

function buildPassiveJoinReportReason(input: {
  reasonCodes: string[];
  score: number;
}) {
  return buildMemberScanReportReason(input as never);
}

function buildPassiveMessageReportReason(reasonCodes: string[]) {
  const labels = reasonCodes.map((reasonCode) => reasonCode.replaceAll("_", " "));
  return `Automatic detector bridge flagged a suspicious message: ${labels.join(", ")}.`;
}

function buildPassiveJoinTriggerFingerprint(guildId: string, userId: string, reasonCodes: string[]) {
  return `guild-member-add:${guildId}:${userId}:${reasonCodes.join("+")}`;
}

function buildPassiveMessageTriggerFingerprint(input: {
  guildId: string;
  channelId: string;
  messageId: string;
  reasonCodes: string[];
  subjectUserId: string;
  duplicateContentHash?: string;
}) {
  if (input.reasonCodes.includes("duplicate_message_pattern") && input.duplicateContentHash) {
    return `message-duplicate:${input.guildId}:${input.subjectUserId}:${input.duplicateContentHash}`;
  }

  return `discord-message:${input.guildId}:${input.channelId}:${input.messageId}`;
}

function resolvePassiveBotActorUserId(value: CreatePassiveEventHandlerOptions["botActorUserId"]) {
  return typeof value === "function" ? value() : value;
}

function buildVerificationShortcutId(guildId: string, caseId: string, userId: string) {
  return buildComponentCustomId({
    entityId: `${caseId}~${userId}`,
    guildId,
    kind: "verification_start",
  });
}

function buildVerificationPanelId(guildId: string) {
  return buildComponentCustomId({
    entityId: "self_serve",
    guildId,
    kind: "verification_panel",
  });
}

function parseCaseUserEntity(entityId: string) {
  const [caseId, userId] = entityId.split("~");
  if (!caseId || !userId) {
    throw new Error("Humanify verification shortcut is missing its case or user reference.");
  }

  return {
    caseId,
    userId,
  };
}

function createPersistenceNote(persistence: string) {
  if (persistence === "persisted") {
    return "Canonical Postgres state was recorded; downstream processing may still be pending.";
  }

  return "Canonical backend persistence is still pending, so no enforcement or release action was executed.";
}

function appendFollowUpNote(content: string, note?: string) {
  return note ? `${content}\n${note}` : content;
}

function truncateDiscordComponentText(value: string, maxLength = 100) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function createVerificationShortcutRow(guildId: string, caseId: string, userId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildVerificationShortcutId(guildId, caseId, userId))
      .setLabel("Start verification")
      .setStyle(ButtonStyle.Primary),
  );
}

function createVerificationPanelRow(guildId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildVerificationPanelId(guildId))
      .setLabel("Verify with Humanify")
      .setStyle(ButtonStyle.Primary),
  );
}

function createVerifierLink(
  verifierBaseUrl: string,
  input: {
    guildId: string;
    sessionId: string;
    token: string;
    userId: string;
    username?: string;
  },
) {
  const url = new URL("/verify", verifierBaseUrl);
  url.searchParams.set("guildId", input.guildId);
  url.searchParams.set("sessionId", input.sessionId);
  url.searchParams.set("token", input.token);
  url.searchParams.set("userId", input.userId);
  if (input.username) {
    url.searchParams.set("username", input.username);
  }

  return url.toString();
}

function buildVerificationSessionReply(input: {
  challengeToken: string;
  followUpNote?: string;
  guildId: string;
  persistence: string;
  sessionId: string;
  summaryLine: string;
  userId: string;
  username?: string;
  verifierBaseUrl: string;
}) {
  const verifierLink = createVerifierLink(input.verifierBaseUrl, {
    guildId: input.guildId,
    sessionId: input.sessionId,
    token: input.challengeToken,
    userId: input.userId,
    username: input.username,
  });

  return appendFollowUpNote([
    input.summaryLine,
    `Open the verifier: ${verifierLink}`,
    createPersistenceNote(input.persistence),
  ].join("\n"), input.followUpNote);
}

function joinFollowUpNotes(...notes: Array<string | undefined>) {
  const present = notes
    .map((note) => note?.trim())
    .filter((note): note is string => Boolean(note));
  return present.length > 0 ? present.join("\n") : undefined;
}

function formatRoleMentions(roleIds: readonly string[]) {
  return roleIds.map((roleId) => `<@&${roleId}>`).join(", ");
}

async function fetchVerificationTargetMember(
  interaction: Pick<ChatInputCommandInteraction | ButtonInteraction, "guild">,
  userId: string,
) {
  if (!interaction.guild) {
    return undefined;
  }

  return interaction.guild.members.fetch(userId);
}

async function applyModeratorVerificationStartEffects(input: {
  interaction: Pick<ChatInputCommandInteraction | ButtonInteraction, "guild">;
  requestTelemetry: RequestTelemetryContext;
  sessionId: string;
  subjectUserId: string;
  verifierLink: string;
  verificationConfig: BotGuildVerificationConfig;
}) {
  const member = await fetchVerificationTargetMember(input.interaction, input.subjectUserId);
  const notes: string[] = [];
  if (!member) {
    return [
      `Humanify could not load <@${input.subjectUserId}> from the guild, so it could not DM them or apply containment roles.`,
    ];
  }

  try {
    await member.user.send(buildHumanifyInteractionMessage({
      content: [
        `Humanify verification requested for ${input.interaction.guild?.name ?? "this server"}`,
        `A Humanify moderator asked you to complete verification for ${input.interaction.guild?.name ?? "this server"}.`,
        "Complete the verification so Humanify can confirm your access and release any configured containment.",
        `Open the verifier: ${input.verifierLink}`,
      ].join("\n"),
      tone: "info",
    }));
    notes.push(`Humanify DM'd <@${input.subjectUserId}> with the verifier link and instructions.`);
  } catch {
    notes.push(`Humanify could not DM <@${input.subjectUserId}> automatically. Share this verifier link manually: ${input.verifierLink}`);
  }

  if (input.verificationConfig.suspiciousRoleIds.length === 0) {
    notes.push("No containment roles are configured for this server yet.");
    return notes;
  }

  try {
    await member.roles.add(
      input.verificationConfig.suspiciousRoleIds,
      createDiscordAuditReason({
        action: "quarantine",
        caseId: input.sessionId,
        reasonCodes: ["verification_requested"],
        requestId: input.requestTelemetry.requestId,
      }),
    );
    notes.push(`Applied containment roles: ${formatRoleMentions(input.verificationConfig.suspiciousRoleIds)}.`);
  } catch {
    notes.push(
      `Humanify could not apply containment roles ${formatRoleMentions(input.verificationConfig.suspiciousRoleIds)}. Check the bot's Manage Roles permission and role hierarchy before relying on verification quarantine.`,
    );
  }

  return notes;
}

function createReplySectionsFromContent(content: string): {
  sections: HumanifyMessageSection[];
  summary?: string;
  title: string;
} {
  const paragraphs = content
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return {
      sections: [],
      title: "Humanify",
    };
  }

  const [firstParagraph, ...remainingParagraphs] = paragraphs;
  if (!firstParagraph.includes("\n")) {
    return {
      sections: remainingParagraphs.map((markdown) => ({ markdown })),
      title: firstParagraph,
    };
  }

  if (remainingParagraphs.length === 0) {
    const lines = firstParagraph
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      sections: lines.length > 1 ? [{ lines: lines.slice(1) }] : [],
      title: lines[0] ?? "Humanify",
    };
  }

  return {
    sections: remainingParagraphs.map((markdown) => ({ markdown })),
    summary: firstParagraph,
    title: "Humanify",
  };
}

function buildHumanifyInteractionMessage(input: {
  components?: ActionRowBuilder<any>[];
  content: string;
  flags?: number;
  sections?: HumanifyMessageSection[];
  summary?: string;
  title?: string;
  tone?: HumanifyMessageTone;
}): HumanifyDiscordMessagePayload {
  const normalized = createReplySectionsFromContent(truncateMessageContent(input.content));
  return createHumanifyMessagePayload({
    actionRows: input.components,
    flags: input.flags,
    sections: input.sections ?? normalized.sections,
    summary: input.summary ?? normalized.summary,
    title: input.title ?? normalized.title,
    tone: input.tone,
  });
}

async function replyEphemeral(
  interaction: {
    reply(options: InteractionReplyOptions): Promise<unknown>;
  },
  payload: {
    components?: ActionRowBuilder<any>[];
    content: string;
    sections?: HumanifyMessageSection[];
    summary?: string;
    title?: string;
    tone?: HumanifyMessageTone;
  },
) {
  const options: InteractionReplyOptions = buildHumanifyInteractionMessage({
    ...payload,
    flags: MessageFlags.Ephemeral,
  });

  await interaction.reply(options);
}

async function updateMessageComponent(
  interaction: {
    update(options: InteractionUpdateOptions): Promise<unknown>;
  },
  payload: {
    components?: ActionRowBuilder<any>[];
    content: string;
    sections?: HumanifyMessageSection[];
    summary?: string;
    title?: string;
    tone?: HumanifyMessageTone;
  },
) {
  await interaction.update({
    components: buildHumanifyInteractionMessage(payload).components,
  });
}

type SetupStep = "bundles" | "channels" | "confirm" | "face" | "grants" | "providers" | "roles";

type SetupFlowDraft = {
  actorUserId: string;
  channelConfig: {
    auditLogChannelId?: string;
    moderationLogChannelId?: string;
    moderatorAlertChannelId?: string;
    reviewChannelId?: string;
  };
  draftId: string;
  guildId: string;
  notice?: string;
  step: SetupStep;
  updatedAt: number;
  verificationConfig: {
    availableBundles: BotSetupBundle[];
    availableProviderIds: string[];
    defaultProviderId: string;
    defaultReusableProofBackendId?: string;
    enabledProviderIds: string[];
    faceVerificationRequired: boolean;
    roleGrantBindings: BotVerificationRoleGrantBinding[];
    requiredBundleIds: string[];
    suspiciousRoleIds: string[];
    trustedRoleIds: string[];
  };
};

type SetupFlowStore = {
  createDraft(input: Omit<SetupFlowDraft, "draftId" | "notice" | "step" | "updatedAt">): SetupFlowDraft;
  deleteDraft(draftId: string): void;
  readDraft(draftId: string): SetupFlowDraft | undefined;
};

const setupStepOrder: readonly SetupStep[] = ["channels", "roles", "grants", "providers", "bundles", "face", "confirm"];

const setupProviderLabels: Record<string, { description: string; title: string }> = {
  didit: {
    description: "Fresh document and liveness check in Humanify's default first-time flow.",
    title: "Verify for the first time (Didit)",
  },
  privado: {
    description: "Reusable proof path for age or nationality when the member already has the right credential.",
    title: "Use a reusable proof (Privado)",
  },
  self: {
    description: "Alternative reusable proof path when Self.xyz fits the community's needs.",
    title: "Use an alternative reusable proof (Self.xyz)",
  },
  world_id: {
    description: "Uniqueness-first path for communities that only need proof of personhood.",
    title: "Prove uniqueness only (World ID)",
  },
};

const verificationRoleGrantTriggers = ["verified_human", "age_over_18", "age_over_21"] as const;

function normalizeRoleGrantBindings(bindings: readonly BotVerificationRoleGrantBinding[]) {
  const byTrigger = new Map<BotVerificationRoleGrantBinding["trigger"], string>();

  for (const binding of bindings) {
    if (!verificationRoleGrantTriggers.includes(binding.trigger) || !binding.roleId.trim()) {
      continue;
    }

    byTrigger.set(binding.trigger, binding.roleId.trim());
  }

  return verificationRoleGrantTriggers.flatMap((trigger) => {
    const roleId = byTrigger.get(trigger);
    return roleId ? [{ roleId, trigger }] : [];
  });
}

function createSetupFlowStore(): SetupFlowStore {
  const drafts = new Map<string, SetupFlowDraft>();
  const ttlMs = 15 * 60 * 1_000;

  const cleanupExpiredDrafts = () => {
    const now = Date.now();
    for (const [draftId, draft] of drafts) {
      if (now - draft.updatedAt > ttlMs) {
        drafts.delete(draftId);
      }
    }
  };

  return {
    createDraft(input) {
      cleanupExpiredDrafts();
      const draft: SetupFlowDraft = {
        ...input,
        draftId: crypto.randomUUID(),
        step: "channels",
        updatedAt: Date.now(),
      };
      drafts.set(draft.draftId, draft);
      return draft;
    },
    deleteDraft(draftId) {
      drafts.delete(draftId);
    },
    readDraft(draftId) {
      cleanupExpiredDrafts();
      const draft = drafts.get(draftId);
      if (!draft) {
        return undefined;
      }

      draft.updatedAt = Date.now();
      return draft;
    },
  };
}

function uniqueStrings(values: readonly string[]) {
  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || unique.has(trimmed)) {
      continue;
    }

    unique.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function formatChannel(channelId?: string) {
  return channelId ? `<#${channelId}>` : "Not set";
}

function formatRoleList(roleIds: readonly string[]) {
  return roleIds.length > 0 ? roleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "None selected";
}

function formatOptionalRole(roleId?: string) {
  return roleId ? formatRoleList([roleId]) : "None selected";
}

function getRoleGrantRoleId(
  bindings: readonly BotVerificationRoleGrantBinding[],
  trigger: BotVerificationRoleGrantBinding["trigger"],
) {
  return bindings.find((binding) => binding.trigger === trigger)?.roleId;
}

function setRoleGrantRoleId(
  bindings: readonly BotVerificationRoleGrantBinding[],
  trigger: BotVerificationRoleGrantBinding["trigger"],
  roleId?: string,
) {
  const nextBindings = bindings.filter((binding) => binding.trigger !== trigger);
  return normalizeRoleGrantBindings(roleId ? [...nextBindings, { roleId, trigger }] : nextBindings);
}

function formatProviderTitle(providerId: string) {
  return setupProviderLabels[providerId]?.title ?? providerId;
}

function formatProviderList(providerIds: readonly string[]) {
  return providerIds.length > 0 ? providerIds.map((providerId) => formatProviderTitle(providerId)).join(", ") : "None selected";
}

function findBundleDefinition(draft: SetupFlowDraft, bundleId: string) {
  return draft.verificationConfig.availableBundles.find((bundle) => bundle.bundleId === bundleId);
}

function formatBundleList(draft: SetupFlowDraft, bundleIds: readonly string[]) {
  return bundleIds.length > 0
    ? bundleIds.map((bundleId) => findBundleDefinition(draft, bundleId)?.title ?? bundleId).join(", ")
    : "None selected";
}

function ensureSetupDraftConsistency(draft: SetupFlowDraft) {
  draft.channelConfig = {
    auditLogChannelId: draft.channelConfig.auditLogChannelId,
    moderationLogChannelId: draft.channelConfig.moderationLogChannelId,
    moderatorAlertChannelId: draft.channelConfig.moderatorAlertChannelId,
    reviewChannelId: draft.channelConfig.reviewChannelId,
  };
  draft.verificationConfig.availableProviderIds = uniqueStrings(draft.verificationConfig.availableProviderIds);
  draft.verificationConfig.enabledProviderIds = uniqueStrings(draft.verificationConfig.enabledProviderIds).filter((providerId) =>
    draft.verificationConfig.availableProviderIds.includes(providerId)
  );

  if (draft.verificationConfig.enabledProviderIds.length === 0) {
    const fallbackProvider = draft.verificationConfig.availableProviderIds[0];
    if (fallbackProvider) {
      draft.verificationConfig.enabledProviderIds = [fallbackProvider];
    }
  }

  if (!draft.verificationConfig.enabledProviderIds.includes(draft.verificationConfig.defaultProviderId)) {
    draft.verificationConfig.defaultProviderId =
      draft.verificationConfig.enabledProviderIds[0] ??
      draft.verificationConfig.availableProviderIds[0] ??
      draft.verificationConfig.defaultProviderId;
  }

  if (
    draft.verificationConfig.defaultReusableProofBackendId &&
    !draft.verificationConfig.enabledProviderIds.includes(draft.verificationConfig.defaultReusableProofBackendId)
  ) {
    draft.verificationConfig.defaultReusableProofBackendId = undefined;
  }

  const availableBundleIds = draft.verificationConfig.availableBundles.map((bundle) => bundle.bundleId);
  draft.verificationConfig.requiredBundleIds = uniqueStrings(draft.verificationConfig.requiredBundleIds).filter((bundleId) =>
    availableBundleIds.includes(bundleId)
  );
  if (draft.verificationConfig.requiredBundleIds.length === 0) {
    const fallbackBundleId = availableBundleIds[0];
    if (fallbackBundleId) {
      draft.verificationConfig.requiredBundleIds = [fallbackBundleId];
    }
  }

  draft.verificationConfig.suspiciousRoleIds = uniqueStrings(draft.verificationConfig.suspiciousRoleIds);
  draft.verificationConfig.trustedRoleIds = uniqueStrings(draft.verificationConfig.trustedRoleIds);
  draft.verificationConfig.roleGrantBindings = normalizeRoleGrantBindings(draft.verificationConfig.roleGrantBindings);
}

function getSetupStepIndex(step: SetupStep) {
  return setupStepOrder.indexOf(step);
}

function getPreviousSetupStep(step: SetupStep): SetupStep {
  const index = getSetupStepIndex(step);
  return setupStepOrder[Math.max(index - 1, 0)]!;
}

function getNextSetupStep(step: SetupStep): SetupStep {
  const index = getSetupStepIndex(step);
  return setupStepOrder[Math.min(index + 1, setupStepOrder.length - 1)]!;
}

function validateSetupStep(draft: SetupFlowDraft, step: SetupStep): string | undefined {
  if (step === "channels" && !draft.channelConfig.moderatorAlertChannelId) {
    return "Choose the main alert channel before moving on.";
  }

  if (step === "providers" && draft.verificationConfig.enabledProviderIds.length === 0) {
    return "Choose at least one verification path before moving on.";
  }

  if (step === "bundles" && draft.verificationConfig.requiredBundleIds.length === 0) {
    return "Choose at least one proof bundle before moving on.";
  }

  if (step === "confirm") {
    return validateSetupStep(draft, "channels") ?? validateSetupStep(draft, "providers") ?? validateSetupStep(draft, "bundles");
  }

  return undefined;
}

function buildSetupSummaryLines(draft: SetupFlowDraft) {
  return [
    `- Alert channel: ${formatChannel(draft.channelConfig.moderatorAlertChannelId)}`,
    `- Review channel: ${formatChannel(draft.channelConfig.reviewChannelId)}`,
    `- Audit log channel: ${formatChannel(draft.channelConfig.auditLogChannelId)}`,
    `- Moderation log channel: ${formatChannel(draft.channelConfig.moderationLogChannelId)}`,
    `- Trusted moderator roles: ${formatRoleList(draft.verificationConfig.trustedRoleIds)}`,
    `- Suspicious roles: ${formatRoleList(draft.verificationConfig.suspiciousRoleIds)}`,
    `- Verified human role: ${formatOptionalRole(getRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "verified_human"))}`,
    `- 18+ role: ${formatOptionalRole(getRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "age_over_18"))}`,
    `- 21+ role: ${formatOptionalRole(getRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "age_over_21"))}`,
    `- Enabled verification paths: ${formatProviderList(draft.verificationConfig.enabledProviderIds)}`,
    `- Default verification path: ${formatProviderTitle(draft.verificationConfig.defaultProviderId)}`,
    `- Proof bundles: ${formatBundleList(draft, draft.verificationConfig.requiredBundleIds)}`,
    `- Face check required: ${draft.verificationConfig.faceVerificationRequired ? "Yes" : "No"}`,
  ];
}

function buildSetupPageContent(draft: SetupFlowDraft, headline: string, details: string[]) {
  return truncateMessageContent([
    `Step ${getSetupStepIndex(draft.step) + 1} of ${setupStepOrder.length} — ${headline}`,
    "",
    ...details,
    "",
    "Current choices:",
    ...buildSetupSummaryLines(draft),
    ...(draft.notice ? ["", `Note: ${draft.notice}`] : []),
  ].join("\n"));
}

function createSetupNavigationRow(draft: SetupFlowDraft) {
  const backButton = new ButtonBuilder()
    .setCustomId(buildSetupFlowCustomId({ action: "back", draftId: draft.draftId, guildId: draft.guildId }))
    .setDisabled(draft.step === "channels")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);
  const cancelButton = new ButtonBuilder()
    .setCustomId(buildSetupFlowCustomId({ action: "cancel", draftId: draft.draftId, guildId: draft.guildId }))
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);
  const primaryButton = draft.step === "confirm"
    ? new ButtonBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "save", draftId: draft.draftId, guildId: draft.guildId }))
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
    : new ButtonBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "next", draftId: draft.draftId, guildId: draft.guildId }))
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(backButton, cancelButton, primaryButton);
}

function renderSetupFlow(draft: SetupFlowDraft) {
  ensureSetupDraftConsistency(draft);

  const components: ActionRowBuilder<any>[] = [];

  if (draft.step === "channels") {
    const channelActions: Array<{
      action: SetupFlowAction;
      current?: string;
      label: string;
      required: boolean;
    }> = [
      {
        action: "channel_alert",
        current: draft.channelConfig.moderatorAlertChannelId,
        label: "Choose the main alert channel",
        required: true,
      },
      {
        action: "channel_review",
        current: draft.channelConfig.reviewChannelId,
        label: "Choose the review channel",
        required: false,
      },
      {
        action: "channel_audit",
        current: draft.channelConfig.auditLogChannelId,
        label: "Choose the audit log channel",
        required: false,
      },
      {
        action: "channel_mod_log",
        current: draft.channelConfig.moderationLogChannelId,
        label: "Choose the moderation log channel",
        required: false,
      },
    ];

    for (const entry of channelActions) {
      const select = new ChannelSelectMenuBuilder()
        .setChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
        .setCustomId(buildSetupFlowCustomId({ action: entry.action, draftId: draft.draftId, guildId: draft.guildId }))
        .setMaxValues(1)
        .setMinValues(entry.required ? 0 : 0)
        .setPlaceholder(truncateDiscordComponentText(entry.label, 150));

      if (entry.current) {
        select.setDefaultChannels(entry.current);
      }

      components.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select));
    }

    components.push(createSetupNavigationRow(draft));
    return {
      components,
      content: buildSetupPageContent(draft, "Choose channels", [
        "Pick the channels Humanify should use for alerts, review, and logs.",
        "Nothing is saved until you click Save at the end.",
      ]),
    };
  }

  if (draft.step === "roles") {
    const trustedRoles = new RoleSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "role_trusted", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(25)
      .setMinValues(0)
      .setPlaceholder(truncateDiscordComponentText("Choose trusted moderator roles", 150));
    const suspiciousRoles = new RoleSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "role_suspicious", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(25)
      .setMinValues(0)
      .setPlaceholder(truncateDiscordComponentText("Choose suspicious roles", 150));

    if (draft.verificationConfig.trustedRoleIds.length > 0) {
      trustedRoles.setDefaultRoles(draft.verificationConfig.trustedRoleIds);
    }

    if (draft.verificationConfig.suspiciousRoleIds.length > 0) {
      suspiciousRoles.setDefaultRoles(draft.verificationConfig.suspiciousRoleIds);
    }

    components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(trustedRoles));
    components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(suspiciousRoles));
    components.push(createSetupNavigationRow(draft));

    return {
      components,
      content: buildSetupPageContent(draft, "Choose roles", [
        "Tell Humanify which roles count as trusted moderators and which roles should stay under extra review.",
      ]),
    };
  }

  if (draft.step === "grants") {
    const verifiedHumanRole = new RoleSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "role_verified_human", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(1)
      .setMinValues(0)
      .setPlaceholder(truncateDiscordComponentText("Choose the verified human role", 150));
    const age18Role = new RoleSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "role_age_18", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(1)
      .setMinValues(0)
      .setPlaceholder(truncateDiscordComponentText("Choose the 18+ role", 150));
    const age21Role = new RoleSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "role_age_21", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(1)
      .setMinValues(0)
      .setPlaceholder(truncateDiscordComponentText("Choose the 21+ role", 150));

    const verifiedHumanRoleId = getRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "verified_human");
    const age18RoleId = getRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "age_over_18");
    const age21RoleId = getRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "age_over_21");

    if (verifiedHumanRoleId) {
      verifiedHumanRole.setDefaultRoles(verifiedHumanRoleId);
    }

    if (age18RoleId) {
      age18Role.setDefaultRoles(age18RoleId);
    }

    if (age21RoleId) {
      age21Role.setDefaultRoles(age21RoleId);
    }

    components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(verifiedHumanRole));
    components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(age18Role));
    components.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(age21Role));
    components.push(createSetupNavigationRow(draft));

    return {
      components,
      content: buildSetupPageContent(draft, "Choose verification roles", [
        "Pick the roles Humanify should grant after a member finishes verification.",
        "Verified human applies to any successful release. 18+ and 21+ only apply when the server asks for those proofs and the provider satisfies them.",
      ]),
    };
  }

  if (draft.step === "providers") {
    const enabledProviders = new StringSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "provider_enabled", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(draft.verificationConfig.availableProviderIds.length)
      .setMinValues(1)
      .setPlaceholder(truncateDiscordComponentText("Choose the verification paths you want to offer", 150))
      .setOptions(
        draft.verificationConfig.availableProviderIds.map((providerId) => ({
          default: draft.verificationConfig.enabledProviderIds.includes(providerId),
          description: truncateDiscordComponentText(setupProviderLabels[providerId]?.description ?? "Verification path"),
          label: truncateDiscordComponentText(formatProviderTitle(providerId)),
          value: providerId,
        })),
      );
    const defaultProvider = new StringSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "provider_default", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(1)
      .setMinValues(1)
      .setPlaceholder(truncateDiscordComponentText("Choose the default path Humanify should suggest first", 150))
      .setOptions(
        draft.verificationConfig.enabledProviderIds.map((providerId) => ({
          default: draft.verificationConfig.defaultProviderId === providerId,
          description: truncateDiscordComponentText(setupProviderLabels[providerId]?.description ?? "Verification path"),
          label: truncateDiscordComponentText(formatProviderTitle(providerId)),
          value: providerId,
        })),
      );

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(enabledProviders));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(defaultProvider));
    components.push(createSetupNavigationRow(draft));

    return {
      components,
      content: buildSetupPageContent(draft, "Choose verification paths", [
        "Pick the ways people can prove they belong here, then choose which one Humanify should suggest first.",
      ]),
    };
  }

  if (draft.step === "bundles") {
    const bundleSelect = new StringSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "bundle_required", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(draft.verificationConfig.availableBundles.length)
      .setMinValues(1)
      .setPlaceholder(truncateDiscordComponentText("Choose the proof bundles Humanify should require", 150))
      .setOptions(
        draft.verificationConfig.availableBundles.map((bundle) => ({
          default: draft.verificationConfig.requiredBundleIds.includes(bundle.bundleId),
          description: truncateDiscordComponentText(bundle.summary),
          label: truncateDiscordComponentText(bundle.title),
          value: bundle.bundleId,
        })),
      );

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(bundleSelect));
    components.push(createSetupNavigationRow(draft));

    return {
      components,
      content: buildSetupPageContent(draft, "Choose proof bundles", [
        "Choose the proof bundle or bundles Humanify should ask for when someone needs verification.",
      ]),
    };
  }

  if (draft.step === "face") {
    const faceRequirement = new StringSelectMenuBuilder()
      .setCustomId(buildSetupFlowCustomId({ action: "face_requirement", draftId: draft.draftId, guildId: draft.guildId }))
      .setMaxValues(1)
      .setMinValues(1)
      .setPlaceholder(truncateDiscordComponentText("Choose whether a face check is required", 150))
      .setOptions(
        {
          default: draft.verificationConfig.faceVerificationRequired,
          description: truncateDiscordComponentText("People must pass a face check when the chosen path supports it."),
          label: truncateDiscordComponentText("Require a face check"),
          value: "required",
        },
        {
          default: !draft.verificationConfig.faceVerificationRequired,
          description: truncateDiscordComponentText("A face check stays optional and Humanify can use other proof paths."),
          label: truncateDiscordComponentText("Do not require a face check"),
          value: "not_required",
        },
      );

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(faceRequirement));
    components.push(createSetupNavigationRow(draft));

    return {
      components,
      content: buildSetupPageContent(draft, "Choose face-check rules", [
        "Decide whether Humanify should require a face check as part of verification.",
      ]),
    };
  }

  components.push(createSetupNavigationRow(draft));
  return {
    components,
    content: buildSetupPageContent(draft, "Confirm and save", [
      "Review the setup choices below. When you click Save, Humanify writes the real guild configuration through the API.",
    ]),
  };
}

function sliceMessagePreview(content: string) {
  return content.trim().slice(0, 180);
}

class BotApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BotApiRequestError";
    this.status = status;
  }
}

async function readJsonResponse<TData>(response: Response): Promise<TData> {
  const body = await response.json() as {
    data?: TData;
    message?: string;
  };

  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `${response.status} ${response.statusText}`.trim();
    throw new BotApiRequestError(response.status, message);
  }

  return body.data as TData;
}

export function createBotApiClient(input: {
  apiBaseUrl: string;
  fetchFn?: typeof fetch;
}): BotApiClient {
  const fetchFn = input.fetchFn ?? fetch;
  const request = async <TData>(requestInput: {
    body?: unknown;
    method: "GET" | "POST" | "PUT";
    path: string;
    requestTelemetry?: RequestTelemetryContext;
  }) => {
    const response = await fetchFn(`${input.apiBaseUrl}${requestInput.path}`, {
      body: requestInput.body === undefined ? undefined : JSON.stringify(requestInput.body),
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        ...(requestInput.body === undefined ? {} : { "content-type": "application/json" }),
      }, requestInput.requestTelemetry ?? createRequestTelemetryContext()),
      method: requestInput.method,
    });

    return readJsonResponse<TData>(response);
  };

  return {
    attachReportEvidence(guildId, reportId, body, requestTelemetry) {
      return request<BotEvidenceResponse>({
        body,
        method: "POST",
        path: `/guilds/${guildId}/reports/${reportId}/evidence`,
        requestTelemetry,
      });
    },
    createReport(guildId, body, requestTelemetry) {
      return request<BotReportResponse>({
        body,
        method: "POST",
        path: `/guilds/${guildId}/reports`,
        requestTelemetry,
      });
    },
    createScanRequest(guildId, body, requestTelemetry) {
      return request<BotScanRequestResponse>({
        body,
        method: "POST",
        path: `/guilds/${guildId}/scans`,
        requestTelemetry,
      });
    },
    createVerificationSession(guildId, body, requestTelemetry) {
      return request<BotVerificationSessionResponse>({
        body,
        method: "POST",
        path: `/guilds/${guildId}/verification/sessions`,
        requestTelemetry,
      });
    },
    getCaseWarningCard(guildId, caseId, requestTelemetry) {
      return request<BotCaseWarningCardReadResponse>({
        method: "GET",
        path: `/guilds/${guildId}/cases/${caseId}/warning-card`,
        requestTelemetry,
      });
    },
    getGuildChannelConfig(guildId, requestTelemetry) {
      return request<BotGuildChannelConfigReadResponse>({
        method: "GET",
        path: `/guilds/${guildId}/channels`,
        requestTelemetry,
      });
    },
    getGuildVerificationConfig(guildId, requestTelemetry) {
      return request<BotGuildVerificationConfigReadResponse>({
        method: "GET",
        path: `/guilds/${guildId}/verification`,
        requestTelemetry,
      });
    },
    updateGuildChannelConfig(guildId, body, requestTelemetry) {
      return request<BotGuildChannelConfigWriteResponse>({
        body,
        method: "PUT",
        path: `/guilds/${guildId}/channels`,
        requestTelemetry,
      });
    },
    updateGuildVerificationConfig(guildId, body, requestTelemetry) {
      return request<BotGuildVerificationConfigWriteResponse>({
        body,
        method: "PUT",
        path: `/guilds/${guildId}/verification`,
        requestTelemetry,
      });
    },
    updateWarningCardAlertMessage(guildId, caseId, body, requestTelemetry) {
      return request<BotWarningAlertMessageWriteResponse>({
        body,
        method: "PUT",
        path: `/guilds/${guildId}/cases/${caseId}/warning-card/alert-message`,
        requestTelemetry,
      });
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
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

function buildModeratorWarningCardMessage(card: BotCaseWarningCardReadResponse): HumanifyDiscordMessagePayload {
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
    actionRows: [createVerificationShortcutRow(card.scope.guildId, card.case.caseId, card.case.subjectUserId)],
    sections,
    summary: `Case \`${card.case.caseId}\` is open for review and can be advanced directly from this card.`,
    title: "Humanify advisory warning",
    tone: "warning",
  });
}

function isDiscordMissingMessageError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 10_008;
}

function createDiscordWarningRuntime(client: Pick<Client, "channels">): ModeratorWarningMessageRuntime {
  const resolveChannel = async (channelId: string) => {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable() || !channel.isTextBased()) {
      throw new Error(`Discord channel ${channelId} is not sendable for moderator warnings.`);
    }

    return channel;
  };

  return {
    async deleteMessage(channelId, messageId) {
      const channel = await resolveChannel(channelId);
      await channel.messages.delete(messageId);
    },
    async editMessage(channelId, messageId, payload) {
      const channel = await resolveChannel(channelId);
      await channel.messages.edit(messageId, {
        allowedMentions: { parse: [] },
        components: payload.components,
      });
    },
    async sendMessage(channelId, payload) {
      const channel = await resolveChannel(channelId);
      const message = await channel.send({
        allowedMentions: { parse: [] },
        components: payload.components,
        flags: payload.flags,
      });
      return {
        messageId: message.id,
      };
    },
  };
}

export async function syncModeratorWarningCard(input: {
  apiClient: BotApiClient;
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

  let warningCard: BotCaseWarningCardReadResponse;
  try {
    warningCard = await input.apiClient.getCaseWarningCard(input.guildId, input.caseId, requestTelemetry);
  } catch (error) {
    if (error instanceof BotApiRequestError && error.status === 404) {
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

  const payload = buildModeratorWarningCardMessage(warningCard);
  const activeAlertRef =
    warningCard.alertMessageRef?.messageState === "active" ? warningCard.alertMessageRef : undefined;

  if (activeAlertRef && activeAlertRef.channelId === moderatorAlertChannelId) {
    try {
      await input.messageRuntime.editMessage(moderatorAlertChannelId, activeAlertRef.messageId, payload);
      await input.apiClient.updateWarningCardAlertMessage(input.guildId, input.caseId, {
        actorService: "bot-bun",
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
        actorService: "bot-bun",
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

async function syncModeratorWarningCardForInteraction(input: {
  apiClient: BotApiClient;
  caseId?: string;
  guildId: string;
  interactionClient: Pick<Client<true>, "channels">;
  requestTelemetry: RequestTelemetryContext;
  syncModeratorWarningCardOverride?: CreateInteractionHandlerOptions["syncModeratorWarningCard"];
}) {
  if (!input.caseId) {
    return undefined;
  }

  if (input.syncModeratorWarningCardOverride) {
    return input.syncModeratorWarningCardOverride({
      apiClient: input.apiClient,
      caseId: input.caseId,
      guildId: input.guildId,
      requestTelemetry: input.requestTelemetry,
    });
  }

  const messageRuntime = createDiscordWarningRuntime(input.interactionClient);
  return syncModeratorWarningCard({
    apiClient: input.apiClient,
    caseId: input.caseId,
    guildId: input.guildId,
    messageRuntime,
    requestTelemetry: input.requestTelemetry,
  });
}

export function createPassiveEventHandler(options: CreatePassiveEventHandlerOptions): PassiveEventHandler {
  const passiveMessageState = createPassiveMessageState();
  const now = options.now ?? Date.now;

  return {
    async handleGuildMemberAdd(member) {
      if (!options.enableMemberJoinSignals || member.user.bot) {
        return;
      }

      const botActorUserId = resolvePassiveBotActorUserId(options.botActorUserId);
      if (!botActorUserId) {
        return;
      }

      const evaluation = evaluateJoinSignals(member, now());
      if (!evaluation.shouldOpenCase) {
        return;
      }

      const requestTelemetry = createRequestTelemetryContext();
      const response = await options.apiClient.createReport(member.guild.id, {
        intakeSource: "detector_bridge",
        openCase: true,
        reportReason: buildPassiveJoinReportReason(evaluation),
        reporterNotes: buildMemberScanReporterNotes(evaluation),
        reporterUserId: botActorUserId,
        subjectUserId: member.user.id,
        triggerFingerprint: buildPassiveJoinTriggerFingerprint(member.guild.id, member.user.id, evaluation.reasonCodes),
      }, requestTelemetry);

      if (!response.report.caseId) {
        return;
      }

      if (options.syncModeratorWarningCard) {
        await options.syncModeratorWarningCard({
          apiClient: options.apiClient,
          caseId: response.report.caseId,
          guildId: member.guild.id,
          requestTelemetry,
        });
        return;
      }

      await syncModeratorWarningCard({
        apiClient: options.apiClient,
        caseId: response.report.caseId,
        guildId: member.guild.id,
        messageRuntime: options.messageRuntime,
        requestTelemetry,
      });
    },

    async handleMessageCreate(message) {
      if (!options.enableMessageSignals || !message.guildId || message.author.bot || message.webhookId) {
        return;
      }

      const botActorUserId = resolvePassiveBotActorUserId(options.botActorUserId);
      if (!botActorUserId) {
        return;
      }

      const detection = extractMessageReasonCodes(message, passiveMessageState, now());
      if (detection.reasonCodes.length === 0) {
        return;
      }

      const requestTelemetry = createRequestTelemetryContext();
      const response = await options.apiClient.createReport(message.guildId, {
        intakeSource: "detector_bridge",
        openCase: true,
        reportReason: buildPassiveMessageReportReason(detection.reasonCodes),
        reporterNotes: `Reason codes: ${detection.reasonCodes.join(", ")}`,
        reporterUserId: botActorUserId,
        subjectUserId: message.author.id,
        triggerFingerprint: buildPassiveMessageTriggerFingerprint({
          channelId: message.channelId,
          duplicateContentHash: detection.duplicateContentHash,
          guildId: message.guildId,
          messageId: message.id,
          reasonCodes: detection.reasonCodes,
          subjectUserId: message.author.id,
        }),
      }, requestTelemetry);

      await options.apiClient.attachReportEvidence(message.guildId, response.report.reportId, {
        actorUserId: botActorUserId,
        captureSource: "discord_message_create",
        channelId: message.channelId,
        evidenceType: "message_link",
        externalRef: buildDiscordMessageUrl(message.guildId, message.channelId, message.id),
        messageId: message.id,
        messagePreview: truncatePlainText(message.content, 160),
        subjectUserId: message.author.id,
      }, requestTelemetry);

      if (!response.report.caseId) {
        return;
      }

      if (options.syncModeratorWarningCard) {
        await options.syncModeratorWarningCard({
          apiClient: options.apiClient,
          caseId: response.report.caseId,
          guildId: message.guildId,
          requestTelemetry,
        });
        return;
      }

      await syncModeratorWarningCard({
        apiClient: options.apiClient,
        caseId: response.report.caseId,
        guildId: message.guildId,
        messageRuntime: options.messageRuntime,
        requestTelemetry,
      });
    },
  };
}

async function handleReportCommand(
  interaction: ChatInputCommandInteraction,
  options: CreateInteractionHandlerOptions,
  requestTelemetry: RequestTelemetryContext,
) {
  const subject = interaction.options.getUser("user", true);
  const report = await options.apiClient.createReport(interaction.guildId!, {
    intakeSource: "slash_command",
    openCase: true,
    reportReason: interaction.options.getString("reason", true),
    reporterNotes: interaction.options.getString("notes") ?? undefined,
    reporterUserId: interaction.user.id,
    subjectUserId: subject.id,
    triggerFingerprint: `slash-report:${interaction.guildId}:${subject.id}`,
  }, requestTelemetry);
  const warningSync = await syncModeratorWarningCardForInteraction({
    apiClient: options.apiClient,
    caseId: report.report.caseId,
    guildId: interaction.guildId!,
    interactionClient: interaction.client as Client<true>,
    requestTelemetry,
    syncModeratorWarningCardOverride: options.syncModeratorWarningCard,
  });

  const components = report.report.caseId
    ? [createVerificationShortcutRow(interaction.guildId!, report.report.caseId, subject.id)]
    : undefined;

  await replyEphemeral(interaction, {
    components,
    content: appendFollowUpNote(
      `Humanify planned report ${report.report.reportId}${report.report.caseId ? ` for case ${report.report.caseId}` : ""}. ${createPersistenceNote(report.persistence)}`,
      warningSync?.note,
    ),
  });
}

async function handleCaseCommand(
  interaction: ChatInputCommandInteraction,
  options: CreateInteractionHandlerOptions,
  requestTelemetry: RequestTelemetryContext,
) {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand !== "open") {
    await replyEphemeral(interaction, {
      content: `Humanify does not support /case ${subcommand} yet.`,
    });
    return;
  }

  if (!await requireTrustedModeratorAction(interaction)) {
    return;
  }

  const subject = interaction.options.getUser("user", true);
  const report = await options.apiClient.createReport(interaction.guildId!, {
    intakeSource: "slash_command",
    openCase: true,
    reportReason: interaction.options.getString("reason", true),
    reporterNotes: interaction.options.getString("notes") ?? undefined,
    reporterUserId: interaction.user.id,
    subjectUserId: subject.id,
    triggerFingerprint: `slash-case-open:${interaction.guildId}:${subject.id}`,
  }, requestTelemetry);

  const caseId = report.report.caseId ?? report.report.reportId;
  const warningSync = await syncModeratorWarningCardForInteraction({
    apiClient: options.apiClient,
    caseId: report.report.caseId,
    guildId: interaction.guildId!,
    interactionClient: interaction.client as Client<true>,
    requestTelemetry,
    syncModeratorWarningCardOverride: options.syncModeratorWarningCard,
  });
  await replyEphemeral(interaction, {
    components: [createVerificationShortcutRow(interaction.guildId!, caseId, subject.id)],
    content: appendFollowUpNote(
      `Humanify planned case ${caseId} via report ${report.report.reportId}. ${createPersistenceNote(report.persistence)}`,
      warningSync?.note,
    ),
  });
}

async function startSetupFlow(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
  setupFlowStore: SetupFlowStore,
) {
  const [channels, verification] = await Promise.all([
    apiClient.getGuildChannelConfig(interaction.guildId!, requestTelemetry),
    apiClient.getGuildVerificationConfig(interaction.guildId!, requestTelemetry),
  ]);
  const draft = setupFlowStore.createDraft({
    actorUserId: interaction.user.id,
    channelConfig: {
      auditLogChannelId: channels.channelConfig.auditLogChannelId,
      moderationLogChannelId: channels.channelConfig.moderationLogChannelId,
      moderatorAlertChannelId: channels.channelConfig.moderatorAlertChannelId,
      reviewChannelId: channels.channelConfig.reviewChannelId,
    },
    guildId: interaction.guildId!,
    verificationConfig: {
      availableBundles: verification.verificationConfig.availableBundles.map((bundle) => ({
        ...bundle,
        claims: [...bundle.claims],
        futureExtensions: [...bundle.futureExtensions],
        operatorStorageGuarantees: [...bundle.operatorStorageGuarantees],
      })),
      availableProviderIds: [...verification.verificationConfig.availableProviderIds],
      defaultProviderId: verification.verificationConfig.defaultProviderId,
      defaultReusableProofBackendId: verification.verificationConfig.defaultReusableProofBackendId,
      enabledProviderIds: [...verification.verificationConfig.enabledProviderIds],
      faceVerificationRequired: verification.verificationConfig.faceVerificationRequired,
      roleGrantBindings: verification.verificationConfig.roleGrantBindings.map((binding) => ({ ...binding })),
      requiredBundleIds: [...verification.verificationConfig.requiredBundleIds],
      suspiciousRoleIds: [...verification.verificationConfig.suspiciousRoleIds],
      trustedRoleIds: [...verification.verificationConfig.trustedRoleIds],
    },
  });

  await replyEphemeral(interaction, renderSetupFlow(draft));
}

async function saveSetupFlow(
  interaction: {
    guildId: string | null;
    update(options: InteractionUpdateOptions): Promise<unknown>;
  },
  apiClient: BotApiClient,
  draft: SetupFlowDraft,
  requestTelemetry: RequestTelemetryContext,
  setupFlowStore: SetupFlowStore,
) {
  const validationError = validateSetupStep(draft, "confirm");
  if (validationError) {
    draft.notice = validationError;
    await updateMessageComponent(interaction, renderSetupFlow(draft));
    return;
  }

  try {
    await apiClient.updateGuildVerificationConfig(interaction.guildId!, {
      actorUserId: draft.actorUserId,
      defaultProviderId: draft.verificationConfig.defaultProviderId,
      defaultReusableProofBackendId: draft.verificationConfig.defaultReusableProofBackendId,
      enabledProviderIds: [...draft.verificationConfig.enabledProviderIds],
      faceVerificationRequired: draft.verificationConfig.faceVerificationRequired,
      roleGrantBindings: [...draft.verificationConfig.roleGrantBindings],
      requiredBundleIds: [...draft.verificationConfig.requiredBundleIds],
      suspiciousRoleIds: [...draft.verificationConfig.suspiciousRoleIds],
      trustedRoleIds: [...draft.verificationConfig.trustedRoleIds],
    }, requestTelemetry);
  } catch (error) {
    draft.notice = `Humanify could not save the verification settings yet: ${error instanceof Error ? error.message : "unknown error"}`;
    await updateMessageComponent(interaction, renderSetupFlow(draft));
    return;
  }

  try {
    await apiClient.updateGuildChannelConfig(interaction.guildId!, {
      actorUserId: draft.actorUserId,
      auditLogChannelId: draft.channelConfig.auditLogChannelId,
      moderationLogChannelId: draft.channelConfig.moderationLogChannelId,
      moderatorAlertChannelId: draft.channelConfig.moderatorAlertChannelId!,
      reviewChannelId: draft.channelConfig.reviewChannelId,
    }, requestTelemetry);
  } catch (error) {
    draft.notice = `Humanify saved the verification settings, but the channel settings still need attention: ${error instanceof Error ? error.message : "unknown error"}`;
    await updateMessageComponent(interaction, renderSetupFlow(draft));
    return;
  }

  setupFlowStore.deleteDraft(draft.draftId);
  await updateMessageComponent(interaction, {
    components: [],
    content: [
      "Setup saved. Humanify wrote the real guild settings through the API.",
      "",
      ...buildSetupSummaryLines(draft),
    ].join("\n"),
  });
}

async function handleSetupFlowComponent(
  interaction: ButtonInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | StringSelectMenuInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
  setupFlowStore: SetupFlowStore,
) {
  let parsedSetupCustomId;
  try {
    parsedSetupCustomId = parseSetupFlowCustomId(interaction.customId);
  } catch {
    return false;
  }

  if (parsedSetupCustomId.guildId !== interaction.guildId) {
    await replyEphemeral(interaction, {
      content: "Humanify refused this setup action because the guild context no longer matches.",
    });
    return true;
  }

  const draft = setupFlowStore.readDraft(parsedSetupCustomId.draftId);
  if (!draft) {
    await replyEphemeral(interaction, {
      content: "This setup session expired. Run /humanify setup again to continue.",
    });
    return true;
  }

  if (draft.actorUserId !== interaction.user.id) {
    await replyEphemeral(interaction, {
      content: "This setup session belongs to a different admin. Run /humanify setup yourself to make changes.",
    });
    return true;
  }

  if (!await requireAdminOnlyAction(interaction)) {
    return true;
  }

  draft.notice = undefined;

  switch (parsedSetupCustomId.action) {
    case "channel_alert":
      draft.channelConfig.moderatorAlertChannelId = interaction.isChannelSelectMenu() ? interaction.values[0] : undefined;
      break;
    case "channel_review":
      draft.channelConfig.reviewChannelId = interaction.isChannelSelectMenu() ? interaction.values[0] : undefined;
      break;
    case "channel_audit":
      draft.channelConfig.auditLogChannelId = interaction.isChannelSelectMenu() ? interaction.values[0] : undefined;
      break;
    case "channel_mod_log":
      draft.channelConfig.moderationLogChannelId = interaction.isChannelSelectMenu() ? interaction.values[0] : undefined;
      break;
    case "role_trusted":
      draft.verificationConfig.trustedRoleIds = interaction.isRoleSelectMenu() ? uniqueStrings(interaction.values) : draft.verificationConfig.trustedRoleIds;
      break;
    case "role_suspicious":
      draft.verificationConfig.suspiciousRoleIds = interaction.isRoleSelectMenu()
        ? uniqueStrings(interaction.values)
        : draft.verificationConfig.suspiciousRoleIds;
      break;
    case "role_verified_human":
      draft.verificationConfig.roleGrantBindings = interaction.isRoleSelectMenu()
        ? setRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "verified_human", interaction.values[0])
        : draft.verificationConfig.roleGrantBindings;
      break;
    case "role_age_18":
      draft.verificationConfig.roleGrantBindings = interaction.isRoleSelectMenu()
        ? setRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "age_over_18", interaction.values[0])
        : draft.verificationConfig.roleGrantBindings;
      break;
    case "role_age_21":
      draft.verificationConfig.roleGrantBindings = interaction.isRoleSelectMenu()
        ? setRoleGrantRoleId(draft.verificationConfig.roleGrantBindings, "age_over_21", interaction.values[0])
        : draft.verificationConfig.roleGrantBindings;
      break;
    case "provider_enabled":
      draft.verificationConfig.enabledProviderIds = interaction.isStringSelectMenu()
        ? uniqueStrings(interaction.values)
        : draft.verificationConfig.enabledProviderIds;
      break;
    case "provider_default":
      draft.verificationConfig.defaultProviderId = interaction.isStringSelectMenu()
        ? interaction.values[0] ?? draft.verificationConfig.defaultProviderId
        : draft.verificationConfig.defaultProviderId;
      break;
    case "bundle_required":
      draft.verificationConfig.requiredBundleIds = interaction.isStringSelectMenu()
        ? uniqueStrings(interaction.values)
        : draft.verificationConfig.requiredBundleIds;
      break;
    case "face_requirement":
      draft.verificationConfig.faceVerificationRequired = interaction.isStringSelectMenu()
        ? interaction.values[0] === "required"
        : draft.verificationConfig.faceVerificationRequired;
      break;
    case "back":
      draft.step = getPreviousSetupStep(draft.step);
      break;
    case "next": {
      const validationError = validateSetupStep(draft, draft.step);
      if (validationError) {
        draft.notice = validationError;
      } else {
        draft.step = getNextSetupStep(draft.step);
      }
      break;
    }
    case "cancel":
      setupFlowStore.deleteDraft(draft.draftId);
      await updateMessageComponent(interaction, {
        components: [],
        content: "Setup cancelled. Nothing was saved.",
      });
      return true;
    case "save":
      await saveSetupFlow(interaction, apiClient, draft, requestTelemetry, setupFlowStore);
      return true;
  }

  ensureSetupDraftConsistency(draft);
  await updateMessageComponent(interaction, renderSetupFlow(draft));
  return true;
}

function deriveVerificationCapabilitiesFromConfig(config: BotGuildVerificationConfig) {
  const capabilities = new Set<string>();

  for (const bundle of config.requiredBundles) {
    for (const claim of bundle.claims) {
      capabilities.add(claim);
    }
  }

  if (config.faceVerificationRequired) {
    capabilities.add("face_verification");
  }

  if (capabilities.size === 0) {
    capabilities.add("captcha");
  }

  return [...capabilities];
}

function summarizeRoleGrantBindings(bindings: readonly BotVerificationRoleGrantBinding[]) {
  return [
    `Verified human: ${formatOptionalRole(getRoleGrantRoleId(bindings, "verified_human"))}`,
    `18+: ${formatOptionalRole(getRoleGrantRoleId(bindings, "age_over_18"))}`,
    `21+: ${formatOptionalRole(getRoleGrantRoleId(bindings, "age_over_21"))}`,
  ].join(" | ");
}

async function handleVerificationPanelCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
  if (!targetChannel || !("send" in targetChannel) || typeof targetChannel.send !== "function") {
    await replyEphemeral(interaction, {
      content: "Humanify can only post the verification panel into a text-capable guild channel.",
    });
    return;
  }

  const verification = await apiClient.getGuildVerificationConfig(interaction.guildId!, requestTelemetry);
  const panelMessage = createHumanifyMessagePayload({
    actionRows: [createVerificationPanelRow(interaction.guildId!)],
    sections: [{
      title: "Release roles after verification",
      lines: [summarizeRoleGrantBindings(verification.verificationConfig.roleGrantBindings)],
    }],
    summary: "Click the button below to start this server's current verification flow.",
    title: "Humanify verification",
    tone: "info",
  });
  await targetChannel.send({
    components: panelMessage.components,
    flags: MessageFlags.IsComponentsV2,
  });

  await replyEphemeral(interaction, {
    content: `Humanify posted the verification button in <#${targetChannel.id}>.`,
  });
}

async function handleHumanifyCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
  setupFlowStore: SetupFlowStore,
) {
  const subcommand = interaction.options.getSubcommand(true);
  if (!await requireAdminOnlyAction(interaction)) {
    return;
  }

  if (subcommand === "setup") {
    await startSetupFlow(interaction, apiClient, requestTelemetry, setupFlowStore);
    return;
  }

  if (subcommand === "panel") {
    await handleVerificationPanelCommand(interaction, apiClient, requestTelemetry);
    return;
  }

  await replyEphemeral(interaction, {
    content: `Humanify does not support /humanify ${subcommand} yet.`,
  });
}

async function handleVerifyCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
  verifierBaseUrl?: string,
) {
  const subject = interaction.options.getUser("user", true);
  const isModeratorStart = subject.id !== interaction.user.id;
  if (isModeratorStart && !await requireTrustedModeratorAction(interaction)) {
    return;
  }

  if (!verifierBaseUrl) {
    await replyEphemeral(interaction, {
      content: "Humanify cannot open the verifier yet because HUMANIFY_VERIFIER_BASE_URL is not configured.",
    });
    return;
  }

  const capability = interaction.options.getString("capability") ?? "captcha";
  const verificationConfig = isModeratorStart
    ? await apiClient.getGuildVerificationConfig(interaction.guildId!, requestTelemetry)
    : undefined;
  const verification = await apiClient.createVerificationSession(interaction.guildId!, {
    initiatedBy: interaction.user.id,
    requiredCapabilities: [capability],
    userId: subject.id,
  }, requestTelemetry);
  const verifierLink = createVerifierLink(verifierBaseUrl, {
    guildId: interaction.guildId!,
    sessionId: verification.session.sessionId,
    token: verification.challengeToken,
    userId: subject.id,
    username: subject.username,
  });
  const followUpNote = isModeratorStart && verificationConfig
    ? joinFollowUpNotes(...await applyModeratorVerificationStartEffects({
      interaction,
      requestTelemetry,
      sessionId: verification.session.sessionId,
      subjectUserId: subject.id,
      verifierLink,
      verificationConfig: verificationConfig.verificationConfig,
    }))
    : undefined;

  await replyEphemeral(interaction, {
    content: buildVerificationSessionReply({
      challengeToken: verification.challengeToken,
      followUpNote,
      guildId: interaction.guildId!,
      persistence: verification.persistence,
      sessionId: verification.session.sessionId,
      summaryLine: `Humanify started verification session ${verification.session.sessionId} for <@${subject.id}> with ${capability}.`,
      userId: subject.id,
      username: subject.username,
      verifierBaseUrl,
    }),
  });
}

async function handleScanCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  if (!await requireTrustedModeratorAction(interaction)) {
    return;
  }

  const subject = interaction.options.getUser("user", true);
  const scanRequest = await apiClient.createScanRequest(interaction.guildId!, {
    actorUserId: interaction.user.id,
    scope: "single_member",
    targetUserId: subject.id,
  }, requestTelemetry);

  await replyEphemeral(interaction, {
    content: [
      `Humanify queued durable scan ${scanRequest.scanRequest.scanRequestId} for <@${subject.id}>.`,
      `Current status: ${scanRequest.scanRequest.status}.`,
      "Temporal-backed worker execution will publish moderator warnings if the scan opens a suspicious case.",
      createPersistenceNote(scanRequest.persistence),
    ].join("\n"),
  });
}

async function handleScanAllCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  if (!await requireAdminOnlyAction(interaction)) {
    return;
  }

  const scanRequest = await apiClient.createScanRequest(interaction.guildId!, {
    actorUserId: interaction.user.id,
    scope: "all_members",
  }, requestTelemetry);

  await replyEphemeral(interaction, {
    content: [
      `Humanify queued full-server scan ${scanRequest.scanRequest.scanRequestId}.`,
      `Current status: ${scanRequest.scanRequest.status}.`,
      "Temporal-backed worker execution will walk the guild membership durably and open moderator warnings only for suspicious matches.",
      createPersistenceNote(scanRequest.persistence),
    ].join("\n"),
  });
}

async function handleMessageContextReport(
  interaction: MessageContextMenuCommandInteraction,
  options: CreateInteractionHandlerOptions,
  requestTelemetry: RequestTelemetryContext,
) {
  const targetMessage = interaction.targetMessage;
  const triggerFingerprint = `discord-message:${interaction.guildId}:${targetMessage.channelId}:${targetMessage.id}`;
  const report = await options.apiClient.createReport(interaction.guildId!, {
    intakeSource: "message_context",
    openCase: true,
    reportReason: "Reported from Discord message context.",
    reporterUserId: interaction.user.id,
    subjectUserId: targetMessage.author.id,
    triggerFingerprint,
  }, requestTelemetry);
  const evidence = await options.apiClient.attachReportEvidence(interaction.guildId!, report.report.reportId, {
    actorUserId: interaction.user.id,
    captureSource: "discord_message_context",
    channelId: targetMessage.channelId,
    evidenceType: "message_link",
    externalRef: buildDiscordMessageUrl(interaction.guildId!, targetMessage.channelId, targetMessage.id),
    messageId: targetMessage.id,
    messagePreview: sliceMessagePreview(targetMessage.content),
    subjectUserId: targetMessage.author.id,
  }, requestTelemetry);
  const warningSync = await syncModeratorWarningCardForInteraction({
    apiClient: options.apiClient,
    caseId: report.report.caseId,
    guildId: interaction.guildId!,
    interactionClient: interaction.client as Client<true>,
    requestTelemetry,
    syncModeratorWarningCardOverride: options.syncModeratorWarningCard,
  });

  const components = report.report.caseId
    ? [createVerificationShortcutRow(interaction.guildId!, report.report.caseId, targetMessage.author.id)]
    : undefined;

  await replyEphemeral(interaction, {
    components,
    content: appendFollowUpNote(
      `Humanify planned report ${report.report.reportId} and evidence ${evidence.evidence.evidenceId}. ${createPersistenceNote(evidence.persistence)}`,
      warningSync?.note,
    ),
  });
}

async function handleVerificationShortcut(
  interaction: ButtonInteraction,
  options: CreateInteractionHandlerOptions,
  requestTelemetry: RequestTelemetryContext,
) {
  if (!interaction.customId.startsWith("humanify:")) {
    return;
  }

  const parsed = parseComponentCustomId(interaction.customId);
  if (parsed.kind !== "verification_start" && parsed.kind !== "verification_panel") {
    await replyEphemeral(interaction, {
      content: "Humanify does not recognize this shortcut.",
    });
    return;
  }

  if (parsed.guildId !== interaction.guildId) {
    await replyEphemeral(interaction, {
      content: "Humanify refused this shortcut because the guild context no longer matches.",
    });
    return;
  }

  const verifierBaseUrl = options.verifierBaseUrl ?? process.env.HUMANIFY_VERIFIER_BASE_URL;
  if (!verifierBaseUrl) {
    await replyEphemeral(interaction, {
      content: "Humanify cannot open the verifier yet because HUMANIFY_VERIFIER_BASE_URL is not configured.",
    });
    return;
  }

  if (parsed.kind === "verification_panel") {
    const verificationConfig = await options.apiClient.getGuildVerificationConfig(interaction.guildId!, requestTelemetry);
    const verification = await options.apiClient.createVerificationSession(interaction.guildId!, {
      initiatedBy: interaction.user.id,
      requiredCapabilities: deriveVerificationCapabilitiesFromConfig(verificationConfig.verificationConfig),
      userId: interaction.user.id,
    }, requestTelemetry);
    const verifierLink = createVerifierLink(verifierBaseUrl, {
      guildId: interaction.guildId!,
      sessionId: verification.session.sessionId,
      token: verification.challengeToken,
      userId: interaction.user.id,
      username: interaction.user.username,
    });

    await replyEphemeral(interaction, {
      content: [
        `Humanify started verification session ${verification.session.sessionId}.`,
        `Open the verifier: ${verifierLink}`,
        createPersistenceNote(verification.persistence),
      ].join("\n"),
    });
    return;
  }

  const { caseId, userId } = parseCaseUserEntity(parsed.entityId);
  const isModeratorStart = userId !== interaction.user.id;
  if (isModeratorStart && !await requireTrustedModeratorAction(interaction)) {
    return;
  }

  const verificationConfig = isModeratorStart
    ? await options.apiClient.getGuildVerificationConfig(interaction.guildId!, requestTelemetry)
    : undefined;
  const verification = await options.apiClient.createVerificationSession(interaction.guildId!, {
    caseId,
    initiatedBy: interaction.user.id,
    requiredCapabilities: ["captcha"],
    userId,
  }, requestTelemetry);
  const warningSync = await syncModeratorWarningCardForInteraction({
    apiClient: options.apiClient,
    caseId,
      guildId: interaction.guildId!,
      interactionClient: interaction.client as Client<true>,
      requestTelemetry,
      syncModeratorWarningCardOverride: options.syncModeratorWarningCard,
    });
  const verifierLink = createVerifierLink(verifierBaseUrl, {
    guildId: interaction.guildId!,
    sessionId: verification.session.sessionId,
    token: verification.challengeToken,
    userId,
  });
  const followUpNote = joinFollowUpNotes(
    warningSync?.note,
    ...(isModeratorStart && verificationConfig
      ? await applyModeratorVerificationStartEffects({
        interaction,
        requestTelemetry,
        sessionId: verification.session.sessionId,
        subjectUserId: userId,
        verifierLink,
        verificationConfig: verificationConfig.verificationConfig,
      })
      : []),
  );

  await replyEphemeral(interaction, {
    content: buildVerificationSessionReply({
      challengeToken: verification.challengeToken,
      followUpNote,
      guildId: interaction.guildId!,
      persistence: verification.persistence,
      sessionId: verification.session.sessionId,
      summaryLine: `Humanify started verification session ${verification.session.sessionId} for case ${caseId}.`,
      userId,
      verifierBaseUrl,
    }),
  });
}

export function decideApprovedActionExecution(input: {
  approval: ApprovedActionEnvelope;
  capabilities: DiscordExecutionCapabilities;
  requestedAction: typeof humanifyActionLadder[number];
}): ApprovedActionExecutionDecision {
  if (input.approval.durability !== "persisted") {
    return {
      executable: false,
      reason: "backend_commit_pending",
      resolvedAction: input.requestedAction,
    };
  }

  if (!input.approval.executionPlan.executable) {
    return input.approval.executionPlan;
  }

  return resolveDiscordExecutionPlan(input.requestedAction, input.capabilities);
}

export function createInteractionHandler(options: CreateInteractionHandlerOptions) {
  const setupFlowStore = createSetupFlowStore();

  return async function handleInteraction(interaction: Interaction) {
    const requestTelemetry = createRequestTelemetryContext();

    if (!interaction.inGuild()) {
      if ("reply" in interaction) {
        await replyEphemeral(interaction, {
          content: "Humanify only accepts guild interactions.",
        });
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === humanifyBotCommandNames.humanify) {
        await handleHumanifyCommand(interaction, options.apiClient, requestTelemetry, setupFlowStore);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.report) {
        await handleReportCommand(interaction, options, requestTelemetry);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.case) {
        await handleCaseCommand(interaction, options, requestTelemetry);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.scan) {
        await handleScanCommand(interaction, options.apiClient, requestTelemetry);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.scanAll) {
        await handleScanAllCommand(interaction, options.apiClient, requestTelemetry);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.verify) {
        await handleVerifyCommand(interaction, options.apiClient, requestTelemetry, options.verifierBaseUrl);
        return;
      }
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === humanifyBotCommandNames.reportMessage) {
      await handleMessageContextReport(interaction, options, requestTelemetry);
      return;
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isStringSelectMenu()) {
      if (await handleSetupFlowComponent(interaction, options.apiClient, requestTelemetry, setupFlowStore)) {
        return;
      }
    }

    if (interaction.isButton()) {
      if (await handleSetupFlowComponent(interaction, options.apiClient, requestTelemetry, setupFlowStore)) {
        return;
      }

      await handleVerificationShortcut(interaction, options, requestTelemetry);
    }
  };
}

export function createBotClient(
  options: Omit<ClientOptions, "intents"> & {
    includeMessageSignals?: boolean;
  } = {},
) {
  const { includeMessageSignals = false, ...clientOptions } = options;
  return new Client({
    ...clientOptions,
    intents: createBotGatewayIntents({ includeMessageSignals }),
  });
}

export async function registerHumanifyCommands(client: Client<true>, commandGuildId?: string) {
  const commands = createHumanifyApplicationCommands();
  if (commandGuildId) {
    const guild = client.guilds.cache.get(commandGuildId) ?? await client.guilds.fetch(commandGuildId);
    await guild.commands.set(commands);
    return {
      commandCount: commands.length,
      scope: commandGuildId,
    };
  }

  if (!client.application) {
    throw new Error("Discord application metadata is unavailable after the ready event.");
  }

  const registered = await client.application.commands.set(commands);
  return {
    commandCount: registered.size,
    scope: "global",
  };
}

export async function startBot(
  token = loadBotTokenConfig(process.env).botToken,
  env = process.env,
  logger: LoggerLike = console,
) {
  const identity = loadServiceIdentityConfig(env, { serviceName: "@humanify/bot-bun" });
  const observability = loadObservabilityConfig(env);
  const telemetry = createTelemetryBootstrap({
    ...identity,
    sentryDsn: observability.sentryDsn,
    sentryTracesSampleRate: observability.sentryTracesSampleRate,
  });
  const apiConfig = loadBotApiConfig(env);
  const apiClient = createBotApiClient({ apiBaseUrl: apiConfig.apiBaseUrl });
  const interactionHandler = createInteractionHandler({ apiClient, verifierBaseUrl: env.HUMANIFY_VERIFIER_BASE_URL });
  const client = createBotClient({ includeMessageSignals: apiConfig.enableMessageSignals });
  const passiveEventHandler = createPassiveEventHandler({
    apiClient,
    botActorUserId: () => client.user?.id,
    enableMemberJoinSignals: apiConfig.enableMemberJoinSignals,
    enableMessageSignals: apiConfig.enableMessageSignals,
    messageRuntime: createDiscordWarningRuntime(client),
  });

  client.once(Events.ClientReady, (readyClient) => {
    const requestTelemetry = createRequestTelemetryContext();
    const logContext = {
      environment: identity.environment,
      release: identity.release,
      requestId: requestTelemetry.requestId,
      serviceName: identity.serviceName,
      traceContext: requestTelemetry.traceContext,
    };

    const readyLog = async () => {
      const registration = apiConfig.registerCommandsOnStart
        ? await registerHumanifyCommands(readyClient, apiConfig.commandGuildId)
        : { commandCount: 0, scope: "disabled" };

      logger.info(
        JSON.stringify(
          createStructuredLogFields(logContext, {
            apiBaseUrl: apiConfig.apiBaseUrl,
            commandRegistrationScope: registration.scope,
            commandsRegistered: registration.commandCount,
            contractVersion: botRuntimeSummary.contractVersion,
            gatewayIntentCount: createBotGatewayIntents({
              includeMessageSignals: apiConfig.enableMessageSignals,
            }).length,
            memberJoinSignalsEnabled: apiConfig.enableMemberJoinSignals,
            messageSignalsEnabled: apiConfig.enableMessageSignals,
            requestIdHeader: telemetry.requestIdHeader,
            sentryEnabled: telemetry.sentryEnabled,
            tag: readyClient.user.tag,
            telemetryHeader: telemetry.propagationHeader,
          }),
        ),
      );
    };

    readyLog().catch((error) => {
      logger.error(JSON.stringify(createStructuredErrorFields(logContext, error, { event: "discord.ready.failed" })));
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    interactionHandler(interaction).catch((error) => {
      const requestTelemetry = createRequestTelemetryContext();
      logger.error(
        JSON.stringify(
          createStructuredErrorFields(
            {
              environment: identity.environment,
              release: identity.release,
              requestId: requestTelemetry.requestId,
              serviceName: identity.serviceName,
              traceContext: requestTelemetry.traceContext,
            },
            error,
            {
              event: "discord.interaction.failed",
              guildId: interaction.guildId ?? undefined,
              interactionType: interaction.type,
            },
          ),
        ),
      );
    });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    passiveEventHandler.handleGuildMemberAdd(member).catch((error) => {
      const requestTelemetry = createRequestTelemetryContext();
      logger.error(
        JSON.stringify(
          createStructuredErrorFields(
            {
              environment: identity.environment,
              release: identity.release,
              requestId: requestTelemetry.requestId,
              serviceName: identity.serviceName,
              traceContext: requestTelemetry.traceContext,
            },
            error,
            {
              event: "discord.guild_member_add.failed",
              guildId: member.guild.id,
              subjectUserId: member.user.id,
            },
          ),
        ),
      );
    });
  });

  client.on(Events.MessageCreate, (message) => {
    passiveEventHandler.handleMessageCreate(message).catch((error) => {
      const requestTelemetry = createRequestTelemetryContext();
      logger.error(
        JSON.stringify(
          createStructuredErrorFields(
            {
              environment: identity.environment,
              release: identity.release,
              requestId: requestTelemetry.requestId,
              serviceName: identity.serviceName,
              traceContext: requestTelemetry.traceContext,
            },
            error,
            {
              channelId: message.channelId,
              event: "discord.message_create.failed",
              guildId: message.guildId ?? undefined,
              messageId: message.id,
              subjectUserId: message.author.id,
            },
          ),
        ),
      );
    });
  });

  await client.login(token);

  return client;
}

if (import.meta.main) {
  startBot().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
