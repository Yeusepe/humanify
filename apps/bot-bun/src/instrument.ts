/**
 * Purpose: Preloads Bun-side error reporting for the Discord bot runtime before the client or API transport is initialized.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\observability-security.md
 * - docs\operations.md
 * - docs\workspaces.md
 * External references:
 * - https://docs.sentry.io/platforms/javascript/guides/bun/
 * - https://bun.sh/docs/runtime
 * Tests:
 * - apps/bot-bun/src/index.test.ts
 */

import { loadObservabilityConfig, loadServiceIdentityConfig } from "@humanify/config";
import { flushBunErrorReporting, initializeBunErrorReporting } from "@humanify/telemetry/bun";

const identity = loadServiceIdentityConfig(process.env, { serviceName: "@humanify/bot-bun" });
const observability = loadObservabilityConfig(process.env);

initializeBunErrorReporting({
  ...identity,
  sentryDsn: observability.sentryDsn,
  sentryTracesSampleRate: observability.sentryTracesSampleRate,
});

process.on("beforeExit", () => {
  void flushBunErrorReporting();
});
