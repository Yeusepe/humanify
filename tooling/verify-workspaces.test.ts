/**
 * Purpose: Covers the root workspace bootstrap contract so later scaffolding can extend it safely.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://bun.sh/docs/install/workspaces
 * Tests:
 * - tooling/verify-workspaces.test.ts
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyWorkspaces } from "./verify-workspaces";

test("workspace bootstrap remains internally consistent", () => {
  const result = verifyWorkspaces(process.cwd());

  expect(result.errors).toEqual([]);
});

test("cargo root remains a workspace manifest", () => {
  const cargoToml = readFileSync(join(process.cwd(), "Cargo.toml"), "utf8");

  expect(cargoToml).toContain("[workspace]");
});

test("root workspace scripts delegate Bun-side checks to workspaces", () => {
  const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");

  expect(packageJson).toContain('"build": "bun run --sequential --filter \'*\' build"');
  expect(packageJson).toContain('"db:migrate": "bun run --filter @humanify/db migrate"');
  expect(packageJson).toContain('"dev": "bun run tooling/dev-stack.ts"');
  expect(packageJson).toContain(
    '"check": "bun run check:workspace && bun run check:rust && bun run typecheck && bun test"',
  );
});
