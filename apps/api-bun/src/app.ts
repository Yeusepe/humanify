/**
 * Purpose: Defines the Elysia application shell for Bun-side HTTP health and contract introspection routes.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://elysiajs.com/at-glance
 * - https://bun.sh/docs/api/http
 * - https://bun.sh/docs/runtime/env
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { Elysia } from "elysia";

import { getHumanifyContractSummary, humanifyContractVersion } from "@humanify/contracts";

export function createApiApp() {
  return new Elysia({ name: "@humanify/api-bun" })
    .get("/", () => ({
      contractVersion: humanifyContractVersion,
      docs: ["docs\\contracts.md", "docs\\observability-security.md"],
      service: "api-bun",
      status: "ok",
    }))
    .get("/health", () => ({
      contractVersion: humanifyContractVersion,
      status: "ok",
    }))
    .get("/contracts/summary", () => getHumanifyContractSummary());
}

export type HumanifyApiApp = ReturnType<typeof createApiApp>;
