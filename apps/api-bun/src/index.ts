/**
 * Purpose: Starts the Bun + Elysia API shell when this workspace is run directly.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://elysiajs.com/at-glance
 * - https://bun.sh/docs/runtime/env
 * - https://bun.sh/docs/typescript
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { createApiApp } from "./app";

export const defaultApiPort = 3001;

export function resolveApiPort(portValue = process.env.HUMANIFY_API_PORT) {
  const parsed = Number(portValue ?? defaultApiPort);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultApiPort;
}

export function startApi(port = resolveApiPort()) {
  return createApiApp().listen(port);
}

if (import.meta.main) {
  const server = startApi();

  console.log(`@humanify/api-bun listening on http://localhost:${server.server?.port ?? resolveApiPort()}`);
}
