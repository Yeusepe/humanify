/**
 * Purpose: Verifies shared Discord helpers keep bot runtime intent, actionability, and audit formatting consistent.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://discord.js.org/docs/packages/discord.js/main
 * Tests:
 * - packages/discord-core/src/index.test.ts
 */

import { expect, test } from "bun:test";
import { GatewayIntentBits, PermissionFlagsBits, PermissionsBitField } from "discord.js";

import {
  authorizeAdminOnlyBotAction,
  authorizeTrustedModeratorOnlyBotAction,
  buildComponentCustomId,
  buildSetupFlowCustomId,
  createHumanifyApplicationCommands,
  createBotGatewayIntents,
  createDiscordAuditReason,
  parseComponentCustomId,
  parseSetupFlowCustomId,
  resolveDiscordExecutionPlan,
  snapshotExecutionCapabilities,
} from "./index";

test("bot gateway intents include moderation and invite tracking by default", () => {
  const intents = createBotGatewayIntents();

  expect(intents).toContain(GatewayIntentBits.Guilds);
  expect(intents).toContain(GatewayIntentBits.GuildMembers);
  expect(intents).toContain(GatewayIntentBits.GuildModeration);
  expect(intents).toContain(GatewayIntentBits.GuildInvites);
});

test("component IDs round-trip through the shared discord-core format", () => {
  const customId = buildComponentCustomId({
    entityId: "case_123",
    guildId: "guild_123",
    kind: "review",
  });

  expect(parseComponentCustomId(customId)).toEqual({
    entityId: "case_123",
    guildId: "guild_123",
    kind: "review",
    version: 1,
  });
});

test("setup flow component IDs round-trip through the setup-scoped helper", () => {
  const customId = buildSetupFlowCustomId({
    action: "next",
    draftId: "draft_123",
    guildId: "guild_123",
  });

  expect(parseSetupFlowCustomId(customId)).toEqual({
    action: "next",
    draftId: "draft_123",
    guildId: "guild_123",
    version: 1,
  });
});

test("humanify application commands expose the first real intake surface", () => {
  const commands = createHumanifyApplicationCommands();
  const names = commands.map((command) => ("toJSON" in command ? command.toJSON().name : command.name));

  expect(names).toEqual(
    expect.arrayContaining([
      "humanify",
      "report",
      "case",
      "verify",
      "Report message to Humanify",
    ]),
  );

  const setupCommand = commands.find((command) => ("toJSON" in command ? command.toJSON().name : command.name) === "humanify") as
    | {
        defaultMemberPermissions?: bigint | string | null;
        options?: Array<{ name: string }>;
      }
    | undefined;

  expect(setupCommand?.defaultMemberPermissions).toBe(PermissionFlagsBits.Administrator);
  expect(setupCommand?.options?.map((option) => option.name)).toEqual(["setup"]);
});

test("execution plans refuse exact moderation actions when the current Discord capability is missing", () => {
  const capabilities = snapshotExecutionCapabilities({
    bannable: false,
    kickable: false,
    manageable: true,
    moderatable: false,
  });

  expect(resolveDiscordExecutionPlan("kick", capabilities)).toEqual({
    executable: false,
    reason: "kick_missing",
    resolvedAction: "kick",
  });
  expect(createDiscordAuditReason({ action: "quarantine", caseId: "case_123", reasonCodes: ["first_message_link"], requestId: "req_123" })).toContain("case:case_123");
});

test("admin-only bot actions fail closed unless the member has administrator", () => {
  expect(authorizeAdminOnlyBotAction(null)).toEqual({
    authorized: false,
    reason: "missing_member_permissions",
    scope: "admin_only",
  });

  expect(authorizeAdminOnlyBotAction(new PermissionsBitField(PermissionFlagsBits.ManageGuild))).toEqual({
    authorized: false,
    reason: "admin_only",
    scope: "admin_only",
  });

  expect(authorizeAdminOnlyBotAction(new PermissionsBitField(PermissionFlagsBits.Administrator))).toEqual({
    authorized: true,
    scope: "admin_only",
  });
});

test("trusted moderator bot actions allow common moderation permissions and fail closed otherwise", () => {
  expect(authorizeTrustedModeratorOnlyBotAction(null)).toEqual({
    authorized: false,
    reason: "missing_member_permissions",
    scope: "trusted_moderator_only",
  });

  expect(authorizeTrustedModeratorOnlyBotAction(new PermissionsBitField(PermissionFlagsBits.UseApplicationCommands))).toEqual({
    authorized: false,
    reason: "trusted_moderator_only",
    scope: "trusted_moderator_only",
  });

  expect(authorizeTrustedModeratorOnlyBotAction(new PermissionsBitField(PermissionFlagsBits.KickMembers))).toEqual({
    authorized: true,
    scope: "trusted_moderator_only",
  });
});
