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

import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  GatewayIntentBits,
  PermissionFlagsBits,
  PermissionsBitField,
  type ApplicationCommandDataResolvable,
  type GuildMember,
  type PermissionResolvable,
} from "discord.js";

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

export type BotAuthorizationScope = "admin_only" | "trusted_moderator_only";

export type BotActionAuthorization = {
  authorized: boolean;
  reason?: "admin_only" | "missing_member_permissions" | "trusted_moderator_only";
  scope: BotAuthorizationScope;
};

type MemberPermissionsLike = PermissionResolvable | Readonly<PermissionsBitField> | null | undefined;

export const humanifyBotCommandNames = {
  case: "case",
  humanify: "humanify",
  report: "report",
  reportMessage: "Report message to Humanify",
  verify: "verify",
} as const;

export const humanifyTrustedModeratorPermissionFlags = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageRoles,
] as const;

function createPermissionsBitField(memberPermissions: MemberPermissionsLike) {
  return memberPermissions ? new PermissionsBitField(memberPermissions) : null;
}

function hasAnyPermission(memberPermissions: MemberPermissionsLike, permissions: readonly PermissionResolvable[]) {
  const resolvedPermissions = createPermissionsBitField(memberPermissions);
  if (!resolvedPermissions) {
    return false;
  }

  return permissions.some((permission) => resolvedPermissions.has(permission));
}

export function createHumanifyApplicationCommands(): readonly ApplicationCommandDataResolvable[] {
  return [
    {
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
      description: "Server setup and capability checks for Humanify.",
      name: humanifyBotCommandNames.humanify,
      options: [
        {
          description: "Start server setup for Humanify.",
          name: "setup",
          type: ApplicationCommandOptionType.Subcommand,
        },
      ],
      type: ApplicationCommandType.ChatInput,
    },
    {
      description: "Open a Humanify report for a member.",
      name: humanifyBotCommandNames.report,
      options: [
        {
          description: "Member to report.",
          name: "user",
          required: true,
          type: ApplicationCommandOptionType.User,
        },
        {
          description: "Short reason for the report.",
          name: "reason",
          required: true,
          type: ApplicationCommandOptionType.String,
        },
        {
          description: "Optional moderator notes for the intake record.",
          name: "notes",
          required: false,
          type: ApplicationCommandOptionType.String,
        },
      ],
      type: ApplicationCommandType.ChatInput,
    },
    {
      description: "Open a Humanify case from Discord.",
      name: humanifyBotCommandNames.case,
      options: [
        {
          description: "Open a new case for a member.",
          name: "open",
          options: [
            {
              description: "Member to open a case for.",
              name: "user",
              required: true,
              type: ApplicationCommandOptionType.User,
            },
            {
              description: "Short case reason.",
              name: "reason",
              required: true,
              type: ApplicationCommandOptionType.String,
            },
            {
              description: "Optional moderator notes.",
              name: "notes",
              required: false,
              type: ApplicationCommandOptionType.String,
            },
          ],
          type: ApplicationCommandOptionType.Subcommand,
        },
      ],
      type: ApplicationCommandType.ChatInput,
    },
    {
      description: "Start a Humanify verification session for a member.",
      name: humanifyBotCommandNames.verify,
      options: [
        {
          description: "Member to verify.",
          name: "user",
          required: true,
          type: ApplicationCommandOptionType.User,
        },
        {
          choices: [
            { name: "captcha", value: "captcha" },
            { name: "human_presence", value: "human_presence" },
            { name: "unique_person", value: "unique_person" },
          ],
          description: "Verification capability to require.",
          name: "capability",
          required: false,
          type: ApplicationCommandOptionType.String,
        },
      ],
      type: ApplicationCommandType.ChatInput,
    },
    {
      name: humanifyBotCommandNames.reportMessage,
      type: ApplicationCommandType.Message,
    },
  ];
}

export function authorizeAdminOnlyBotAction(memberPermissions: MemberPermissionsLike): BotActionAuthorization {
  if (!memberPermissions) {
    return {
      authorized: false,
      reason: "missing_member_permissions",
      scope: "admin_only",
    };
  }

  return hasAnyPermission(memberPermissions, [PermissionFlagsBits.Administrator])
    ? {
        authorized: true,
        scope: "admin_only",
      }
    : {
        authorized: false,
        reason: "admin_only",
        scope: "admin_only",
      };
}

export function authorizeTrustedModeratorOnlyBotAction(memberPermissions: MemberPermissionsLike): BotActionAuthorization {
  if (!memberPermissions) {
    return {
      authorized: false,
      reason: "missing_member_permissions",
      scope: "trusted_moderator_only",
    };
  }

  return hasAnyPermission(memberPermissions, humanifyTrustedModeratorPermissionFlags)
    ? {
        authorized: true,
        scope: "trusted_moderator_only",
      }
    : {
        authorized: false,
        reason: "trusted_moderator_only",
        scope: "trusted_moderator_only",
      };
}

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
      return capabilities.canBan
        ? { executable: true, resolvedAction: "ban" }
        : { executable: false, reason: "ban_missing", resolvedAction: "ban" };
    case "kick":
      return capabilities.canKick
        ? { executable: true, resolvedAction: "kick" }
        : { executable: false, reason: "kick_missing", resolvedAction: "kick" };
    case "timeout":
      return capabilities.canTimeout
        ? { executable: true, resolvedAction: "timeout" }
        : { executable: false, reason: "timeout_missing", resolvedAction: "timeout" };
    case "quarantine":
      return capabilities.canManageRoles
        ? { executable: true, resolvedAction: "quarantine" }
        : { executable: false, reason: "manage_roles_missing", resolvedAction: "quarantine" };
    default:
      return { executable: true, resolvedAction: action };
  }
}
