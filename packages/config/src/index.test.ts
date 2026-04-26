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
  loadApiBindingConfig,
  loadDiscordOAuthConfig,
  loadPolicyClampConfig,
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

test("policy clamp config rejects actions outside the canonical ladder", () => {
  expect(() => loadPolicyClampConfig({ HUMANIFY_MAX_AUTOMATIC_ACTION: "delete" })).toThrow(ConfigError);
});

test("config summaries redact secrets and tokens recursively", () => {
  expect(
    summarizeConfigForLogs({
      nested: {
        sessionSecret: "secret",
      },
      serviceName: "api-bun",
      token: "abc",
    }),
  ).toEqual({
    nested: {
      sessionSecret: "[redacted]",
    },
    serviceName: "api-bun",
    token: "[redacted]",
  });
});
