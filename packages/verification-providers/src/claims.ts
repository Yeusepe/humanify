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
  bestFor: string;
  bundleId: string;
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

const humanifyIdClaimBundles = [
  {
    bestFor: "The server only needs an age gate and you want to reveal as little as possible.",
    bundleId: "humanify_id_age_over_18_v1",
    claims: ["age_over_18"],
    futureExtensions: [
      "age-over-21 as a stricter threshold without disclosing a date of birth",
      "server-specific age thresholds once issuer and verifier support is wired explicitly",
    ],
    operatorStorageGuarantees: [
      "Humanify stores only proof receipts, nullifiers, issuer references, expiry windows, and claim predicates.",
      "Humanify does not store document images, birthdates, passport numbers, or the full verifiable credential payload.",
      "The reusable Humanify ID lives with the user as a holder credential; the server verifies proofs instead of warehousing identity data.",
    ],
    summary: "Use the smallest age-only proof when you only need to show that you are 18 or older.",
    title: "Only prove age over 18",
  },
  {
    bestFor: "The server only needs country eligibility and you do not want to add an age proof.",
    bundleId: "humanify_id_nationality_v1",
    claims: ["nationality"],
    futureExtensions: [
      "regional eligibility predicates once issuer coverage is documented provider-by-provider",
      "additional residency-style claims without disclosing the full source credential",
    ],
    operatorStorageGuarantees: [
      "Humanify stores only proof receipts, nullifiers, issuer references, expiry windows, and claim predicates.",
      "Humanify does not store document images, birthdates, passport numbers, or the full verifiable credential payload.",
      "The reusable Humanify ID lives with the user as a holder credential; the server verifies proofs instead of warehousing identity data.",
    ],
    summary: "Use a nationality-only proof when the community only needs a country or citizenship check.",
    title: "Only prove nationality",
  },
  {
    bestFor: "The server needs both age and nationality, or you want one reusable proof set that covers both.",
    bundleId: "humanify_id_age_and_nationality_v1",
    claims: ["age_over_18", "nationality"],
    futureExtensions: [
      "unique_person as a separate proof-of-personhood lane once World ID or equivalent coverage is explicitly wired",
      "additional predicates like sanctions exclusion or age-over-21 without storing the raw source document",
    ],
    operatorStorageGuarantees: [
      "Humanify stores only proof receipts, nullifiers, issuer references, expiry windows, and claim predicates.",
      "Humanify does not store document images, birthdates, passport numbers, or the full verifiable credential payload.",
      "The reusable Humanify ID lives with the user as a holder credential; the server verifies proofs instead of warehousing identity data.",
    ],
    summary: "Default v1 bundle: prove age and nationality, but keep the underlying document data out of Humanify storage.",
    title: "Prove age + nationality",
  },
] as const satisfies readonly HumanifyIdClaimBundle[];

const defaultHumanifyIdClaimBundle = {
  ...humanifyIdClaimBundles[2],
} as const satisfies HumanifyIdClaimBundle;

function cloneClaimBundle(bundle: HumanifyIdClaimBundle): HumanifyIdClaimBundle {
  return {
    ...bundle,
    claims: [...bundle.claims],
    futureExtensions: [...bundle.futureExtensions],
    operatorStorageGuarantees: [...bundle.operatorStorageGuarantees],
  };
}

export function getHumanifyIdClaimBundles(): HumanifyIdClaimBundle[] {
  return humanifyIdClaimBundles.map((bundle) => cloneClaimBundle(bundle));
}

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
  return cloneClaimBundle(defaultHumanifyIdClaimBundle);
}
