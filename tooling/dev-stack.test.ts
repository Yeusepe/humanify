/**
 * Purpose: Verifies the root development-stack launcher keeps the documented process plan.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://bun.sh/docs/api/spawn
 * Tests:
 * - tooling/dev-stack.test.ts
 */

import { expect, test } from "bun:test";

import { createDevStackPlan } from "./dev-stack";

test("dev stack includes all local services and UI surfaces", () => {
  const plan = createDevStackPlan({});
  const names = plan.processes.map((processSpec) => processSpec.name);

  expect(names).toEqual([
    "@humanify/api-bun",
    "@humanify/dashboard-start",
    "@humanify/verifier-start",
    "inference-rs",
    "learning-rs",
    "evidence-rs",
    "trust-rs",
  ]);
});

test("dev stack includes the Discord bot when DISCORD_BOT_TOKEN is set", () => {
  const plan = createDevStackPlan({ DISCORD_BOT_TOKEN: "test-token" });
  const names = plan.processes.map((processSpec) => processSpec.name);

  expect(names[0]).toBe("@humanify/bot-bun");
  expect(plan.notices).toEqual([]);
});

test("dev stack warns when the Discord bot token is absent", () => {
  const plan = createDevStackPlan({});

  expect(plan.notices).toEqual(["Skipping @humanify/bot-bun because DISCORD_BOT_TOKEN is not set."]);
});
