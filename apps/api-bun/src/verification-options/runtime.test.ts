/**
 * Purpose: Verifies optional verification-provider runtime config does not accidentally enable Didit from base URLs alone.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\verification.md
 * - docs\local-development.md
 * External references:
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.didit.me/integration/webhooks
 * Tests:
 * - apps\api-bun\src\verification-options\runtime.test.ts
 */

import { expect, test } from "bun:test";

import { createApiVerificationOptionEnvironment } from "./runtime";

test("verification runtime keeps Didit disabled when only default callback and API URLs are configured", () => {
  const runtimeEnvironment = createApiVerificationOptionEnvironment({
    env: {
      HUMANIFY_DIDIT_API_BASE_URL: "https://verification.didit.me",
      HUMANIFY_VERIFIER_BASE_URL: "http://127.0.0.1:3212",
    },
  });

  expect(runtimeEnvironment.diditClient).toBeUndefined();
  expect(runtimeEnvironment.diditConfig).toBeUndefined();
});
