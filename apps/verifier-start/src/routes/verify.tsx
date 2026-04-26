/**
 * Purpose: Renders the first real verifier flow: load signed-link session context, confirm the Discord-bound challenge, and stop before unsupported provider handoffs.
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
 * - apps/verifier-start package build
 */

import { useEffect, useMemo, useState } from "react";

import { Button, Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { ProductShell } from "@humanify/ui";

import {
  buildVerificationChecklist,
  completeVerificationChallenge,
  fetchVerificationSession,
  getDefaultHumanifyIdClaimBundle,
  getDefaultVerificationProviderId,
  getHumanifyIdClaimBundles,
  getVerificationProvider,
  getVerificationProviderClaimCompatibility,
  getVerifierApiBaseUrl,
  getVerificationProviderOptions,
  hasVerificationLink,
  parseVerificationSearch,
  type VerificationProviderId,
  type VerificationChallengeData,
  type VerificationSessionData,
} from "../verification-flow";

export const Route = createFileRoute("/verify")({
  component: VerificationRoute,
  validateSearch: parseVerificationSearch,
});

function VerificationRoute() {
  const search = Route.useSearch();
  const [sessionData, setSessionData] = useState<VerificationSessionData | null>(null);
  const [challengeData, setChallengeData] = useState<VerificationChallengeData | null>(null);
  const providerEnv = import.meta.env as Record<string, string | undefined>;
  const [selectedProvider, setSelectedProvider] = useState<VerificationProviderId>(() =>
    getDefaultVerificationProviderId(providerEnv),
  );
  const [selectedClaimBundleId, setSelectedClaimBundleId] = useState<string>(() =>
    getDefaultHumanifyIdClaimBundle().bundleId,
  );
  const [loadState, setLoadState] = useState<"error" | "idle" | "loading" | "ready">(
    hasVerificationLink(search) ? "loading" : "idle",
  );
  const [actionState, setActionState] = useState<"error" | "idle" | "submitting" | "success">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const apiBaseUrl = getVerifierApiBaseUrl(providerEnv);
  const providerOptions = useMemo(() => getVerificationProviderOptions(providerEnv), [providerEnv]);
  const claimBundleOptions = useMemo(() => getHumanifyIdClaimBundles(), []);
  const selectedProviderDefinition = useMemo(
    () => getVerificationProvider(selectedProvider, providerEnv),
    [providerEnv, selectedProvider],
  );
  const humanifyIdBundle = useMemo(
    () =>
      claimBundleOptions.find((bundle) => bundle.bundleId === selectedClaimBundleId) ?? getDefaultHumanifyIdClaimBundle(),
    [claimBundleOptions, selectedClaimBundleId],
  );

  useEffect(() => {
    const currentProvider = providerOptions.find((provider) => provider.id === selectedProvider);
    if (currentProvider && getVerificationProviderClaimCompatibility(currentProvider, humanifyIdBundle.claims)) {
      return;
    }

    const fallbackProvider = providerOptions.find((provider) =>
      getVerificationProviderClaimCompatibility(provider, humanifyIdBundle.claims)
    );
    if (fallbackProvider) {
      setSelectedProvider(fallbackProvider.id);
    }
  }, [humanifyIdBundle.claims, providerOptions, selectedProvider]);

  useEffect(() => {
    let active = true;

    setChallengeData(null);
    setActionState("idle");
    setFeedbackMessage(null);

    if (!hasVerificationLink(search)) {
      setSessionData(null);
      setLoadState("idle");
      return () => {
        active = false;
      };
    }

    setLoadState("loading");

    void fetchVerificationSession(fetch, {
      apiBaseUrl,
      sessionId: search.sessionId,
      token: search.token,
    })
      .then((data) => {
        if (!active) {
          return;
        }

        setSessionData(data);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setSessionData(null);
        setLoadState("error");
        setFeedbackMessage(error instanceof Error ? error.message : "Verification session loading failed.");
      });

    return () => {
      active = false;
    };
  }, [apiBaseUrl, search.sessionId, search.token]);

  const effectiveSession = challengeData?.session ?? sessionData?.session ?? null;
  const providerFlowConfigured =
    challengeData?.providerBoundary.providerFlowConfigured ??
    sessionData?.providerBoundary.providerFlowConfigured ??
    false;
  const releaseEligible = challengeData?.providerBoundary.releaseEligible ?? sessionData?.providerBoundary.releaseEligible ?? false;
  const challengeCompleted = challengeData?.challenge.verified ?? false;
  const checklist = useMemo(
    () =>
      buildVerificationChecklist({
        challengeCompleted,
        providerFlowConfigured,
        releaseEligible,
      }),
    [challengeCompleted, providerFlowConfigured, releaseEligible],
  );

  async function handleChallengeConfirmation() {
    if (!effectiveSession || !hasVerificationLink(search)) {
      return;
    }

    setActionState("submitting");
    setFeedbackMessage(null);

    try {
      const data = await completeVerificationChallenge(fetch, {
        apiBaseUrl,
        challengeId: effectiveSession.challengeId,
        guildId: effectiveSession.guildId,
        providerId: selectedProvider,
        requestedClaims: humanifyIdBundle.claims,
        sessionId: effectiveSession.sessionId,
        token: search.token,
        userId: effectiveSession.userId,
      });

      setChallengeData(data);
      setActionState("success");
      setFeedbackMessage(
        `Challenge accepted. ${selectedProviderDefinition.title} is now the selected verification path, but release still waits for Humanify's server-side provider verification contract.`,
      );
    } catch (error) {
      setActionState("error");
      setFeedbackMessage(error instanceof Error ? error.message : "Challenge confirmation failed.");
    }
  }

  return (
    <ProductShell
      description="This verifier now uses the Bun API's signed challenge token to load session context, confirm the Discord-bound challenge, and stop cleanly before any unsupported provider or release step."
      eyebrow="HUMANIFY / VERIFIER"
      panels={[
        {
          description: "Current session lifecycle state from Bun-owned verification boundaries.",
          title: "Session state",
          value: effectiveSession?.state ?? "link required",
        },
        {
          description: "Required assurance capabilities from the signed challenge token.",
          title: "Required checks",
          value: effectiveSession ? String(effectiveSession.requiredCapabilities.length) : "0",
          variant: "secondary",
        },
        {
          description: "Provider verification remains explicit until Bun documents and wires a concrete server-side provider contract.",
          title: "Release status",
          value: releaseEligible ? "eligible" : "blocked",
          variant: "tertiary",
        },
      ]}
      title="Verification flow"
    >
      <div className="space-y-6">
        {!hasVerificationLink(search) ? (
          <Card>
            <Card.Header className="gap-2">
              <Card.Title>Signed verifier link required</Card.Title>
              <Card.Description>
                Open the verifier using the Bun-authored link that includes a signed challenge token and session ID.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-3 text-sm leading-7 text-muted">
              <p>
                 This first real verifier path does not fake Discord OAuth, provider success, or role release. It only accepts
                 a signed link from the API, confirms the challenge, and then waits for future server-side provider wiring.
              </p>
              <p className="font-medium text-foreground">
                Expected query params: <code className="rounded bg-content2 px-2 py-1 text-xs">sessionId</code> and{" "}
                <code className="rounded bg-content2 px-2 py-1 text-xs">token</code>.
              </p>
            </Card.Content>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Session context</Card.Title>
                  <Card.Description>
                    Derived from the signed challenge token, not from synthetic client-side state.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                  {loadState === "loading" ? (
                    <p>Loading signed session context from the Bun API…</p>
                  ) : effectiveSession ? (
                    <>
                      <DetailRow label="Session" value={effectiveSession.sessionId} />
                      <DetailRow label="Challenge" value={effectiveSession.challengeId} />
                      <DetailRow label="Guild" value={effectiveSession.guildId} />
                      <DetailRow label="User" value={effectiveSession.userId} />
                      <DetailRow label="Expires" value={effectiveSession.challengeExpiresAt} />
                      {search.serverName ? <DetailRow label="Server label" value={search.serverName} /> : null}
                      {search.username ? <DetailRow label="User label" value={search.username} /> : null}
                    </>
                  ) : (
                    <p>Session context is unavailable until the signed verifier link loads successfully.</p>
                  )}
                </Card.Content>
              </Card>

              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Verification checklist</Card.Title>
                  <Card.Description>
                    Honest step state: complete what exists, block what does not yet have a Bun-side proof path.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-3">
                  {checklist.map((item) => (
                    <div key={item.title} className="rounded-2xl border border-content3 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <span className="rounded-full border border-content3 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p>
                    </div>
                  ))}
                </Card.Content>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Choose your proof</Card.Title>
                  <Card.Description>
                    Start by picking what you want to prove right now. Use the smallest option that gets you through the server's rules.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  {claimBundleOptions.map((bundle) => {
                    const current = humanifyIdBundle.bundleId === bundle.bundleId;
                    return (
                      <div
                        className={`rounded-2xl border px-4 py-4 ${current ? "border-foreground/20 bg-content2" : "border-content3"}`}
                        key={bundle.bundleId}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <p className="font-semibold text-foreground">{bundle.title}</p>
                            <p>{bundle.summary}</p>
                            <p className="text-xs leading-6">
                              <span className="font-semibold text-foreground">Best for:</span> {bundle.bestFor}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {bundle.claims.map((claim) => (
                                <span
                                  className="rounded-full border border-content3 px-3 py-1 text-xs font-semibold tracking-wide text-foreground uppercase"
                                  key={claim}
                                >
                                  {claim}
                                </span>
                              ))}
                            </div>
                          </div>
                          <Button
                            onPress={() => setSelectedClaimBundleId(bundle.bundleId)}
                            variant={current ? "primary" : "outline"}
                          >
                            {current ? "Selected" : "Choose this proof"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </Card.Content>
              </Card>

              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Choose how to verify</Card.Title>
                  <Card.Description>
                    Now pick the provider that fits your privacy and document situation.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  {providerOptions.map((provider) => {
                    const current = selectedProvider === provider.id;
                    const compatible = getVerificationProviderClaimCompatibility(provider, humanifyIdBundle.claims);
                    return (
                      <div
                        className={`rounded-2xl border px-4 py-4 ${current ? "border-foreground/20 bg-content2" : "border-content3"}`}
                        key={provider.id}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-foreground">{provider.title}</p>
                              <span className="rounded-full border border-content3 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                                {provider.privacySummary}
                              </span>
                              <span className="rounded-full border border-content3 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                                {compatible ? "Works with this proof" : "Not available for this proof"}
                              </span>
                            </div>
                            <p>{provider.summary}</p>
                            <p className="text-xs leading-6">
                              <span className="font-semibold text-foreground">Good for:</span> {provider.goodFor}
                            </p>
                            <p className="text-xs leading-6">
                              <span className="font-semibold text-foreground">What you need:</span> {provider.whatYouNeed}
                            </p>
                            <ul className="list-disc space-y-1 pl-5">
                              {provider.benefits.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                            <p className="text-xs leading-6 text-foreground">
                              <span className="font-semibold">Privacy:</span> {provider.privacyDetails}
                            </p>
                            {provider.deletionPolicy ? (
                              <p className="text-xs leading-6 text-foreground">{provider.deletionPolicy}</p>
                            ) : null}
                            <ul className="list-disc space-y-1 pl-5 text-xs leading-6">
                              {provider.thingsToKnow.map((limitation) => (
                                <li key={limitation}>{limitation}</li>
                              ))}
                            </ul>
                          </div>
                          <Button
                            isDisabled={!compatible}
                            onPress={() => setSelectedProvider(provider.id)}
                            variant={current ? "primary" : "outline"}
                          >
                            {current ? "Selected" : "Use this option"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </Card.Content>
              </Card>

              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>What happens with your proof</Card.Title>
                  <Card.Description>
                    Your selected proof stays focused on the claims you picked instead of exposing the full identity document.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  <p className="font-medium text-foreground">{humanifyIdBundle.title}</p>
                  <p>{humanifyIdBundle.summary}</p>
                  <p>
                    <span className="font-medium text-foreground">Best for:</span> {humanifyIdBundle.bestFor}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {humanifyIdBundle.claims.map((claim) => (
                      <span
                        className="rounded-full border border-content3 px-3 py-1 text-xs font-semibold tracking-wide text-foreground uppercase"
                        key={claim}
                      >
                        {claim}
                      </span>
                    ))}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">What Humanify stores</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {humanifyIdBundle.operatorStorageGuarantees.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Later extensions</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {humanifyIdBundle.futureExtensions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </Card.Content>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Challenge step</Card.Title>
                  <Card.Description>
                    Confirm the Discord-bound challenge using the same signed session identity that created this link.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  <p>
                    The current implementation uses the Bun-issued verifier link itself as the one-time challenge proof. That
                    keeps the first path honest while Discord short-code delivery and OAuth account binding stay explicit
                    future work.
                  </p>
                  <p>
                    Selected proof: <span className="font-semibold text-foreground">{humanifyIdBundle.title}</span>
                  </p>
                  <p>
                    Selected provider: <span className="font-semibold text-foreground">{selectedProviderDefinition.title}</span>
                  </p>
                  <Button
                    isDisabled={!effectiveSession || actionState === "submitting" || challengeCompleted}
                    onPress={handleChallengeConfirmation}
                    variant="primary"
                  >
                    {challengeCompleted
                      ? "Challenge confirmed"
                      : actionState === "submitting"
                        ? "Confirming challenge…"
                        : "Confirm Discord-bound challenge"}
                  </Button>
                  {feedbackMessage ? <p className="text-sm leading-6 text-foreground">{feedbackMessage}</p> : null}
                </Card.Content>
              </Card>

              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Provider boundary</Card.Title>
                  <Card.Description>
                    Required assurance capabilities are visible, but Humanify only trusts the selected provider's server handoff.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  <div className="flex flex-wrap gap-2">
                    {(effectiveSession?.requiredCapabilities ?? []).map((capability) => (
                      <span
                        key={capability}
                        className="rounded-full border border-content3 px-3 py-1 text-xs font-semibold tracking-wide text-foreground uppercase"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                  <p>
                    Server handoff:{" "}
                    <span className="font-semibold text-foreground">
                      {providerHandoffLabel(
                        challengeData?.providerBoundary.handoffKind ?? selectedProviderDefinition.integration.handoffKind,
                      )}
                    </span>
                  </p>
                  <p>
                    Server endpoint:{" "}
                    <code className="rounded bg-content2 px-2 py-1 text-xs">
                      {challengeData?.providerBoundary.providerServerEndpoint ??
                        selectedProviderDefinition.integration.serverEndpointPath}
                    </code>
                  </p>
                  <p>{challengeData?.providerBoundary.serverVerificationNote ?? selectedProviderDefinition.integration.serverVerificationNote}</p>
                  <p>
                    The current Bun API still blocks release until this provider-neutral server verification contract is
                    implemented against canonical Postgres state. No browser-only provider status is trusted.
                  </p>
                </Card.Content>
              </Card>
            </div>
          </>
        )}
      </div>
    </ProductShell>
  );
}

function DetailRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
      <span className="font-medium text-foreground">{label}</span>
      <span className="break-all text-muted">{value}</span>
    </div>
  );
}

function providerHandoffLabel(handoffKind: "server_verified_proof" | "signed_webhook") {
  switch (handoffKind) {
    case "server_verified_proof":
      return "server-verified proof";
    case "signed_webhook":
      return "signed webhook";
  }
}
