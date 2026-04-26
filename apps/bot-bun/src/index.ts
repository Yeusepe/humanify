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
  type Interaction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type MessageContextMenuCommandInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";

import { loadBotApiConfig, loadBotTokenConfig, loadObservabilityConfig, loadServiceIdentityConfig } from "@humanify/config";
import { humanifyActionLadder, humanifyContractVersion } from "@humanify/contracts";
import {
  authorizeAdminOnlyBotAction,
  authorizeTrustedModeratorOnlyBotAction,
  buildComponentCustomId,
  buildSetupFlowCustomId,
  createBotGatewayIntents,
  createHumanifyApplicationCommands,
  humanifyBotCommandNames,
  parseComponentCustomId,
  parseSetupFlowCustomId,
  resolveDiscordExecutionPlan,
  type DiscordExecutionCapabilities,
  type DiscordExecutionPlan,
  type SetupFlowAction,
} from "@humanify/discord-core";
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
  intakeSource: "message_context" | "slash_command";
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
  requiredBundleIds: string[];
  requiredBundles: BotSetupBundle[];
  source: "catalog_default" | "persisted";
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
};

export type BotGuildVerificationConfigReadResponse = {
  persistence: "catalog_default" | "persisted";
  verificationConfig: BotGuildVerificationConfig;
};

export type BotGuildVerificationConfigWriteBody = {
  actorUserId: string;
  defaultProviderId: string;
  enabledProviderIds: string[];
  faceVerificationRequired: boolean;
  requiredBundleIds: string[];
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
};

export type BotGuildVerificationConfigWriteResponse = {
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
  verificationConfig: BotGuildVerificationConfig;
};

export type ApprovedActionExecutionDecision = DiscordExecutionPlan;

export type ApprovedActionEnvelope = {
  auditReason: string;
  durability: string;
  executionPlan: DiscordExecutionPlan;
};

export type BotApiClient = {
  attachReportEvidence(
    guildId: string,
    reportId: string,
    body: BotEvidenceBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotEvidenceResponse>;
  createReport(guildId: string, body: BotReportBody, requestTelemetry?: RequestTelemetryContext): Promise<BotReportResponse>;
  createVerificationSession(
    guildId: string,
    body: BotVerificationSessionBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<BotVerificationSessionResponse>;
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
};

export type CreateInteractionHandlerOptions = {
  apiClient: BotApiClient;
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

function buildVerificationShortcutId(guildId: string, caseId: string, userId: string) {
  return buildComponentCustomId({
    entityId: `${caseId}~${userId}`,
    guildId,
    kind: "verification_start",
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

function createVerificationShortcutRow(guildId: string, caseId: string, userId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildVerificationShortcutId(guildId, caseId, userId))
      .setLabel("Start verification")
      .setStyle(ButtonStyle.Primary),
  );
}

async function replyEphemeral(
  interaction: {
    reply(options: InteractionReplyOptions): Promise<unknown>;
  },
  payload: {
    components?: ActionRowBuilder<ButtonBuilder>[];
    content: string;
  },
) {
  const options: InteractionReplyOptions = {
    components: payload.components,
    content: payload.content,
    flags: MessageFlags.Ephemeral,
  };

  await interaction.reply(options);
}

function sliceMessagePreview(content: string) {
  return content.trim().slice(0, 180);
}

async function readJsonResponse<TData>(response: Response): Promise<TData> {
  const body = await response.json() as {
    data?: TData;
    message?: string;
  };

  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `${response.status} ${response.statusText}`.trim();
    throw new Error(message);
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
    createVerificationSession(guildId, body, requestTelemetry) {
      return request<BotVerificationSessionResponse>({
        body,
        method: "POST",
        path: `/guilds/${guildId}/verification/sessions`,
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
  };
}

async function handleReportCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  const subject = interaction.options.getUser("user", true);
  const report = await apiClient.createReport(interaction.guildId!, {
    intakeSource: "slash_command",
    openCase: true,
    reportReason: interaction.options.getString("reason", true),
    reporterNotes: interaction.options.getString("notes") ?? undefined,
    reporterUserId: interaction.user.id,
    subjectUserId: subject.id,
    triggerFingerprint: `slash-report:${interaction.guildId}:${subject.id}`,
  }, requestTelemetry);

  const components = report.report.caseId
    ? [createVerificationShortcutRow(interaction.guildId!, report.report.caseId, subject.id)]
    : undefined;

  await replyEphemeral(interaction, {
    components,
    content: `Humanify planned report ${report.report.reportId}${report.report.caseId ? ` for case ${report.report.caseId}` : ""}. ${createPersistenceNote(report.persistence)}`,
  });
}

async function handleCaseCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
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
  const report = await apiClient.createReport(interaction.guildId!, {
    intakeSource: "slash_command",
    openCase: true,
    reportReason: interaction.options.getString("reason", true),
    reporterNotes: interaction.options.getString("notes") ?? undefined,
    reporterUserId: interaction.user.id,
    subjectUserId: subject.id,
    triggerFingerprint: `slash-case-open:${interaction.guildId}:${subject.id}`,
  }, requestTelemetry);

  const caseId = report.report.caseId ?? report.report.reportId;
  await replyEphemeral(interaction, {
    components: [createVerificationShortcutRow(interaction.guildId!, caseId, subject.id)],
    content: `Humanify planned case ${caseId} via report ${report.report.reportId}. ${createPersistenceNote(report.persistence)}`,
  });
}

async function handleHumanifyCommand(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand !== "setup") {
    await replyEphemeral(interaction, {
      content: `Humanify does not support /humanify ${subcommand} yet.`,
    });
    return;
  }

  if (!await requireAdminOnlyAction(interaction)) {
    return;
  }

  await replyEphemeral(interaction, {
    content: "Humanify setup is not ready yet. Server admins will be able to configure channels and roles here soon.",
  });
}

async function handleVerifyCommand(
  interaction: ChatInputCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  const subject = interaction.options.getUser("user", true);
  if (subject.id !== interaction.user.id && !await requireTrustedModeratorAction(interaction)) {
    return;
  }

  const capability = interaction.options.getString("capability") ?? "captcha";
  const verification = await apiClient.createVerificationSession(interaction.guildId!, {
    initiatedBy: interaction.user.id,
    requiredCapabilities: [capability],
    userId: subject.id,
  }, requestTelemetry);

  await replyEphemeral(interaction, {
    content: `Humanify planned verification session ${verification.session.sessionId} for <@${subject.id}> with ${capability}. ${createPersistenceNote(verification.persistence)}`,
  });
}

async function handleMessageContextReport(
  interaction: MessageContextMenuCommandInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  const targetMessage = interaction.targetMessage;
  const triggerFingerprint = `discord-message:${interaction.guildId}:${targetMessage.channelId}:${targetMessage.id}`;
  const report = await apiClient.createReport(interaction.guildId!, {
    intakeSource: "message_context",
    openCase: true,
    reportReason: "Reported from Discord message context.",
    reporterUserId: interaction.user.id,
    subjectUserId: targetMessage.author.id,
    triggerFingerprint,
  }, requestTelemetry);
  const evidence = await apiClient.attachReportEvidence(interaction.guildId!, report.report.reportId, {
    actorUserId: interaction.user.id,
    captureSource: "discord_message_context",
    channelId: targetMessage.channelId,
    evidenceType: "message_link",
    externalRef: buildDiscordMessageUrl(interaction.guildId!, targetMessage.channelId, targetMessage.id),
    messageId: targetMessage.id,
    messagePreview: sliceMessagePreview(targetMessage.content),
    subjectUserId: targetMessage.author.id,
  }, requestTelemetry);

  const components = report.report.caseId
    ? [createVerificationShortcutRow(interaction.guildId!, report.report.caseId, targetMessage.author.id)]
    : undefined;

  await replyEphemeral(interaction, {
    components,
    content: `Humanify planned report ${report.report.reportId} and evidence ${evidence.evidence.evidenceId}. ${createPersistenceNote(evidence.persistence)}`,
  });
}

async function handleVerificationShortcut(
  interaction: ButtonInteraction,
  apiClient: BotApiClient,
  requestTelemetry: RequestTelemetryContext,
) {
  if (!interaction.customId.startsWith("humanify:")) {
    return;
  }

  const parsed = parseComponentCustomId(interaction.customId);
  if (parsed.kind !== "verification_start") {
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

  const { caseId, userId } = parseCaseUserEntity(parsed.entityId);
  if (userId !== interaction.user.id && !await requireTrustedModeratorAction(interaction)) {
    return;
  }

  const verification = await apiClient.createVerificationSession(interaction.guildId!, {
    caseId,
    initiatedBy: interaction.user.id,
    requiredCapabilities: ["captcha"],
    userId,
  }, requestTelemetry);

  await replyEphemeral(interaction, {
    content: `Humanify planned verification session ${verification.session.sessionId} for case ${caseId}. ${createPersistenceNote(verification.persistence)}`,
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
        await handleHumanifyCommand(interaction);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.report) {
        await handleReportCommand(interaction, options.apiClient, requestTelemetry);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.case) {
        await handleCaseCommand(interaction, options.apiClient, requestTelemetry);
        return;
      }

      if (interaction.commandName === humanifyBotCommandNames.verify) {
        await handleVerifyCommand(interaction, options.apiClient, requestTelemetry);
      }

      return;
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === humanifyBotCommandNames.reportMessage) {
      await handleMessageContextReport(interaction, options.apiClient, requestTelemetry);
      return;
    }

    if (interaction.isButton()) {
      await handleVerificationShortcut(interaction, options.apiClient, requestTelemetry);
    }
  };
}

export function createBotClient(options: Omit<ClientOptions, "intents"> = {}) {
  return new Client({
    ...options,
    intents: createBotGatewayIntents(),
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
  const interactionHandler = createInteractionHandler({ apiClient });
  const client = createBotClient();

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
            gatewayIntentCount: botRuntimeSummary.gatewayIntentCount,
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

  await client.login(token);

  return client;
}

if (import.meta.main) {
  startBot().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
