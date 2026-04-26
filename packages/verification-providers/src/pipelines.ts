/**
 * Purpose: Defines role-complete verification strategy pipelines so the shared package can describe capture flows, reusable-proof flows, and the Bun-owned policy consumer together.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\workspaces.md
 * External references:
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.privado.id/docs/verifier/verifier-overview/
 * - https://docs.world.org/world-id/concepts
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { isHumanifyClaimKey, type HumanifyClaimKey } from "./claims";

export const verificationStrategyPathways = ["first_time_capture", "reusable_proof", "proof_of_personhood"] as const;

export type VerificationStrategyPathway = (typeof verificationStrategyPathways)[number];

export type VerificationStrategyPipelineDefinition = {
  defaultRank: number;
  id: string;
  strategyIds: {
    captureProviderId?: string;
    policyConsumerId: string;
    reusableProofBackendId?: string;
  };
  pathway: VerificationStrategyPathway;
  supportedClaimKeys: readonly HumanifyClaimKey[];
  summary: string;
  title: string;
};

export function cloneVerificationStrategyPipelineDefinition<TPipeline extends VerificationStrategyPipelineDefinition>(
  pipeline: TPipeline,
): TPipeline {
  return {
    ...pipeline,
    strategyIds: {
      ...pipeline.strategyIds,
    },
    supportedClaimKeys: [...pipeline.supportedClaimKeys],
  };
}

export function getVerificationStrategyPipelinePrimaryStrategyId(pipeline: VerificationStrategyPipelineDefinition) {
  return pipeline.strategyIds.captureProviderId ?? pipeline.strategyIds.reusableProofBackendId;
}

export function defineVerificationStrategyPipeline<TPipeline extends VerificationStrategyPipelineDefinition>(
  pipeline: TPipeline,
): TPipeline {
  if (pipeline.id.trim().length === 0) {
    throw new Error("Verification strategy pipelines must declare a non-empty id.");
  }

  if (pipeline.title.trim().length === 0) {
    throw new Error(`Verification strategy pipeline "${pipeline.id}" must declare a human-readable title.`);
  }

  if (pipeline.summary.trim().length === 0) {
    throw new Error(`Verification strategy pipeline "${pipeline.id}" must declare a summary.`);
  }

  if (pipeline.supportedClaimKeys.length === 0) {
    throw new Error(`Verification strategy pipeline "${pipeline.id}" must support at least one Humanify claim.`);
  }

  for (const claimKey of pipeline.supportedClaimKeys) {
    if (!isHumanifyClaimKey(claimKey)) {
      throw new Error(`Verification strategy pipeline "${pipeline.id}" references unsupported Humanify claim "${claimKey}".`);
    }
  }

  if (pipeline.strategyIds.policyConsumerId.trim().length === 0) {
    throw new Error(`Verification strategy pipeline "${pipeline.id}" must declare a policy consumer.`);
  }

  const hasCaptureProvider = Boolean(pipeline.strategyIds.captureProviderId);
  const hasReusableProofBackend = Boolean(pipeline.strategyIds.reusableProofBackendId);

  if (hasCaptureProvider == hasReusableProofBackend) {
    throw new Error(
      `Verification strategy pipeline "${pipeline.id}" must declare exactly one primary external strategy role.`,
    );
  }

  if (pipeline.pathway === "first_time_capture" && !hasCaptureProvider) {
    throw new Error(`Verification strategy pipeline "${pipeline.id}" must declare a capture provider.`);
  }

  if (pipeline.pathway != "first_time_capture" && !hasReusableProofBackend) {
    throw new Error(`Verification strategy pipeline "${pipeline.id}" must declare a reusable-proof backend.`);
  }

  return cloneVerificationStrategyPipelineDefinition(pipeline);
}

export const diditCaptureVerificationPipeline = defineVerificationStrategyPipeline({
  defaultRank: 1,
  id: "humanify_didit_capture_v1",
  pathway: "first_time_capture",
  strategyIds: {
    captureProviderId: "didit",
    policyConsumerId: "humanify",
  },
  supportedClaimKeys: [
    "age_over_18",
    "age_over_21",
    "nationality",
    "document_identity",
    "liveness",
    "face_verification",
  ],
  summary: "Humanify binds the Discord challenge, Didit performs first-time capture, and Bun policy decides whether release can happen.",
  title: "Verify for the first time",
});

export const privadoReusableVerificationPipeline = defineVerificationStrategyPipeline({
  defaultRank: 1,
  id: "humanify_privado_reusable_v1",
  pathway: "reusable_proof",
  strategyIds: {
    policyConsumerId: "humanify",
    reusableProofBackendId: "privado",
  },
  supportedClaimKeys: ["age_over_18", "nationality"],
  summary: "Humanify issues the verifier request, Privado returns the reusable proof, and Bun policy consumes the verified result.",
  title: "Use a reusable proof",
});

export const selfReusableVerificationPipeline = defineVerificationStrategyPipeline({
  defaultRank: 2,
  id: "humanify_self_reusable_v1",
  pathway: "reusable_proof",
  strategyIds: {
    policyConsumerId: "humanify",
    reusableProofBackendId: "self",
  },
  supportedClaimKeys: ["age_over_18", "nationality"],
  summary: "Humanify can consume a Self.xyz reusable proof when its supported credentials match the guild's policy needs.",
  title: "Use an alternative reusable proof",
});

export const worldIdUniquenessVerificationPipeline = defineVerificationStrategyPipeline({
  defaultRank: 1,
  id: "humanify_world_id_uniqueness_v1",
  pathway: "proof_of_personhood",
  strategyIds: {
    policyConsumerId: "humanify",
    reusableProofBackendId: "world_id",
  },
  supportedClaimKeys: ["unique_person"],
  summary: "Humanify can consume a World ID uniqueness proof when a guild needs anti-Sybil or proof-of-personhood checks.",
  title: "Prove uniqueness only",
});
