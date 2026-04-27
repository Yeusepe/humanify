/**
 * Purpose: Verifies the Humanify Discord bot routes intake commands and refuses executor work until Bun approvals are durable.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\verification.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://discord.js.org/docs/packages/discord.js/main
 * Tests:
 * - apps/bot-bun/src/index.test.ts
 */

import { expect, test } from "bun:test";

import { GatewayIntentBits, MessageFlags, PermissionFlagsBits, PermissionsBitField } from "discord.js";

import {
  buildComponentCustomId,
  createBotGatewayIntents,
  parseComponentCustomId,
  parseSetupFlowCustomId,
} from "@humanify/discord-core";

import {
  type BotApiClient,
  type BotCaseWarningCardReadResponse,
  type ModeratorWarningMessageRuntime,
  createBotApiClient,
  createInteractionHandler,
  createPassiveEventHandler,
  decideApprovedActionExecution,
  syncModeratorWarningCard,
} from "./index";

function createGuildInteractionPermissions(...permissions: bigint[]) {
  return new PermissionsBitField(permissions);
}

function createChatCommandInteraction(input: {
  channel?: { id: string; isTextBased(): boolean; send?: (payload: unknown) => Promise<void> };
  commandName: string;
  getChannel?: (name: string) => { id: string; isTextBased(): boolean; send?: (payload: unknown) => Promise<void> } | null;
  getString?: (name: string) => string | null;
  getSubcommand?: () => string;
  getUser?: (name: string) => { id: string; username?: string } | null;
  memberPermissions?: PermissionsBitField | null;
  reply?: (payload: unknown) => Promise<void>;
  userId?: string;
}) {
  return {
    commandName: input.commandName,
    channel: input.channel,
    guildId: "guild_123",
    inGuild: () => true,
    isButton: () => false,
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    memberPermissions: input.memberPermissions,
    options: {
      getString(name: string) {
        return input.getString?.(name) ?? null;
      },
      getChannel(name: string) {
        return input.getChannel?.(name) ?? null;
      },
      getSubcommand() {
        return input.getSubcommand?.() ?? "open";
      },
      getUser(name: string) {
        return input.getUser?.(name) ?? null;
      },
    },
    reply: input.reply ?? (async () => undefined),
    user: { id: input.userId ?? "user_123" },
  } as any;
}

function createComponentInteraction(input: {
  customId: string;
  kind: "button" | "channel_select" | "role_select" | "string_select";
  memberPermissions?: PermissionsBitField | null;
  reply?: (payload: unknown) => Promise<void>;
  update?: (payload: unknown) => Promise<void>;
  userId?: string;
  values?: string[];
}) {
  return {
    customId: input.customId,
    guildId: "guild_123",
    inGuild: () => true,
    isAnySelectMenu: () => input.kind !== "button",
    isButton: () => input.kind === "button",
    isChannelSelectMenu: () => input.kind === "channel_select",
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => false,
    isRoleSelectMenu: () => input.kind === "role_select",
    isStringSelectMenu: () => input.kind === "string_select",
    memberPermissions: input.memberPermissions,
    reply: input.reply ?? (async () => undefined),
    update: input.update ?? (async () => undefined),
    user: { id: input.userId ?? "user_123" },
    values: input.values ?? [],
  } as any;
}

function createVerificationBundle(input: {
  bundleId: string;
  claims: string[];
  summary: string;
  title: string;
}) {
  return {
    bestFor: "setup testing",
    bundleId: input.bundleId,
    claims: input.claims,
    futureExtensions: [],
    operatorStorageGuarantees: [],
    summary: input.summary,
    title: input.title,
  };
}

function createTestApiClient(overrides: Partial<BotApiClient> = {}): BotApiClient {
  return {
    attachReportEvidence: async () => {
      throw new Error("test did not provide attachReportEvidence");
    },
    createReport: async () => {
      throw new Error("test did not provide createReport");
    },
    createScanRequest: async () => {
      throw new Error("test did not provide createScanRequest");
    },
    createVerificationSession: async () => {
      throw new Error("test did not provide createVerificationSession");
    },
    getCaseWarningCard: async () => {
      throw new Error("test did not provide getCaseWarningCard");
    },
    getGuildChannelConfig: async () => ({
      channelConfig: {
        guildId: "guild_123",
        source: "not_configured",
      },
      persistence: "not_configured",
    }),
    getGuildVerificationConfig: async () => ({
      persistence: "catalog_default",
      verificationConfig: {
        availableBundles: [
          createVerificationBundle({
            bundleId: "humanify_id_age_over_18_v1",
            claims: ["age_over_18"],
            summary: "Age only",
            title: "Only prove age over 18",
          }),
          createVerificationBundle({
            bundleId: "humanify_id_nationality_v1",
            claims: ["nationality"],
            summary: "Nationality only",
            title: "Only prove nationality",
          }),
          createVerificationBundle({
            bundleId: "humanify_id_age_and_nationality_v1",
            claims: ["age_over_18", "nationality"],
            summary: "Age and nationality",
            title: "Prove age + nationality",
          }),
        ],
        availableProviderIds: ["didit", "privado", "self", "world_id"],
        defaultProviderId: "didit",
        enabledProviderIds: ["didit", "privado", "self", "world_id"],
        faceVerificationRequired: false,
        fallbackRoles: [],
        guildId: "guild_123",
        roleGrantBindings: [],
        requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
        requiredBundles: [
          createVerificationBundle({
            bundleId: "humanify_id_age_and_nationality_v1",
            claims: ["age_over_18", "nationality"],
            summary: "Age and nationality",
            title: "Prove age + nationality",
          }),
        ],
        source: "catalog_default",
        suspiciousRoleIds: [],
        trustedRoleIds: [],
      },
    }),
    updateGuildChannelConfig: async (guildId, body) => ({
      channelConfig: {
        auditLogChannelId: body.auditLogChannelId,
        createdAt: "2026-01-01T00:00:00.000Z",
        guildId,
        moderationLogChannelId: body.moderationLogChannelId,
        moderatorAlertChannelId: body.moderatorAlertChannelId,
        reviewChannelId: body.reviewChannelId,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      persistence: "persisted",
      queueDelivery: "pending_outbox_publish",
    }),
    updateGuildVerificationConfig: async (guildId, body) => ({
      persistence: "persisted",
      queueDelivery: "pending_outbox_publish",
      verificationConfig: {
        availableBundles: [
          createVerificationBundle({
            bundleId: "humanify_id_age_over_18_v1",
            claims: ["age_over_18"],
            summary: "Age only",
            title: "Only prove age over 18",
          }),
          createVerificationBundle({
            bundleId: "humanify_id_nationality_v1",
            claims: ["nationality"],
            summary: "Nationality only",
            title: "Only prove nationality",
          }),
          createVerificationBundle({
            bundleId: "humanify_id_age_and_nationality_v1",
            claims: ["age_over_18", "nationality"],
            summary: "Age and nationality",
            title: "Prove age + nationality",
          }),
        ],
        availableProviderIds: ["didit", "privado", "self", "world_id"],
        defaultProviderId: body.defaultProviderId,
        enabledProviderIds: body.enabledProviderIds,
        faceVerificationRequired: body.faceVerificationRequired,
        fallbackRoles: body.trustedRoleIds,
        guildId,
        roleGrantBindings: body.roleGrantBindings,
        requiredBundleIds: body.requiredBundleIds,
        requiredBundles: [
          createVerificationBundle({
            bundleId: "humanify_id_age_over_18_v1",
            claims: ["age_over_18"],
            summary: "Age only",
            title: "Only prove age over 18",
          }),
        ],
        source: "persisted",
        suspiciousRoleIds: body.suspiciousRoleIds,
        trustedRoleIds: body.trustedRoleIds,
      },
    }),
    updateWarningCardAlertMessage: async (guildId, caseId, body) => ({
      alertMessageRef: {
        caseId,
        channelId: body.channelId,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActorService: body.actorService,
        messageId: body.messageId,
        messageState: body.messageState ?? "active",
        messageUrl: `https://discord.com/channels/${guildId}/${body.channelId}/${body.messageId}`,
        subjectUserId: "user_123",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      persistence: "persisted",
      queueDelivery: "pending_outbox_publish",
    }),
    ...overrides,
  };
}

function createPassiveWarningRuntime(): ModeratorWarningMessageRuntime {
  return {
    deleteMessage: async () => undefined,
    editMessage: async () => undefined,
    sendMessage: async () => ({ messageId: "warning_message_123" }),
  };
}

function createGuildMemberAddEvent(input: {
  accountCreatedAt?: number;
  avatar?: string | null;
  guildId?: string;
  userId?: string;
}) {
  return {
    guild: {
      id: input.guildId ?? "guild_123",
    },
    user: {
      avatar: input.avatar ?? null,
      bot: false,
      createdTimestamp: input.accountCreatedAt ?? Date.UTC(2026, 0, 1, 11, 0, 0),
      id: input.userId ?? "user_123",
    },
  } as any;
}

function createMessageCreateEvent(input: {
  authorBot?: boolean;
  channelId?: string;
  content: string;
  createdAt?: number;
  guildId?: string;
  id?: string;
  mentionRoleCount?: number;
  mentionUserCount?: number;
  userId?: string;
  webhookId?: string | null;
}) {
  return {
    author: {
      bot: input.authorBot ?? false,
      createdTimestamp: input.createdAt ?? Date.UTC(2025, 11, 20, 0, 0, 0),
      id: input.userId ?? "user_123",
    },
    channelId: input.channelId ?? "channel_123",
    content: input.content,
    guildId: input.guildId ?? "guild_123",
    id: input.id ?? "message_123",
    mentions: {
      roles: { size: input.mentionRoleCount ?? 0 },
      users: { size: input.mentionUserCount ?? 0 },
    },
    webhookId: input.webhookId ?? null,
  } as any;
}

function createWarningCard(overrides: Partial<BotCaseWarningCardReadResponse> = {}): BotCaseWarningCardReadResponse {
  return {
    case: {
      caseId: "case_123",
      openedAt: "2026-01-01T00:00:00.000Z",
      reason: "fake Nitro lure",
      severity: 7,
      status: "open",
      subjectUserId: "user_123",
    },
    evidenceSummary: {
      evidenceCount: 1,
      latestEvidence: {
        createdAt: "2026-01-01T00:05:00.000Z",
        evidenceId: "evidence_123",
        messagePreview: "Claim your free Nitro gift now",
      },
    },
    readModelStatus: "canonical_postgres",
    reportsSummary: {
      latestReportAt: "2026-01-01T00:01:00.000Z",
      latestReportReason: "fake Nitro lure",
      reportCount: 1,
      reporterCount: 1,
    },
    scope: {
      caseId: "case_123",
      guildId: "guild_123",
    },
    source: "canonical_postgres_warning_card",
    ...overrides,
  };
}

function createWarningRuntime(overrides: Partial<ModeratorWarningMessageRuntime> = {}): {
  calls: Array<Record<string, unknown>>;
  runtime: ModeratorWarningMessageRuntime;
} {
  const calls: Array<Record<string, unknown>> = [];

  return {
    calls,
    runtime: {
      async deleteMessage(channelId, messageId) {
        calls.push({ channelId, kind: "delete", messageId });
      },
      async editMessage(channelId, messageId, content) {
        calls.push({ channelId, content, kind: "edit", messageId });
      },
      async sendMessage(channelId, content) {
        calls.push({ channelId, content, kind: "send" });
        return {
          messageId: "message_alert_123",
        };
      },
      ...overrides,
    },
  };
}

function findCustomId(payload: {
  components?: Array<{ toJSON(): { components?: Array<{ custom_id?: string }> } }>;
}, matcher: (customId: string) => boolean) {
  for (const row of payload.components ?? []) {
    for (const component of row.toJSON().components ?? []) {
      if (component.custom_id && matcher(component.custom_id)) {
        return component.custom_id;
      }
    }
  }

  throw new Error("Expected setup component custom ID was not found.");
}

function assertDiscordPayloadWithinLimits(payload: {
  components?: Array<{ toJSON(): { components?: Array<Record<string, unknown>> } }>;
  content?: string;
}) {
  if (typeof payload.content === "string" && payload.content.length > 2_000) {
    throw new Error("Invalid string length");
  }

  for (const row of payload.components ?? []) {
    for (const component of row.toJSON().components ?? []) {
      if (typeof component.custom_id === "string" && component.custom_id.length > 100) {
        throw new Error("Received one or more errors");
      }

      if (typeof component.placeholder === "string" && component.placeholder.length > 150) {
        throw new Error("Received one or more errors");
      }

      const options = Array.isArray(component.options) ? component.options : [];
      for (const option of options) {
        if (typeof option.label === "string" && option.label.length > 100) {
          throw new Error("Received one or more errors");
        }

        if (typeof option.description === "string" && option.description.length > 100) {
          throw new Error("Received one or more errors");
        }
      }
    }
  }
}

test("report command routes moderator intake through the report API and offers a verification shortcut", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const warningCalls: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      attachReportEvidence: async () => {
        throw new Error("report command should not attach evidence");
      },
      createReport: async (guildId, body) => {
        apiCalls.push({ body, guildId, kind: "report" });

        return {
          persistence: "planned_not_persisted",
          report: {
            caseId: "case_123",
            reportId: "report_123",
          },
        };
      },
      createVerificationSession: async () => {
        throw new Error("report command should not create verification directly");
      },
    }),
    syncModeratorWarningCard: async ({ caseId, guildId }) => {
      warningCalls.push({ caseId, guildId });
      return {
        note: "Moderator warning posted in <#channel_alerts>.",
        status: "posted",
      };
    },
  });

  await handler({
    commandName: "report",
    guildId: "guild_123",
    inGuild: () => true,
    isButton: () => false,
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    options: {
      getString(name: string) {
        if (name === "reason") return "spam link";
        if (name === "notes") return "sent suspicious invite";
        return null;
      },
      getUser(name: string) {
        if (name === "user") {
          return { id: "user_123", username: "target" };
        }

        return null;
      },
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    user: { id: "mod_123" },
  } as any);

  expect(apiCalls).toEqual([
    {
      body: expect.objectContaining({
        intakeSource: "slash_command",
        openCase: true,
        reportReason: "spam link",
        reporterNotes: "sent suspicious invite",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
      }),
      guildId: "guild_123",
      kind: "report",
    },
  ]);

  const reply = replies[0] as {
    components: Array<{ toJSON(): { components: Array<{ custom_id?: string }> } }>;
    content: string;
    flags: number;
  };
  const customId = reply.components[0].toJSON().components[0].custom_id;

  expect(reply.flags).toBe(MessageFlags.Ephemeral);
  expect(reply.content).toContain("case_123");
  expect(reply.content).toContain("persistence is still pending");
  expect(reply.content).toContain("Moderator warning posted in <#channel_alerts>.");
  expect(parseComponentCustomId(customId ?? "")).toMatchObject({
    entityId: "case_123~user_123",
    guildId: "guild_123",
    kind: "verification_start",
  });
  expect(warningCalls).toEqual([
    {
      caseId: "case_123",
      guildId: "guild_123",
    },
  ]);
});

test("report command truncates oversized follow-up notes before replying to Discord", async () => {
  const replies: Array<{ content: string; flags: MessageFlags }> = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      createReport: async () => ({
        persistence: "persisted",
        report: {
          caseId: "case_123",
          reportId: "report_123",
        },
      }),
    }),
    syncModeratorWarningCard: async () => ({
      note: "Moderator warning update: " + "x".repeat(4_000),
      status: "updated",
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "report",
      getString(name) {
        if (name === "reason") return "spam link";
        return null;
      },
      getUser(name) {
        if (name === "user") return { id: "subject_123", username: "target" };
        return null;
      },
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.KickMembers),
      reply: async (payload) => {
        assertDiscordPayloadWithinLimits(payload as { content?: string });
        replies.push(payload as { content: string; flags: MessageFlags });
      },
      userId: "mod_123",
    }),
  );

  expect(replies).toHaveLength(1);
  expect(replies[0]!.content.length).toBeLessThanOrEqual(2_000);
  expect(replies[0]!.content).toContain("Moderator warning update:");
  expect(replies[0]!.content.endsWith("…")).toBe(true);
});

test("humanify setup refuses members who are not server admins", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient(),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "humanify",
      getSubcommand: () => "setup",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.ManageGuild),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "admin_candidate",
    }),
  );

  expect(replies).toEqual([
    expect.objectContaining({
      content: "Only server admins can run Humanify setup.",
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("humanify setup loads the current config and opens a guided setup flow for server admins", async () => {
  const replies: unknown[] = [];
  const apiCalls: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      getGuildChannelConfig: async (guildId) => {
        apiCalls.push({ guildId, kind: "channels" });
        return {
          channelConfig: {
            auditLogChannelId: "channel_audit",
            guildId,
            moderationLogChannelId: "channel_mod_log",
            moderatorAlertChannelId: "channel_alerts",
            reviewChannelId: "channel_review",
            source: "persisted",
          },
          persistence: "persisted",
        };
      },
      getGuildVerificationConfig: async (guildId) => {
        apiCalls.push({ guildId, kind: "verification" });
        return {
          persistence: "persisted",
          verificationConfig: {
            availableBundles: [
              createVerificationBundle({
                bundleId: "humanify_id_age_over_18_v1",
                claims: ["age_over_18"],
                summary: "Age only",
                title: "Only prove age over 18",
              }),
              createVerificationBundle({
                bundleId: "humanify_id_nationality_v1",
                claims: ["nationality"],
                summary: "Nationality only",
                title: "Only prove nationality",
              }),
              createVerificationBundle({
                bundleId: "humanify_id_age_and_nationality_v1",
                claims: ["age_over_18", "nationality"],
                summary: "Age and nationality",
                title: "Prove age + nationality",
              }),
            ],
            availableProviderIds: ["didit", "privado", "self", "world_id"],
            defaultProviderId: "didit",
            enabledProviderIds: ["didit", "privado"],
            faceVerificationRequired: false,
            fallbackRoles: ["role_trusted"],
            guildId,
            roleGrantBindings: [
              { roleId: "role_verified_human", trigger: "verified_human" },
              { roleId: "role_21_plus", trigger: "age_over_21" },
            ],
            requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
            requiredBundles: [
              createVerificationBundle({
                bundleId: "humanify_id_age_and_nationality_v1",
                claims: ["age_over_18", "nationality"],
                summary: "Age and nationality",
                title: "Prove age + nationality",
              }),
            ],
            source: "persisted",
            suspiciousRoleIds: ["role_suspicious"],
            trustedRoleIds: ["role_trusted"],
          },
        };
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "humanify",
      getSubcommand: () => "setup",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "admin_123",
    }),
  );

  expect(apiCalls).toEqual([
    { guildId: "guild_123", kind: "channels" },
    { guildId: "guild_123", kind: "verification" },
  ]);

  const reply = replies[0] as {
    components: Array<{ toJSON(): { components?: Array<{ custom_id?: string }> } }>;
    content: string;
    flags: number;
  };

  expect(reply.flags).toBe(MessageFlags.Ephemeral);
  expect(reply.content).toContain("Step 1 of 7");
  expect(reply.content).toContain("Pick the channels Humanify should use");
  expect(reply.content).toContain("<#channel_alerts>");
  expect(reply.content).toContain("<@&role_verified_human>");
  expect(parseSetupFlowCustomId(findCustomId(reply, (customId) => parseSetupFlowCustomId(customId).action === "next"))).toMatchObject({
    action: "next",
    guildId: "guild_123",
  });
});

test("humanify setup saves the guided selections through the real guild config routes", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const updates: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      getGuildChannelConfig: async (guildId) => ({
        channelConfig: {
          guildId,
          source: "not_configured",
        },
        persistence: "not_configured",
      }),
      getGuildVerificationConfig: async (guildId) => ({
        persistence: "catalog_default",
        verificationConfig: {
          availableBundles: [
            createVerificationBundle({
              bundleId: "humanify_id_age_over_18_v1",
              claims: ["age_over_18"],
              summary: "Age only",
              title: "Only prove age over 18",
            }),
            createVerificationBundle({
              bundleId: "humanify_id_nationality_v1",
              claims: ["nationality"],
              summary: "Nationality only",
              title: "Only prove nationality",
            }),
            createVerificationBundle({
              bundleId: "humanify_id_age_and_nationality_v1",
              claims: ["age_over_18", "nationality"],
              summary: "Age and nationality",
              title: "Prove age + nationality",
            }),
          ],
          availableProviderIds: ["didit", "privado", "self", "world_id"],
            defaultProviderId: "didit",
            enabledProviderIds: ["didit", "privado", "self", "world_id"],
            faceVerificationRequired: false,
            fallbackRoles: [],
            guildId,
            roleGrantBindings: [],
            requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
          requiredBundles: [
            createVerificationBundle({
              bundleId: "humanify_id_age_and_nationality_v1",
              claims: ["age_over_18", "nationality"],
              summary: "Age and nationality",
              title: "Prove age + nationality",
            }),
          ],
          source: "catalog_default",
          suspiciousRoleIds: [],
          trustedRoleIds: [],
        },
      }),
      updateGuildChannelConfig: async (guildId, body) => {
        apiCalls.push({ body, guildId, kind: "channels" });
        return {
          channelConfig: {
            auditLogChannelId: body.auditLogChannelId,
            createdAt: "2026-01-01T00:00:00.000Z",
            guildId,
            moderationLogChannelId: body.moderationLogChannelId,
            moderatorAlertChannelId: body.moderatorAlertChannelId,
            reviewChannelId: body.reviewChannelId,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
        };
      },
      updateGuildVerificationConfig: async (guildId, body) => {
        apiCalls.push({ body, guildId, kind: "verification" });
        return {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          verificationConfig: {
            availableBundles: [
              createVerificationBundle({
                bundleId: "humanify_id_age_over_18_v1",
                claims: ["age_over_18"],
                summary: "Age only",
                title: "Only prove age over 18",
              }),
              createVerificationBundle({
                bundleId: "humanify_id_nationality_v1",
                claims: ["nationality"],
                summary: "Nationality only",
                title: "Only prove nationality",
              }),
            ],
            availableProviderIds: ["didit", "privado", "self", "world_id"],
             defaultProviderId: body.defaultProviderId,
             enabledProviderIds: body.enabledProviderIds,
             faceVerificationRequired: body.faceVerificationRequired,
             fallbackRoles: body.trustedRoleIds,
             guildId,
             roleGrantBindings: body.roleGrantBindings,
             requiredBundleIds: body.requiredBundleIds,
            requiredBundles: [
              createVerificationBundle({
                bundleId: "humanify_id_nationality_v1",
                claims: ["nationality"],
                summary: "Nationality only",
                title: "Only prove nationality",
              }),
            ],
            source: "persisted",
            suspiciousRoleIds: body.suspiciousRoleIds,
            trustedRoleIds: body.trustedRoleIds,
          },
        };
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "humanify",
      getSubcommand: () => "setup",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "admin_123",
    }),
  );

  let latest = replies[0] as {
    components: Array<{ toJSON(): { components?: Array<{ custom_id?: string }> } }>;
    content: string;
  };

  async function runComponent(input: {
    action?: string;
    kind: "button" | "channel_select" | "role_select" | "string_select";
    values?: string[];
  }) {
    const customId = findCustomId(
      latest,
      (candidate) => !input.action || parseSetupFlowCustomId(candidate).action === input.action,
    );

    await handler(
      createComponentInteraction({
        customId,
        kind: input.kind,
        memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
        update: async (payload) => {
          updates.push(payload);
          latest = payload as typeof latest;
        },
        userId: "admin_123",
        values: input.values,
      }),
    );
  }

  await runComponent({ action: "channel_alert", kind: "channel_select", values: ["channel_alerts_live"] });
  await runComponent({ action: "channel_review", kind: "channel_select", values: ["channel_review_live"] });
  await runComponent({ action: "channel_audit", kind: "channel_select", values: ["channel_audit_live"] });
  await runComponent({ action: "channel_mod_log", kind: "channel_select", values: ["channel_mod_log_live"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "role_trusted", kind: "role_select", values: ["role_trusted_a", "role_trusted_b"] });
  await runComponent({ action: "role_suspicious", kind: "role_select", values: ["role_suspicious_a"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "role_verified_human", kind: "role_select", values: ["role_verified_human_live"] });
  await runComponent({ action: "role_age_18", kind: "role_select", values: ["role_18_plus_live"] });
  await runComponent({ action: "role_age_21", kind: "role_select", values: ["role_21_plus_live"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "provider_enabled", kind: "string_select", values: ["didit", "world_id"] });
  await runComponent({ action: "provider_default", kind: "string_select", values: ["didit"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "bundle_required", kind: "string_select", values: ["humanify_id_nationality_v1"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "face_requirement", kind: "string_select", values: ["required"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "save", kind: "button" });

  expect(apiCalls).toEqual([
    {
      body: {
        actorUserId: "admin_123",
        defaultProviderId: "didit",
        enabledProviderIds: ["didit", "world_id"],
        faceVerificationRequired: true,
        roleGrantBindings: [
          { roleId: "role_verified_human_live", trigger: "verified_human" },
          { roleId: "role_18_plus_live", trigger: "age_over_18" },
          { roleId: "role_21_plus_live", trigger: "age_over_21" },
        ],
        requiredBundleIds: ["humanify_id_nationality_v1"],
        suspiciousRoleIds: ["role_suspicious_a"],
        trustedRoleIds: ["role_trusted_a", "role_trusted_b"],
      },
      guildId: "guild_123",
      kind: "verification",
    },
    {
      body: {
        actorUserId: "admin_123",
        auditLogChannelId: "channel_audit_live",
        moderationLogChannelId: "channel_mod_log_live",
        moderatorAlertChannelId: "channel_alerts_live",
        reviewChannelId: "channel_review_live",
      },
      guildId: "guild_123",
      kind: "channels",
    },
  ]);

  expect(updates).not.toHaveLength(0);
  expect(latest.content).toContain("Setup saved");
  expect(latest.content).toContain("<#channel_alerts_live>");
  expect(latest.content).toContain("Only prove nationality");
  expect(latest.content).toContain("Face check required: Yes");
  expect(latest.content).toContain("<@&role_verified_human_live>");
  expect(latest.components).toEqual([]);
});

test("humanify panel posts a reusable verification button and clicking it returns a verifier link", async () => {
  const replies: unknown[] = [];
  const postedMessages: unknown[] = [];
  const verificationBodies: unknown[] = [];
  const verificationChannel = {
    id: "channel_verify",
    isTextBased: () => true,
    send: async (payload: unknown) => {
      postedMessages.push(payload);
    },
  };
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      createVerificationSession: async (guildId, body) => {
        verificationBodies.push({ body, guildId });
        return {
          challengeToken: "challenge_token_123",
          persistence: "persisted",
          session: {
            challengeId: "challenge_123",
            guildId,
            sessionId: "session_123",
            state: "pending",
            userId: body.userId,
          },
        };
      },
      getGuildVerificationConfig: async (guildId) => ({
        persistence: "persisted",
        verificationConfig: {
          availableBundles: [
            createVerificationBundle({
              bundleId: "humanify_id_age_over_21_v1",
              claims: ["age_over_21"],
              summary: "Age only",
              title: "Only prove age over 21",
            }),
          ],
          availableProviderIds: ["didit"],
          defaultProviderId: "didit",
          enabledProviderIds: ["didit"],
          faceVerificationRequired: true,
          fallbackRoles: [],
          guildId,
          roleGrantBindings: [
            { roleId: "role_verified_human", trigger: "verified_human" },
            { roleId: "role_21_plus", trigger: "age_over_21" },
          ],
          requiredBundleIds: ["humanify_id_age_over_21_v1"],
          requiredBundles: [
            createVerificationBundle({
              bundleId: "humanify_id_age_over_21_v1",
              claims: ["age_over_21"],
              summary: "Age only",
              title: "Only prove age over 21",
            }),
          ],
          source: "persisted",
          suspiciousRoleIds: [],
          trustedRoleIds: [],
        },
      }),
    }),
    verifierBaseUrl: "http://127.0.0.1:3212",
  });

  await handler(
    createChatCommandInteraction({
      channel: verificationChannel,
      commandName: "humanify",
      getChannel: () => verificationChannel,
      getSubcommand: () => "panel",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "admin_123",
    }),
  );

  expect(postedMessages).toHaveLength(1);
  const postedMessage = postedMessages[0] as {
    components: Array<{ toJSON(): { components: Array<{ custom_id?: string }> } }>;
    content: string;
  };
  expect(postedMessage.content).toContain("Humanify verification");
  expect(postedMessage.content).toContain("<@&role_verified_human>");
  const panelButtonId = postedMessage.components[0].toJSON().components[0].custom_id!;

  await handler(
    createComponentInteraction({
      customId: panelButtonId,
      kind: "button",
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "member_777",
    }),
  );

  expect(verificationBodies).toEqual([
    {
      body: {
        initiatedBy: "member_777",
        requiredCapabilities: ["age_over_21", "face_verification"],
        userId: "member_777",
      },
      guildId: "guild_123",
    },
  ]);
  expect((replies[1] as { content: string }).content).toContain("http://127.0.0.1:3212/verify");
  expect((replies[1] as { content: string }).content).toContain("sessionId=session_123");
  expect((replies[1] as { content: string }).content).toContain("token=challenge_token_123");
});

test("humanify setup truncates oversized bundle labels and summaries before rendering Discord select menus", async () => {
  const replies: unknown[] = [];
  const updates: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      getGuildChannelConfig: async (guildId) => ({
        channelConfig: {
          guildId,
          source: "not_configured",
        },
        persistence: "not_configured",
      }),
      getGuildVerificationConfig: async (guildId) => ({
        persistence: "catalog_default",
        verificationConfig: {
          availableBundles: [
            createVerificationBundle({
              bundleId: "humanify_id_age_and_nationality_v1",
              claims: ["age_over_18", "nationality"],
              summary: "S".repeat(180),
              title: "T".repeat(140),
            }),
          ],
          availableProviderIds: ["didit", "privado"],
          defaultProviderId: "didit",
          enabledProviderIds: ["didit", "privado"],
          faceVerificationRequired: false,
          fallbackRoles: [],
          guildId,
          roleGrantBindings: [],
          requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
          requiredBundles: [
            createVerificationBundle({
              bundleId: "humanify_id_age_and_nationality_v1",
              claims: ["age_over_18", "nationality"],
              summary: "S".repeat(180),
              title: "T".repeat(140),
            }),
          ],
          source: "catalog_default",
          suspiciousRoleIds: [],
          trustedRoleIds: [],
        },
      }),
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "humanify",
      getSubcommand: () => "setup",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
      reply: async (payload) => {
        assertDiscordPayloadWithinLimits(payload as {
          components?: Array<{ toJSON(): { components?: Array<Record<string, unknown>> } }>;
          content?: string;
        });
        replies.push(payload);
      },
      userId: "admin_123",
    }),
  );

  let latest = replies[0] as {
    components: Array<{ toJSON(): { components?: Array<Record<string, unknown>> } }>;
    content: string;
  };

  async function runComponent(input: {
    action?: string;
    kind: "button" | "channel_select" | "role_select" | "string_select";
    values?: string[];
  }) {
    const customId = findCustomId(
      latest,
      (candidate) => !input.action || parseSetupFlowCustomId(candidate).action === input.action,
    );

    await handler(
      createComponentInteraction({
        customId,
        kind: input.kind,
        memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
        update: async (payload) => {
          assertDiscordPayloadWithinLimits(payload as {
            components?: Array<{ toJSON(): { components?: Array<Record<string, unknown>> } }>;
            content?: string;
          });
          updates.push(payload);
          latest = payload as typeof latest;
        },
        userId: "admin_123",
        values: input.values,
      }),
    );
  }

  await runComponent({ action: "channel_alert", kind: "channel_select", values: ["channel_alerts_live"] });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "next", kind: "button" });
  await runComponent({ action: "next", kind: "button" });

  expect(updates).not.toHaveLength(0);
  const bundleSelect = latest.components[0]!.toJSON().components?.[0] as {
    options?: Array<{ description?: string; label?: string }>;
  };
  expect(bundleSelect.options?.[0]?.label?.length).toBeLessThanOrEqual(100);
  expect(bundleSelect.options?.[0]?.description?.length).toBeLessThanOrEqual(100);
  expect(bundleSelect.options?.[0]?.label?.endsWith("…")).toBe(true);
  expect(bundleSelect.options?.[0]?.description?.endsWith("…")).toBe(true);
});

test("case open refuses members who are not trusted moderators", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      attachReportEvidence: async () => {
        throw new Error("case open should not attach evidence");
      },
      createReport: async () => {
        throw new Error("case open should be blocked before API handoff");
      },
      createVerificationSession: async () => {
        throw new Error("case open should not create verification");
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "case",
      getString(name) {
        if (name === "reason") return "spam link";
        return null;
      },
      getSubcommand: () => "open",
      getUser(name) {
        if (name === "user") return { id: "subject_123", username: "target" };
        return null;
      },
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.UseApplicationCommands),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "member_123",
    }),
  );

  expect(replies).toEqual([
    expect.objectContaining({
      content: "Only trusted moderators can open cases or verify other members.",
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("scan queues a durable single-member scan for trusted moderators", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      createScanRequest: async (guildId, body) => {
        apiCalls.push({ body, guildId });
        return {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          scanRequest: {
            createdAt: "2026-01-01T00:00:00.000Z",
            guildId,
            readModelStatus: "canonical_postgres",
            requestedByUserId: body.actorUserId,
            scanRequestId: "scan_request_123",
            scope: body.scope,
            scopeRef: {
              guildId,
              scanRequestId: "scan_request_123",
            },
            status: "pending",
            summary: {
              notes: [],
              processedMemberCount: 0,
              suspiciousFindings: [],
              suspiciousMemberCount: 0,
            },
            targetUserId: body.targetUserId,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "scan",
      getUser(name) {
        if (name === "user") return { id: "subject_123", username: "target" };
        return null;
      },
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.ModerateMembers),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "moderator_123",
    }),
  );

  expect(apiCalls).toEqual([{
    body: {
      actorUserId: "moderator_123",
      scope: "single_member",
      targetUserId: "subject_123",
    },
    guildId: "guild_123",
  }]);
  expect(replies).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("scan_request_123"),
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("scan-all stays admin-only and queues a full-guild scan", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      createScanRequest: async (guildId, body) => {
        apiCalls.push({ body, guildId });
        return {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          scanRequest: {
            createdAt: "2026-01-01T00:00:00.000Z",
            guildId,
            readModelStatus: "canonical_postgres",
            requestedByUserId: body.actorUserId,
            scanRequestId: "scan_request_all_123",
            scope: body.scope,
            scopeRef: {
              guildId,
              scanRequestId: "scan_request_all_123",
            },
            status: "pending",
            summary: {
              notes: [],
              processedMemberCount: 0,
              suspiciousFindings: [],
              suspiciousMemberCount: 0,
            },
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "scan-all",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.Administrator),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "admin_123",
    }),
  );

  expect(apiCalls).toEqual([{
    body: {
      actorUserId: "admin_123",
      scope: "all_members",
    },
    guildId: "guild_123",
  }]);
  expect(replies).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("full-server scan"),
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("scan-all refuses moderators who are not admins", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      createScanRequest: async () => {
        throw new Error("scan-all should be blocked before API handoff");
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "scan-all",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.ModerateMembers),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "moderator_123",
    }),
  );

  expect(replies).toEqual([
    expect.objectContaining({
      content: "Only server admins can run Humanify setup.",
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("verify allows members to start verification for themselves", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      attachReportEvidence: async () => {
        throw new Error("verify should not attach evidence");
      },
      createReport: async () => {
        throw new Error("verify should not create reports");
      },
      createVerificationSession: async (guildId, body) => {
        apiCalls.push({ body, guildId });
        return {
          challengeToken: "challenge_123",
          persistence: "planned_not_persisted",
          session: {
            challengeId: "challenge_123",
            guildId,
            sessionId: "session_123",
            state: "pending",
            userId: body.userId,
          },
        };
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "verify",
      getString: () => null,
      getUser(name) {
        if (name === "user") return { id: "member_123", username: "member" };
        return null;
      },
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.UseApplicationCommands),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "member_123",
    }),
  );

  expect(apiCalls).toEqual([
    {
      body: {
        initiatedBy: "member_123",
        requiredCapabilities: ["captcha"],
        userId: "member_123",
      },
      guildId: "guild_123",
    },
  ]);
  expect(replies).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("session_123"),
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("verify refuses members who try to start verification for someone else without trusted moderator permission", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      attachReportEvidence: async () => {
        throw new Error("verify should not attach evidence");
      },
      createReport: async () => {
        throw new Error("verify should not create reports");
      },
      createVerificationSession: async () => {
        throw new Error("verify should be blocked before API handoff");
      },
    }),
  });

  await handler(
    createChatCommandInteraction({
      commandName: "verify",
      getString: () => "captcha",
      getUser(name) {
        if (name === "user") return { id: "subject_123", username: "member" };
        return null;
      },
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.UseApplicationCommands),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "member_123",
    }),
  );

  expect(replies).toEqual([
    expect.objectContaining({
      content: "Only trusted moderators can open cases or verify other members.",
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("message context intake opens a report and then attaches canonical Discord message evidence", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const warningCalls: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      attachReportEvidence: async (guildId, reportId, body) => {
        apiCalls.push({ body, guildId, kind: "evidence", reportId });

        return {
          evidence: {
            evidenceId: "evidence_123",
          },
          persistence: "planned_not_persisted",
        };
      },
      createReport: async (guildId, body) => {
        apiCalls.push({ body, guildId, kind: "report" });

        return {
          persistence: "planned_not_persisted",
          report: {
            caseId: "case_123",
            reportId: "report_123",
          },
        };
      },
      createVerificationSession: async () => {
        throw new Error("message context report should not create verification");
      },
    }),
    syncModeratorWarningCard: async ({ caseId, guildId }) => {
      warningCalls.push({ caseId, guildId });
      return {
        note: "Moderator warning updated in <#channel_alerts>.",
        status: "updated",
      };
    },
  });

  await handler({
    commandName: "Report message to Humanify",
    guildId: "guild_123",
    inGuild: () => true,
    isButton: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => true,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    targetMessage: {
      author: { id: "user_123" },
      channelId: "channel_123",
      content: "Join my scam server",
      id: "message_123",
    },
    user: { id: "mod_123" },
  } as any);

  expect(apiCalls).toEqual([
    {
      body: expect.objectContaining({
        intakeSource: "message_context",
        reporterUserId: "mod_123",
        subjectUserId: "user_123",
        triggerFingerprint: "discord-message:guild_123:channel_123:message_123",
      }),
      guildId: "guild_123",
      kind: "report",
    },
    {
      body: expect.objectContaining({
        actorUserId: "mod_123",
        captureSource: "discord_message_context",
        channelId: "channel_123",
        evidenceType: "message_link",
        externalRef: "https://discord.com/channels/guild_123/channel_123/message_123",
        messageId: "message_123",
        subjectUserId: "user_123",
      }),
      guildId: "guild_123",
      kind: "evidence",
      reportId: "report_123",
    },
  ]);
  expect(warningCalls).toEqual([
    {
      caseId: "case_123",
      guildId: "guild_123",
    },
  ]);
  expect(replies).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("Moderator warning updated in <#channel_alerts>."),
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("verification shortcut refreshes the advisory warning card for the linked case", async () => {
  const replies: unknown[] = [];
  const warningCalls: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: createTestApiClient({
      createVerificationSession: async (guildId, body) => ({
        challengeToken: "challenge_123",
        persistence: "persisted",
        session: {
          caseId: body.caseId,
          challengeId: "challenge_123",
          guildId,
          sessionId: "session_123",
          state: "pending",
          userId: body.userId,
        },
      }),
    }),
    syncModeratorWarningCard: async ({ caseId, guildId }) => {
      warningCalls.push({ caseId, guildId });
      return {
        note: "Moderator warning updated in <#channel_alerts>.",
        status: "updated",
      };
    },
  });

  await handler(
    createComponentInteraction({
      customId: buildComponentCustomId({
        entityId: "case_123~user_123",
        guildId: "guild_123",
        kind: "verification_start",
      }),
      kind: "button",
      memberPermissions: createGuildInteractionPermissions(PermissionFlagsBits.KickMembers),
      reply: async (payload) => {
        replies.push(payload);
      },
      userId: "mod_123",
    }),
  );

  expect(warningCalls).toEqual([
    {
      caseId: "case_123",
      guildId: "guild_123",
    },
  ]);
  expect(replies).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("Moderator warning updated in <#channel_alerts>."),
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("warning-card sync posts a new advisory message and persists the canonical alert ref", async () => {
  const apiCalls: unknown[] = [];
  const { calls, runtime } = createWarningRuntime();

  const result = await syncModeratorWarningCard({
    apiClient: createTestApiClient({
      getCaseWarningCard: async (guildId, caseId) => {
        apiCalls.push({ caseId, guildId, kind: "warning-card" });
        return createWarningCard({
          case: {
            caseId,
            openedAt: "2026-01-01T00:00:00.000Z",
            reason: "fake Nitro lure",
            severity: 7,
            status: "open",
            subjectUserId: "user_123",
          },
          scope: { caseId, guildId },
        });
      },
      getGuildChannelConfig: async (guildId) => ({
        channelConfig: {
          guildId,
          moderatorAlertChannelId: "channel_alerts",
          source: "persisted",
        },
        persistence: "persisted",
      }),
      updateWarningCardAlertMessage: async (guildId, caseId, body) => {
        apiCalls.push({ body, caseId, guildId, kind: "warning-alert-ref" });
        return {
          alertMessageRef: {
            caseId,
            channelId: body.channelId,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastActorService: body.actorService,
            messageId: body.messageId,
            messageState: body.messageState ?? "active",
            messageUrl: `https://discord.com/channels/${guildId}/${body.channelId}/${body.messageId}`,
            subjectUserId: "user_123",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
        };
      },
    }),
    caseId: "case_123",
    guildId: "guild_123",
    messageRuntime: runtime,
  });

  expect(apiCalls).toEqual([
    {
      caseId: "case_123",
      guildId: "guild_123",
      kind: "warning-card",
    },
    {
      body: {
        actorService: "bot-bun",
        channelId: "channel_alerts",
        messageId: "message_alert_123",
        messageState: "active",
      },
      caseId: "case_123",
      guildId: "guild_123",
      kind: "warning-alert-ref",
    },
  ]);
  expect(calls).toEqual([
    expect.objectContaining({
      channelId: "channel_alerts",
      kind: "send",
    }),
  ]);
  expect((calls[0] as { content: string }).content).toContain("Case: `case_123`");
  expect((calls[0] as { content: string }).content).toContain("Suspected user: <@user_123> (`user_123`)");
  expect((calls[0] as { content: string }).content).toContain("Evidence: 1 linked item.");
  expect((calls[0] as { content: string }).content).toContain("Advisory only");
  expect(result).toEqual({
    note: "Moderator warning posted in <#channel_alerts> for case case_123.",
    status: "posted",
  });
});

test("warning-card sync edits the persisted advisory message instead of reposting duplicates", async () => {
  const apiCalls: unknown[] = [];
  const { calls, runtime } = createWarningRuntime({
    async sendMessage() {
      throw new Error("sync should edit the existing message instead of sending a duplicate");
    },
  });

  const result = await syncModeratorWarningCard({
    apiClient: createTestApiClient({
      getCaseWarningCard: async () => createWarningCard({
        alertMessageRef: {
          caseId: "case_123",
          channelId: "channel_alerts",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActorService: "bot-bun",
          messageId: "message_alert_123",
          messageState: "active",
          messageUrl: "https://discord.com/channels/guild_123/channel_alerts/message_alert_123",
          subjectUserId: "user_123",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        faceCheck: {
          passed: true,
          performed: true,
          source: "verification_summary",
        },
        reusableCredentialBridge: {
          approvedClaims: ["age_over_18", "nationality"],
          status: "issuer_handoff_required",
          targetProvider: "privado",
        },
        verification: {
          caseLinkage: "case_linked",
          initiatedBy: "mod_123",
          providerId: "didit",
          providerStatus: "provider_webhook_verified",
          sessionId: "session_123",
          state: "passed",
          summary: {
            faceVerificationPassed: true,
            satisfiedClaims: ["age_over_18", "nationality", "face_verification"],
          },
          updatedAt: "2026-01-01T00:10:00.000Z",
        },
      }),
      getGuildChannelConfig: async (guildId) => ({
        channelConfig: {
          guildId,
          moderatorAlertChannelId: "channel_alerts",
          source: "persisted",
        },
        persistence: "persisted",
      }),
      updateWarningCardAlertMessage: async (guildId, caseId, body) => {
        apiCalls.push({ body, caseId, guildId });
        return {
          alertMessageRef: {
            caseId,
            channelId: body.channelId,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastActorService: body.actorService,
            messageId: body.messageId,
            messageState: body.messageState ?? "active",
            messageUrl: `https://discord.com/channels/${guildId}/${body.channelId}/${body.messageId}`,
            subjectUserId: "user_123",
            updatedAt: "2026-01-01T00:10:00.000Z",
          },
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
        };
      },
    }),
    caseId: "case_123",
    guildId: "guild_123",
    messageRuntime: runtime,
  });

  expect(calls).toEqual([
    expect.objectContaining({
      channelId: "channel_alerts",
      kind: "edit",
      messageId: "message_alert_123",
    }),
  ]);
  expect((calls[0] as { content: string }).content).toContain("Verification: passed via didit.");
  expect((calls[0] as { content: string }).content).toContain("Reusable proof handoff: issuer_handoff_required via privado.");
  expect((calls[0] as { content: string }).content).toContain("Face check: passed.");
  expect(apiCalls).toEqual([
    {
      body: {
        actorService: "bot-bun",
        channelId: "channel_alerts",
        messageId: "message_alert_123",
        messageState: "active",
      },
      caseId: "case_123",
      guildId: "guild_123",
    },
  ]);
  expect(result).toEqual({
    note: "Moderator warning updated in <#channel_alerts> for case case_123.",
    status: "updated",
  });
});

test("warning-card sync refuses to pretend success when the moderator alert channel is not configured", async () => {
  const { calls, runtime } = createWarningRuntime({
    async editMessage() {
      throw new Error("warning sync should stop before Discord operations");
    },
    async sendMessage() {
      throw new Error("warning sync should stop before Discord operations");
    },
  });

  const result = await syncModeratorWarningCard({
    apiClient: createTestApiClient({
      getGuildChannelConfig: async (guildId) => ({
        channelConfig: {
          guildId,
          source: "not_configured",
        },
        persistence: "not_configured",
      }),
      getCaseWarningCard: async () => createWarningCard(),
    }),
    caseId: "case_123",
    guildId: "guild_123",
    messageRuntime: runtime,
  });

  expect(calls).toEqual([]);
  expect(result).toEqual({
    note: "Moderator warning was not published because the canonical alert channel is not configured.",
    status: "skipped",
  });
});

test("executor planning blocks action execution until Bun approval is durably persisted", () => {
  expect(
    decideApprovedActionExecution({
      approval: {
        auditReason: "case:case_123 action:quarantine request:req_123 reasons:first_message_link",
        durability: "planned_not_persisted",
        executionPlan: {
          executable: true,
          resolvedAction: "quarantine",
        },
      },
      capabilities: {
        canBan: true,
        canKick: true,
        canManageRoles: true,
        canTimeout: true,
      },
      requestedAction: "quarantine",
    }),
  ).toEqual({
    executable: false,
    reason: "backend_commit_pending",
    resolvedAction: "quarantine",
  });
});

test("bot API client propagates request and trace headers to the Bun API", async () => {
  const requests: Request[] = [];
  const fetchFn: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit | BunFetchRequestInit) => {
      if (input instanceof Request) {
        requests.push(input);
      } else {
        requests.push(new Request(input.toString(), init));
      }
      return new Response(
        JSON.stringify({
          data: {
            persistence: "planned_not_persisted",
            report: {
              reportId: "report_123",
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      );
    },
    {
      preconnect() {
        return;
      },
    },
  );
  const client = createBotApiClient({
    apiBaseUrl: "http://127.0.0.1:3211",
    fetchFn,
  });

  await client.createReport("guild_123", {
    intakeSource: "slash_command",
    openCase: true,
    reportReason: "spam link",
    reporterUserId: "mod_123",
    subjectUserId: "user_123",
    triggerFingerprint: "slash-report:guild_123:user_123",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers.get("x-request-id")).toBeTruthy();
  expect(requests[0]?.headers.get("traceparent")).toBeTruthy();
});

test("passive guild-member detector opens an advisory case for very new accounts", async () => {
  const reports: Array<Record<string, unknown>> = [];
  const warningSyncInputs: Array<Record<string, unknown>> = [];
  const handler = createPassiveEventHandler({
    apiClient: createTestApiClient({
      createReport: async (_guildId, body) => {
        reports.push(body as unknown as Record<string, unknown>);
        return {
          persistence: "persisted",
          report: {
            caseId: "case_join_123",
            reportId: "report_join_123",
          },
        };
      },
    }),
    botActorUserId: "bot_123",
    enableMemberJoinSignals: true,
    enableMessageSignals: false,
    messageRuntime: createPassiveWarningRuntime(),
    now: () => Date.UTC(2026, 0, 1, 12, 0, 0),
    syncModeratorWarningCard: async (input) => {
      warningSyncInputs.push(input as unknown as Record<string, unknown>);
      return {
        note: "warning synced",
        status: "posted",
      };
    },
  });

  await handler.handleGuildMemberAdd(
    createGuildMemberAddEvent({
      accountCreatedAt: Date.UTC(2026, 0, 1, 11, 30, 0),
    }),
  );

  expect(reports).toEqual([
    expect.objectContaining({
      intakeSource: "detector_bridge",
      openCase: true,
      reportReason: "Automatic detector bridge flagged a very new Discord account joining the server.",
      reporterNotes: "Reason codes: account_age_lt_24h",
      reporterUserId: "bot_123",
      subjectUserId: "user_123",
      triggerFingerprint: "guild-member-add:guild_123:user_123:account_age_lt_24h",
    }),
  ]);
  expect(warningSyncInputs).toEqual([
    expect.objectContaining({
      caseId: "case_join_123",
      guildId: "guild_123",
    }),
  ]);
});

test("passive message detector opens a detector-bridge report and attaches canonical message evidence", async () => {
  const reports: Array<Record<string, unknown>> = [];
  const evidenceBodies: Array<Record<string, unknown>> = [];
  const warningSyncInputs: Array<Record<string, unknown>> = [];
  const handler = createPassiveEventHandler({
    apiClient: createTestApiClient({
      attachReportEvidence: async (_guildId, _reportId, body) => {
        evidenceBodies.push(body as unknown as Record<string, unknown>);
        return {
          evidence: {
            evidenceId: "evidence_123",
          },
          persistence: "persisted",
        };
      },
      createReport: async (_guildId, body) => {
        reports.push(body as unknown as Record<string, unknown>);
        return {
          persistence: "persisted",
          report: {
            caseId: "case_message_123",
            reportId: "report_message_123",
          },
        };
      },
    }),
    botActorUserId: "bot_123",
    enableMemberJoinSignals: false,
    enableMessageSignals: true,
    messageRuntime: createPassiveWarningRuntime(),
    syncModeratorWarningCard: async (input) => {
      warningSyncInputs.push(input as unknown as Record<string, unknown>);
      return {
        note: "warning synced",
        status: "posted",
      };
    },
  });

  await handler.handleMessageCreate(
    createMessageCreateEvent({
      content: "https://evil.example/claim-your-free-nitro",
      id: "message_456",
    }),
  );

  expect(reports).toEqual([
    expect.objectContaining({
      intakeSource: "detector_bridge",
      openCase: true,
      reportReason: "Automatic detector bridge flagged a suspicious message: first message link.",
      reporterNotes: "Reason codes: first_message_link",
      reporterUserId: "bot_123",
      subjectUserId: "user_123",
      triggerFingerprint: "discord-message:guild_123:channel_123:message_456",
    }),
  ]);
  expect(evidenceBodies).toEqual([
    expect.objectContaining({
      actorUserId: "bot_123",
      captureSource: "discord_message_create",
      channelId: "channel_123",
      evidenceType: "message_link",
      externalRef: "https://discord.com/channels/guild_123/channel_123/message_456",
      messageId: "message_456",
      messagePreview: "https://evil.example/claim-your-free-nitro",
      subjectUserId: "user_123",
    }),
  ]);
  expect(warningSyncInputs).toEqual([
    expect.objectContaining({
      caseId: "case_message_123",
      guildId: "guild_123",
    }),
  ]);
});

test("passive message detector stays disabled until message signals are enabled", async () => {
  const reports: Array<Record<string, unknown>> = [];
  const handler = createPassiveEventHandler({
    apiClient: createTestApiClient({
      createReport: async (_guildId, body) => {
        reports.push(body as unknown as Record<string, unknown>);
        return {
          persistence: "persisted",
          report: {
            caseId: "case_disabled_123",
            reportId: "report_disabled_123",
          },
        };
      },
    }),
    botActorUserId: "bot_123",
    enableMemberJoinSignals: true,
    enableMessageSignals: false,
    messageRuntime: createPassiveWarningRuntime(),
  });

  await handler.handleMessageCreate(
    createMessageCreateEvent({
      content: "https://evil.example/claim-your-free-nitro",
    }),
  );

  expect(reports).toHaveLength(0);
});

test("default bot runtime keeps automatic message-content bot scoring disabled", () => {
  const defaultIntents = createBotGatewayIntents();
  const messageSignalIntents = createBotGatewayIntents({ includeMessageSignals: true });

  expect(defaultIntents).not.toContain(GatewayIntentBits.GuildMessages);
  expect(defaultIntents).not.toContain(GatewayIntentBits.MessageContent);
  expect(messageSignalIntents).toContain(GatewayIntentBits.GuildMessages);
  expect(messageSignalIntents).toContain(GatewayIntentBits.MessageContent);
});
