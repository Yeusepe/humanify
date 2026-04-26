/**
 * Purpose: Defines the generic verification-provider template used by Bun apps to register provider manifests and server handoff contracts.
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
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { isHumanifyClaimKey, type HumanifyClaimKey } from "./claims";

export type VerificationProviderHandoffKind = "server_verified_proof" | "signed_webhook";

export type VerificationProviderDefinition = {
  benefits: readonly string[];
  defaultRank: number;
  deletionPolicy?: string;
  goodFor: string;
  id: string;
  integration: {
    completionMode: "provider_verification_required";
    handoffKind: VerificationProviderHandoffKind;
    serverEndpointPath: string;
    serverVerificationNote: string;
  };
  privacyDetails: string;
  privacySummary: string;
  summary: string;
  supportedClaimKeys: readonly HumanifyClaimKey[];
  thingsToKnow: readonly string[];
  title: string;
  whatYouNeed: string;
};

export function cloneVerificationProviderDefinition<TProvider extends VerificationProviderDefinition>(
  provider: TProvider,
): TProvider {
  return {
    ...provider,
    benefits: [...provider.benefits],
    integration: {
      ...provider.integration,
    },
    thingsToKnow: [...provider.thingsToKnow],
    supportedClaimKeys: [...provider.supportedClaimKeys],
  };
}

export function defineVerificationProvider<TProvider extends VerificationProviderDefinition>(provider: TProvider): TProvider {
  if (provider.id.trim().length === 0) {
    throw new Error("Verification providers must declare a non-empty id.");
  }

  if (provider.title.trim().length === 0) {
    throw new Error(`Verification provider "${provider.id}" must declare a human-readable title.`);
  }

  if (provider.benefits.length === 0) {
    throw new Error(`Verification provider "${provider.id}" must explain why a user would choose it.`);
  }

  if (provider.thingsToKnow.length === 0) {
    throw new Error(`Verification provider "${provider.id}" must declare at least one limitation.`);
  }

  if (provider.supportedClaimKeys.length === 0) {
    throw new Error(`Verification provider "${provider.id}" must support at least one Humanify claim.`);
  }

  for (const claimKey of provider.supportedClaimKeys) {
    if (!isHumanifyClaimKey(claimKey)) {
      throw new Error(`Verification provider "${provider.id}" references unsupported Humanify claim "${claimKey}".`);
    }
  }

  return cloneVerificationProviderDefinition(provider);
}
