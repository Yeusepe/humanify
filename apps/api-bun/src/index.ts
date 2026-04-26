/**
 * Purpose: Starts the Bun + Elysia API shell when this workspace is run directly.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
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
import { loadApiBindingConfig, loadServiceIdentityConfig, type EnvSource } from "@humanify/config";
import { createTelemetryBootstrap } from "@humanify/telemetry";

export const defaultApiPort = 3211;

export function resolveApiPort(source: EnvSource = process.env) {
  return loadApiBindingConfig(source).port;
}

export function getApiRuntimeSummary(source: EnvSource = process.env) {
  const identity = loadServiceIdentityConfig(source, { serviceName: "api-bun" });

  return {
    binding: loadApiBindingConfig(source),
    identity,
    telemetry: createTelemetryBootstrap(identity),
  };
}

export function startApi(port = resolveApiPort()) {
  return createApiApp().listen(port);
}

if (import.meta.main) {
  const runtime = getApiRuntimeSummary();
  const server = startApi(runtime.binding.port);

  console.log(
    `@humanify/api-bun listening on http://localhost:${server.server?.port ?? runtime.binding.port} (${runtime.telemetry.propagationHeader}).`,
  );
}
