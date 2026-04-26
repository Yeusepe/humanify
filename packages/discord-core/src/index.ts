/**
 * Purpose: Provides Discord gateway intent, component ID, audit-reason, and capability helpers for Humanify bot execution.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * - docs\workspaces.md
 * External references:
 * - https://discord.js.org/docs/packages/discord.js/main
 * - https://discord.com/developers/docs/intro
 * - https://discord.com/developers/docs/topics/oauth2
 * Tests:
 * - packages/discord-core/src/index.test.ts
 */

import { GatewayIntentBits, type GuildMember } from "discord.js";

import type { HumanifyAction } from "@humanify/contracts";

export type DiscordExecutionCapabilities = {
  canBan: boolean;
  canKick: boolean;
  canManageRoles: boolean;
  canTimeout: boolean;
};

export type DiscordExecutionPlan = {
  executable: boolean;
  reason?: string;
  resolvedAction: HumanifyAction;
};

export function createBotGatewayIntents(options: {
  includeInviteTracking?: boolean;
  includeMessageSignals?: boolean;
} = {}) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration];

  if (options.includeInviteTracking ?? true) {
    intents.push(GatewayIntentBits.GuildInvites);
  }

  if (options.includeMessageSignals) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }

  return intents;
}

export function createDiscordAuditReason(input: {
  action: HumanifyAction;
  caseId: string;
  reasonCodes: string[];
  requestId: string;
}) {
  return `case:${input.caseId} action:${input.action} request:${input.requestId} reasons:${input.reasonCodes.join(",") || "none"}`;
}

export function buildComponentCustomId(input: {
  entityId: string;
  guildId: string;
  kind: string;
  version?: number;
}) {
  return `humanify:v${input.version ?? 1}:${input.kind}:${input.guildId}:${input.entityId}`;
}

export function parseComponentCustomId(customId: string) {
  const [prefix, version, kind, guildId, entityId] = customId.split(":");
  if (prefix !== "humanify" || !version?.startsWith("v") || !kind || !guildId || !entityId) {
    throw new Error("Component custom ID is not a Humanify identifier.");
  }

  return {
    entityId,
    guildId,
    kind,
    version: Number.parseInt(version.slice(1), 10),
  };
}

export function snapshotExecutionCapabilities(
  member: Pick<GuildMember, "bannable" | "kickable" | "manageable" | "moderatable">,
): DiscordExecutionCapabilities {
  return {
    canBan: member.bannable,
    canKick: member.kickable,
    canManageRoles: member.manageable,
    canTimeout: member.moderatable,
  };
}

export function resolveDiscordExecutionPlan(
  action: HumanifyAction,
  capabilities: DiscordExecutionCapabilities,
): DiscordExecutionPlan {
  switch (action) {
    case "ban":
      if (capabilities.canBan) return { executable: true, resolvedAction: "ban" };
      return resolveDiscordExecutionPlan("kick", capabilities);
    case "kick":
      if (capabilities.canKick) return { executable: true, resolvedAction: "kick" };
      return resolveDiscordExecutionPlan("timeout", capabilities);
    case "timeout":
      if (capabilities.canTimeout) return { executable: true, resolvedAction: "timeout" };
      return resolveDiscordExecutionPlan("quarantine", capabilities);
    case "quarantine":
      return capabilities.canManageRoles
        ? { executable: true, resolvedAction: "quarantine" }
        : { executable: false, reason: "manage_roles_missing", resolvedAction: "verify" };
    default:
      return { executable: true, resolvedAction: action };
  }
}
