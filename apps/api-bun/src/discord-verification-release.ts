/**
 * Purpose: Applies verification-driven Discord role grants and containment cleanup through the official Discord REST client.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\discord-bot.md
 * - docs\verification.md
 * External references:
 * - https://discord.js.org/docs/packages/rest/main/REST:Class
 * - https://discord.com/developers/docs/resources/guild#add-guild-member-role
 * - https://discord.com/developers/docs/resources/guild#remove-guild-member-role
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

export type VerificationRoleReleaseExecutor = {
  applyRoleGrants(input: {
    auditLogReason: string;
    guildId: string;
    removeRoleIds: string[];
    roleIds: string[];
    userId: string;
  }): Promise<void>;
};

export function createDiscordVerificationRoleReleaseExecutor(input: {
  botToken: string;
}): VerificationRoleReleaseExecutor {
  const rest = new REST().setToken(input.botToken);

  return {
    async applyRoleGrants({ auditLogReason, guildId, removeRoleIds, roleIds, userId }) {
      for (const roleId of roleIds) {
        await rest.put(Routes.guildMemberRole(guildId, userId, roleId), {
          headers: {
            "X-Audit-Log-Reason": auditLogReason,
          },
        });
      }

      for (const roleId of removeRoleIds) {
        await rest.delete(Routes.guildMemberRole(guildId, userId, roleId), {
          headers: {
            "X-Audit-Log-Reason": auditLogReason,
          },
        });
      }
    },
  };
}
