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
  buildMemberScanReportReason,
  buildMemberScanReporterNotes,
  buildComponentCustomId,
  buildSetupFlowCustomId,
  createHumanifyApplicationCommands,
  createBotGatewayIntents,
  createDiscordAuditReason,
  discordSnowflakeToTimestamp,
  evaluateDiscordAccountTrust,
  evaluateMemberScanSnapshot,
  extractMemberScanReasonCodes,
  memberScanWatchThresholdScore,
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
    version: 1,
  });

  expect(parseComponentCustomId(customId)).toEqual({
    entityId: "case_123",
    guildId: "guild_123",
    kind: "review",
    version: 1,
  });
});

test("verification shortcut component IDs stay within Discord's 100 character limit", () => {
  const entityId = "a0147b1e-82db-4418-aed0-15a5f0786c27~1423467182293258252";
  const customId = buildComponentCustomId({
    entityId,
    guildId: "1422780738331213867",
    kind: "verification_start",
  });

  expect(customId.length).toBeLessThanOrEqual(100);
  expect(parseComponentCustomId(customId)).toMatchObject({
    entityId,
    guildId: "1422780738331213867",
    kind: "verification_start",
  });
});

test("component ID parser remains backward compatible with legacy verbose IDs", () => {
  const legacyCustomId =
    "humanify:v1:verification_start:1422780738331213867:a0147b1e-82db-4418-aed0-15a5f0786c27~1423467182293258252";

  expect(parseComponentCustomId(legacyCustomId)).toEqual({
    entityId: "a0147b1e-82db-4418-aed0-15a5f0786c27~1423467182293258252",
    guildId: "1422780738331213867",
    kind: "verification_start",
    version: 1,
  });
});

test("v2 component IDs fail fast when a kind is missing a compact identifier", () => {
  expect(() => buildComponentCustomId({
    entityId: "case_123",
    guildId: "guild_123",
    kind: "review",
  })).toThrow('Humanify component kind "review" is missing a compact v2 identifier.');
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
    version: 2,
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
      "scan",
      "scan-all",
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
  expect(setupCommand?.options?.map((option) => option.name)).toEqual(["panel", "setup"]);
});

test("scan commands stay admin-scoped at registration so non-admins do not see them by default", () => {
  const commands = createHumanifyApplicationCommands();
  const scanCommand = commands.find((command) => ("toJSON" in command ? command.toJSON().name : command.name) === "scan") as
    | {
        defaultMemberPermissions?: bigint | string | null;
      }
    | undefined;
  const scanAllCommand = commands.find((command) => ("toJSON" in command ? command.toJSON().name : command.name) === "scan-all") as
    | {
        defaultMemberPermissions?: bigint | string | null;
      }
    | undefined;

  expect(scanCommand?.defaultMemberPermissions).toBe(PermissionFlagsBits.Administrator);
  expect(scanAllCommand?.defaultMemberPermissions).toBe(PermissionFlagsBits.Administrator);
});

test("moderation and verification slash commands stay admin-scoped at registration", () => {
  const commands = createHumanifyApplicationCommands();
  const reportCommand = commands.find((command) => ("toJSON" in command ? command.toJSON().name : command.name) === "report") as
    | {
        defaultMemberPermissions?: bigint | string | null;
      }
    | undefined;
  const caseCommand = commands.find((command) => ("toJSON" in command ? command.toJSON().name : command.name) === "case") as
    | {
        defaultMemberPermissions?: bigint | string | null;
      }
    | undefined;
  const verifyCommand = commands.find((command) => ("toJSON" in command ? command.toJSON().name : command.name) === "verify") as
    | {
        defaultMemberPermissions?: bigint | string | null;
      }
    | undefined;

  expect(reportCommand?.defaultMemberPermissions).toBe(PermissionFlagsBits.Administrator);
  expect(caseCommand?.defaultMemberPermissions).toBe(PermissionFlagsBits.Administrator);
  expect(verifyCommand?.defaultMemberPermissions).toBe(PermissionFlagsBits.Administrator);
});

test("member scan heuristics stay aligned with the passive new-account detector", () => {
  const newAccountEvaluation = evaluateMemberScanSnapshot({
    now: Date.UTC(2026, 0, 8, 0, 0, 0),
    snapshot: {
      avatar: null,
      createdTimestamp: Date.UTC(2026, 0, 7, 12, 0, 0),
      guildId: "guild_123",
      userId: "user_new",
    },
  });
  expect(newAccountEvaluation).toEqual({
    reasonCodes: ["account_age_lt_24h", "profile_missing_avatar"],
    score: 8,
    shouldOpenCase: true,
  });

  const olderEvaluation = evaluateMemberScanSnapshot({
    now: Date.UTC(2026, 0, 8, 0, 0, 0),
    snapshot: {
      avatar: null,
      createdTimestamp: Date.UTC(2026, 0, 2, 12, 0, 0),
      guildId: "guild_123",
      userId: "user_sparse",
    },
  });

  expect(extractMemberScanReasonCodes({
    now: Date.UTC(2026, 0, 8, 0, 0, 0),
    snapshot: {
      avatar: null,
      createdTimestamp: Date.UTC(2026, 0, 2, 12, 0, 0),
      guildId: "guild_123",
      userId: "user_sparse",
    },
  })).toEqual(["account_age_lt_7d", "profile_missing_avatar"]);
  expect(olderEvaluation).toEqual({
    reasonCodes: ["account_age_lt_7d", "profile_missing_avatar"],
    score: 5,
    shouldOpenCase: true,
  });
  expect(buildMemberScanReportReason(olderEvaluation)).toContain("score 5/10");

  const matureSparseEvaluation = evaluateMemberScanSnapshot({
    now: Date.UTC(2026, 3, 27, 15, 17, 10),
    snapshot: {
      avatar: null,
      createdTimestamp: Date.UTC(2025, 9, 3, 0, 30, 23),
      guildId: "guild_123",
      userId: "1423467182293258252",
      username: "yeusepetest_69399",
    },
  });

  expect(matureSparseEvaluation).toEqual({
    reasonCodes: ["profile_missing_avatar", "profile_test_handle_pattern"],
    score: memberScanWatchThresholdScore,
    shouldOpenCase: true,
  });
  expect(buildMemberScanReportReason(matureSparseEvaluation)).toContain("synthetic-looking");
  expect(buildMemberScanReporterNotes(matureSparseEvaluation)).toContain(`Advisory member-scan score: ${memberScanWatchThresholdScore}/10`);
});

test("discord account trust scoring rewards mature verified profiles and flags sparse new accounts", () => {
  expect(discordSnowflakeToTimestamp(((BigInt(Date.UTC(2025, 0, 1, 0, 0, 0) - 1_420_070_400_000) << 22n)).toString())).toBe(
    Date.UTC(2025, 0, 1, 0, 0, 0),
  );

  const trusted = evaluateDiscordAccountTrust({
    now: Date.UTC(2026, 0, 8, 0, 0, 0),
    snapshot: {
      avatar: "avatar_hash",
      connectionTypes: ["github", "twitter"],
      createdTimestamp: Date.UTC(2025, 5, 1, 0, 0, 0),
      emailVerified: true,
      premiumType: 2,
      userId: "user_trusted",
      username: "trusted-user",
    },
  });
  const sparse = evaluateDiscordAccountTrust({
    now: Date.UTC(2026, 0, 8, 0, 0, 0),
    snapshot: {
      avatar: null,
      connectionTypes: [],
      createdTimestamp: Date.UTC(2026, 0, 7, 12, 0, 0),
      emailVerified: false,
      userId: "user_sparse",
      username: "test_12345",
    },
  });

  expect(trusted).toMatchObject({
    positiveReasonCodes: ["profile_has_avatar", "account_email_verified", "account_has_connections", "account_has_premium"],
    satisfied: true,
    trustScore: 10,
  });
  expect(sparse).toMatchObject({
    negativeReasonCodes: ["account_age_lt_24h", "profile_missing_avatar", "profile_test_handle_pattern"],
    satisfied: false,
    trustScore: 1,
  });
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
