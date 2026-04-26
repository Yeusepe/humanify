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

export type BotApiConfig = {
  apiBaseUrl: string;
  commandGuildId?: string;
  enableMemberJoinSignals: boolean;
  enableMessageSignals: boolean;
  registerCommandsOnStart: boolean;
};

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
};

export type DiditConfig = {
  apiKey: string;
  verificationApiBaseUrl: string;
  verifierBaseUrl: string;
  webhookSecret: string;
  workflowId: string;
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

export type ObservabilityConfig = {
  sentryDsn?: string;
  sentryTracesSampleRate: number;
};

export type AdvisoryServiceConfig = {
  learningServiceUrl: string;
};

export type PrivadoVerifierConfig = {
  chainId: string;
  enabled: boolean;
  verifierBaseUrl?: string;
  trustedIssuers: string[];
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

function readNumberInRange(
  source: EnvSource,
  key: string,
  issues: ConfigIssue[],
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = readOptionalString(source, key);

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    issues.push({ key, message: `${key} must be a number between ${minimum} and ${maximum}.` });
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

function normalizeLoopbackHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }

  return host;
}

export function loadBotApiConfig(source: EnvSource = process.env): BotApiConfig {
  const issues: ConfigIssue[] = [];
  const explicitApiBaseUrl = readOptionalString(source, "HUMANIFY_API_BASE_URL");
  const registerCommandsOnStart = readBoolean(source, "HUMANIFY_BOT_REGISTER_COMMANDS", true);
  const commandGuildId = readOptionalString(source, "HUMANIFY_BOT_COMMAND_GUILD_ID");
  const enableMessageSignals = readBoolean(source, "HUMANIFY_BOT_ENABLE_MESSAGE_SIGNALS", false);
  const enableMemberJoinSignals = readBoolean(source, "HUMANIFY_BOT_ENABLE_MEMBER_JOIN_SIGNALS", true);

  let apiBaseUrl = explicitApiBaseUrl;
  if (!apiBaseUrl) {
    const binding = loadApiBindingConfig(source);
    apiBaseUrl = `http://${normalizeLoopbackHost(binding.host)}:${binding.port}`;
  }

  try {
    apiBaseUrl = new URL(apiBaseUrl).toString().replace(/\/$/u, "");
  } catch {
    issues.push({ key: "HUMANIFY_API_BASE_URL", message: "HUMANIFY_API_BASE_URL must be a valid absolute URL." });
  }

  return finalizeIssues(issues, {
    apiBaseUrl,
    commandGuildId,
    enableMemberJoinSignals,
    enableMessageSignals,
    registerCommandsOnStart,
  });
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

export function loadDiditConfig(source: EnvSource = process.env): DiditConfig | undefined {
  const issues: ConfigIssue[] = [];
  const apiKey = readOptionalString(source, "HUMANIFY_DIDIT_API_KEY");
  const webhookSecret = readOptionalString(source, "HUMANIFY_DIDIT_WEBHOOK_SECRET");
  const workflowId = readOptionalString(source, "HUMANIFY_DIDIT_WORKFLOW_ID");
  const verifierBaseUrl = readOptionalString(source, "HUMANIFY_VERIFIER_BASE_URL");
  const verificationApiBaseUrl = readOptionalString(source, "HUMANIFY_DIDIT_API_BASE_URL") ?? "https://verification.didit.me";

  const anyDiditConfigPresent = Boolean(apiKey || webhookSecret || workflowId || verifierBaseUrl || source.HUMANIFY_DIDIT_API_BASE_URL);
  if (!anyDiditConfigPresent) {
    return undefined;
  }

  if (!apiKey) {
    issues.push({ key: "HUMANIFY_DIDIT_API_KEY", message: "HUMANIFY_DIDIT_API_KEY is required when Didit is enabled." });
  }

  if (!webhookSecret) {
    issues.push({
      key: "HUMANIFY_DIDIT_WEBHOOK_SECRET",
      message: "HUMANIFY_DIDIT_WEBHOOK_SECRET is required when Didit is enabled.",
    });
  }

  if (!workflowId) {
    issues.push({
      key: "HUMANIFY_DIDIT_WORKFLOW_ID",
      message: "HUMANIFY_DIDIT_WORKFLOW_ID is required when Didit is enabled.",
    });
  }

  if (!verifierBaseUrl) {
    issues.push({
      key: "HUMANIFY_VERIFIER_BASE_URL",
      message: "HUMANIFY_VERIFIER_BASE_URL is required when Didit is enabled.",
    });
  }

  let normalizedVerifierBaseUrl = verifierBaseUrl ?? "";
  let normalizedVerificationApiBaseUrl = verificationApiBaseUrl;

  try {
    normalizedVerifierBaseUrl = new URL(normalizedVerifierBaseUrl).toString().replace(/\/$/u, "");
  } catch {
    issues.push({
      key: "HUMANIFY_VERIFIER_BASE_URL",
      message: "HUMANIFY_VERIFIER_BASE_URL must be a valid absolute URL.",
    });
  }

  try {
    normalizedVerificationApiBaseUrl = new URL(normalizedVerificationApiBaseUrl).toString().replace(/\/$/u, "");
  } catch {
    issues.push({
      key: "HUMANIFY_DIDIT_API_BASE_URL",
      message: "HUMANIFY_DIDIT_API_BASE_URL must be a valid absolute URL.",
    });
  }

  return finalizeIssues(issues, {
    apiKey: apiKey ?? "",
    verificationApiBaseUrl: normalizedVerificationApiBaseUrl,
    verifierBaseUrl: normalizedVerifierBaseUrl,
    webhookSecret: webhookSecret ?? "",
    workflowId: workflowId ?? "",
  });
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

export function loadObservabilityConfig(source: EnvSource = process.env): ObservabilityConfig {
  const issues: ConfigIssue[] = [];
  const sentryDsn = readOptionalString(source, "HUMANIFY_SENTRY_DSN");
  const sentryTracesSampleRate = readNumberInRange(
    source,
    "HUMANIFY_SENTRY_TRACES_SAMPLE_RATE",
    issues,
    0,
    0,
    1,
  );

  if (sentryDsn) {
    try {
      new URL(sentryDsn);
    } catch {
      issues.push({ key: "HUMANIFY_SENTRY_DSN", message: "HUMANIFY_SENTRY_DSN must be a valid DSN URL." });
    }
  }

  return finalizeIssues(issues, {
    sentryDsn,
    sentryTracesSampleRate,
  });
}

export function loadAdvisoryServiceConfig(source: EnvSource = process.env): AdvisoryServiceConfig {
  const issues: ConfigIssue[] = [];
  const learningServiceUrl = readOptionalString(source, "HUMANIFY_LEARNING_SERVICE_URL") ?? "http://127.0.0.1:4102";

  try {
    return finalizeIssues(issues, {
      learningServiceUrl: new URL(learningServiceUrl).toString().replace(/\/$/u, ""),
    });
  } catch {
    issues.push({
      key: "HUMANIFY_LEARNING_SERVICE_URL",
      message: "HUMANIFY_LEARNING_SERVICE_URL must be a valid absolute URL.",
    });
    return finalizeIssues(issues, {
      learningServiceUrl,
    });
  }
}

export function loadPrivadoVerifierConfig(source: EnvSource = process.env): PrivadoVerifierConfig {
  const issues: ConfigIssue[] = [];
  const verifierBaseUrl = readOptionalString(source, "HUMANIFY_PRIVADO_VERIFIER_BASE_URL");
  const chainId = readOptionalString(source, "HUMANIFY_PRIVADO_CHAIN_ID") ?? "80002";
  const trustedIssuers = (
    readOptionalString(source, "HUMANIFY_PRIVADO_ALLOWED_ISSUERS")
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );

  if (!verifierBaseUrl) {
    return {
      chainId,
      enabled: false,
      trustedIssuers: [],
    };
  }

  try {
    new URL(verifierBaseUrl);
  } catch {
    issues.push({
      key: "HUMANIFY_PRIVADO_VERIFIER_BASE_URL",
      message: "HUMANIFY_PRIVADO_VERIFIER_BASE_URL must be a valid absolute URL.",
    });
  }

  if (trustedIssuers.length === 0) {
    issues.push({
      key: "HUMANIFY_PRIVADO_ALLOWED_ISSUERS",
      message: "HUMANIFY_PRIVADO_ALLOWED_ISSUERS must include at least one trusted issuer DID when Privado is enabled.",
    });
  }

  if (trustedIssuers.includes("*")) {
    issues.push({
      key: "HUMANIFY_PRIVADO_ALLOWED_ISSUERS",
      message: 'HUMANIFY_PRIVADO_ALLOWED_ISSUERS must list explicit trusted issuer DIDs; "*" is not allowed.',
    });
  }

  return finalizeIssues(issues, {
    chainId,
    enabled: true,
    trustedIssuers,
    verifierBaseUrl: verifierBaseUrl.replace(/\/$/u, ""),
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
