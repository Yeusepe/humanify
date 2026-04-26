/**
 * Purpose: Exposes the shared verification-provider catalog, provider template, and Humanify ID claim helpers so apps never bake provider details into their own code.
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
 * - https://www.w3.org/TR/vc-data-model/
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { diditVerificationProvider } from "./providers/didit";
import { selfVerificationProvider } from "./providers/self";
import { worldIdVerificationProvider } from "./providers/world-id";
import { type HumanifyClaimKey } from "./claims";

export {
  getDefaultHumanifyIdClaimBundle,
  getHumanifyClaimDefinitions,
  getHumanifyIdClaimBundles,
  getSupportedHumanifyClaimIds,
  isHumanifyClaimKey,
  type HumanifyClaimDefinition,
  type HumanifyClaimKey,
  type HumanifyIdClaimBundle,
} from "./claims";
export {
  cloneVerificationProviderDefinition,
  defineVerificationProvider,
  type VerificationProviderDefinition,
  type VerificationProviderHandoffKind,
} from "./template";

import { cloneVerificationProviderDefinition, type VerificationProviderDefinition } from "./template";

export type VerificationProviderCatalog = {
  defaultProvider(): VerificationProviderDefinition;
  get(providerId: string): VerificationProviderDefinition | undefined;
  has(providerId: string): boolean;
  ids(): string[];
  list(): VerificationProviderDefinition[];
  require(providerId: string): VerificationProviderDefinition;
  withEnabled(enabledProviderIds: readonly string[]): VerificationProviderCatalog;
};

export type VerificationProviderConfiguration = {
  availableProviderIds: string[];
  defaultProviderId: string;
  enabledProviderIds: string[];
};

const registeredVerificationProviders = [
  selfVerificationProvider,
  worldIdVerificationProvider,
  diditVerificationProvider,
] as const satisfies readonly VerificationProviderDefinition[];

function sortProviders(left: VerificationProviderDefinition, right: VerificationProviderDefinition) {
  return left.defaultRank - right.defaultRank || left.title.localeCompare(right.title);
}

export function parseVerificationProviderSelection(value?: string): string[] | undefined {
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

export function createVerificationProviderCatalog(
  providers: readonly VerificationProviderDefinition[],
): VerificationProviderCatalog {
  if (providers.length === 0) {
    throw new Error("Verification provider catalog requires at least one registered provider.");
  }

  const sortedProviders = [...providers].sort(sortProviders);
  const providersById = new Map<string, VerificationProviderDefinition>();

  for (const provider of sortedProviders) {
    if (providersById.has(provider.id)) {
      throw new Error(`Verification provider ids must be unique. Duplicate id: "${provider.id}".`);
    }

    providersById.set(provider.id, provider);
  }

  return {
    defaultProvider() {
      return cloneVerificationProviderDefinition(sortedProviders[0]!);
    },
    get(providerId) {
      const provider = providersById.get(providerId);
      return provider ? cloneVerificationProviderDefinition(provider) : undefined;
    },
    has(providerId) {
      return providersById.has(providerId);
    },
    ids() {
      return sortedProviders.map((provider) => provider.id);
    },
    list() {
      return sortedProviders.map((provider) => cloneVerificationProviderDefinition(provider));
    },
    require(providerId) {
      const provider = providersById.get(providerId);
      if (!provider) {
        throw new Error(`Unknown verification provider "${providerId}".`);
      }

      return cloneVerificationProviderDefinition(provider);
    },
    withEnabled(enabledProviderIds) {
      const enabledSet = new Set<string>();

      for (const providerId of enabledProviderIds) {
        if (!providersById.has(providerId)) {
          throw new Error(`Enabled verification providers include unknown provider "${providerId}".`);
        }

        enabledSet.add(providerId);
      }

      const enabledProviders = sortedProviders.filter((provider) => enabledSet.has(provider.id));
      if (enabledProviders.length === 0) {
        throw new Error("Enabled verification providers resolved to an empty catalog.");
      }

      return createVerificationProviderCatalog(enabledProviders);
    },
  };
}

export const humanifyVerificationProviderCatalog = createVerificationProviderCatalog(registeredVerificationProviders);

export function resolveVerificationProviderCatalog(input: { enabledProviderIds?: readonly string[] } = {}) {
  return input.enabledProviderIds?.length
    ? humanifyVerificationProviderCatalog.withEnabled(input.enabledProviderIds)
    : humanifyVerificationProviderCatalog;
}

export function verificationProviderSupportsClaims(
  provider: Pick<VerificationProviderDefinition, "supportedClaimKeys">,
  requestedClaims: readonly HumanifyClaimKey[],
) {
  const supportedClaimKeySet = new Set<string>(provider.supportedClaimKeys);
  return requestedClaims.every((claimKey) => supportedClaimKeySet.has(claimKey));
}

export function resolveVerificationProviderConfiguration(input: {
  availableCatalog?: VerificationProviderCatalog;
  defaultProviderId?: string;
  enabledProviderIds?: readonly string[];
} = {}): VerificationProviderConfiguration {
  const availableCatalog = input.availableCatalog ?? humanifyVerificationProviderCatalog;
  if (input.enabledProviderIds && input.enabledProviderIds.length === 0) {
    throw new Error("At least one verification provider must remain enabled for the guild.");
  }

  const enabledCatalog = input.enabledProviderIds?.length
    ? availableCatalog.withEnabled(input.enabledProviderIds)
    : availableCatalog;
  const defaultProviderId = input.defaultProviderId ?? enabledCatalog.defaultProvider().id;

  if (!enabledCatalog.has(defaultProviderId)) {
    throw new Error(`Default verification provider "${defaultProviderId}" must be enabled for the guild.`);
  }

  return {
    availableProviderIds: availableCatalog.ids(),
    defaultProviderId,
    enabledProviderIds: enabledCatalog.ids(),
  };
}
