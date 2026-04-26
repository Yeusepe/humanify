/**
 * Purpose: Boots the Bun-side Discord client shell and advertises the shared contract baseline it depends on.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://discord.js.org/docs/packages/discord.js/main
 * - https://discord.com/developers/docs/intro
 * - https://bun.sh/docs/runtime/env
 * Tests:
 * - apps/bot-bun/src/index.test.ts
 */

import { Client, Events } from "discord.js";

import { loadBotTokenConfig } from "@humanify/config";
import { humanifyActionLadder, humanifyContractVersion } from "@humanify/contracts";
import { createBotGatewayIntents } from "@humanify/discord-core";

export const botRuntimeSummary = {
  contractVersion: humanifyContractVersion,
  gatewayIntentCount: createBotGatewayIntents().length,
  supportedActionCount: humanifyActionLadder.length,
};

export function createBotClient() {
  return new Client({
    intents: createBotGatewayIntents(),
  });
}

export async function startBot(token = loadBotTokenConfig(process.env).botToken) {

  const client = createBotClient();

  client.once(Events.ClientReady, (readyClient) => {
    console.log(
      `@humanify/bot-bun connected as ${readyClient.user.tag} with contract ${botRuntimeSummary.contractVersion}.`,
    );
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
