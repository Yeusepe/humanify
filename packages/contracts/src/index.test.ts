/**
 * Purpose: Verifies the shared contracts package stays anchored to the canonical JSON Schema and documented contract version.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://json-schema.org/draft/2020-12
 * - https://semver.org/spec/v2.0.0.html
 * Tests:
 * - packages/contracts/src/index.test.ts
 */

import { expect, test } from "bun:test";
import schema from "../../../docs/contracts/humanify-contracts.schema.json" with { type: "json" };

import {
  getHumanifyContractSummary,
  humanifyActionLadder,
  humanifyContractVersion,
  humanifyInferenceEventKinds,
  isHumanifyAction,
} from "./index";

test("contract summary stays aligned with the documented baseline", () => {
  const summary = getHumanifyContractSummary();

  expect(summary.contractVersion).toBe(humanifyContractVersion);
  expect(summary.actions).toEqual(humanifyActionLadder);
  expect(summary.inferenceEventKinds).toEqual(humanifyInferenceEventKinds);
  expect(summary.schemaPath).toBe("docs\\contracts\\humanify-contracts.schema.json");
});

test("typed contract constants stay aligned with the canonical JSON schema", () => {
  const documentedActions = [...schema.$defs.Action.enum];
  const documentedEventKinds = [...schema.$defs.InferenceEvent.properties.kind.enum];

  expect([...humanifyActionLadder] as string[]).toEqual([...getHumanifyContractSummary().actions]);
  expect([...humanifyActionLadder] as string[]).toEqual(documentedActions);
  expect([...humanifyInferenceEventKinds] as string[]).toEqual(documentedEventKinds);
  expect(isHumanifyAction("quarantine")).toBe(true);
  expect(isHumanifyAction("delete")).toBe(false);
});

test("the contracts package can be imported by the Node-based scan worker runtime", () => {
  const result = Bun.spawnSync([
    "node",
    "--input-type=module",
    "--experimental-strip-types",
    "-e",
    "const mod = await import('./packages/contracts/src/index.ts'); console.log(mod.humanifyContractSchemaPath);",
  ], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.stdout).toString("utf8").trim()).toBe("docs\\contracts\\humanify-contracts.schema.json");
});
