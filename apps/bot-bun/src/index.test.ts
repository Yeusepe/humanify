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

import { createBotGatewayIntents, parseComponentCustomId } from "@humanify/discord-core";

import {
  createBotApiClient,
  createInteractionHandler,
  decideApprovedActionExecution,
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

test("report command routes moderator intake through the report API and offers a verification shortcut", async () => {
  const apiCalls: unknown[] = [];
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: {
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
  expect(parseComponentCustomId(customId ?? "")).toMatchObject({
    entityId: "case_123~user_123",
    guildId: "guild_123",
    kind: "verification_start",
  });
});

test("humanify setup refuses members who are not server admins", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: {
      attachReportEvidence: async () => {
        throw new Error("setup should not attach evidence");
      },
      createReport: async () => {
        throw new Error("setup should not create reports");
      },
      createVerificationSession: async () => {
        throw new Error("setup should not create verification");
      },
    },
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

test("humanify setup keeps an honest pending reply for server admins", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: {
      attachReportEvidence: async () => {
        throw new Error("setup should not attach evidence");
      },
      createReport: async () => {
        throw new Error("setup should not create reports");
      },
      createVerificationSession: async () => {
        throw new Error("setup should not create verification");
      },
    },
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

  expect(replies).toEqual([
    expect.objectContaining({
      content: "Humanify setup is not ready yet. Server admins will be able to configure channels and roles here soon.",
      flags: MessageFlags.Ephemeral,
    }),
  ]);
});

test("case open refuses members who are not trusted moderators", async () => {
  const replies: unknown[] = [];
  const handler = createInteractionHandler({
    apiClient: {
      attachReportEvidence: async () => {
        throw new Error("case open should not attach evidence");
      },
      createReport: async () => {
        throw new Error("case open should be blocked before API handoff");
      },
      createVerificationSession: async () => {
        throw new Error("case open should not create verification");
      },
    },
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
    apiClient: {
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
    },
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
    apiClient: {
      attachReportEvidence: async () => {
        throw new Error("verify should not attach evidence");
      },
      createReport: async () => {
        throw new Error("verify should not create reports");
      },
      createVerificationSession: async () => {
        throw new Error("verify should be blocked before API handoff");
      },
    },
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
  const handler = createInteractionHandler({
    apiClient: {
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
    },
  });

  await handler({
    commandName: "Report message to Humanify",
    guildId: "guild_123",
    inGuild: () => true,
    isButton: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => true,
    reply: async () => undefined,
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
