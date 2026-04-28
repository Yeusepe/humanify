/**
 * Purpose: Verifies the shared config package enforces Humanify startup validation and safe config summaries.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\operations.md
 * - docs\verification.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://bun.sh/docs/runtime/env
 * - https://discord.com/developers/docs/topics/oauth2
 * Tests:
 * - packages/config/src/index.test.ts
 */

import { expect, test } from "bun:test";

import {
  ConfigError,
  loadAdvisoryServiceConfig,
  loadApiBindingConfig,
  loadBotApiConfig,
  loadDiditConfig,
  loadOptionalDiscordVerificationAuthConfig,
  loadDiscordVerificationAuthConfig,
  loadDiscordOAuthConfig,
  loadObservabilityConfig,
  loadPolicyClampConfig,
  loadPrivadoVerifierConfig,
  loadSessionConfig,
  loadTemporalWorkerConfig,
  summarizeConfigForLogs,
} from "./index";

test("api binding config uses documented defaults", () => {
  expect(loadApiBindingConfig({})).toEqual({
    host: "0.0.0.0",
    port: 3211,
  });
});

test("discord oauth config requires a full server-side callback bundle", () => {
  expect(() =>
    loadDiscordOAuthConfig({
      DISCORD_CLIENT_ID: "client",
      DISCORD_REDIRECT_URI: "https://humanify.test/callback",
    }),
  ).toThrow(ConfigError);
});

test("discord verification auth config derives Better Auth base URLs and safer verification scopes", () => {
  expect(
    loadDiscordVerificationAuthConfig({
      DISCORD_CLIENT_ID: "client",
      DISCORD_CLIENT_SECRET: "secret",
      HUMANIFY_API_PORT: "4211",
      HUMANIFY_SESSION_SECRET: "session-secret",
      HUMANIFY_VERIFIER_BASE_URL: "https://verifier.humanify.test/",
    }),
  ).toEqual({
    apiBaseUrl: "http://127.0.0.1:4211",
    authBasePath: "/auth/better",
    betterAuthSecret: "session-secret",
    clientId: "client",
    clientSecret: "secret",
    scopes: ["identify", "email", "connections"],
    verifierBaseUrl: "https://verifier.humanify.test",
  });
});

test("discord verification auth config stays disabled when the verifier app base URL is not configured", () => {
  expect(
    loadOptionalDiscordVerificationAuthConfig({
      DISCORD_CLIENT_ID: "client",
      DISCORD_CLIENT_SECRET: "secret",
      HUMANIFY_SESSION_SECRET: "session-secret",
    }),
  ).toBeUndefined();

  expect(
    loadOptionalDiscordVerificationAuthConfig({
      HUMANIFY_VERIFIER_BASE_URL: "https://verifier.humanify.test",
    }),
  ).toBeUndefined();
});

test("didit config validates the minimum API, webhook, workflow, and verifier return URL bundle", () => {
  expect(
    loadDiditConfig({
      HUMANIFY_DIDIT_API_KEY: "didit_api_key",
      HUMANIFY_DIDIT_WEBHOOK_SECRET: "didit_webhook_secret",
      HUMANIFY_DIDIT_WORKFLOW_ID: "11111111-2222-3333-4444-555555555555",
      HUMANIFY_VERIFIER_BASE_URL: "https://verifier.humanify.test/",
    }),
  ).toEqual({
    apiKey: "didit_api_key",
    verificationApiBaseUrl: "https://verification.didit.me",
    verifierBaseUrl: "https://verifier.humanify.test",
    webhookSecret: "didit_webhook_secret",
    workflowId: "11111111-2222-3333-4444-555555555555",
  });

  expect(() =>
    loadDiditConfig({
      HUMANIFY_DIDIT_API_KEY: "didit_api_key",
      HUMANIFY_VERIFIER_BASE_URL: "https://verifier.humanify.test",
    }),
  ).toThrow(ConfigError);

  expect(
    loadDiditConfig({
      HUMANIFY_DIDIT_API_BASE_URL: "https://verification.didit.me",
      HUMANIFY_VERIFIER_BASE_URL: "http://127.0.0.1:3212",
    }),
  ).toBeUndefined();
});

test("session config validates secrets and safe cookie defaults", () => {
  expect(
    loadSessionConfig({
      HUMANIFY_SESSION_SECRET: "super-secret",
      HUMANIFY_SECURE_COOKIES: "false",
    }),
  ).toEqual({
    cookieName: "humanify_session",
    secureCookies: false,
    sessionSecret: "super-secret",
    sessionTtlSeconds: 43200,
  });
});

test("bot api config falls back to the local api port and can opt into guild-scoped command sync", () => {
  expect(
    loadBotApiConfig({
      HUMANIFY_API_PORT: "4321",
      HUMANIFY_BOT_COMMAND_GUILD_ID: "guild_123",
      HUMANIFY_BOT_ENABLE_MEMBER_JOIN_SIGNALS: "true",
      HUMANIFY_BOT_ENABLE_MESSAGE_SIGNALS: "true",
      HUMANIFY_BOT_REGISTER_COMMANDS: "true",
    }),
  ).toEqual({
    apiBaseUrl: "http://127.0.0.1:4321",
    commandGuildId: "guild_123",
    enableMemberJoinSignals: true,
    enableMessageSignals: true,
    registerCommandsOnStart: true,
  });
});

test("policy clamp config rejects actions outside the canonical ladder", () => {
  expect(() => loadPolicyClampConfig({ HUMANIFY_MAX_AUTOMATIC_ACTION: "delete" })).toThrow(ConfigError);
});

test("observability config validates optional Sentry inputs safely", () => {
  expect(
    loadObservabilityConfig({
      HUMANIFY_SENTRY_DSN: "https://public@example.ingest.sentry.io/123",
      HUMANIFY_SENTRY_TRACES_SAMPLE_RATE: "0.25",
    }),
  ).toEqual({
    sentryDsn: "https://public@example.ingest.sentry.io/123",
    sentryTracesSampleRate: 0.25,
  });

  expect(() =>
    loadObservabilityConfig({
      HUMANIFY_SENTRY_DSN: "not-a-dsn",
    }),
  ).toThrow(ConfigError);
});

test("advisory service config defaults learning-rs to the documented loopback endpoint", () => {
  expect(loadAdvisoryServiceConfig({})).toEqual({
    learningServiceUrl: "http://127.0.0.1:4102",
  });

  expect(() =>
    loadAdvisoryServiceConfig({
      HUMANIFY_LEARNING_SERVICE_URL: "not-a-url",
    }),
  ).toThrow(ConfigError);
});

test("temporal worker config defaults to the documented local task queue and validates overrides", () => {
  expect(loadTemporalWorkerConfig({})).toEqual({
    address: "127.0.0.1:7233",
    healthPort: 4210,
    namespace: "default",
    pollIntervalMs: 3000,
    scanTaskQueue: "humanify-member-scan",
  });

  expect(
    loadTemporalWorkerConfig({
      HUMANIFY_SCAN_WORKER_POLL_INTERVAL_MS: "5000",
      HUMANIFY_SCAN_WORKER_PORT: "4310",
      HUMANIFY_TEMPORAL_ADDRESS: "temporal.internal:8233",
      HUMANIFY_TEMPORAL_NAMESPACE: "humanify-dev",
      HUMANIFY_TEMPORAL_SCAN_TASK_QUEUE: "scan-tasks-dev",
    }),
  ).toEqual({
    address: "temporal.internal:8233",
    healthPort: 4310,
    namespace: "humanify-dev",
    pollIntervalMs: 5000,
    scanTaskQueue: "scan-tasks-dev",
  });

  expect(() =>
    loadTemporalWorkerConfig({
      HUMANIFY_TEMPORAL_ADDRESS: "temporal-without-port",
    })
  ).toThrow(ConfigError);
});

test("Privado verifier config stays disabled by default and validates trusted issuers when enabled", () => {
  expect(loadPrivadoVerifierConfig({})).toEqual({
    chainId: "80002",
    enabled: false,
    trustedIssuers: [],
  });

  expect(
    loadPrivadoVerifierConfig({
      HUMANIFY_PRIVADO_ALLOWED_ISSUERS: "did:issuer:one,did:issuer:two",
      HUMANIFY_PRIVADO_CHAIN_ID: "137",
      HUMANIFY_PRIVADO_VERIFIER_BASE_URL: "https://verifier-backend.privado.id/",
    }),
  ).toEqual({
    chainId: "137",
    enabled: true,
    trustedIssuers: ["did:issuer:one", "did:issuer:two"],
    verifierBaseUrl: "https://verifier-backend.privado.id",
  });

  expect(() =>
    loadPrivadoVerifierConfig({
      HUMANIFY_PRIVADO_ALLOWED_ISSUERS: "*",
      HUMANIFY_PRIVADO_VERIFIER_BASE_URL: "https://verifier-backend.privado.id",
    }),
  ).toThrow(ConfigError);
});

test("config summaries redact secrets and tokens recursively", () => {
  expect(
    summarizeConfigForLogs({
      observability: {
        sentryDsn: "https://public@example.ingest.sentry.io/123",
      },
      nested: {
        sessionSecret: "secret",
      },
      serviceName: "api-bun",
      token: "abc",
    }),
  ).toEqual({
    observability: {
      sentryDsn: "[redacted]",
    },
    nested: {
      sessionSecret: "[redacted]",
    },
    serviceName: "api-bun",
    token: "[redacted]",
  });
});
