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

test("execution plans fall back to reversible containment when harder actions are unavailable", () => {
  const capabilities = snapshotExecutionCapabilities({
    bannable: false,
    kickable: false,
    manageable: true,
    moderatable: false,
  });

  expect(resolveDiscordExecutionPlan("kick", capabilities)).toEqual({
    executable: true,
    resolvedAction: "quarantine",
  });
  expect(createDiscordAuditReason({ action: "quarantine", caseId: "case_123", reasonCodes: ["first_message_link"], requestId: "req_123" })).toContain("case:case_123");
});
