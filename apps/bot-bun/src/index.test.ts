/**
 * Purpose: Verifies the Discord client scaffold stays limited to the documented Bun-side bootstrap surface.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://discord.js.org/docs/packages/discord.js/main
 * Tests:
 * - apps/bot-bun/src/index.test.ts
 */

import { expect, test } from "bun:test";
import { GatewayIntentBits } from "discord.js";

import { botRuntimeSummary, createBotClient } from "./index";

test("bot client boots with the guild intent only", () => {
  const client = createBotClient();

  expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
  expect(botRuntimeSummary.contractVersion).toBe("0.1.0");

  client.destroy();
});
