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
import { GatewayIntentBits } from "discord.js";

import {
  buildComponentCustomId,
  createHumanifyApplicationCommands,
  createBotGatewayIntents,
  createDiscordAuditReason,
  parseComponentCustomId,
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

test("humanify application commands expose the first real intake surface", () => {
  const commands = createHumanifyApplicationCommands();
  const names = commands.map((command) => ("toJSON" in command ? command.toJSON().name : command.name));

  expect(names).toEqual(
    expect.arrayContaining([
      "report",
      "case",
      "verify",
      "Report message to Humanify",
    ]),
  );
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
