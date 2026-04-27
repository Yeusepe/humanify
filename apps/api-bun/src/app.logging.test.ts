/**
 * Purpose: Verifies API request logging never throws when the underlying request URL is missing or malformed.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\observability-security.md
 * - docs\fleet-bugfix-playbook.md
 * External references:
 * - https://elysiajs.com/
 * - https://developer.mozilla.org/docs/Web/API/URL/URL
 * Tests:
 * - apps\api-bun\src\app.logging.test.ts
 */

import { expect, test } from "bun:test";

import { resolveRequestPathForLogging } from "./app";

test("request logging falls back safely when the runtime hands the API an empty request URL", () => {
  expect(resolveRequestPathForLogging("")).toBe("[invalid request url]");
});

test("request logging keeps the pathname when the runtime provides a valid absolute URL", () => {
  expect(resolveRequestPathForLogging("http://127.0.0.1:3211/healthz?ready=1")).toBe("/healthz");
});
