/**
 * Purpose: Exposes the shared verification strategy registry, role-split manifests, pipeline catalog, strategy template, and claim helpers so apps never bake provider details into their own control flow.
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
 * - https://www.w3.org/TR/vc-data-model/
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { type HumanifyClaimKey } from "./claims";
import {
  cloneVerificationStrategyPipelineDefinition,
  diditCaptureVerificationPipeline,
  getVerificationStrategyPipelinePrimaryStrategyId,
  privadoReusableVerificationPipeline,
  selfReusableVerificationPipeline,
  worldIdUniquenessVerificationPipeline,
  type VerificationStrategyPathway,
  type VerificationStrategyPipelineDefinition,
} from "./pipelines";
import { diditCaptureFlowStrategy } from "./capture-flows/didit";
import { humanifyPolicyConsumerStrategy } from "./policy-consumers/humanify";
import { privadoReusableProofBackendStrategy } from "./reusable-proof-backends/privado";
import { selfReusableProofBackendStrategy } from "./reusable-proof-backends/self";
import { worldIdReusableProofBackendStrategy } from "./reusable-proof-backends/world-id";
import {
  cloneVerificationStrategyDefinition,
  isUserSelectableVerificationStrategyRole,
  isVerificationStrategyRole,
  toVerificationProviderDefinition,
  type VerificationProviderDefinition,
  type VerificationStrategyDefinition,
  type VerificationStrategyRole,
} from "./template";

export {
  getDefaultVerificationClaimBundle,
  getVerificationClaimBundles,
  getVerificationClaimDefinitions,
  getSupportedVerificationClaimIds,
  getDefaultHumanifyIdClaimBundle,
  getHumanifyClaimDefinitions,
  getHumanifyIdClaimBundles,
  getSupportedHumanifyClaimIds,
  isHumanifyClaimKey,
  type HumanifyClaimDefinition,
  type HumanifyClaimKey,
  type HumanifyIdClaimBundle,
  type VerificationClaimBundle,
  type VerificationClaimDefinition,
} from "./claims";
export {
  buildPrivadoWalletLaunch,
  createPrivadoReusableCredentialBridge,
  createPrivadoVerificationPlan,
  normalizePrivadoVerificationResult,
  type PrivadoReusableCredentialBridge,
  type PrivadoNormalizedVerificationResult,
  type PrivadoVerifierBackendQRCodeMessage,
  type PrivadoVerifierBackendSignInRequest,
  type PrivadoVerifierBackendSignInResponse,
  type PrivadoVerifierBackendStatusResponse,
  type PrivadoVerificationPlan,
  type PrivadoWalletLaunch,
} from "./privado";
export {
  cloneVerificationStrategyDefinition,
  defineVerificationStrategy,
  cloneVerificationProviderDefinition,
  defineVerificationProvider,
  isUserSelectableVerificationStrategyRole,
  isVerificationStrategyRole,
  toVerificationProviderDefinition,
  type UserSelectableVerificationStrategyRole,
  type VerificationProviderDefinition,
  type VerificationProviderHandoffKind,
  type VerificationStrategyCompletionMode,
  type VerificationStrategyDefinition,
  type VerificationStrategyHandoffKind,
  type VerificationStrategyRole,
} from "./template";
export {
  cloneVerificationStrategyPipelineDefinition,
  defineVerificationStrategyPipeline,
  diditCaptureVerificationPipeline,
  getVerificationStrategyPipelinePrimaryStrategyId,
  privadoReusableVerificationPipeline,
  selfReusableVerificationPipeline,
  worldIdUniquenessVerificationPipeline,
  type VerificationStrategyPathway,
  type VerificationStrategyPipelineDefinition,
} from "./pipelines";
export { diditCaptureFlowStrategy } from "./capture-flows/didit";
export { humanifyPolicyConsumerStrategy } from "./policy-consumers/humanify";
export { privadoReusableProofBackendStrategy } from "./reusable-proof-backends/privado";
export { selfReusableProofBackendStrategy } from "./reusable-proof-backends/self";
export { worldIdReusableProofBackendStrategy } from "./reusable-proof-backends/world-id";

const roleSortOrder: Record<VerificationStrategyRole, number> = {
  capture_provider: 1,
  reusable_proof_backend: 2,
  policy_consumer: 3,
};

const pathwaySortOrder: Record<VerificationStrategyPathway, number> = {
  first_time_capture: 1,
  reusable_proof: 2,
  proof_of_personhood: 3,
};

export const registeredVerificationCaptureFlowStrategies = [
  diditCaptureFlowStrategy,
] as const satisfies readonly VerificationStrategyDefinition[];

export const registeredVerificationReusableProofBackendStrategies = [
  privadoReusableProofBackendStrategy,
  selfReusableProofBackendStrategy,
  worldIdReusableProofBackendStrategy,
] as const satisfies readonly VerificationStrategyDefinition[];

export const registeredVerificationPolicyConsumerStrategies = [
  humanifyPolicyConsumerStrategy,
] as const satisfies readonly VerificationStrategyDefinition[];

const registeredVerificationStrategies = [
  ...registeredVerificationCaptureFlowStrategies,
  ...registeredVerificationReusableProofBackendStrategies,
  ...registeredVerificationPolicyConsumerStrategies,
] as const satisfies readonly VerificationStrategyDefinition[];

const registeredVerificationStrategyPipelines = [
  diditCaptureVerificationPipeline,
  privadoReusableVerificationPipeline,
  selfReusableVerificationPipeline,
  worldIdUniquenessVerificationPipeline,
] as const satisfies readonly VerificationStrategyPipelineDefinition[];

function sortStrategies(left: VerificationStrategyDefinition, right: VerificationStrategyDefinition) {
  return (
    roleSortOrder[left.role] - roleSortOrder[right.role] ||
    left.defaultRank - right.defaultRank ||
    left.title.localeCompare(right.title)
  );
}

function sortPipelines(left: VerificationStrategyPipelineDefinition, right: VerificationStrategyPipelineDefinition) {
  return (
    pathwaySortOrder[left.pathway] - pathwaySortOrder[right.pathway] ||
    left.defaultRank - right.defaultRank ||
    left.title.localeCompare(right.title)
  );
}

export type VerificationStrategyCatalog = {
  all(): VerificationStrategyDefinition[];
  allIds(): string[];
  byRole(role: VerificationStrategyRole): VerificationStrategyDefinition[];
  defaultForRole(role: VerificationStrategyRole): VerificationStrategyDefinition;
  get(strategyId: string): VerificationStrategyDefinition | undefined;
  has(strategyId: string): boolean;
  require(strategyId: string): VerificationStrategyDefinition;
  selectable(): VerificationStrategyDefinition[];
  selectableIds(): string[];
  withEnabled(enabledStrategyIds: readonly string[]): VerificationStrategyCatalog;
};

export type VerificationStrategyPipelineCatalog = {
  defaultForPathway(pathway: VerificationStrategyPathway): VerificationStrategyPipelineDefinition;
  defaultPipeline(): VerificationStrategyPipelineDefinition;
  get(pipelineId: string): VerificationStrategyPipelineDefinition | undefined;
  has(pipelineId: string): boolean;
  ids(): string[];
  list(): VerificationStrategyPipelineDefinition[];
  require(pipelineId: string): VerificationStrategyPipelineDefinition;
  withEnabledStrategyIds(enabledStrategyIds: readonly string[]): VerificationStrategyPipelineCatalog;
};

export type VerificationStrategyConfiguration = {
  availablePipelineIds: string[];
  availableStrategyIds: string[];
  defaultCaptureProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledPipelineIds: string[];
  enabledStrategyIds: string[];
  policyConsumerId: string;
};

export function parseVerificationStrategySelection(value?: string): string[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const token of trimmed.split(",")) {
    const candidate = token.trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    ids.push(candidate);
  }

  return ids.length > 0 ? ids : undefined;
}

export function createVerificationStrategyCatalog(
  strategies: readonly VerificationStrategyDefinition[],
): VerificationStrategyCatalog {
  if (strategies.length === 0) {
    throw new Error("Verification strategy catalog requires at least one registered strategy.");
  }

  const sortedStrategies = [...strategies].sort(sortStrategies);
  const strategiesById = new Map<string, VerificationStrategyDefinition>();

  for (const strategy of sortedStrategies) {
    if (strategiesById.has(strategy.id)) {
      throw new Error(`Verification strategy ids must be unique. Duplicate id: "${strategy.id}".`);
    }

    if (!isVerificationStrategyRole(strategy.role)) {
      throw new Error(`Verification strategy "${strategy.id}" declares an unknown role.`);
    }

    strategiesById.set(strategy.id, strategy);
  }

  const selectableStrategies = sortedStrategies.filter((strategy) => isUserSelectableVerificationStrategyRole(strategy.role));

  return {
    all() {
      return sortedStrategies.map((strategy) => cloneVerificationStrategyDefinition(strategy));
    },
    allIds() {
      return sortedStrategies.map((strategy) => strategy.id);
    },
    byRole(role) {
      return sortedStrategies
        .filter((strategy) => strategy.role === role)
        .map((strategy) => cloneVerificationStrategyDefinition(strategy));
    },
    defaultForRole(role) {
      const strategy = sortedStrategies.find((entry) => entry.role === role);
      if (!strategy) {
        throw new Error(`Verification strategy catalog does not include role "${role}".`);
      }

      return cloneVerificationStrategyDefinition(strategy);
    },
    get(strategyId) {
      const strategy = strategiesById.get(strategyId);
      return strategy ? cloneVerificationStrategyDefinition(strategy) : undefined;
    },
    has(strategyId) {
      return strategiesById.has(strategyId);
    },
    require(strategyId) {
      const strategy = strategiesById.get(strategyId);
      if (!strategy) {
        throw new Error(`Unknown verification strategy "${strategyId}".`);
      }

      return cloneVerificationStrategyDefinition(strategy);
    },
    selectable() {
      return selectableStrategies.map((strategy) => cloneVerificationStrategyDefinition(strategy));
    },
    selectableIds() {
      return selectableStrategies.map((strategy) => strategy.id);
    },
    withEnabled(enabledStrategyIds) {
      const enabledSet = new Set<string>();

      for (const strategyId of enabledStrategyIds) {
        const strategy = strategiesById.get(strategyId);
        if (!strategy) {
          throw new Error(`Enabled verification strategies include unknown strategy "${strategyId}".`);
        }

        if (isUserSelectableVerificationStrategyRole(strategy.role)) {
          enabledSet.add(strategyId);
        }
      }

      const enabledStrategies = sortedStrategies.filter(
        (strategy) => !isUserSelectableVerificationStrategyRole(strategy.role) || enabledSet.has(strategy.id),
      );
      if (enabledStrategies.every((strategy) => !isUserSelectableVerificationStrategyRole(strategy.role))) {
        throw new Error("Enabled verification strategies resolved to an empty catalog.");
      }

      return createVerificationStrategyCatalog(enabledStrategies);
    },
  };
}

export const humanifyVerificationStrategyCatalog = createVerificationStrategyCatalog(registeredVerificationStrategies);

export function resolveVerificationStrategyCatalog(input: { enabledStrategyIds?: readonly string[] } = {}) {
  return input.enabledStrategyIds?.length
    ? humanifyVerificationStrategyCatalog.withEnabled(input.enabledStrategyIds)
    : humanifyVerificationStrategyCatalog;
}

export function verificationStrategySupportsClaims(
  strategy: Pick<VerificationStrategyDefinition, "supportedClaimKeys">,
  requestedClaims: readonly HumanifyClaimKey[],
) {
  const supportedClaimKeySet = new Set<string>(strategy.supportedClaimKeys);
  return requestedClaims.every((claimKey) => supportedClaimKeySet.has(claimKey));
}

export function createVerificationStrategyPipelineCatalog(
  pipelines: readonly VerificationStrategyPipelineDefinition[],
  strategyCatalog: VerificationStrategyCatalog,
): VerificationStrategyPipelineCatalog {
  if (pipelines.length === 0) {
    throw new Error("Verification strategy pipeline catalog requires at least one registered pipeline.");
  }

  const sortedPipelines = [...pipelines].sort(sortPipelines);
  const pipelinesById = new Map<string, VerificationStrategyPipelineDefinition>();

  for (const pipeline of sortedPipelines) {
    if (pipelinesById.has(pipeline.id)) {
      throw new Error(`Verification strategy pipeline ids must be unique. Duplicate id: "${pipeline.id}".`);
    }

    const policyConsumer = strategyCatalog.require(pipeline.strategyIds.policyConsumerId);
    if (policyConsumer.role !== "policy_consumer") {
      throw new Error(`Verification strategy pipeline "${pipeline.id}" must reference a policy consumer.`);
    }

    if (!verificationStrategySupportsClaims(policyConsumer, pipeline.supportedClaimKeys)) {
      throw new Error(`Verification strategy pipeline "${pipeline.id}" references claims unsupported by policy consumer "${policyConsumer.id}".`);
    }

    if (pipeline.strategyIds.captureProviderId) {
      const captureProvider = strategyCatalog.require(pipeline.strategyIds.captureProviderId);
      if (captureProvider.role !== "capture_provider") {
        throw new Error(`Verification strategy pipeline "${pipeline.id}" must reference a capture provider.`);
      }

      if (!verificationStrategySupportsClaims(captureProvider, pipeline.supportedClaimKeys)) {
        throw new Error(`Verification strategy pipeline "${pipeline.id}" references claims unsupported by capture provider "${captureProvider.id}".`);
      }
    }

    if (pipeline.strategyIds.reusableProofBackendId) {
      const reusableProofBackend = strategyCatalog.require(pipeline.strategyIds.reusableProofBackendId);
      if (reusableProofBackend.role !== "reusable_proof_backend") {
        throw new Error(`Verification strategy pipeline "${pipeline.id}" must reference a reusable-proof backend.`);
      }

      if (!verificationStrategySupportsClaims(reusableProofBackend, pipeline.supportedClaimKeys)) {
        throw new Error(
          `Verification strategy pipeline "${pipeline.id}" references claims unsupported by reusable-proof backend "${reusableProofBackend.id}".`,
        );
      }
    }

    pipelinesById.set(pipeline.id, pipeline);
  }

  return {
    defaultForPathway(pathway) {
      const pipeline = sortedPipelines.find((entry) => entry.pathway === pathway);
      if (!pipeline) {
        throw new Error(`Verification strategy pipeline catalog does not include pathway "${pathway}".`);
      }

      return cloneVerificationStrategyPipelineDefinition(pipeline);
    },
    defaultPipeline() {
      return cloneVerificationStrategyPipelineDefinition(sortedPipelines[0]!);
    },
    get(pipelineId) {
      const pipeline = pipelinesById.get(pipelineId);
      return pipeline ? cloneVerificationStrategyPipelineDefinition(pipeline) : undefined;
    },
    has(pipelineId) {
      return pipelinesById.has(pipelineId);
    },
    ids() {
      return sortedPipelines.map((pipeline) => pipeline.id);
    },
    list() {
      return sortedPipelines.map((pipeline) => cloneVerificationStrategyPipelineDefinition(pipeline));
    },
    require(pipelineId) {
      const pipeline = pipelinesById.get(pipelineId);
      if (!pipeline) {
        throw new Error(`Unknown verification strategy pipeline "${pipelineId}".`);
      }

      return cloneVerificationStrategyPipelineDefinition(pipeline);
    },
    withEnabledStrategyIds(enabledStrategyIds) {
      const enabledStrategyCatalog = strategyCatalog.withEnabled(enabledStrategyIds);
      const enabledStrategyIdSet = new Set(enabledStrategyCatalog.allIds());
      const enabledPipelines = sortedPipelines.filter((pipeline) => {
        const primaryStrategyId = getVerificationStrategyPipelinePrimaryStrategyId(pipeline);
        if (!primaryStrategyId) {
          return false;
        }

        return enabledStrategyIdSet.has(primaryStrategyId) && enabledStrategyIdSet.has(pipeline.strategyIds.policyConsumerId);
      });

      if (enabledPipelines.length === 0) {
        throw new Error("Enabled verification strategies resolved to an empty pipeline catalog.");
      }

      return createVerificationStrategyPipelineCatalog(enabledPipelines, enabledStrategyCatalog);
    },
  };
}

export const humanifyVerificationStrategyPipelineCatalog = createVerificationStrategyPipelineCatalog(
  registeredVerificationStrategyPipelines,
  humanifyVerificationStrategyCatalog,
);

export function resolveVerificationStrategyConfiguration(input: {
  availableCatalog?: VerificationStrategyCatalog;
  availablePipelineCatalog?: VerificationStrategyPipelineCatalog;
  defaultCaptureProviderId?: string;
  defaultReusableProofBackendId?: string;
  enabledStrategyIds?: readonly string[];
} = {}): VerificationStrategyConfiguration {
  const availableCatalog = input.availableCatalog ?? humanifyVerificationStrategyCatalog;
  const availablePipelineCatalog =
    input.availablePipelineCatalog ?? humanifyVerificationStrategyPipelineCatalog.withEnabledStrategyIds(availableCatalog.selectableIds());

  if (input.enabledStrategyIds && input.enabledStrategyIds.length === 0) {
    throw new Error("At least one verification strategy must remain enabled for the guild.");
  }

  const enabledCatalog = input.enabledStrategyIds?.length
    ? availableCatalog.withEnabled(input.enabledStrategyIds)
    : availableCatalog;

  const enabledCaptureProviders = enabledCatalog.byRole("capture_provider");
  if (enabledCaptureProviders.length === 0) {
    throw new Error("At least one capture provider must remain enabled for the guild.");
  }

  const defaultCaptureProviderId = input.defaultCaptureProviderId ?? enabledCatalog.defaultForRole("capture_provider").id;
  const defaultCaptureProvider = enabledCatalog.require(defaultCaptureProviderId);
  if (defaultCaptureProvider.role !== "capture_provider") {
    throw new Error(`Default capture provider "${defaultCaptureProviderId}" must use the capture_provider role.`);
  }

  const enabledReusableProofBackends = enabledCatalog.byRole("reusable_proof_backend");
  const defaultReusableProofBackendId = input.defaultReusableProofBackendId ?? enabledReusableProofBackends[0]?.id;

  if (defaultReusableProofBackendId) {
    const defaultReusableProofBackend = enabledCatalog.require(defaultReusableProofBackendId);
    if (defaultReusableProofBackend.role !== "reusable_proof_backend") {
      throw new Error(
        `Default reusable-proof backend "${defaultReusableProofBackendId}" must use the reusable_proof_backend role.`,
      );
    }
  }

  const policyConsumerId = enabledCatalog.defaultForRole("policy_consumer").id;
  const enabledPipelineCatalog = availablePipelineCatalog.withEnabledStrategyIds(enabledCatalog.selectableIds());

  return {
    availablePipelineIds: availablePipelineCatalog.ids(),
    availableStrategyIds: availableCatalog.selectableIds(),
    defaultCaptureProviderId,
    defaultReusableProofBackendId,
    enabledPipelineIds: enabledPipelineCatalog.ids(),
    enabledStrategyIds: enabledCatalog.selectableIds(),
    policyConsumerId,
  };
}

export type VerificationOptionDefinition = VerificationProviderDefinition;

export type VerificationOptionCatalog = {
  defaultOption(): VerificationOptionDefinition;
  defaultProvider(): VerificationOptionDefinition;
  get(optionId: string): VerificationOptionDefinition | undefined;
  has(optionId: string): boolean;
  ids(): string[];
  list(): VerificationOptionDefinition[];
  require(optionId: string): VerificationOptionDefinition;
  withEnabled(enabledOptionIds: readonly string[]): VerificationOptionCatalog;
};

export type VerificationOptionConfiguration = {
  availableOptionIds: string[];
  availablePipelineIds: string[];
  defaultOptionId: string;
  defaultReusableProofBackendId?: string;
  enabledOptionIds: string[];
  enabledPipelineIds: string[];
  policyConsumerId: string;
};

function createOptionCatalogFromStrategyCatalog(strategyCatalog: VerificationStrategyCatalog): VerificationOptionCatalog {
  return {
    defaultOption() {
      return toVerificationProviderDefinition(strategyCatalog.defaultForRole("capture_provider"));
    },
    defaultProvider() {
      return this.defaultOption();
    },
    get(optionId) {
      const strategy = strategyCatalog.get(optionId);
      return strategy && isUserSelectableVerificationStrategyRole(strategy.role)
        ? toVerificationProviderDefinition(strategy)
        : undefined;
    },
    has(optionId) {
      const strategy = strategyCatalog.get(optionId);
      return Boolean(strategy && isUserSelectableVerificationStrategyRole(strategy.role));
    },
    ids() {
      return strategyCatalog.selectableIds();
    },
    list() {
      return strategyCatalog.selectable().map((strategy) => toVerificationProviderDefinition(strategy));
    },
    require(optionId) {
      const strategy = strategyCatalog.require(optionId);
      if (!isUserSelectableVerificationStrategyRole(strategy.role)) {
        throw new Error(`Unknown verification option "${optionId}".`);
      }

      return toVerificationProviderDefinition(strategy);
    },
    withEnabled(enabledOptionIds) {
      return createOptionCatalogFromStrategyCatalog(strategyCatalog.withEnabled(enabledOptionIds));
    },
  };
}

export function createVerificationOptionCatalog(
  options: readonly VerificationOptionDefinition[],
): VerificationOptionCatalog {
  return createOptionCatalogFromStrategyCatalog(createVerificationStrategyCatalog(options));
}

export const humanifyVerificationOptionCatalog = createOptionCatalogFromStrategyCatalog(humanifyVerificationStrategyCatalog);

export function resolveVerificationOptionCatalog(input: { enabledOptionIds?: readonly string[] } = {}) {
  return input.enabledOptionIds?.length
    ? humanifyVerificationOptionCatalog.withEnabled(input.enabledOptionIds)
    : humanifyVerificationOptionCatalog;
}

export const parseVerificationOptionSelection = parseVerificationStrategySelection;
export const verificationOptionSupportsClaims = verificationStrategySupportsClaims;

export function resolveVerificationOptionConfiguration(input: {
  availableCatalog?: VerificationOptionCatalog;
  defaultOptionId?: string;
  defaultReusableProofBackendId?: string;
  enabledOptionIds?: readonly string[];
} = {}): VerificationOptionConfiguration {
  try {
    const availableStrategyCatalog = input.availableCatalog
      ? createVerificationStrategyCatalog([
          ...input.availableCatalog.list(),
          humanifyVerificationStrategyCatalog.require("humanify"),
        ])
      : humanifyVerificationStrategyCatalog;
    const strategyConfiguration = resolveVerificationStrategyConfiguration({
      availableCatalog: availableStrategyCatalog,
      defaultCaptureProviderId: input.defaultOptionId,
      defaultReusableProofBackendId: input.defaultReusableProofBackendId,
      enabledStrategyIds: input.enabledOptionIds,
    });

    return {
      availableOptionIds: strategyConfiguration.availableStrategyIds,
      availablePipelineIds: strategyConfiguration.availablePipelineIds,
      defaultOptionId: strategyConfiguration.defaultCaptureProviderId,
      defaultReusableProofBackendId: strategyConfiguration.defaultReusableProofBackendId,
      enabledOptionIds: strategyConfiguration.enabledStrategyIds,
      enabledPipelineIds: strategyConfiguration.enabledPipelineIds,
      policyConsumerId: strategyConfiguration.policyConsumerId,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith('Unknown verification strategy "')) {
        throw new Error(error.message.replace("verification strategy", "verification option"));
      }

      if (error.message.startsWith('Enabled verification strategies include unknown strategy "')) {
        throw new Error(error.message.replace("verification strategies", "verification options").replace("strategy", "option"));
      }
    }

    throw error;
  }
}

export type VerificationProviderCatalog = VerificationOptionCatalog;

export type VerificationProviderConfiguration = {
  availablePipelineIds: string[];
  availableProviderIds: string[];
  defaultProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledPipelineIds: string[];
  enabledProviderIds: string[];
  policyConsumerId: string;
};

export function createVerificationProviderCatalog(
  providers: readonly VerificationProviderDefinition[],
): VerificationProviderCatalog {
  return createVerificationOptionCatalog(providers);
}

export const humanifyVerificationProviderCatalog = humanifyVerificationOptionCatalog;

export function resolveVerificationProviderCatalog(input: { enabledProviderIds?: readonly string[] } = {}) {
  return resolveVerificationOptionCatalog({
    enabledOptionIds: input.enabledProviderIds,
  });
}

export const parseVerificationProviderSelection = parseVerificationOptionSelection;
export const verificationProviderSupportsClaims = verificationOptionSupportsClaims;

export function resolveVerificationProviderConfiguration(input: {
  availableCatalog?: VerificationProviderCatalog;
  defaultProviderId?: string;
  enabledProviderIds?: readonly string[];
} = {}): VerificationProviderConfiguration {
  const optionConfiguration = resolveVerificationOptionConfiguration({
    availableCatalog: input.availableCatalog,
    defaultOptionId: input.defaultProviderId,
    enabledOptionIds: input.enabledProviderIds,
  });

  return {
    availablePipelineIds: optionConfiguration.availablePipelineIds,
    availableProviderIds: optionConfiguration.availableOptionIds,
    defaultProviderId: optionConfiguration.defaultOptionId,
    defaultReusableProofBackendId: optionConfiguration.defaultReusableProofBackendId,
    enabledPipelineIds: optionConfiguration.enabledPipelineIds,
    enabledProviderIds: optionConfiguration.enabledOptionIds,
    policyConsumerId: optionConfiguration.policyConsumerId,
  };
}
