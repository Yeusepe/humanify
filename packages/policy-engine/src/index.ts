/**
 * Purpose: Evaluates Humanify moderation policy so Bun turns advisory risk into explainable, capability-aware allowed actions.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\contracts.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://www.postgresql.org/docs/current/index.html
 * - https://bun.sh/docs/typescript
 * - https://bun.sh/docs/test
 * Tests:
 * - packages/policy-engine/src/index.test.ts
 */

import { humanifyActionLadder, type HumanifyAction } from "@humanify/contracts";

export type PolicyRiskDecision = {
  confidence: number;
  evidenceRefs: string[];
  guildId: string;
  recommendedAction: HumanifyAction;
  reasonCodes: string[];
  score: number;
  userId: string;
};

export type ServerPolicy = {
  allowAutoBan: boolean;
  banAtOrAbove?: number;
  kickAtOrAbove?: number;
  maxAutomaticAction: HumanifyAction;
  quarantineAtOrAbove: number;
  timeoutAtOrAbove?: number;
  verificationRequiredAtOrAbove: number;
};

export type CapabilityContext = {
  canBan: boolean;
  canKick: boolean;
  canManageRoles: boolean;
  canTimeout: boolean;
};

export type CaseContext = {
  appealOpen: boolean;
  existingOpenCase: boolean;
  verificationStatus: "unknown" | "pending" | "passed" | "failed";
};

export type PolicyInput = {
  capabilityContext: CapabilityContext;
  caseContext: CaseContext;
  riskDecision: PolicyRiskDecision;
  serverPolicy: ServerPolicy;
};

export type PolicyDecision = {
  allowedAction: HumanifyAction;
  blockedReasons: string[];
  candidateAction: HumanifyAction;
  reviewRequired: boolean;
  scoreAction: HumanifyAction;
  verificationRequired: boolean;
};

function rank(action: HumanifyAction): number {
  return humanifyActionLadder.indexOf(action);
}

function maxAction(left: HumanifyAction, right: HumanifyAction): HumanifyAction {
  return rank(left) >= rank(right) ? left : right;
}

function minAction(left: HumanifyAction, right: HumanifyAction): HumanifyAction {
  return rank(left) <= rank(right) ? left : right;
}

export function scoreToRecommendedAction(score: number, policy: ServerPolicy): HumanifyAction {
  if (policy.allowAutoBan && policy.banAtOrAbove && score >= policy.banAtOrAbove) {
    return "ban";
  }

  if (policy.kickAtOrAbove && score >= policy.kickAtOrAbove) {
    return "kick";
  }

  if (policy.timeoutAtOrAbove && score >= policy.timeoutAtOrAbove) {
    return "timeout";
  }

  if (score >= policy.quarantineAtOrAbove) {
    return "quarantine";
  }

  if (score >= policy.verificationRequiredAtOrAbove) {
    return "verify";
  }

  return score >= 4 ? "watch" : "none";
}

export function clampActionToPolicy(action: HumanifyAction, policy: ServerPolicy): HumanifyAction {
  const maxPolicyAction = policy.allowAutoBan ? policy.maxAutomaticAction : minAction(policy.maxAutomaticAction, "kick");
  return minAction(action, maxPolicyAction);
}

export function clampActionToCapabilities(action: HumanifyAction, capabilityContext: CapabilityContext): HumanifyAction {
  switch (action) {
    case "ban":
      if (capabilityContext.canBan) return "ban";
      return clampActionToCapabilities("kick", capabilityContext);
    case "kick":
      if (capabilityContext.canKick) return "kick";
      return clampActionToCapabilities("timeout", capabilityContext);
    case "timeout":
      if (capabilityContext.canTimeout) return "timeout";
      return clampActionToCapabilities("quarantine", capabilityContext);
    case "quarantine":
      return capabilityContext.canManageRoles ? "quarantine" : "verify";
    default:
      return action;
  }
}

export function requiresVerification(input: Pick<PolicyInput, "caseContext" | "riskDecision" | "serverPolicy">): boolean {
  return (
    input.riskDecision.score >= input.serverPolicy.verificationRequiredAtOrAbove &&
    input.caseContext.verificationStatus !== "passed"
  );
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const scoreAction = scoreToRecommendedAction(input.riskDecision.score, input.serverPolicy);
  const verificationRequired = requiresVerification(input);
  const verificationAdjustedAction = verificationRequired
    ? maxAction(maxAction(input.riskDecision.recommendedAction, scoreAction), "verify")
    : maxAction(input.riskDecision.recommendedAction, scoreAction);
  const policyClampedAction = clampActionToPolicy(verificationAdjustedAction, input.serverPolicy);
  const capabilityClampedAction = clampActionToCapabilities(policyClampedAction, input.capabilityContext);
  const blockedReasons: string[] = [];

  if (verificationRequired) {
    blockedReasons.push("verification_required");
  }

  if (policyClampedAction !== verificationAdjustedAction) {
    blockedReasons.push("server_policy_clamp");
  }

  if (capabilityClampedAction !== policyClampedAction) {
    blockedReasons.push("discord_capability_clamp");
  }

  let allowedAction = capabilityClampedAction;
  if (input.caseContext.appealOpen && rank(allowedAction) > rank("watch")) {
    allowedAction = "watch";
    blockedReasons.push("appeal_open");
  }

  return {
    allowedAction,
    blockedReasons,
    candidateAction: verificationAdjustedAction,
    reviewRequired: blockedReasons.length > 0 || input.caseContext.existingOpenCase,
    scoreAction,
    verificationRequired,
  };
}
