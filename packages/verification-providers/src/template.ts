/**
 * Purpose: Defines the generic verification-strategy template used by Bun apps to register role-based strategy manifests and server handoff contracts.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\workspaces.md
 * External references:
 * - https://docs.self.xyz/
 * - https://docs.world.org/world-id/concepts
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.privado.id/docs/verifier/verifier-overview/
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { isHumanifyClaimKey, type HumanifyClaimKey } from "./claims";

export const verificationStrategyRoles = ["capture_provider", "reusable_proof_backend", "policy_consumer"] as const;

export type VerificationStrategyRole = (typeof verificationStrategyRoles)[number];
export type UserSelectableVerificationStrategyRole = Exclude<VerificationStrategyRole, "policy_consumer">;

export type VerificationStrategyHandoffKind = "server_verified_proof" | "signed_webhook" | "policy_evaluation";
export type VerificationStrategyCompletionMode = "provider_verification_required" | "policy_consumer_evaluation";

export type VerificationStrategyDefinition = {
  benefits: readonly string[];
  defaultRank: number;
  deletionPolicy?: string;
  goodFor: string;
  id: string;
  integration: {
    completionMode: VerificationStrategyCompletionMode;
    handoffKind: VerificationStrategyHandoffKind;
    serverEndpointPath: string;
    serverVerificationNote: string;
  };
  privacyDetails: string;
  privacySummary: string;
  role: VerificationStrategyRole;
  summary: string;
  supportedClaimKeys: readonly HumanifyClaimKey[];
  thingsToKnow: readonly string[];
  title: string;
  whatYouNeed: string;
};

export function isVerificationStrategyRole(value: string): value is VerificationStrategyRole {
  return (verificationStrategyRoles as readonly string[]).includes(value);
}

export function isUserSelectableVerificationStrategyRole(value: VerificationStrategyRole): value is UserSelectableVerificationStrategyRole {
  return value !== "policy_consumer";
}

export function cloneVerificationStrategyDefinition<TStrategy extends VerificationStrategyDefinition>(
  strategy: TStrategy,
): TStrategy {
  return {
    ...strategy,
    benefits: [...strategy.benefits],
    integration: {
      ...strategy.integration,
    },
    supportedClaimKeys: [...strategy.supportedClaimKeys],
    thingsToKnow: [...strategy.thingsToKnow],
  };
}

export function defineVerificationStrategy<TStrategy extends VerificationStrategyDefinition>(strategy: TStrategy): TStrategy {
  if (!isVerificationStrategyRole(strategy.role)) {
    throw new Error(`Verification strategy "${strategy.id}" must declare a supported role.`);
  }

  if (strategy.id.trim().length === 0) {
    throw new Error("Verification strategies must declare a non-empty id.");
  }

  if (strategy.title.trim().length === 0) {
    throw new Error(`Verification strategy "${strategy.id}" must declare a human-readable title.`);
  }

  if (strategy.summary.trim().length === 0) {
    throw new Error(`Verification strategy "${strategy.id}" must declare a summary.`);
  }

  if (strategy.benefits.length === 0) {
    throw new Error(`Verification strategy "${strategy.id}" must explain why a user would choose it.`);
  }

  if (strategy.thingsToKnow.length === 0) {
    throw new Error(`Verification strategy "${strategy.id}" must declare at least one limitation.`);
  }

  if (strategy.supportedClaimKeys.length === 0) {
    throw new Error(`Verification strategy "${strategy.id}" must support at least one Humanify claim.`);
  }

  for (const claimKey of strategy.supportedClaimKeys) {
    if (!isHumanifyClaimKey(claimKey)) {
      throw new Error(`Verification strategy "${strategy.id}" references unsupported Humanify claim "${claimKey}".`);
    }
  }

  if (strategy.role === "policy_consumer") {
    if (strategy.integration.handoffKind !== "policy_evaluation") {
      throw new Error(`Policy-consumer strategy "${strategy.id}" must use the policy_evaluation handoff.`);
    }

    if (strategy.integration.completionMode !== "policy_consumer_evaluation") {
      throw new Error(`Policy-consumer strategy "${strategy.id}" must use the policy_consumer_evaluation completion mode.`);
    }
  }

  if (strategy.role !== "policy_consumer") {
    if (strategy.integration.handoffKind === "policy_evaluation") {
      throw new Error(`User-selectable strategy "${strategy.id}" cannot use the policy_evaluation handoff.`);
    }

    if (strategy.integration.completionMode !== "provider_verification_required") {
      throw new Error(`User-selectable strategy "${strategy.id}" must require provider verification.`);
    }
  }

  return cloneVerificationStrategyDefinition(strategy);
}

export type VerificationProviderHandoffKind = Exclude<VerificationStrategyHandoffKind, "policy_evaluation">;
export type VerificationProviderDefinition = Omit<VerificationStrategyDefinition, "integration" | "role"> & {
  integration: Omit<VerificationStrategyDefinition["integration"], "completionMode" | "handoffKind"> & {
    completionMode: "provider_verification_required";
    handoffKind: VerificationProviderHandoffKind;
  };
  role: UserSelectableVerificationStrategyRole;
};

export function cloneVerificationProviderDefinition<TProvider extends VerificationProviderDefinition>(
  provider: TProvider,
): TProvider {
  return cloneVerificationStrategyDefinition(provider);
}

export function toVerificationProviderDefinition(strategy: VerificationStrategyDefinition): VerificationProviderDefinition {
  if (!isUserSelectableVerificationStrategyRole(strategy.role)) {
    throw new Error(`Strategy "${strategy.id}" is not a user-selectable verification provider.`);
  }

  return cloneVerificationStrategyDefinition(strategy) as VerificationProviderDefinition;
}

export function defineVerificationProvider<TProvider extends VerificationProviderDefinition>(provider: TProvider): TProvider {
  return toVerificationProviderDefinition(defineVerificationStrategy(provider)) as TProvider;
}
