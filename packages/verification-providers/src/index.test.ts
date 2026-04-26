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
  getVerificationClaimDefinitions,
  getVerificationClaimBundles,
  getSupportedVerificationClaimIds,
  humanifyVerificationOptionCatalog,
  humanifyVerificationStrategyCatalog,
  humanifyVerificationStrategyPipelineCatalog,
  parseVerificationOptionSelection,
  parseVerificationStrategySelection,
  registeredVerificationCaptureFlowStrategies,
  registeredVerificationPolicyConsumerStrategies,
  registeredVerificationReusableProofBackendStrategies,
  resolveVerificationProviderConfiguration,
  resolveVerificationOptionConfiguration,
  resolveVerificationStrategyCatalog,
  resolveVerificationStrategyConfiguration,
  verificationOptionSupportsClaims,
  verificationStrategySupportsFaceVerificationRequirement,
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
  expect(parseVerificationOptionSelection(" didit, privado , didit ,, world_id ")).toEqual([
    "didit",
    "privado",
    "world_id",
  ]);
});

test("role-split manifests keep capture flows, reusable backends, and policy consumers separate", () => {
  expect(registeredVerificationCaptureFlowStrategies.map((strategy) => strategy.id)).toEqual(["didit"]);
  expect(registeredVerificationReusableProofBackendStrategies.map((strategy) => strategy.id)).toEqual([
    "privado",
    "self",
    "world_id",
  ]);
  expect(registeredVerificationPolicyConsumerStrategies.map((strategy) => strategy.id)).toEqual(["humanify"]);
});

test("the shared strategy template rejects unsupported claims and duplicate strategy ids", () => {
  expect(() =>
    defineVerificationStrategy({
      benefits: ["broken"],
      capabilities: {
        claimDelivery: [
          {
            claimKey: "unknown-claim" as never,
            deliveryKind: "capture_attestation",
          },
        ],
        faceVerification: {
          satisfiesFaceVerificationPolicy: false,
          summary: "broken",
          supportLevel: "not_automatic",
        },
        reusableIdentity: {
          contractRole: "none",
          disclosedAttributeKeys: [],
          proofOnlyClaimKeys: [],
          summary: "broken",
        },
      },
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

test("claim catalog keeps plain-language proof-only metadata while default bundles stay minimal", () => {
  const bundle = getDefaultVerificationClaimBundle();
  const bundles = getVerificationClaimBundles();
  const definitions = getVerificationClaimDefinitions();
  const storageContract = bundle.operatorStorageGuarantees.join(" ");
  const ageOver21 = definitions.find((definition) => definition.id === "age_over_21");
  const faceVerification = definitions.find((definition) => definition.id === "face_verification");
  const genderMarkerFemale = definitions.find((definition) => definition.id === "gender_marker_female");

  expect(getSupportedVerificationClaimIds()).toEqual([
    "age_over_18",
    "age_over_21",
    "nationality",
    "document_identity",
    "liveness",
    "face_verification",
    "unique_person",
    "gender_marker_female",
    "gender_marker_male",
    "gender_marker_x",
  ]);
  expect(ageOver21).toMatchObject({
    category: "age",
    disclosureMode: "proof_only",
    sourceAttributes: ["date_of_birth"],
  });
  expect(faceVerification).toMatchObject({
    category: "biometric",
    disclosureMode: "proof_only",
    sourceAttributes: ["face_check"],
  });
  expect(genderMarkerFemale).toMatchObject({
    category: "gender",
    disclosureMode: "proof_only",
    sourceAttributes: ["gender_marker"],
  });
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
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("didit"), [
      "age_over_21",
      "face_verification",
    ]),
  ).toBe(true);
  expect(
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("world_id"), ["unique_person"]),
  ).toBe(true);
  expect(
    verificationStrategySupportsClaims(humanifyVerificationStrategyCatalog.require("world_id"), ["age_over_18"]),
  ).toBe(false);
  expect(
    verificationOptionSupportsClaims(humanifyVerificationOptionCatalog.require("privado"), ["age_over_18"]),
  ).toBe(true);
});

test("provider capability metadata stays honest about face verification and reusable identity handoff roles", () => {
  const didit = humanifyVerificationStrategyCatalog.require("didit");
  const privado = humanifyVerificationStrategyCatalog.require("privado");
  const worldId = humanifyVerificationStrategyCatalog.require("world_id");

  expect(verificationStrategySupportsFaceVerificationRequirement(didit)).toBe(true);
  expect(verificationStrategySupportsFaceVerificationRequirement(worldId)).toBe(true);
  expect(verificationStrategySupportsFaceVerificationRequirement(privado)).toBe(false);
  expect(didit.capabilities.reusableIdentity).toMatchObject({
    contractRole: "seed",
    disclosedAttributeKeys: ["nationality"],
    proofOnlyClaimKeys: ["age_over_18", "age_over_21", "gender_marker_female", "gender_marker_male", "gender_marker_x"],
  });
  expect(privado.capabilities.reusableIdentity).toMatchObject({
    contractRole: "consume",
    disclosedAttributeKeys: ["nationality"],
    proofOnlyClaimKeys: ["age_over_18", "age_over_21", "gender_marker_female", "gender_marker_male", "gender_marker_x"],
  });
  expect(worldId.capabilities.faceVerification).toMatchObject({
    satisfiesFaceVerificationPolicy: true,
    supportLevel: "proof_of_personhood",
  });
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

test("option configuration stays aligned with the strategy catalog without treating capture flows as reusable backends", () => {
  expect(
    resolveVerificationOptionConfiguration({
      enabledOptionIds: ["didit", "privado"],
    }),
  ).toEqual({
    availableOptionIds: ["didit", "privado", "self", "world_id"],
    availablePipelineIds: [
      "humanify_didit_capture_v1",
      "humanify_privado_reusable_v1",
      "humanify_self_reusable_v1",
      "humanify_world_id_uniqueness_v1",
    ],
    defaultOptionId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledOptionIds: ["didit", "privado"],
    enabledPipelineIds: ["humanify_didit_capture_v1", "humanify_privado_reusable_v1"],
    policyConsumerId: "humanify",
  });

  expect(
    resolveVerificationOptionConfiguration({
      defaultReusableProofBackendId: "world_id",
      enabledOptionIds: ["didit", "privado", "world_id"],
    }).defaultReusableProofBackendId,
  ).toBe("world_id");

  expect(
    resolveVerificationProviderConfiguration({
      defaultProviderId: "didit",
      defaultReusableProofBackendId: "privado",
      enabledProviderIds: ["didit", "privado"],
    }),
  ).toMatchObject({
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
  });
});
