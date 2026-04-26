/**
 * Purpose: Verifies the verifier flow helpers only trust signed-link context, call the Bun API correctly, and keep provider release blocked.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\verification.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://developer.mozilla.org/docs/Web/API/Fetch_API
 * Tests:
 * - apps/verifier-start/src/verification-flow.test.ts
 */

import { expect, test } from "bun:test";

import {
  buildVerificationChecklist,
  completeVerificationChallenge,
  fetchVerificationSession,
  getDefaultHumanifyIdClaimBundle,
  getDefaultVerificationProviderId,
  getVerifierApiBaseUrl,
  getVerificationProviderOptions,
  hasVerificationLink,
  parseVerificationSearch,
} from "./verification-flow";

test("verification search parsing only keeps meaningful signed-link fields", () => {
  const parsed = parseVerificationSearch({
    ignored: "value",
    serverName: " Example Community ",
    sessionId: " session_123 ",
    token: " signed.token ",
    username: "",
  });

  expect(parsed).toEqual({
    serverName: "Example Community",
    sessionId: "session_123",
    token: "signed.token",
    username: undefined,
  });
  expect(hasVerificationLink(parsed)).toBe(true);
});

test("verifier flow defaults to the local Bun API port unless configured", () => {
  expect(getVerifierApiBaseUrl()).toBe("http://127.0.0.1:3211");
  expect(getVerifierApiBaseUrl({ VITE_HUMANIFY_API_BASE_URL: "https://api.humanify.test/" })).toBe(
    "https://api.humanify.test",
  );
});

test("fetchVerificationSession calls the Bun API status route with the signed token", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          providerBoundary: {
            nextStep: "complete_challenge",
            providerFlowConfigured: false,
            releaseEligible: false,
            status: "challenge_link_verified",
          },
          persistence: "derived_from_signed_challenge",
          session: {
            challengeExpiresAt: "2026-01-01T00:05:00.000Z",
            challengeId: "challenge_123",
            guildId: "guild_123",
            releaseEligible: false,
            requiredCapabilities: ["captcha"],
            sessionId: "session_123",
            source: "signed_challenge_token",
            state: "challenge_issued",
            userId: "user_123",
          },
        },
        requestId: "request_123",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
    );
  };

  const result = await fetchVerificationSession(fetchImpl, {
    apiBaseUrl: "http://127.0.0.1:3211",
    sessionId: "session_123",
    token: "signed.token",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3211/verification/sessions/session_123?token=signed.token");
  expect(requests[0]?.headers.get("x-request-id")).toBeTruthy();
  expect(requests[0]?.headers.get("traceparent")).toBeTruthy();
  expect(result.session.requiredCapabilities).toEqual(["captcha"]);
  expect(result.providerBoundary.providerFlowConfigured).toBe(false);
});

test("completeVerificationChallenge posts the signed session identity back to the Bun API", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          challenge: {
            challengeId: "challenge_123",
            guildId: "guild_123",
            sessionId: "session_123",
            userId: "user_123",
            verified: true,
          },
          persistence: "planned_not_persisted",
          providerBoundary: {
            handoffKind: "server_verified_proof",
            nextStep: "provider_verification_required",
            providerFlowConfigured: false,
            providerServerEndpoint: "/verification/providers/self/proof",
            requestedClaims: ["age_over_18", "nationality"],
            releaseEligible: false,
            requiredCapabilities: ["captcha"],
            selectedProvider: "self",
            serverVerificationNote: "Humanify must verify a Self-issued proof server-side; browser success alone is never sufficient.",
            status: "pending_provider_verification",
          },
          session: {
            challengeExpiresAt: "2026-01-01T00:05:00.000Z",
            challengeId: "challenge_123",
            guildId: "guild_123",
            releaseEligible: false,
            requiredCapabilities: ["captcha"],
            sessionId: "session_123",
            source: "signed_challenge_token",
            state: "provider_pending",
            userId: "user_123",
          },
        },
        requestId: "request_456",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 202,
      },
    );
  };

  const result = await completeVerificationChallenge(fetchImpl, {
    apiBaseUrl: "http://127.0.0.1:3211",
    challengeId: "challenge_123",
    guildId: "guild_123",
    providerId: "self",
    requestedClaims: ["age_over_18", "nationality"],
    sessionId: "session_123",
    token: "signed.token",
    userId: "user_123",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.method).toBe("POST");
  expect(requests[0]?.headers.get("x-request-id")).toBeTruthy();
  expect(requests[0]?.headers.get("traceparent")).toBeTruthy();
  expect(await requests[0]?.json()).toEqual({
    guildId: "guild_123",
    providerId: "self",
    requestedClaims: ["age_over_18", "nationality"],
    sessionId: "session_123",
    token: "signed.token",
    userId: "user_123",
  });
  expect(result.providerBoundary.status).toBe("pending_provider_verification");
  expect(result.providerBoundary.selectedProvider).toBe("self");
  expect(result.providerBoundary.handoffKind).toBe("server_verified_proof");
});

test("buildVerificationChecklist keeps provider verification and release explicitly blocked", () => {
  expect(
    buildVerificationChecklist({
      challengeCompleted: true,
      providerFlowConfigured: false,
      releaseEligible: false,
    }),
  ).toEqual([
    expect.objectContaining({ status: "complete", title: "Signed verifier link" }),
    expect.objectContaining({ status: "complete", title: "Discord-bound challenge" }),
    expect.objectContaining({ status: "blocked", title: "Provider verification" }),
    expect.objectContaining({ status: "blocked", title: "Release-to-role" }),
  ]);
});

test("provider options rank Self first and keep Didit as the process-and-purge fallback", () => {
  const providers = getVerificationProviderOptions();

  expect(providers.map((provider) => provider.id)).toEqual(["self", "world_id", "didit"]);
  expect(providers[0]?.privacySummary).toContain("Most private");
  expect(providers[0]?.integration.handoffKind).toBe("server_verified_proof");
  expect(providers[2]?.deletionPolicy).toContain("DELETE /v3/session/{session_id}/");
});

test("provider defaults and enablement come from the shared provider catalog", () => {
  expect(getDefaultVerificationProviderId()).toBe("self");
  expect(getDefaultVerificationProviderId({ VITE_HUMANIFY_ENABLED_VERIFICATION_PROVIDERS: "didit" })).toBe("didit");
});

test("default Humanify ID bundle stores predicates and nullifier receipts instead of raw identity data", () => {
  const bundle = getDefaultHumanifyIdClaimBundle();
  const storageContract = bundle.operatorStorageGuarantees.join(" ");

  expect(bundle.claims).toEqual(["age_over_18", "nationality"]);
  expect(storageContract).toContain("nullifiers");
  expect(storageContract).toContain("should not store document images");
  expect(storageContract).toContain("birthdates");
});
