/**
 * Purpose: Defines the verifier app's signed-link session loading, challenge submission, and honest step-state helpers.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\verification.md
 * - docs\observability-security.md
 * - docs\testing.md
 * External references:
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://developer.mozilla.org/docs/Web/API/Fetch_API
 * Tests:
 * - apps/verifier-start/src/verification-flow.test.ts
 */

import { createRequestTelemetryContext, injectRequestTelemetryHeaders } from "@humanify/telemetry";

export type VerificationRouteSearch = {
  serverName?: string;
  sessionId?: string;
  token?: string;
  username?: string;
};

export type VerificationSessionSnapshot = {
  challengeExpiresAt: string;
  challengeId: string;
  guildId: string;
  releaseEligible: boolean;
  requiredCapabilities: string[];
  sessionId: string;
  source: string;
  state: "challenge_issued" | "provider_pending";
  userId: string;
};

export type VerificationCallbackBoundary = {
  nextStep: string;
  providerCallbacksConfigured: boolean;
  releaseEligible: boolean;
  status: string;
};

export type VerificationProviderBoundary = VerificationCallbackBoundary & {
  requiredCapabilities: string[];
};

export type VerificationSessionData = {
  callbackBoundary: VerificationCallbackBoundary;
  persistence: string;
  session: VerificationSessionSnapshot;
};

export type VerificationChallengeData = {
  challenge: {
    challengeId: string;
    guildId: string;
    sessionId: string;
    userId: string;
    verified: boolean;
  };
  persistence: string;
  providerBoundary: VerificationProviderBoundary;
  session: VerificationSessionSnapshot;
};

export type VerificationChecklistItem = {
  detail: string;
  status: "blocked" | "complete" | "pending";
  title: string;
};

type ApiEnvelope<TData> = {
  contractVersion: string;
  data: TData;
  requestId: string;
};

type ApiErrorEnvelope = {
  errorCode: string;
  message: string;
  requestId: string;
  retryable: boolean;
};

type FetchLike = (input: URL | string | Request, init?: RequestInit) => Promise<Response>;

function readSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class VerifierApiError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly requestId?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "VerifierApiError";
  }
}

export function parseVerificationSearch(search: Record<string, unknown>): VerificationRouteSearch {
  return {
    serverName: readSearchString(search.serverName),
    sessionId: readSearchString(search.sessionId),
    token: readSearchString(search.token),
    username: readSearchString(search.username),
  };
}

export function hasVerificationLink(
  search: VerificationRouteSearch,
): search is VerificationRouteSearch & { sessionId: string; token: string } {
  return Boolean(search.sessionId && search.token);
}

export function getVerifierApiBaseUrl(env: Record<string, string | undefined> = {}): string {
  const configuredBaseUrl = env.VITE_HUMANIFY_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:3211";
}

function buildApiUrl(apiBaseUrl: string, path: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

async function readApiEnvelope<TData>(response: Response): Promise<TData> {
  const json = (await response.json()) as ApiEnvelope<TData> | ApiErrorEnvelope;

  if (!response.ok) {
    const error = json as ApiErrorEnvelope;
    throw new VerifierApiError(
      error.errorCode ?? "internal_error",
      error.message ?? "Verification request failed.",
      error.requestId,
      error.retryable ?? false,
    );
  }

  return (json as ApiEnvelope<TData>).data;
}

export async function fetchVerificationSession(
  fetchImpl: FetchLike,
  input: { apiBaseUrl: string; sessionId: string; token: string },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(
      input.apiBaseUrl,
      `/verification/sessions/${encodeURIComponent(input.sessionId)}?token=${encodeURIComponent(input.token)}`,
    ),
    {
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
      }, requestTelemetry),
    },
  );

  return readApiEnvelope<VerificationSessionData>(response);
}

export async function completeVerificationChallenge(
  fetchImpl: FetchLike,
  input: {
    apiBaseUrl: string;
    challengeId: string;
    guildId: string;
    sessionId: string;
    token: string;
    userId: string;
  },
) {
  const requestTelemetry = createRequestTelemetryContext();
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, `/verification/challenges/${encodeURIComponent(input.challengeId)}/complete`),
    {
      body: JSON.stringify({
        guildId: input.guildId,
        sessionId: input.sessionId,
        token: input.token,
        userId: input.userId,
      }),
      credentials: "include",
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }, requestTelemetry),
      method: "POST",
    },
  );

  return readApiEnvelope<VerificationChallengeData>(response);
}

export function buildVerificationChecklist(input: {
  challengeCompleted: boolean;
  providerCallbacksConfigured: boolean;
  releaseEligible: boolean;
}) {
  const items: VerificationChecklistItem[] = [
    {
      detail: "The Bun API accepted a signed verifier link and derived the session context from that server-signed challenge.",
      status: "complete",
      title: "Signed verifier link",
    },
    {
      detail: input.challengeCompleted
        ? "The Discord-bound challenge request was accepted and the session moved to provider pending."
        : "Confirm the Discord-bound challenge before any provider step can begin.",
      status: input.challengeCompleted ? "complete" : "pending",
      title: "Discord-bound challenge",
    },
    {
      detail: input.providerCallbacksConfigured
        ? "Provider callbacks are configured and can advance the session."
        : "Provider callbacks remain disabled until Humanify documents a concrete provider signature and replay contract.",
      status: input.providerCallbacksConfigured ? "pending" : "blocked",
      title: "Provider callback verification",
    },
    {
      detail: input.releaseEligible
        ? "The session is eligible for Bun-side release orchestration."
        : "Release-to-role stays blocked until a provider callback marks the session passed in canonical Postgres state.",
      status: input.releaseEligible ? "pending" : "blocked",
      title: "Release-to-role",
    },
  ];

  return items;
}
