/**
 * Purpose: Scores a normalized Discord OAuth account snapshot into the Bun-owned account-trust signal used by verification.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\discord-bot.md
 * - docs\contracts.md
 * External references:
 * - https://discord.com/developers/docs/reference#snowflakes
 * - https://discord.com/developers/docs/resources/user#get-current-user
 * - https://discord.com/developers/docs/resources/user#get-user-connections
 * Tests:
 * - packages/discord-core/src/index.test.ts
 */

import { evaluateMemberScanSnapshot, type MemberScanReasonCode } from "./member-scan.ts";

export type DiscordAccountTrustReasonCode =
  | MemberScanReasonCode
  | "account_email_verified"
  | "account_has_connections"
  | "account_has_premium"
  | "profile_has_avatar";

export type DiscordAccountTrustSnapshot = {
  avatar?: string | null;
  connectionTypes: readonly string[];
  createdTimestamp: number;
  emailVerified: boolean;
  globalName?: string | null;
  premiumType?: number | null;
  publicFlags?: number | null;
  userId: string;
  username?: string | null;
};

export type DiscordAccountTrustEvaluation = {
  negativeReasonCodes: MemberScanReasonCode[];
  positiveReasonCodes: Exclude<DiscordAccountTrustReasonCode, MemberScanReasonCode>[];
  reasonCodes: DiscordAccountTrustReasonCode[];
  riskScore: number;
  satisfied: boolean;
  trustScore: number;
};

const discordEpoch = 1_420_070_400_000n;
const minimumDiscordTrustScore = 6;

export function discordSnowflakeToTimestamp(snowflake: string): number {
  return Number((BigInt(snowflake) >> 22n) + discordEpoch);
}

function summarizeConnectionTypes(connectionTypes: readonly string[]) {
  return [...new Set(connectionTypes.map((entry) => entry.trim()).filter((entry) => entry.length > 0))].sort();
}

export function evaluateDiscordAccountTrust(input: {
  now: number;
  snapshot: DiscordAccountTrustSnapshot;
}): DiscordAccountTrustEvaluation {
  const memberScan = evaluateMemberScanSnapshot({
    now: input.now,
    snapshot: {
      avatar: input.snapshot.avatar,
      createdTimestamp: input.snapshot.createdTimestamp,
      globalName: input.snapshot.globalName,
      guildId: "verification_session",
      userId: input.snapshot.userId,
      username: input.snapshot.username,
    },
  });
  const positiveReasonCodes: DiscordAccountTrustEvaluation["positiveReasonCodes"] = [];
  let trustBoost = 0;

  if (input.snapshot.avatar) {
    positiveReasonCodes.push("profile_has_avatar");
    trustBoost += 1;
  }

  if (input.snapshot.emailVerified) {
    positiveReasonCodes.push("account_email_verified");
    trustBoost += 2;
  }

  if (summarizeConnectionTypes(input.snapshot.connectionTypes).length > 0) {
    positiveReasonCodes.push("account_has_connections");
    trustBoost += 2;
  }

  if ((input.snapshot.premiumType ?? 0) > 0) {
    positiveReasonCodes.push("account_has_premium");
    trustBoost += 1;
  }

  const trustScore = Math.max(1, Math.min(10, 10 - memberScan.score + trustBoost));
  const reasonCodes = [...memberScan.reasonCodes, ...positiveReasonCodes] as DiscordAccountTrustReasonCode[];

  return {
    negativeReasonCodes: memberScan.reasonCodes,
    positiveReasonCodes,
    reasonCodes,
    riskScore: memberScan.score,
    satisfied: trustScore >= minimumDiscordTrustScore,
    trustScore,
  };
}
