/**
 * Purpose: Proves the verification strategy registry stays role-based, filterable, and safe to extend without app-level provider conditionals.
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
  createVerificationStrategyCatalog,
  defineVerificationStrategy,
  getDefaultVerificationClaimBundle,
  getVerificationClaimBundles,
  getSupportedVerificationClaimIds,
  humanifyVerificationStrategyCatalog,
  humanifyVerificationStrategyPipelineCatalog,
  parseVerificationStrategySelection,
  resolveVerificationStrategyCatalog,
  resolveVerificationStrategyConfiguration,
  verificationStrategySupportsClaims,
} from "./index";

test("strategy catalogs sort by role and expose default capture + reusable backends without app-local branching", () => {
  const catalog = resolveVerificationStrategyCatalog({
    enabledStrategyIds: ["didit", "privado", "world_id"],
  });

  expect(catalog.selectableIds()).toEqual(["didit", "privado", "world_id"]);
  expect(catalog.defaultForRole("capture_provider").id).toBe("didit");
  expect(catalog.defaultForRole("reusable_proof_backend").id).toBe("privado");
  expect(catalog.require("didit").integration.handoffKind).toBe("signed_webhook");
  expect(catalog.require("privado").role).toBe("reusable_proof_backend");
  expect(catalog.defaultForRole("policy_consumer").id).toBe("humanify");
});

test("strategy selection parsing trims, deduplicates, and ignores blanks", () => {
  expect(parseVerificationStrategySelection(" didit, privado , didit ,, world_id ")).toEqual([
    "didit",
    "privado",
    "world_id",
  ]);
  expect(parseVerificationStrategySelection("   ")).toBeUndefined();
});

test("the shared strategy template rejects unsupported claims and duplicate strategy ids", () => {
  expect(() =>
    defineVerificationStrategy({
      benefits: ["broken"],
      defaultRank: 9,
      goodFor: "broken",
      id: "broken-strategy",
      integration: {
        completionMode: "provider_verification_required",
        handoffKind: "signed_webhook",
        serverEndpointPath: "/callbacks/providers/broken-strategy",
        serverVerificationNote: "broken",
      },
      privacyDetails: "broken",
      privacySummary: "broken",
      role: "capture_provider",
      summary: "broken",
      supportedClaimKeys: ["unknown-claim" as never],
      thingsToKnow: ["broken"],
      title: "Broken",
      whatYouNeed: "broken",
    }),
  ).toThrow('unsupported Humanify claim "unknown-claim"');

  expect(() =>
    createVerificationStrategyCatalog([
      humanifyVerificationStrategyCatalog.require("didit"),
      humanifyVerificationStrategyCatalog.require("didit"),
    ]),
  ).toThrow('Duplicate id: "didit"');
});

test("default claim bundle stays age + nationality while the shared claim catalog covers capture, reusable, and uniqueness predicates", () => {
  const bundle = getDefaultVerificationClaimBundle();
  const bundles = getVerificationClaimBundles();
  const storageContract = bundle.operatorStorageGuarantees.join(" ");

  expect(getSupportedVerificationClaimIds()).toEqual([
    "age_over_18",
    "nationality",
    "document_identity",
    "liveness",
    "unique_person",
  ]);
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

test("strategy capability checks stay generic and role-based", () => {
  expect(
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("didit"), [
      "document_identity",
      "liveness",
    ]),
  ).toBe(true);
  expect(
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("privado"), ["age_over_18"]),
  ).toBe(true);
  expect(
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("world_id"), ["unique_person"]),
  ).toBe(true);
  expect(
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("world_id"), ["age_over_18"]),
  ).toBe(false);
});

test("pipeline catalogs describe first-time capture, reusable proof, and uniqueness lanes against the same policy consumer", () => {
  expect(humanifyVerificationStrategyPipelineCatalog.defaultForPathway("first_time_capture").id).toBe(
    "humanify_didit_capture_v1",
  );
  expect(humanifyVerificationStrategyPipelineCatalog.defaultForPathway("reusable_proof").id).toBe(
    "humanify_privado_reusable_v1",
  );
  expect(humanifyVerificationStrategyPipelineCatalog.defaultForPathway("proof_of_personhood").id).toBe(
    "humanify_world_id_uniqueness_v1",
  );
  expect(humanifyVerificationStrategyPipelineCatalog.withEnabledStrategyIds(["didit", "privado"]).ids()).toEqual([
    "humanify_didit_capture_v1",
    "humanify_privado_reusable_v1",
  ]);
});

test("strategy configuration resolves enabled strategies, role defaults, and enabled pipelines from the shared catalogs", () => {
  expect(
    resolveVerificationStrategyConfiguration({
      availableCatalog: resolveVerificationStrategyCatalog({ enabledStrategyIds: ["didit", "privado", "self"] }),
      defaultCaptureProviderId: "didit",
      defaultReusableProofBackendId: "privado",
      enabledStrategyIds: ["didit", "privado"],
    }),
  ).toEqual({
    availablePipelineIds: ["humanify_didit_capture_v1", "humanify_privado_reusable_v1", "humanify_self_reusable_v1"],
    availableStrategyIds: ["didit", "privado", "self"],
    defaultCaptureProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledPipelineIds: ["humanify_didit_capture_v1", "humanify_privado_reusable_v1"],
    enabledStrategyIds: ["didit", "privado"],
    policyConsumerId: "humanify",
  });

  expect(() =>
    resolveVerificationStrategyConfiguration({
      defaultCaptureProviderId: "world_id",
      enabledStrategyIds: ["didit", "self", "world_id"],
    }),
  ).toThrow('Default capture provider "world_id" must use the capture_provider role.');

  expect(() =>
    resolveVerificationStrategyConfiguration({
      enabledStrategyIds: [],
    }),
  ).toThrow("At least one verification strategy must remain enabled for the guild.");
});
