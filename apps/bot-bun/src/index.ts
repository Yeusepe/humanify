/**
 * Purpose: Boots the Bun-side Discord client shell and advertises the shared contract baseline it depends on.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
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

import { Client, Events, GatewayIntentBits } from "discord.js";

import { humanifyActionLadder, humanifyContractVersion } from "@humanify/contracts";

export const botRuntimeSummary = {
  contractVersion: humanifyContractVersion,
  supportedActionCount: humanifyActionLadder.length,
};

export function createBotClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
  });
}

export async function startBot(token = process.env.DISCORD_BOT_TOKEN) {
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required to start @humanify/bot-bun.");
  }

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
