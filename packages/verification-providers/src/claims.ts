/**
 * Purpose: Defines the Bun-owned verification claim catalog and reusable proof bundles that stay generic across capture providers, reusable-proof backends, and Humanify policy consumers.
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

export type VerificationClaimDefinition = {
  id: string;
  summary: string;
  title: string;
};

export type VerificationClaimBundle = {
  bestFor: string;
  bundleId: string;
  claims: readonly HumanifyClaimKey[];
  futureExtensions: readonly string[];
  operatorStorageGuarantees: readonly string[];
  summary: string;
  title: string;
};

const verificationClaimDefinitions = [
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
  {
    id: "document_identity",
    summary: "Normalized proof that a first-time capture flow verified a supported identity document for the session.",
    title: "Document identity",
  },
  {
    id: "liveness",
    summary: "Normalized anti-spoof or live-presence proof emitted by a capture flow without storing raw biometric data.",
    title: "Liveness",
  },
  {
    id: "unique_person",
    summary: "Proof-of-personhood / uniqueness predicate backed by replay-safe nullifiers or equivalent anti-Sybil signals.",
    title: "Unique person",
  },
] as const satisfies readonly VerificationClaimDefinition[];

export type HumanifyClaimKey = (typeof verificationClaimDefinitions)[number]["id"];

const supportedClaimIds = verificationClaimDefinitions.map((claim) => claim.id) as HumanifyClaimKey[];
const supportedClaimIdSet = new Set<string>(supportedClaimIds);

const verificationClaimBundles = [
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
] as const satisfies readonly VerificationClaimBundle[];

const defaultVerificationClaimBundle = {
  ...verificationClaimBundles[2],
} as const satisfies VerificationClaimBundle;

function cloneClaimBundle(bundle: VerificationClaimBundle): VerificationClaimBundle {
  return {
    ...bundle,
    claims: [...bundle.claims],
    futureExtensions: [...bundle.futureExtensions],
    operatorStorageGuarantees: [...bundle.operatorStorageGuarantees],
  };
}

export function getVerificationClaimBundles(): VerificationClaimBundle[] {
  return verificationClaimBundles.map((bundle) => cloneClaimBundle(bundle));
}

export function getVerificationClaimDefinitions(): VerificationClaimDefinition[] {
  return verificationClaimDefinitions.map((definition) => ({ ...definition }));
}

export function getSupportedVerificationClaimIds(): HumanifyClaimKey[] {
  return [...supportedClaimIds];
}

export function isHumanifyClaimKey(value: string): value is HumanifyClaimKey {
  return supportedClaimIdSet.has(value);
}

export function getDefaultVerificationClaimBundle(): VerificationClaimBundle {
  return cloneClaimBundle(defaultVerificationClaimBundle);
}

export type HumanifyClaimDefinition = VerificationClaimDefinition;
export type HumanifyIdClaimBundle = VerificationClaimBundle;

export const getDefaultHumanifyIdClaimBundle = getDefaultVerificationClaimBundle;
export const getHumanifyClaimDefinitions = getVerificationClaimDefinitions;
export const getHumanifyIdClaimBundles = getVerificationClaimBundles;
export const getSupportedHumanifyClaimIds = getSupportedVerificationClaimIds;
