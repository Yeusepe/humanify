/**
 * Purpose: Verifies Humanify policy evaluation clamps advisory risk to safe, server-authorized moderation actions.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\contracts.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://bun.sh/docs/typescript
 * Tests:
 * - packages/policy-engine/src/index.test.ts
 */

import { expect, test } from "bun:test";

import { evaluatePolicy } from "./index";

const baseInput = {
  capabilityContext: {
    canBan: true,
    canKick: true,
    canManageRoles: true,
    canTimeout: true,
  },
  caseContext: {
    appealOpen: false,
    existingOpenCase: false,
    verificationStatus: "unknown" as const,
  },
  riskDecision: {
    confidence: 0.9,
    evidenceRefs: [],
    guildId: "guild_123",
    recommendedAction: "watch" as const,
    reasonCodes: ["first_message_link"],
    score: 6,
    userId: "user_123",
  },
  serverPolicy: {
    allowAutoBan: false,
    banAtOrAbove: 10,
    kickAtOrAbove: 9,
    maxAutomaticAction: "quarantine" as const,
    quarantineAtOrAbove: 7,
    timeoutAtOrAbove: 8,
    verificationRequiredAtOrAbove: 6,
  },
};

test("verification threshold elevates low recommendations into explicit verify actions", () => {
  const decision = evaluatePolicy(baseInput);

  expect(decision.allowedAction).toBe("verify");
  expect(decision.verificationRequired).toBe(true);
  expect(decision.blockedReasons).toContain("verification_required");
});

test("policy max automatic action clamps higher-risk recommendations", () => {
  const decision = evaluatePolicy({
    ...baseInput,
    riskDecision: {
      ...baseInput.riskDecision,
      recommendedAction: "ban",
      score: 10,
    },
  });

  expect(decision.allowedAction).toBe("quarantine");
  expect(decision.blockedReasons).toContain("server_policy_clamp");
});

test("discord capability clamps irreversible actions back to reversible containment", () => {
  const decision = evaluatePolicy({
    ...baseInput,
    capabilityContext: {
      canBan: false,
      canKick: false,
      canManageRoles: true,
      canTimeout: false,
    },
    riskDecision: {
      ...baseInput.riskDecision,
      recommendedAction: "kick",
      score: 9,
    },
    serverPolicy: {
      ...baseInput.serverPolicy,
      maxAutomaticAction: "kick",
    },
  });

  expect(decision.allowedAction).toBe("quarantine");
  expect(decision.blockedReasons).toContain("discord_capability_clamp");
});
