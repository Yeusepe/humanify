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

import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";

import {
  buildVerificationChecklist,
  completeVerificationChallenge,
  fetchVerificationSession,
  getDefaultHumanifyIdClaimBundle,
  getHumanifyIdClaimBundles,
  getDefaultVerificationProviderId,
  getGuildVerificationClaimBundleOptions,
  getGuildVerificationProviderOptions,
  getInitialGuildVerificationSelection,
  getVerificationOptionLaunch,
  getVerifierApiBaseUrl,
  getVerificationProviderAvailability,
  getVerificationProviderClaimCompatibility,
  getVerificationProviderOptions,
  hasVerificationLink,
  parseVerificationSearch,
  releaseVerificationSession,
  startReusableProofFlow,
  startVerificationOptionLaunch,
  verifyReusableProofResult,
} from "./verification-flow";
import { routeTree } from "./routeTree.gen";

async function renderRoute(path: "/" | `/verify?${string}`) {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree,
  });

  await router.load();

  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

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
          verificationConfig: {
            availableProviderIds: ["didit", "privado", "self"],
            defaultProviderId: "didit",
            defaultReusableProofBackendId: "privado",
            enabledProviderIds: ["didit", "privado"],
            faceVerificationRequired: false,
            fallbackRoles: ["role_verified"],
            requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
            source: "persisted",
            suspiciousRoleIds: ["role_suspicious"],
            trustedRoleIds: ["role_verified"],
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
  expect(result.verificationConfig.defaultProviderId).toBe("didit");
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
          verificationConfig: {
            availableProviderIds: ["didit", "privado", "self"],
            defaultProviderId: "didit",
            defaultReusableProofBackendId: "privado",
            enabledProviderIds: ["didit", "self"],
            faceVerificationRequired: true,
            fallbackRoles: ["role_verified"],
            requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
            source: "persisted",
            suspiciousRoleIds: ["role_suspicious"],
            trustedRoleIds: ["role_verified"],
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
  expect(result.verificationConfig.faceVerificationRequired).toBe(true);
});

test("startReusableProofFlow posts a signed reusable-proof start token and returns a wallet launch", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          flow: {
            providerId: "privado",
            providerSessionId: "backend_123",
            providerSessionToken: "proof.session.token",
            qrCodeValue: "iden3comm://?request_uri=https%3A%2F%2Fverifier-backend.privado.id%2Fqr-store%3Fid%3Dabc123",
            request: {
              chainID: "80002",
              reason: "Humanify reusable proof request for age_over_18, nationality.",
              scope: [],
            },
            requestUri: "https://verifier-backend.privado.id/qr-store?id=abc123",
            universalLink: "https://wallet.privado.id/#request_uri=https%3A%2F%2Fverifier-backend.privado.id%2Fqr-store%3Fid%3Dabc123",
          },
          persistence: "provider_request_created",
          providerBoundary: {
            nextStep: "provider_verification_required",
            providerFlowConfigured: true,
            providerSessionToken: "proof.session.token",
            releaseEligible: false,
            status: "proof_request_created",
          },
          session: {
            challengeExpiresAt: "2026-01-01T00:15:00.000Z",
            challengeId: "challenge_123",
            guildId: "guild_123",
            releaseEligible: false,
            requiredCapabilities: ["captcha"],
            sessionId: "session_123",
            source: "signed_reusable_proof_start_token",
            state: "provider_pending",
            userId: "user_123",
          },
        },
        requestId: "request_789",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 202,
      },
    );
  };

  const result = await startReusableProofFlow(fetchImpl, {
    apiBaseUrl: "http://127.0.0.1:3211",
    backUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
    finishUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
    providerId: "privado",
    providerStartEndpoint: "/verification/sessions/session_123/providers/privado/start",
    providerStartToken: "start.token",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3211/verification/sessions/session_123/providers/privado/start");
  expect(await requests[0]?.json()).toEqual({
    backUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
    finishUrl: "https://verifier.humanify.test/verify?sessionId=session_123",
    providerStartToken: "start.token",
  });
  expect(result.flow.providerSessionToken).toBe("proof.session.token");
  expect(result.flow.universalLink).toContain("https://wallet.privado.id/#request_uri=");
});

test("verifyReusableProofResult posts the provider session token and returns minimal proof evidence", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          persistence: "planned_not_persisted",
          providerBoundary: {
            nextStep: "release_available",
            providerFlowConfigured: true,
            releaseEligible: true,
            status: "provider_proof_verified",
          },
          session: {
            challengeExpiresAt: "2026-01-01T00:15:00.000Z",
            challengeId: "challenge_123",
            guildId: "guild_123",
            releaseEligible: true,
            requiredCapabilities: ["captcha"],
            sessionId: "session_123",
            source: "signed_reusable_proof_session_token",
            state: "provider_pending",
            userId: "user_123",
          },
          verification: {
            message: "Privado verified 2 reusable proof predicate(s) for the current Humanify session.",
            proofReceipt: {
              nullifiers: [
                {
                  claimKey: "age_over_18",
                  nullifier: "nullifier_age",
                  nullifierSessionId: "session_123",
                  scopeId: 1,
                },
              ],
              proofReceiptHash: "sha256:abc123",
              proofReceiptRef: "privado:session:backend_123",
              trustedIssuerScopes: ["did:issuer:age"],
              verifiablePresentationCount: 2,
            },
            providerId: "privado",
            providerSessionId: "backend_123",
            satisfiedClaims: ["age_over_18", "nationality"],
            status: "verified",
          },
        },
        requestId: "request_790",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 202,
      },
    );
  };

  const result = await verifyReusableProofResult(fetchImpl, {
    apiBaseUrl: "http://127.0.0.1:3211",
    providerId: "privado",
    providerSessionToken: "proof.session.token",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3211/verification/providers/privado/proof");
  expect(await requests[0]?.json()).toEqual({
    providerSessionToken: "proof.session.token",
  });
  expect(result.providerBoundary.releaseEligible).toBe(true);
  expect(result.verification.proofReceipt.proofReceiptRef).toBe("privado:session:backend_123");
  expect(result.verification.satisfiedClaims).toEqual(["age_over_18", "nationality"]);
});

test("releaseVerificationSession posts the signed release request and returns the applied role grants", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          providerBoundary: {
            nextStep: "released",
            providerFlowConfigured: true,
            releaseEligible: false,
            status: "released",
          },
          release: {
            appliedRoleIds: ["role_human", "role_18"],
            releasedAt: "2026-01-01T00:20:00.000Z",
            triggerKeys: ["verified_human", "age_over_18"],
          },
          session: {
            challengeExpiresAt: "2026-01-01T00:15:00.000Z",
            challengeId: "challenge_123",
            guildId: "guild_123",
            releaseEligible: false,
            requiredCapabilities: ["captcha"],
            sessionId: "session_123",
            source: "canonical_verification_session",
            state: "released",
            userId: "user_123",
          },
          verification: {
            satisfiedClaims: ["age_over_18"],
            status: "verified",
          },
          verificationConfig: {
            availableProviderIds: ["didit", "privado", "self"],
            defaultProviderId: "didit",
            enabledProviderIds: ["didit", "privado"],
            faceVerificationRequired: false,
            fallbackRoles: ["role_verified"],
            requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
            roleGrantBindings: [
              { roleId: "role_human", trigger: "verified_human" },
              { roleId: "role_18", trigger: "age_over_18" },
            ],
            source: "persisted",
            suspiciousRoleIds: ["role_suspicious"],
            trustedRoleIds: ["role_verified"],
          },
        },
        requestId: "request_release_123",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
    );
  };

  const result = await releaseVerificationSession(fetchImpl, {
    apiBaseUrl: "http://127.0.0.1:3211",
    guildId: "guild_123",
    sessionId: "session_123",
    token: "signed.token",
    userId: "user_123",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3211/verification/sessions/session_123/release");
  expect(await requests[0]?.json()).toEqual({
    guildId: "guild_123",
    token: "signed.token",
    userId: "user_123",
  });
  expect(result.release.appliedRoleIds).toEqual(["role_human", "role_18"]);
  expect(result.session.state).toBe("released");
  expect(result.providerBoundary.status).toBe("released");
});

test("didit launch contracts are read from the generic provider boundary", () => {
  expect(
    getVerificationOptionLaunch({
      handoffKind: "signed_webhook",
      launch: {
        mode: "didit_sdk",
        packageName: "@didit-protocol/sdk-web",
        providerId: "didit",
        providerSessionId: "didit_session_123",
        providerStatus: "Not Started",
        url: "https://verify.didit.me/session/didit_session_123",
      },
      nextStep: "provider_verification_required",
      providerFlowConfigured: true,
      providerServerEndpoint: "/callbacks/providers/didit",
      releaseEligible: false,
      selectedProvider: "didit",
      status: "didit_session_created",
    }),
  ).toEqual({
    mode: "didit_sdk",
    packageName: "@didit-protocol/sdk-web",
    providerId: "didit",
    providerSessionId: "didit_session_123",
    providerStatus: "Not Started",
    url: "https://verify.didit.me/session/didit_session_123",
  });
});

test("startDiditVerification launches the SDK and reports completed, cancelled, and failed outcomes honestly", async () => {
  const completedStates: Array<{ kind: string; message: string; refreshStatus: boolean }> = [];
  const startCalls: Array<{ configuration?: Record<string, unknown>; url: string }> = [];
  const sharedSdk = {
    async startVerification(input: { configuration?: Record<string, unknown>; url: string }) {
      startCalls.push(input);
      this.onComplete?.({
        session: {
          sessionId: "didit_session_123",
          status: "Approved",
        },
        type: "completed",
      });
      this.onComplete?.({
        session: {
          sessionId: "didit_session_123",
          status: "Pending",
        },
        type: "cancelled",
      });
      this.onComplete?.({
        error: {
          message: "Camera access denied.",
        },
        type: "failed",
      });
    },
    onComplete: undefined as ((result: {
      error?: { message?: string };
      session?: { sessionId: string; status: string };
      type: "cancelled" | "completed" | "failed";
    }) => void) | undefined,
  };

  const originalWindow = globalThis.window;
  Object.assign(globalThis, {
    window: {
      DiditSdk: {
        shared: sharedSdk,
      },
    },
  });

  await startVerificationOptionLaunch({
    launch: {
      mode: "didit_sdk",
      packageName: "@didit-protocol/sdk-web",
      providerId: "didit",
      providerSessionId: "didit_session_123",
      providerStatus: "Not Started",
      url: "https://verify.didit.me/session/didit_session_123",
    },
    onBrowserResult(result) {
      completedStates.push(result);
    },
  });

  Object.assign(globalThis, {
    window: originalWindow,
  });

  expect(startCalls).toEqual([
    {
      configuration: {
        closeModalOnComplete: true,
        showExitConfirmation: true,
      },
      url: "https://verify.didit.me/session/didit_session_123",
    },
  ]);
  expect(completedStates).toEqual([
    expect.objectContaining({
      kind: "completed",
      message: expect.stringContaining("Verification finished in your browser"),
      refreshStatus: true,
    }),
    expect.objectContaining({
      kind: "cancelled",
      message: expect.stringContaining("closed the browser verification flow"),
      refreshStatus: false,
    }),
    expect.objectContaining({
      kind: "failed",
      message: expect.stringContaining("Camera access denied."),
      refreshStatus: false,
    }),
  ]);
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

  expect(providers.map((provider) => provider.id)).toEqual(["didit", "privado", "self", "world_id"]);
  expect(providers[0]?.role).toBe("capture_provider");
  expect(providers[0]?.deletionPolicy).toContain("DELETE /v3/session/{session_id}/");
  expect(providers[1]?.id).toBe("privado");
  expect(providers[1]?.integration.handoffKind).toBe("server_verified_proof");
});

test("provider defaults and enablement come from the shared provider catalog", () => {
  expect(getDefaultVerificationProviderId()).toBe("didit");
  expect(getDefaultVerificationProviderId({ VITE_HUMANIFY_ENABLED_VERIFICATION_PROVIDERS: "didit" })).toBe("didit");
});

test("guild verification config filters provider and proof choices from the server snapshot", () => {
  const verificationConfig = {
    availableProviderIds: ["didit", "privado", "self"],
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: false,
    fallbackRoles: ["role_verified"],
    requiredBundleIds: ["humanify_id_nationality_v1"],
    source: "persisted" as const,
    suspiciousRoleIds: ["role_suspicious"],
    trustedRoleIds: ["role_verified"],
  };

  expect(getGuildVerificationProviderOptions(verificationConfig).map((provider) => provider.id)).toEqual([
    "didit",
    "privado",
  ]);
  expect(getGuildVerificationClaimBundleOptions(verificationConfig).map((bundle) => bundle.bundleId)).toEqual([
    "humanify_id_nationality_v1",
  ]);
  expect(getInitialGuildVerificationSelection(verificationConfig)).toEqual({
    claimBundleId: "humanify_id_nationality_v1",
    providerId: "didit",
  });
});

test("face verification requirements block incompatible reusable-proof options", () => {
  const privado = getVerificationProviderOptions().find((provider) => provider.id === "privado")!;

  expect(
    getVerificationProviderAvailability({
      faceVerificationRequired: true,
      provider: privado,
      requestedClaims: ["age_over_18"],
    }),
  ).toEqual({
    allowed: false,
    reason: "This server needs a face check, so choose a first-time capture option instead.",
  });
});

test("claim bundle options expose consumer-facing choices for what to prove", () => {
  const bundles = getHumanifyIdClaimBundles();

  expect(bundles.map((bundle) => bundle.title)).toEqual([
    "Only prove age over 18",
    "Only prove nationality",
    "Prove age + nationality",
  ]);
  expect(bundles[0]?.claims).toEqual(["age_over_18"]);
  expect(bundles[1]?.claims).toEqual(["nationality"]);
  expect(bundles[2]?.claims).toEqual(["age_over_18", "nationality"]);
});

test("provider compatibility is computed from shared claim support", () => {
  const provider = getVerificationProviderOptions()[0]!;

  expect(getVerificationProviderClaimCompatibility(provider, ["age_over_18"])).toBe(true);
  expect(getVerificationProviderClaimCompatibility(provider, ["age_over_18", "nationality"])).toBe(true);
});

test("default Humanify ID bundle stores predicates and nullifier receipts instead of raw identity data", () => {
  const bundle = getDefaultHumanifyIdClaimBundle();
  const storageContract = bundle.operatorStorageGuarantees.join(" ");

  expect(bundle.claims).toEqual(["age_over_18", "nationality"]);
  expect(storageContract).toContain("nullifiers");
  expect(storageContract).toContain("does not store document images");
  expect(storageContract).toContain("birthdates");
});

test("verification route separates first-time capture from reusable proofs with privacy copy", async () => {
  const markup = await renderRoute("/verify?sessionId=session_123&token=signed.token");

  expect(markup).toContain("First-time capture options");
  expect(markup).toContain("Reusable proof options");
  expect(markup).toContain("What Humanify learns");
  expect(markup).toContain("What Humanify does not learn");
  expect(markup).toContain("Face verification");
});

test("verifier main files stay option-driven instead of hard-coding provider brands", () => {
  const verificationFlowSource = readFileSync(new URL("./verification-flow.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("./routes/verify.tsx", import.meta.url), "utf8");

  expect(verificationFlowSource).not.toContain("@didit-protocol/sdk-web");
  expect(verificationFlowSource).not.toContain("getDiditLaunchContract");
  expect(verificationFlowSource).not.toContain("DiditProviderLaunch");

  expect(routeSource).not.toContain("@didit-protocol/sdk-web");
  expect(routeSource).not.toContain("Didit");
  expect(routeSource).not.toContain("Privado");
  expect(routeSource).not.toContain("selectedProvider === \"privado\"");
});
