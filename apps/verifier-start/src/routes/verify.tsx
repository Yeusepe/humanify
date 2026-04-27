/**
 * Purpose: Renders the verifier flow with user-facing proof choices, role-split capture/reusable options, and honest server-verification boundaries.
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
  getGuildVerificationClaimBundleOptions,
  getGuildVerificationProviderOptions,
  getInitialGuildVerificationSelection,
  getVerificationOptionLaunch,
  getVerificationProvider,
  getVerificationProviderAvailability,
  getVerifierApiBaseUrl,
  hasVerificationLink,
  parseVerificationSearch,
  releaseVerificationSession,
  startVerificationOptionLaunch,
  startReusableProofFlow,
  verifyReusableProofResult,
  type VerificationProviderId,
  type VerificationProviderOption,
  type VerificationChallengeData,
  type ReusableProofStartData,
  type ReusableProofVerificationData,
  type VerificationReleaseData,
  type VerificationSessionData,
} from "../verification-flow";
import { resolveVerificationOptionRouteRuntime } from "../verification-options/runtime";

export const Route = createFileRoute("/verify")({
  component: VerificationRoute,
  validateSearch: parseVerificationSearch,
});

function VerificationRoute() {
  const search = Route.useSearch();
  const [sessionData, setSessionData] = useState<VerificationSessionData | null>(null);
  const [challengeData, setChallengeData] = useState<VerificationChallengeData | null>(null);
  const [proofStartData, setProofStartData] = useState<ReusableProofStartData | null>(null);
  const [proofVerificationData, setProofVerificationData] = useState<ReusableProofVerificationData | null>(null);
  const [releaseData, setReleaseData] = useState<VerificationReleaseData | null>(null);
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
  const [browserLaunchState, setBrowserLaunchState] = useState<"idle" | "launching">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [releaseState, setReleaseState] = useState<"error" | "idle" | "releasing" | "released">("idle");

  const apiBaseUrl = getVerifierApiBaseUrl(providerEnv);

  useEffect(() => {
    let active = true;

    setChallengeData(null);
    setProofStartData(null);
    setProofVerificationData(null);
    setReleaseData(null);
    setActionState("idle");
    setReleaseState("idle");
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

  const effectiveVerificationConfig =
    releaseData?.verificationConfig ?? challengeData?.verificationConfig ?? sessionData?.verificationConfig ?? null;
  const providerOptions = useMemo(
    () => getGuildVerificationProviderOptions(effectiveVerificationConfig ?? undefined, providerEnv),
    [effectiveVerificationConfig, providerEnv],
  );
  const claimBundleOptions = useMemo(
    () => getGuildVerificationClaimBundleOptions(effectiveVerificationConfig ?? undefined),
    [effectiveVerificationConfig],
  );
  const humanifyIdBundle = useMemo(
    () =>
      claimBundleOptions.find((bundle) => bundle.bundleId === selectedClaimBundleId) ?? getDefaultHumanifyIdClaimBundle(),
    [claimBundleOptions, selectedClaimBundleId],
  );
  const providerRoleGroups = useMemo(() => splitVerificationProviderOptions(providerOptions), [providerOptions]);
  const selectedProviderDefinition = useMemo(
    () => providerOptions.find((provider) => provider.id === selectedProvider) ?? getVerificationProvider(selectedProvider, providerEnv),
    [providerEnv, providerOptions, selectedProvider],
  );
  const selectedOptionRuntime = useMemo(
    () => resolveVerificationOptionRouteRuntime(selectedProviderDefinition),
    [selectedProviderDefinition],
  );

  const effectiveSession =
    releaseData?.session ?? challengeData?.session ?? proofStartData?.session ?? proofVerificationData?.session ?? sessionData?.session ?? null;
  const activeProviderBoundary =
    releaseData?.providerBoundary ??
    proofVerificationData?.providerBoundary ??
    proofStartData?.providerBoundary ??
    challengeData?.providerBoundary ??
    sessionData?.providerBoundary ??
    null;
  const providerFlowConfigured = activeProviderBoundary?.providerFlowConfigured ?? false;
  const releaseEligible =
    releaseData?.providerBoundary.releaseEligible ??
    proofVerificationData?.providerBoundary.releaseEligible ??
    challengeData?.providerBoundary.releaseEligible ??
    sessionData?.providerBoundary.releaseEligible ??
    false;
  const challengeCompleted = challengeData?.challenge.verified ?? false;
  const providerStartEndpoint = challengeData?.providerBoundary.providerStartEndpoint;
  const providerStartToken = challengeData?.providerBoundary.providerStartToken;
  const providerSessionToken =
    proofVerificationData?.providerBoundary.providerSessionToken ??
    proofStartData?.providerBoundary.providerSessionToken;
  const activeProviderId = activeProviderBoundary?.selectedProvider ?? selectedProviderDefinition.id;
  const activeVerificationSummary = releaseData?.verification ?? proofVerificationData?.verification ?? sessionData?.verification ?? null;
  const activeReusableCredentialBridge = sessionData?.reusableCredentialBridge ?? null;
  const activeProviderDefinition = useMemo(
    () => providerOptions.find((provider) => provider.id === activeProviderId) ?? getVerificationProvider(activeProviderId, providerEnv),
    [activeProviderId, providerEnv, providerOptions],
  );
  const activeOptionRuntime = useMemo(
    () => resolveVerificationOptionRouteRuntime(activeProviderDefinition),
    [activeProviderDefinition],
  );
  const providerLaunchContract = activeProviderBoundary ? getVerificationOptionLaunch(activeProviderBoundary) : null;
  const checklist = useMemo(
    () =>
      buildVerificationChecklist({
        challengeCompleted,
        providerFlowConfigured,
        releaseEligible,
      }),
    [challengeCompleted, providerFlowConfigured, releaseEligible],
  );
  const selectedClaims = activeProviderBoundary?.requestedClaims ?? humanifyIdBundle.claims;
  const selectedProviderAvailability = useMemo(
    () =>
      getVerificationProviderAvailability({
        faceVerificationRequired: effectiveVerificationConfig?.faceVerificationRequired ?? false,
        provider: selectedProviderDefinition,
        requestedClaims: humanifyIdBundle.claims,
      }),
    [
      effectiveVerificationConfig?.faceVerificationRequired,
      humanifyIdBundle.claims,
      selectedProviderDefinition,
    ],
  );
  const humanifyKnowledge = useMemo(
    () => buildHumanifyKnowledgeSummary(selectedClaims, selectedProviderDefinition.role),
    [selectedClaims, selectedProviderDefinition.role],
  );
  const faceVerificationSummary = useMemo(
    () =>
      buildFaceVerificationSummary({
        faceVerificationRequired: effectiveVerificationConfig?.faceVerificationRequired ?? false,
        providerRole: selectedProviderDefinition.role,
        requiredCapabilities: activeProviderBoundary?.requiredCapabilities ?? effectiveSession?.requiredCapabilities ?? [],
      }),
    [
      activeProviderBoundary?.requiredCapabilities,
      effectiveSession?.requiredCapabilities,
      effectiveVerificationConfig?.faceVerificationRequired,
      selectedProviderDefinition.role,
    ],
  );

  useEffect(() => {
    const initialSelection = getInitialGuildVerificationSelection(effectiveVerificationConfig ?? undefined, providerEnv);
    const selectedBundle = claimBundleOptions.find((bundle) => bundle.bundleId === selectedClaimBundleId) ?? claimBundleOptions[0];
    const currentProvider = providerOptions.find((provider) => provider.id === selectedProvider);
    const firstAllowedProvider = selectedBundle
      ? providerOptions.find((provider) =>
          getVerificationProviderAvailability({
            faceVerificationRequired: effectiveVerificationConfig?.faceVerificationRequired ?? false,
            provider,
            requestedClaims: selectedBundle.claims,
          }).allowed
        )
      : undefined;
    const currentProviderAvailable = currentProvider && selectedBundle
      ? getVerificationProviderAvailability({
          faceVerificationRequired: effectiveVerificationConfig?.faceVerificationRequired ?? false,
          provider: currentProvider,
          requestedClaims: selectedBundle.claims,
        }).allowed
      : false;

    if (!selectedBundle && initialSelection.claimBundleId !== selectedClaimBundleId) {
      setSelectedClaimBundleId(initialSelection.claimBundleId);
    }

    const fallbackProviderId = firstAllowedProvider?.id ?? initialSelection.providerId;
    if (!currentProviderAvailable && fallbackProviderId !== selectedProvider) {
      setSelectedProvider(fallbackProviderId);
      return;
    }

    if (!currentProvider) {
      setSelectedProvider(initialSelection.providerId);
    }
  }, [
    claimBundleOptions,
    effectiveVerificationConfig,
    providerEnv,
    providerOptions,
    selectedClaimBundleId,
    selectedProvider,
  ]);

  async function refreshSessionStatus() {
    if (!hasVerificationLink(search)) {
      return;
    }

    const refreshed = await fetchVerificationSession(fetch, {
      apiBaseUrl,
      sessionId: search.sessionId,
      token: search.token,
    });
    setSessionData(refreshed);
  }

  useEffect(() => {
    if (!hasVerificationLink(search) || !effectiveSession || effectiveSession.state !== "passed" || releaseData || releaseState === "releasing") {
      return;
    }

    let active = true;
    setReleaseState("releasing");

    void releaseVerificationSession(fetch, {
      apiBaseUrl,
      guildId: effectiveSession.guildId,
      sessionId: effectiveSession.sessionId,
      token: search.token,
      userId: effectiveSession.userId,
    })
      .then((data) => {
        if (!active) {
          return;
        }

        setReleaseData(data);
        setReleaseState("released");
        setFeedbackMessage(
          data.release.appliedRoleIds.length > 0
            ? `Verification complete. Humanify applied ${data.release.appliedRoleIds.length} Discord role(s).`
            : "Verification complete. Humanify did not need to apply any additional Discord roles for this server.",
        );
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setReleaseState("error");
        setFeedbackMessage(error instanceof Error ? error.message : "Verification release failed.");
      });

    return () => {
      active = false;
    };
  }, [apiBaseUrl, effectiveSession, releaseData, releaseState, search]);

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
      const completedProvider = getVerificationProvider(data.providerBoundary.selectedProvider ?? selectedProvider, providerEnv);
      const completedRuntime = resolveVerificationOptionRouteRuntime(completedProvider);
      const completedLaunch = getVerificationOptionLaunch(data.providerBoundary);
      setFeedbackMessage(
        completedLaunch && completedRuntime.browserLaunch
          ? completedRuntime.browserLaunch.challengeAcceptedMessage(completedProvider)
          : `Challenge accepted. ${completedProvider.title} is now the selected verification path, but release still waits for Humanify's server-side provider verification contract.`,
      );
    } catch (error) {
      setActionState("error");
      setFeedbackMessage(error instanceof Error ? error.message : "Challenge confirmation failed.");
    }
  }

  async function handleStartReusableProof() {
    if (!providerStartEndpoint || !providerStartToken) {
      return;
    }

    setActionState("submitting");
    setFeedbackMessage(null);

    try {
      const currentUrl = typeof window === "undefined" ? undefined : window.location.href;
      const data = await startReusableProofFlow(fetch, {
        apiBaseUrl,
        backUrl: currentUrl,
        finishUrl: currentUrl,
        providerId: selectedProvider,
        providerStartEndpoint,
        providerStartToken,
      });

      setProofStartData(data);
      setProofVerificationData(null);
      setActionState("success");
      setFeedbackMessage(
        selectedOptionRuntime.reusableProof?.startSuccessMessage(selectedProviderDefinition)
          ?? `${selectedProviderDefinition.title} proof request created. Return here so Humanify can verify the proof server-side.`,
      );
    } catch (error) {
      setActionState("error");
      setFeedbackMessage(
        error instanceof Error
          ? error.message
          : selectedOptionRuntime.reusableProof?.startErrorMessage(selectedProviderDefinition)
            ?? "Proof request creation failed.",
      );
    }
  }

  async function handleVerifyReusableProof() {
    if (!providerSessionToken) {
      return;
    }

    setActionState("submitting");
    setFeedbackMessage(null);

    try {
      const data = await verifyReusableProofResult(fetch, {
        apiBaseUrl,
        providerId: activeProviderDefinition.id,
        providerSessionToken,
      });

      setProofVerificationData(data);
      setActionState("success");
      setFeedbackMessage(data.verification.message);
    } catch (error) {
      setActionState("error");
      setFeedbackMessage(
        error instanceof Error
          ? error.message
          : selectedOptionRuntime.reusableProof?.verifyErrorMessage(selectedProviderDefinition)
            ?? "Proof verification failed.",
      );
    }
  }

  async function handleBrowserLaunchStart() {
    if (!providerLaunchContract || !activeOptionRuntime.browserLaunch) {
      return;
    }

    setBrowserLaunchState("launching");
    setFeedbackMessage(null);

    try {
      await startVerificationOptionLaunch({
        launch: providerLaunchContract,
        onBrowserResult(result) {
          setFeedbackMessage(result.message);
          if (result.refreshStatus) {
            void refreshSessionStatus().catch(() => undefined);
          }
        },
      });
    } catch (error) {
      setFeedbackMessage(
        error instanceof Error
          ? error.message
          : activeOptionRuntime.browserLaunch.errorMessage(activeProviderDefinition),
      );
    } finally {
      setBrowserLaunchState("idle");
    }
  }

  return (
    <ProductShell
      description="This verifier uses Bun-signed challenge state plus the server-returned verification config snapshot so people only see the proof paths the server currently allows."
      eyebrow="HUMANIFY / VERIFIER"
      panels={[
        {
          description: "Current session lifecycle state from Bun-owned verification boundaries.",
          title: "Session state",
          value: effectiveSession?.state ?? "link required",
        },
        {
          description: "Allowed proof bundles and face-check rules from the guild verification config snapshot.",
          title: "Guild rules",
          value: effectiveVerificationConfig ? String(effectiveVerificationConfig.requiredBundleIds.length) : "0",
          variant: "secondary",
        },
        {
          description: "Browser completion never counts on its own. Humanify waits for the provider's server-side verification result.",
          title: "Release status",
          value: effectiveSession?.state === "released" ? "released" : releaseEligible ? "eligible" : "blocked",
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
                  This verifier only trusts Bun-signed links and server-verified provider receipts. It never treats a browser-only
                  completion screen as success, but it can now finish the verified release step once Bun confirms the session.
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
                    Derived from the signed challenge token and refreshed from the Bun API, not from synthetic client-side state.
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
                      {releaseData ? (
                        <DetailRow
                          label="Released roles"
                          value={releaseData.release.appliedRoleIds.join(", ") || "None"}
                        />
                      ) : null}
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
                  <Card.Title>Server verification rules</Card.Title>
                  <Card.Description>
                    The Bun API decides which proof bundles, providers, and face-check rules apply to this server.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                  {effectiveVerificationConfig ? (
                    <>
                      <DetailRow
                        label="Config source"
                        value={effectiveVerificationConfig.source === "persisted" ? "saved guild settings" : "server defaults"}
                      />
                      <DetailRow
                        label="Allowed providers"
                        value={providerOptions.map((provider) => provider.title).join(", ") || "No provider allowed"}
                      />
                      <DetailRow
                        label="Allowed proofs"
                        value={claimBundleOptions.map((bundle) => bundle.title).join(", ") || "No proof bundle allowed"}
                      />
                      <DetailRow
                        label="Face check"
                        value={effectiveVerificationConfig.faceVerificationRequired ? "Required for this server" : "Not required"}
                      />
                    </>
                  ) : (
                    <p>Load the signed session first so Humanify can show the guild's current verification rules.</p>
                  )}
                </Card.Content>
              </Card>
            </div>

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

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Choose what to prove</Card.Title>
                  <Card.Description>
                    Pick from the proof bundles this server currently allows. Humanify keeps this focused on the smallest acceptable proof.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  {claimBundleOptions.length === 0 ? (
                    <p>This server has not exposed an allowed proof bundle for this verification session.</p>
                  ) : claimBundleOptions.map((bundle) => {
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
                                  {formatVerificationLabel(claim)}
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
                  <Card.Title>What Humanify learns</Card.Title>
                  <Card.Description>
                    Humanify stores only the minimum proof facts needed to apply the server's verification policy.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                  <div>
                    <p className="font-medium text-foreground">What Humanify learns</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {humanifyKnowledge.learns.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">What Humanify does not learn</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {humanifyKnowledge.doesNotLearn.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-content3 px-4 py-4">
                    <p className="font-medium text-foreground">Face verification</p>
                    <p className="mt-2">{faceVerificationSummary.title}</p>
                    <p className="mt-1 text-xs leading-6">{faceVerificationSummary.detail}</p>
                  </div>
                </Card.Content>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <ProviderLaneCard
                description="Use a fresh capture flow when you do not already hold a reusable proof. Humanify keeps the app generic by reading these options from the shared strategy catalog."
                emptyState="This server has not enabled a first-time capture flow."
                faceVerificationRequired={effectiveVerificationConfig?.faceVerificationRequired ?? false}
                providers={providerRoleGroups.captureProviders}
                selectedBundleClaims={humanifyIdBundle.claims}
                selectedProvider={selectedProvider}
                setSelectedProvider={setSelectedProvider}
                title="First-time capture options"
              />
              <ProviderLaneCard
                description="Use a reusable proof when you already have a wallet credential. The credential stays with you while Humanify verifies only the required proof."
                emptyState="This server has not enabled a reusable proof backend."
                faceVerificationRequired={effectiveVerificationConfig?.faceVerificationRequired ?? false}
                providers={providerRoleGroups.reusableProofBackends}
                selectedBundleClaims={humanifyIdBundle.claims}
                selectedProvider={selectedProvider}
                setSelectedProvider={setSelectedProvider}
                title="Reusable proof options"
              />
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
                    Humanify uses this signed verifier link as the current Discord-bound challenge proof. After that, the API
                    either creates the real provider session or keeps the next step blocked until the backend contract exists.
                  </p>
                  <p>
                    Selected proof: <span className="font-semibold text-foreground">{humanifyIdBundle.title}</span>
                  </p>
                  <p>
                    Selected provider: <span className="font-semibold text-foreground">{selectedProviderDefinition.title}</span>
                  </p>
                  {!selectedProviderAvailability.allowed && selectedProviderAvailability.reason ? (
                    <p className="rounded-2xl border border-content3 px-4 py-3 text-sm leading-6">
                      {selectedProviderAvailability.reason}
                    </p>
                  ) : null}
                  <Button
                    isDisabled={
                      !effectiveSession
                      || actionState === "submitting"
                      || challengeCompleted
                      || !selectedProviderAvailability.allowed
                    }
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
                        {formatVerificationLabel(capability)}
                      </span>
                    ))}
                  </div>
                  <p>
                    Server handoff:{" "}
                    <span className="font-semibold text-foreground">
                      {providerHandoffLabel(
                        activeProviderBoundary?.handoffKind ?? selectedProviderDefinition.integration.handoffKind,
                      )}
                    </span>
                  </p>
                  <p>
                    Server endpoint:{" "}
                    <code className="rounded bg-content2 px-2 py-1 text-xs">
                      {activeProviderBoundary?.providerServerEndpoint ??
                        selectedProviderDefinition.integration.serverEndpointPath}
                    </code>
                  </p>
                  <p>{activeProviderBoundary?.serverVerificationNote ?? selectedProviderDefinition.integration.serverVerificationNote}</p>
                  <div className="rounded-2xl border border-content3 px-4 py-4">
                    <p className="font-semibold text-foreground">Face verification</p>
                    <p className="mt-2">{faceVerificationSummary.title}</p>
                    <p className="mt-1 text-xs leading-6">{faceVerificationSummary.detail}</p>
                  </div>
                  <p>
                    Humanify never treats a browser-only provider screen as verified. Only the signed server handoff can move
                    the canonical session forward.
                  </p>
                  {providerLaunchContract && activeOptionRuntime.browserLaunch ? (
                    <>
                      <p>{activeOptionRuntime.browserLaunch.intro(activeProviderDefinition)}</p>
                      <Button
                        isDisabled={browserLaunchState === "launching"}
                        onPress={handleBrowserLaunchStart}
                        variant="primary"
                      >
                        {activeOptionRuntime.browserLaunch.launchButtonLabel(activeProviderDefinition, browserLaunchState)}
                      </Button>
                      <p className="text-xs leading-6">
                        {activeOptionRuntime.browserLaunch.pendingNote(activeProviderDefinition)}
                      </p>
                    </>
                  ) : null}
                  {activeOptionRuntime.reusableProof && providerStartEndpoint && providerStartToken ? (
                    <>
                      <div className="rounded-2xl border border-content3 bg-content2 px-4 py-4">
                        <p className="font-semibold text-foreground">
                          {activeOptionRuntime.reusableProof.summaryTitle(activeProviderDefinition)}
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-6">
                          {activeOptionRuntime.reusableProof.summaryBullets(activeProviderDefinition).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          isDisabled={actionState === "submitting"}
                          onPress={handleStartReusableProof}
                          variant="primary"
                        >
                          {activeOptionRuntime.reusableProof.createRequestLabel(activeProviderDefinition, Boolean(proofStartData))}
                        </Button>
                        <Button
                          isDisabled={!proofStartData?.flow.universalLink}
                          onPress={() => {
                            if (proofStartData?.flow.universalLink) {
                              window.location.assign(proofStartData.flow.universalLink);
                            }
                          }}
                          variant="outline"
                        >
                          {activeOptionRuntime.reusableProof.openWalletLabel(activeProviderDefinition)}
                        </Button>
                        <Button
                          isDisabled={!providerSessionToken || actionState === "submitting"}
                          onPress={handleVerifyReusableProof}
                          variant="outline"
                        >
                          Check proof status
                        </Button>
                      </div>
                      {proofStartData ? (
                        <div className="space-y-2 text-xs leading-6">
                          <p>
                            Provider session:{" "}
                            <code className="rounded bg-content2 px-2 py-1">{proofStartData.flow.providerSessionId}</code>
                          </p>
                          {proofStartData.flow.requestUri ? (
                            <p className="break-all">
                              Request URI: <code className="rounded bg-content2 px-2 py-1">{proofStartData.flow.requestUri}</code>
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {proofVerificationData ? (
                        <div className="rounded-2xl border border-content3 px-4 py-4 text-xs leading-6">
                          <p className="font-semibold text-foreground">
                            Proof status: {proofVerificationData.verification.status}
                          </p>
                          <p>{proofVerificationData.verification.message}</p>
                          <p>
                            Satisfied claims:{" "}
                            {proofVerificationData.verification.satisfiedClaims.length > 0
                              ? proofVerificationData.verification.satisfiedClaims.join(", ")
                              : "none yet"}
                          </p>
                          <p>
                            Receipt ref:{" "}
                            {proofVerificationData.verification.proofReceipt.proofReceiptRef ?? "not issued yet"}
                          </p>
                        </div>
                      ) : null}
                      {releaseData ? (
                        <div className="rounded-2xl border border-content3 px-4 py-4 text-xs leading-6">
                          <p className="font-semibold text-foreground">Discord role release</p>
                          <p>Released at: {releaseData.release.releasedAt}</p>
                          <p>Applied roles: {releaseData.release.appliedRoleIds.join(", ") || "none"}</p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </Card.Content>
              </Card>
            </div>

            {(activeVerificationSummary || activeReusableCredentialBridge) ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Current proof summary</Card.Title>
                    <Card.Description>
                      Humanify shows the current server-side proof summary exactly as the API returned it.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                    {activeVerificationSummary ? (
                      <>
                        {activeVerificationSummary.status ? (
                          <DetailRow label="Status" value={activeVerificationSummary.status} />
                        ) : null}
                        {activeVerificationSummary.providerReferenceId ? (
                          <DetailRow label="Provider reference" value={activeVerificationSummary.providerReferenceId} />
                        ) : null}
                        {activeVerificationSummary.proofReceiptRef ? (
                          <DetailRow label="Receipt ref" value={activeVerificationSummary.proofReceiptRef} />
                        ) : null}
                        {activeVerificationSummary.proofReceiptHash ? (
                          <DetailRow label="Receipt hash" value={activeVerificationSummary.proofReceiptHash} />
                        ) : null}
                        {activeVerificationSummary.satisfiedClaims?.length ? (
                          <DetailRow
                            label="Satisfied claims"
                            value={activeVerificationSummary.satisfiedClaims.map((claim) => formatVerificationLabel(claim)).join(", ")}
                          />
                        ) : null}
                        {typeof activeVerificationSummary.faceVerificationPerformed === "boolean" ? (
                          <DetailRow
                            label="Face check performed"
                            value={activeVerificationSummary.faceVerificationPerformed ? "Yes" : "No"}
                          />
                        ) : null}
                        {typeof activeVerificationSummary.faceVerificationPassed === "boolean" ? (
                          <DetailRow
                            label="Face check passed"
                            value={activeVerificationSummary.faceVerificationPassed ? "Yes" : "No"}
                          />
                        ) : null}
                      </>
                    ) : (
                      <p>No server-side proof summary is available yet.</p>
                    )}
                  </Card.Content>
                </Card>

                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Reusable credential bridge</Card.Title>
                    <Card.Description>
                      If Humanify prepared a reusable handoff, show that bridge honestly instead of pretending the wallet step already happened.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                    {activeReusableCredentialBridge ? (
                      <>
                        {activeReusableCredentialBridge.status ? (
                          <DetailRow label="Bridge status" value={activeReusableCredentialBridge.status} />
                        ) : null}
                        {activeReusableCredentialBridge.targetProvider ? (
                          <DetailRow label="Target proof path" value={activeReusableCredentialBridge.targetProvider} />
                        ) : null}
                        {activeReusableCredentialBridge.approvedClaims?.length ? (
                          <DetailRow
                            label="Approved claims"
                            value={activeReusableCredentialBridge.approvedClaims.map((claim) => formatVerificationLabel(claim)).join(", ")}
                          />
                        ) : null}
                        {activeReusableCredentialBridge.claims?.disclosedAttributes ? (
                          <DetailRow
                            label="Disclosed attributes"
                            value={Object.entries(activeReusableCredentialBridge.claims.disclosedAttributes)
                              .map(([key, value]) => `${formatVerificationLabel(key)}: ${value}`)
                              .join(", ")}
                          />
                        ) : null}
                        {activeReusableCredentialBridge.temporaryRetention?.expiresAt ? (
                          <DetailRow
                            label="Temporary retention"
                            value={activeReusableCredentialBridge.temporaryRetention.expiresAt}
                          />
                        ) : null}
                      </>
                    ) : (
                      <p>No reusable credential bridge is attached to this session yet.</p>
                    )}
                  </Card.Content>
                </Card>
              </div>
            ) : null}
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

function ProviderLaneCard({
  description,
  emptyState,
  faceVerificationRequired,
  providers,
  selectedBundleClaims,
  selectedProvider,
  setSelectedProvider,
  title,
}: Readonly<{
  description: string;
  emptyState: string;
  faceVerificationRequired: boolean;
  providers: readonly VerificationProviderOption[];
  selectedBundleClaims: Parameters<typeof getVerificationProviderAvailability>[0]["requestedClaims"];
  selectedProvider: VerificationProviderId;
  setSelectedProvider: (providerId: VerificationProviderId) => void;
  title: string;
}>) {
  if (providers.length === 0) {
    return (
      <Card>
        <Card.Header className="gap-2">
          <Card.Title>{title}</Card.Title>
          <Card.Description>{description}</Card.Description>
        </Card.Header>
        <Card.Content className="text-sm leading-7 text-muted">
          <p>{emptyState}</p>
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header className="gap-2">
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4 text-sm leading-7 text-muted">
        {providers.map((provider) => {
          const current = selectedProvider === provider.id;
          const availability = getVerificationProviderAvailability({
            faceVerificationRequired,
            provider,
            requestedClaims: selectedBundleClaims,
          });
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
                      {availability.allowed ? "Works with this proof" : "Blocked for this server"}
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
                  {!availability.allowed && availability.reason ? (
                    <p className="text-xs leading-6 text-foreground">{availability.reason}</p>
                  ) : null}
                </div>
                <Button
                  isDisabled={!availability.allowed}
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
  );
}

function splitVerificationProviderOptions(providers: readonly VerificationProviderOption[]) {
  return {
    captureProviders: providers.filter((provider) => provider.role === "capture_provider"),
    reusableProofBackends: providers.filter((provider) => provider.role === "reusable_proof_backend"),
  };
}

function buildHumanifyKnowledgeSummary(selectedClaims: readonly string[], providerRole: string) {
  const readableClaims = selectedClaims.map((claim) => formatVerificationLabel(claim)).join(", ");

  return {
    doesNotLearn: [
      "Your raw document images or selfie capture files.",
      "Passport, ID-card, or document numbers.",
      "Your date of birth or a full copy of a reusable wallet credential.",
    ],
    learns: [
      `Whether these checks passed for this session: ${readableClaims || "the selected proof bundle"}.`,
      providerRole === "capture_provider"
        ? "Minimal attestation facts, expiry windows, and whether a face or liveness step ran and passed."
        : "Minimal proof receipt refs, trusted issuer scopes, expiry windows, and replay-safe nullifiers.",
    ],
  };
}

function buildFaceVerificationSummary(input: {
  faceVerificationRequired: boolean;
  providerRole: string;
  requiredCapabilities: readonly string[];
}) {
  if (input.providerRole !== "capture_provider") {
    return {
      detail:
        "Reusable proof backends do not ask you for a new selfie in Humanify's current flow. If the server still needs liveness, pick a first-time capture option instead.",
      title: "Not part of this reusable proof",
    };
  }

  if (input.faceVerificationRequired || input.requiredCapabilities.includes("face_verification")) {
    return {
      detail:
        "This server currently asks for a live selfie or liveness step before release. Humanify stores only whether that check ran and whether it passed.",
      title: "Required for this first-time capture",
    };
  }

  return {
    detail:
      "This first-time capture flow can still include a face or liveness step when the provider workflow needs it. Humanify only keeps the normalized pass/fail facts.",
    title: "Possible during first-time capture",
  };
}

function formatVerificationLabel(value: string) {
  return value.replace(/_/g, " ");
}

function providerHandoffLabel(handoffKind: "server_verified_proof" | "signed_webhook") {
  switch (handoffKind) {
    case "server_verified_proof":
      return "server-verified proof";
    case "signed_webhook":
      return "signed webhook";
  }
}
