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
  loadDiscordOAuthConfig,
  loadObservabilityConfig,
  loadPolicyClampConfig,
  loadPrivadoVerifierConfig,
  loadSessionConfig,
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
