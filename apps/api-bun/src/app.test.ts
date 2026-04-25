/**
 * Purpose: Verifies the Elysia Bun API scaffold exposes the expected health and contract summary routes.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://elysiajs.com/at-glance
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { expect, test } from "bun:test";

import { humanifyContractVersion } from "@humanify/contracts";

import { createApiApp } from "./app";

test("health route reports Bun-side API status", async () => {
  const app = createApiApp();
  const response = await app.handle(new Request("http://humanify.local/health"));
  const json = (await response.json()) as {
    contractVersion: string;
    status: string;
  };

  expect(response.status).toBe(200);
  expect(json).toEqual({
    contractVersion: humanifyContractVersion,
    status: "ok",
  });
});

test("contracts summary route exposes the shared schema metadata", async () => {
  const app = createApiApp();
  const response = await app.handle(new Request("http://humanify.local/contracts/summary"));
  const json = (await response.json()) as {
    contractVersion: string;
    schemaPath: string;
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.schemaPath).toBe("docs\\contracts\\humanify-contracts.schema.json");
});
