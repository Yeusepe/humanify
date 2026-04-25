/**
 * Purpose: Verifies the root development-stack launcher keeps the documented full-stack process plan.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * - docs\local-development.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://bun.sh/docs/api/spawn
 * - https://docs.docker.com/reference/cli/docker/compose/up/
 * Tests:
 * - tooling/dev-stack.test.ts
 */

import { expect, test } from "bun:test";

import { createDevStackPlan } from "./dev-stack";

test("dev stack includes Docker Compose orchestration metadata", () => {
  const plan = createDevStackPlan({ DISCORD_BOT_TOKEN: "test-token" });

  expect(plan.composeFile).toBe("docker-compose.local.yml");
  expect(plan.composeProjectName).toBe("humanify-local");
});

test("dev stack includes all local services and UI surfaces", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });
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

test("dev stack allows explicit botless work", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });

  expect(plan.notices).toEqual(["Skipping @humanify/bot-bun because HUMANIFY_SKIP_BOT=1."]);
});

test("dev stack fails fast when the bot is required but no token is configured", () => {
  expect(() => createDevStackPlan({})).toThrow(
    "DISCORD_BOT_TOKEN is required for the full local stack. Set HUMANIFY_SKIP_BOT=1 only if you intentionally want to run without the Discord bot.",
  );
});

test("dev stack keeps documented readiness URLs", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });
  const readinessUrls = plan.processes.map((processSpec) => processSpec.readinessUrl).filter(Boolean);

  expect(readinessUrls).toEqual([
    "http://127.0.0.1:3211/healthz",
    "http://127.0.0.1:3210/",
    "http://127.0.0.1:3212/",
    "http://127.0.0.1:4101/healthz",
    "http://127.0.0.1:4102/healthz",
    "http://127.0.0.1:4103/healthz",
    "http://127.0.0.1:4104/healthz",
  ]);
});
