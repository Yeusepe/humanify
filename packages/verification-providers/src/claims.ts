/**
 * Purpose: Defines the Bun-owned Humanify claim catalog and the default reusable Humanify ID bundle.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * - docs\workspaces.md
 * External references:
 * - https://www.w3.org/TR/vc-data-model/
 * - https://semaphore.appliedzkp.org/docs/concepts/nullifiers
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

export type HumanifyClaimDefinition = {
  id: string;
  summary: string;
  title: string;
};

export type HumanifyIdClaimBundle = {
  bundleId: "humanify_id_age_and_nationality_v1";
  claims: readonly HumanifyClaimKey[];
  futureExtensions: readonly string[];
  operatorStorageGuarantees: readonly string[];
  summary: string;
  title: string;
};

const humanifyClaimDefinitions = [
  {
    id: "age_over_18",
    summary: "Threshold proof that the holder is 18 or older without disclosing a birth date.",
    title: "Age over 18",
  },
  {
    id: "nationality",
    summary: "Selective-disclosure proof of nationality without exposing the full underlying document.",
    title: "Nationality",
  },
] as const satisfies readonly HumanifyClaimDefinition[];

export type HumanifyClaimKey = (typeof humanifyClaimDefinitions)[number]["id"];

const supportedClaimIds = humanifyClaimDefinitions.map((claim) => claim.id) as HumanifyClaimKey[];
const supportedClaimIdSet = new Set<string>(supportedClaimIds);

const defaultHumanifyIdClaimBundle = {
  bundleId: "humanify_id_age_and_nationality_v1",
  claims: ["age_over_18", "nationality"],
  futureExtensions: [
    "unique_person as a separate proof-of-personhood lane once World ID or equivalent coverage is explicitly wired",
    "additional predicates like sanctions exclusion or age-over-21 without storing the raw source document",
  ],
  operatorStorageGuarantees: [
    "Humanify should store only proof receipts, nullifiers, issuer references, expiry windows, and claim predicates.",
    "Humanify should not store document images, birthdates, passport numbers, or the full verifiable credential payload.",
    "The reusable Humanify ID should live with the user as a holder credential; the server should verify proofs, not warehouse identity data.",
  ],
  summary: "Default v1 bundle: prove age and nationality, but keep the underlying document data out of Humanify storage.",
  title: "Humanify ID / Age + nationality",
} as const satisfies HumanifyIdClaimBundle;

export function getHumanifyClaimDefinitions(): HumanifyClaimDefinition[] {
  return humanifyClaimDefinitions.map((definition) => ({ ...definition }));
}

export function getSupportedHumanifyClaimIds(): HumanifyClaimKey[] {
  return [...supportedClaimIds];
}

export function isHumanifyClaimKey(value: string): value is HumanifyClaimKey {
  return supportedClaimIdSet.has(value);
}

export function getDefaultHumanifyIdClaimBundle(): HumanifyIdClaimBundle {
  return {
    ...defaultHumanifyIdClaimBundle,
    claims: [...defaultHumanifyIdClaimBundle.claims],
    futureExtensions: [...defaultHumanifyIdClaimBundle.futureExtensions],
    operatorStorageGuarantees: [...defaultHumanifyIdClaimBundle.operatorStorageGuarantees],
  };
}
