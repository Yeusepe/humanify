/**
 * Purpose: Proves the verification-provider registry stays generic, filterable, and safe to extend without app-level provider conditionals.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\verification.md
 * - docs\api.md
 * Tests:
 * - packages/verification-providers/src/index.test.ts
 */

import { expect, test } from "bun:test";

import {
  createVerificationProviderCatalog,
  defineVerificationProvider,
  getDefaultHumanifyIdClaimBundle,
  getHumanifyIdClaimBundles,
  getSupportedHumanifyClaimIds,
  humanifyVerificationProviderCatalog,
  parseVerificationProviderSelection,
  resolveVerificationProviderConfiguration,
  resolveVerificationProviderCatalog,
  verificationProviderSupportsClaims,
} from "./index";

test("provider catalogs sort by rank and can be filtered without touching app code", () => {
  const catalog = resolveVerificationProviderCatalog({
    enabledProviderIds: ["didit", "self"],
  });

  expect(catalog.ids()).toEqual(["self", "didit"]);
  expect(catalog.defaultProvider().id).toBe("self");
  expect(catalog.require("didit").integration.handoffKind).toBe("signed_webhook");
});

test("provider selection parsing trims, deduplicates, and ignores blanks", () => {
  expect(parseVerificationProviderSelection(" didit, self , didit ,, world_id ")).toEqual([
    "didit",
    "self",
    "world_id",
  ]);
  expect(parseVerificationProviderSelection("   ")).toBeUndefined();
});

test("the shared provider template rejects unsupported claims and duplicate provider ids", () => {
  expect(() =>
    defineVerificationProvider({
      benefits: ["broken"],
      defaultRank: 9,
      goodFor: "broken",
      id: "broken-provider",
      integration: {
        completionMode: "provider_verification_required",
        handoffKind: "signed_webhook",
        serverEndpointPath: "/callbacks/providers/broken-provider",
        serverVerificationNote: "broken",
      },
      privacyDetails: "broken",
      privacySummary: "broken",
      summary: "broken",
      supportedClaimKeys: ["unknown-claim" as never],
      thingsToKnow: ["broken"],
      title: "Broken",
      whatYouNeed: "broken",
    }),
  ).toThrow('unsupported Humanify claim "unknown-claim"');

  expect(() =>
    createVerificationProviderCatalog([
      humanifyVerificationProviderCatalog.require("self"),
      humanifyVerificationProviderCatalog.require("self"),
    ]),
  ).toThrow('Duplicate id: "self"');
});

test("default Humanify ID bundle stays age + nationality and stores proof receipts instead of raw identity data", () => {
  const bundle = getDefaultHumanifyIdClaimBundle();
  const bundles = getHumanifyIdClaimBundles();
  const storageContract = bundle.operatorStorageGuarantees.join(" ");

  expect(getSupportedHumanifyClaimIds()).toEqual(["age_over_18", "nationality"]);
  expect(bundles.map((entry) => entry.bundleId)).toEqual([
    "humanify_id_age_over_18_v1",
    "humanify_id_nationality_v1",
    "humanify_id_age_and_nationality_v1",
  ]);
  expect(bundle.claims).toEqual(["age_over_18", "nationality"]);
  expect(storageContract).toContain("nullifiers");
  expect(storageContract).toContain("does not store document images");
  expect(storageContract).toContain("birthdates");
});

test("provider capability checks stay generic and claim-based", () => {
  expect(
    verificationProviderSupportsClaims(humanifyVerificationProviderCatalog.require("self"), ["age_over_18", "nationality"]),
  ).toBe(true);
  expect(
    verificationProviderSupportsClaims(humanifyVerificationProviderCatalog.require("didit"), ["age_over_18"]),
  ).toBe(true);
});

test("server-owner provider configuration resolves enabled and default providers from the shared catalog", () => {
  expect(
    resolveVerificationProviderConfiguration({
      availableCatalog: resolveVerificationProviderCatalog({ enabledProviderIds: ["self", "didit"] }),
      defaultProviderId: "didit",
      enabledProviderIds: ["didit"],
    }),
  ).toEqual({
    availableProviderIds: ["self", "didit"],
    defaultProviderId: "didit",
    enabledProviderIds: ["didit"],
  });

  expect(() =>
    resolveVerificationProviderConfiguration({
      defaultProviderId: "world_id",
      enabledProviderIds: ["self"],
    }),
  ).toThrow('Default verification provider "world_id" must be enabled for the guild.');

  expect(() =>
    resolveVerificationProviderConfiguration({
      enabledProviderIds: [],
    }),
  ).toThrow("At least one verification provider must remain enabled for the guild.");
});
