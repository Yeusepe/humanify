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
  decideApprovedActionExecution,
  syncModeratorWarningCard,
} from "./index";

function createGuildInteractionPermissions(...permissions: bigint[]) {
  return new PermissionsBitField(permissions);
}

function createChatCommandInteraction(input: {
  commandName: string;
  getString?: (name: string) => string | null;
  getSubcommand?: () => string;
  getUser?: (name: string) => { id: string; username?: string } | null;
  memberPermissions?: PermissionsBitField | null;
  reply?: (payload: unknown) => Promise<void>;
  userId?: string;
}) {
  return {
    commandName: input.commandName,
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
  expect(reply.content).toContain("Step 1 of 6");
  expect(reply.content).toContain("Pick the channels Humanify should use");
  expect(reply.content).toContain("<#channel_alerts>");
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
  expect(latest.components).toEqual([]);
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

test("default bot runtime keeps automatic message-content bot scoring disabled", () => {
  const defaultIntents = createBotGatewayIntents();
  const messageSignalIntents = createBotGatewayIntents({ includeMessageSignals: true });

  expect(defaultIntents).not.toContain(GatewayIntentBits.GuildMessages);
  expect(defaultIntents).not.toContain(GatewayIntentBits.MessageContent);
  expect(messageSignalIntents).toContain(GatewayIntentBits.GuildMessages);
  expect(messageSignalIntents).toContain(GatewayIntentBits.MessageContent);
});
