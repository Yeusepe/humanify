/**
 * Purpose: Initializes Bun-specific error reporting with explicit redaction defaults for Humanify runtimes.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\observability-security.md
 * - docs\operations.md
 * - docs\workspaces.md
 * External references:
 * - https://docs.sentry.io/platforms/javascript/guides/bun/
 * - https://docs.sentry.io/platforms/javascript/guides/bun/configuration/options/
 * Tests:
 * - packages/telemetry/src/index.test.ts
 */

import * as Sentry from "@sentry/bun";

import { redactSensitiveValue } from "./index";

let sentryInitialized = false;

export function initializeBunErrorReporting(input: {
  environment: string;
  release?: string;
  sentryDsn?: string;
  sentryTracesSampleRate?: number;
  serviceName: string;
}) {
  if (!input.sentryDsn || sentryInitialized) {
    return false;
  }

  Sentry.init({
    beforeSend(event) {
      return redactSensitiveValue(event) as typeof event;
    },
    dsn: input.sentryDsn,
    enableLogs: false,
    environment: input.environment,
    initialScope(scope) {
      scope.setTag("service", input.serviceName);
      return scope;
    },
    release: input.release,
    sendDefaultPii: false,
    tracesSampleRate: input.sentryTracesSampleRate ?? 0,
  });

  sentryInitialized = true;
  return true;
}

export async function flushBunErrorReporting(timeoutMs = 2_000) {
  if (!sentryInitialized) {
    return true;
  }

  return Sentry.close(timeoutMs);
}
