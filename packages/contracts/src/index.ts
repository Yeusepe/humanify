/**
 * Purpose: Re-exports the canonical Humanify Bun↔Rust JSON Schema and derived metadata for Bun workspaces.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\workspaces.md
 * External references:
 * - https://json-schema.org/draft/2020-12
 * - https://www.rfc-editor.org/rfc/rfc8259.txt
 * - https://semver.org/spec/v2.0.0.html
 * Tests:
 * - packages/contracts/src/index.test.ts
 */

import schema from "../../../docs/contracts/humanify-contracts.schema.json";

export const humanifyContractVersion = "0.1.0" as const;
export const humanifyContractsSchema = schema;
export const humanifyContractSchemaId = humanifyContractsSchema.$id;
export const humanifyContractSchemaPath = "docs\\contracts\\humanify-contracts.schema.json" as const;
export const humanifyContractDocumentPath = "docs\\contracts.md" as const;

export const humanifyActionLadder = ["none", "watch", "verify", "quarantine", "timeout", "kick", "ban"] as const;
export type HumanifyAction = (typeof humanifyActionLadder)[number];

export const humanifyInferenceEventKinds = [
  "join",
  "message",
  "report",
  "verification_update",
  "manual_review",
] as const;
export type HumanifyInferenceEventKind = (typeof humanifyInferenceEventKinds)[number];

export function isHumanifyAction(value: string): value is HumanifyAction {
  return (humanifyActionLadder as readonly string[]).includes(value);
}

export function getHumanifyContractSummary() {
  return {
    actions: humanifyActionLadder,
    contractVersion: humanifyContractVersion,
    documentPath: humanifyContractDocumentPath,
    inferenceEventKinds: humanifyInferenceEventKinds,
    schemaId: humanifyContractSchemaId,
    schemaPath: humanifyContractSchemaPath,
  };
}
