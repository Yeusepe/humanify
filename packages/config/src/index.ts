/**
 * Purpose: Validates shared Bun runtime configuration and composes role-specific config bundles for Humanify services.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\operations.md
 * - docs\verification.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/runtime/env
 * - https://bun.sh/docs/typescript
 * - https://discord.com/developers/docs/topics/oauth2
 * Tests:
 * - packages/config/src/index.test.ts
 */

import { humanifyActionLadder, type HumanifyAction, isHumanifyAction } from "@humanify/contracts";

export type EnvSource = Record<string, string | undefined>;
export type HumanifyEnvironment = "development" | "test" | "production";
export type ConfigIssue = {
  key: string;
  message: string;
};

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(`Configuration validation failed for ${issues.map((issue) => issue.key).join(", ")}.`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export type ServiceIdentityConfig = {
  environment: HumanifyEnvironment;
  release?: string;
  serviceName: string;
};

export type ApiBindingConfig = {
  host: string;
  port: number;
};

export type BotTokenConfig = {
  botToken: string;
};

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
};

export type DataPlaneConfig = {
  postgresUrl: string;
  redisUrl: string;
};

export type SessionConfig = {
  cookieName: string;
  secureCookies: boolean;
  sessionSecret: string;
  sessionTtlSeconds: number;
};

export type PolicyClampConfig = {
  maxAutomaticAction: HumanifyAction;
};

const humanifyEnvironmentValues = ["development", "test", "production"] as const;
const defaultOAuthScopes = ["identify", "guilds"] as const;
const redactedKeyPattern = /(secret|token|password|dsn|key|cookie)/i;

function readOptionalString(source: EnvSource, key: string): string | undefined {
  const value = source[key]?.trim();
  return value ? value : undefined;
}

function readRequiredString(source: EnvSource, key: string, issues: ConfigIssue[]): string {
  const value = readOptionalString(source, key);

  if (!value) {
    issues.push({ key, message: `${key} is required.` });
    return "";
  }

  return value;
}

function readInteger(
  source: EnvSource,
  key: string,
  issues: ConfigIssue[],
  fallback: number,
  minimum = 1,
): number {
  const raw = readOptionalString(source, key);

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    issues.push({ key, message: `${key} must be an integer greater than or equal to ${minimum}.` });
    return fallback;
  }

  return parsed;
}

function readBoolean(source: EnvSource, key: string, fallback: boolean): boolean {
  const raw = readOptionalString(source, key)?.toLowerCase();

  if (!raw) {
    return fallback;
  }

  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readEnum<T extends readonly string[]>(
  source: EnvSource,
  key: string,
  values: T,
  issues: ConfigIssue[],
  fallback?: T[number],
): T[number] {
  const raw = readOptionalString(source, key);

  if (!raw) {
    if (fallback) {
      return fallback;
    }

    issues.push({ key, message: `${key} must be one of: ${values.join(", ")}.` });
    return values[0];
  }

  if (!values.includes(raw as T[number])) {
    issues.push({ key, message: `${key} must be one of: ${values.join(", ")}.` });
    return fallback ?? values[0];
  }

  return raw as T[number];
}

function readUrl(source: EnvSource, key: string, issues: ConfigIssue[]): string {
  const value = readRequiredString(source, key, issues);

  if (!value) {
    return value;
  }

  try {
    return new URL(value).toString();
  } catch {
    issues.push({ key, message: `${key} must be a valid absolute URL.` });
    return value;
  }
}

function finalizeIssues<T>(issues: ConfigIssue[], value: T): T {
  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return value;
}

export function loadServiceIdentityConfig(
  source: EnvSource = process.env,
  defaults: Partial<Pick<ServiceIdentityConfig, "environment" | "serviceName">> = {},
): ServiceIdentityConfig {
  const issues: ConfigIssue[] = [];

  const serviceName = readOptionalString(source, "HUMANIFY_SERVICE_NAME") ?? defaults.serviceName ?? "humanify";
  const environment = readEnum(
    source,
    "HUMANIFY_ENVIRONMENT",
    humanifyEnvironmentValues,
    issues,
    defaults.environment ?? "development",
  );
  const release = readOptionalString(source, "HUMANIFY_RELEASE");

  return finalizeIssues(issues, { environment, release, serviceName });
}

export function loadApiBindingConfig(source: EnvSource = process.env): ApiBindingConfig {
  const issues: ConfigIssue[] = [];
  const host = readOptionalString(source, "HUMANIFY_API_HOST") ?? "0.0.0.0";
  const port = readInteger(source, "HUMANIFY_API_PORT", issues, 3211, 1);

  return finalizeIssues(issues, { host, port });
}

export function loadBotTokenConfig(source: EnvSource = process.env): BotTokenConfig {
  const issues: ConfigIssue[] = [];
  const botToken = readRequiredString(source, "DISCORD_BOT_TOKEN", issues);

  return finalizeIssues(issues, { botToken });
}

export function loadDiscordOAuthConfig(source: EnvSource = process.env): DiscordOAuthConfig {
  const issues: ConfigIssue[] = [];
  const clientId = readRequiredString(source, "DISCORD_CLIENT_ID", issues);
  const clientSecret = readRequiredString(source, "DISCORD_CLIENT_SECRET", issues);
  const redirectUri = readUrl(source, "DISCORD_REDIRECT_URI", issues);
  const scopes = (
    readOptionalString(source, "DISCORD_OAUTH_SCOPES")
      ?.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean) ?? [...defaultOAuthScopes]
  );

  return finalizeIssues(issues, { clientId, clientSecret, redirectUri, scopes });
}

export function loadDataPlaneConfig(source: EnvSource = process.env): DataPlaneConfig {
  const issues: ConfigIssue[] = [];
  const postgresUrl = readUrl(source, "HUMANIFY_POSTGRES_URL", issues);
  const redisUrl = readUrl(source, "HUMANIFY_REDIS_URL", issues);

  return finalizeIssues(issues, { postgresUrl, redisUrl });
}

export function loadSessionConfig(source: EnvSource = process.env): SessionConfig {
  const issues: ConfigIssue[] = [];
  const cookieName = readOptionalString(source, "HUMANIFY_SESSION_COOKIE_NAME") ?? "humanify_session";
  const sessionSecret = readRequiredString(source, "HUMANIFY_SESSION_SECRET", issues);
  const sessionTtlSeconds = readInteger(source, "HUMANIFY_SESSION_TTL_SECONDS", issues, 43_200, 60);
  const secureCookies = readBoolean(source, "HUMANIFY_SECURE_COOKIES", true);

  return finalizeIssues(issues, { cookieName, secureCookies, sessionSecret, sessionTtlSeconds });
}

export function loadPolicyClampConfig(source: EnvSource = process.env): PolicyClampConfig {
  const issues: ConfigIssue[] = [];
  const rawValue = readOptionalString(source, "HUMANIFY_MAX_AUTOMATIC_ACTION") ?? "quarantine";

  if (!isHumanifyAction(rawValue)) {
    issues.push({
      key: "HUMANIFY_MAX_AUTOMATIC_ACTION",
      message: `HUMANIFY_MAX_AUTOMATIC_ACTION must be one of: ${humanifyActionLadder.join(", ")}.`,
    });
  }

  return finalizeIssues(issues, {
    maxAutomaticAction: isHumanifyAction(rawValue) ? rawValue : "quarantine",
  });
}

export function summarizeConfigForLogs<T extends Record<string, unknown>>(config: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return [key, summarizeConfigForLogs(value as Record<string, unknown>)];
      }

      if (redactedKeyPattern.test(key)) {
        return [key, "[redacted]"];
      }

      return [key, value];
    }),
  );
}
