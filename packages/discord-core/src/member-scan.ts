/**
 * Purpose: Defines the pure Humanify member-scan heuristic shared by Discord intake and durable scan workflows.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * - docs\workspaces.md
 * External references:
 * - https://discord.com/developers/docs/reference#snowflakes
 * Tests:
 * - packages/discord-core/src/index.test.ts
 * - apps/scan-worker-temporal/src/index.test.ts
 */

export type MemberScanReasonCode =
  | "account_age_lt_24h"
  | "account_age_lt_7d"
  | "profile_missing_avatar"
  | "profile_test_handle_pattern";

export type MemberScanEvaluation = {
  reasonCodes: MemberScanReasonCode[];
  score: number;
  shouldOpenCase: boolean;
};

export type MemberScanSnapshot = {
  avatar?: string | null;
  createdTimestamp: number;
  globalName?: string | null;
  guildId: string;
  userId: string;
  username?: string | null;
};

const twentyFourHoursMs = 24 * 60 * 60 * 1_000;
const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
const maxMemberScanScore = 10;

export const memberScanWatchThresholdScore = 4 as const;

const memberScanReasonWeights: Record<MemberScanReasonCode, number> = {
  account_age_lt_24h: 6,
  account_age_lt_7d: 3,
  profile_missing_avatar: 2,
  profile_test_handle_pattern: 2,
};

function hasSyntheticTestHandle(snapshot: MemberScanSnapshot) {
  const candidates = [snapshot.username, snapshot.globalName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());

  return candidates.some((value) => value.includes("test") && /[_-]?\d{4,}$/.test(value));
}

export function extractMemberScanReasonCodes(input: {
  now: number;
  snapshot: MemberScanSnapshot;
}): MemberScanReasonCode[] {
  return evaluateMemberScanSnapshot(input).reasonCodes;
}

export function evaluateMemberScanSnapshot(input: {
  now: number;
  snapshot: MemberScanSnapshot;
}): MemberScanEvaluation {
  const accountAgeMs = Math.max(input.now - input.snapshot.createdTimestamp, 0);
  const reasonCodes: MemberScanReasonCode[] = [];

  if (accountAgeMs < twentyFourHoursMs) {
    reasonCodes.push("account_age_lt_24h");
  } else if (accountAgeMs < sevenDaysMs) {
    reasonCodes.push("account_age_lt_7d");
  }

  if (!input.snapshot.avatar) {
    reasonCodes.push("profile_missing_avatar");
  }

  if (!input.snapshot.avatar && hasSyntheticTestHandle(input.snapshot)) {
    reasonCodes.push("profile_test_handle_pattern");
  }

  const dedupedReasonCodes = [...new Set(reasonCodes)];
  const score = Math.min(
    dedupedReasonCodes.reduce((total, reasonCode) => total + memberScanReasonWeights[reasonCode], 0),
    maxMemberScanScore,
  );

  return {
    reasonCodes: dedupedReasonCodes,
    score,
    shouldOpenCase: score >= memberScanWatchThresholdScore,
  };
}

export function buildMemberScanReportReason(evaluation: Pick<MemberScanEvaluation, "reasonCodes" | "score">) {
  if (evaluation.reasonCodes.includes("account_age_lt_24h")) {
    return `Automatic detector bridge assigned advisory member-scan score ${evaluation.score}/10 to a very new Discord account joining the server.`;
  }

  if (evaluation.reasonCodes.includes("profile_test_handle_pattern")) {
    return `Automatic detector bridge assigned advisory member-scan score ${evaluation.score}/10 to a sparse Discord profile with a synthetic-looking test handle.`;
  }

  return `Automatic detector bridge assigned advisory member-scan score ${evaluation.score}/10 to a newly created Discord account with incomplete profile signals.`;
}

export function buildMemberScanReporterNotes(evaluation: Pick<MemberScanEvaluation, "reasonCodes" | "score">) {
  return `Advisory member-scan score: ${evaluation.score}/10. Case-open threshold: ${memberScanWatchThresholdScore}/10. Reason codes: ${evaluation.reasonCodes.join(", ")}`;
}
