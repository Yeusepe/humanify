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

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Button, Card, Spinner } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

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
    <div className="min-h-screen bg-background px-4 py-10 text-foreground md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pt-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-accent uppercase">
              Humanify verifier
            </span>
            <span className="rounded-full border border-content3 bg-content2 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
              Bun authoritative
            </span>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">Prove you&apos;re human</h1>
            <p className="max-w-3xl text-base leading-8 text-muted">
              One session, one trusted server decision, and only the verification methods this server actually allows.
            </p>
          </div>
          {(search.serverName || search.username) ? (
            <div className="flex flex-wrap gap-2">
              {search.serverName ? <MetaBadge label={search.serverName} /> : null}
              {search.username ? <MetaBadge label={search.username} /> : null}
            </div>
          ) : null}
        </header>

        {!hasVerificationLink(search) ? (
          <Card className="max-w-xl">
            <Card.Header className="gap-2">
              <Card.Title>Signed verifier link required</Card.Title>
              <Card.Description>
                Open this page from the Humanify link that includes the signed session token.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-3 text-sm leading-7 text-muted">
              <p>
                Humanify only trusts Bun-signed links and server-verified provider receipts. A browser-only completion screen is
                never enough to release Discord roles.
              </p>
              <p className="font-medium text-foreground">
                Expected query params: <code className="rounded bg-content2 px-2 py-1 text-xs">sessionId</code> and{" "}
                <code className="rounded bg-content2 px-2 py-1 text-xs">token</code>.
              </p>
            </Card.Content>
          </Card>
        ) : (
          <>
            <Card>
              <Card.Header className="gap-2">
                <Card.Title>Session progress</Card.Title>
                <Card.Description>
                  The browser can guide you, but only the trusted server path moves this session forward.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-3 md:grid-cols-3">
                {checklist.map((item) => (
                  <div className="rounded-3xl border border-content3 bg-content1 px-4 py-4" key={item.title}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p>
                  </div>
                ))}
              </Card.Content>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
              <div className="space-y-4">
                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Pick what to prove</Card.Title>
                    <Card.Description>
                      Humanify keeps the request as small as the server policy allows.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-3">
                    {claimBundleOptions.length === 0 ? (
                      <p className="text-sm leading-7 text-muted">
                        This server has not exposed a proof bundle for the current session.
                      </p>
                    ) : (
                      claimBundleOptions.map((bundle) => {
                        const current = humanifyIdBundle.bundleId === bundle.bundleId;
                        return (
                          <div
                            className={`rounded-3xl border px-4 py-4 ${
                              current ? "border-accent/25 bg-accent/5" : "border-content3 bg-content1"
                            }`}
                            key={bundle.bundleId}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-2">
                                <p className="font-semibold text-foreground">{bundle.title}</p>
                                <p className="text-sm leading-6 text-muted">{bundle.summary}</p>
                                <div className="flex flex-wrap gap-2">
                                  {bundle.claims.map((claim) => (
                                    <MetaBadge key={claim} label={formatVerificationLabel(claim)} />
                                  ))}
                                </div>
                              </div>
                              <Button onPress={() => setSelectedClaimBundleId(bundle.bundleId)} variant={current ? "primary" : "outline"}>
                                {current ? "Selected" : "Choose"}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </Card.Content>
                </Card>

                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Pick a verification method</Card.Title>
                    <Card.Description>
                      Only server-enabled options appear here. Choose the path that fits the proof you selected.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-5">
                    <ProviderLaneCard
                      description="Fresh capture for people starting from scratch."
                      emptyState="No first-time capture flow is enabled for this server."
                      faceVerificationRequired={effectiveVerificationConfig?.faceVerificationRequired ?? false}
                      providers={providerRoleGroups.captureProviders}
                      selectedBundleClaims={humanifyIdBundle.claims}
                      selectedProvider={selectedProvider}
                      setSelectedProvider={setSelectedProvider}
                      title="First-time capture"
                    />
                    <ProviderLaneCard
                      description="Reusable proofs for people who already hold a wallet credential."
                      emptyState="No reusable proof backend is enabled for this server."
                      faceVerificationRequired={effectiveVerificationConfig?.faceVerificationRequired ?? false}
                      providers={providerRoleGroups.reusableProofBackends}
                      selectedBundleClaims={humanifyIdBundle.claims}
                      selectedProvider={selectedProvider}
                      setSelectedProvider={setSelectedProvider}
                      title="Reusable proof"
                    />
                  </Card.Content>
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Next step</Card.Title>
                    <Card.Description>
                      Humanify keeps one clear action in front of you and waits for the trusted server handoff before release.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                    <div className="flex flex-wrap gap-2">
                      <MetaBadge label={selectedProviderDefinition.title} />
                      <MetaBadge label={humanifyIdBundle.title} />
                    </div>

                    {loadState === "loading" ? (
                      <InlineLoading label="Loading the signed session from the Bun API…" />
                    ) : loadState === "error" ? (
                      <NoticePanel tone="danger">{feedbackMessage ?? "Verification session loading failed."}</NoticePanel>
                    ) : releaseState === "releasing" ? (
                      <InlineLoading label="Applying the release decision and Discord roles…" />
                    ) : releaseData ? (
                      <NoticePanel tone="success">
                        Verification complete. {releaseData.release.appliedRoleIds.length > 0
                          ? `Humanify applied ${releaseData.release.appliedRoleIds.length} Discord role(s).`
                          : "No additional Discord roles were needed for this server."}
                      </NoticePanel>
                    ) : activeOptionRuntime.reusableProof && providerStartEndpoint && providerStartToken ? (
                      <>
                        <p>
                          Create the request, complete it in your wallet, then return here so Humanify can verify the proof server-side.
                        </p>
                        <div className="flex flex-col gap-2">
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
                      </>
                    ) : providerLaunchContract && activeOptionRuntime.browserLaunch ? (
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
                    ) : (
                      <>
                        <p>
                          Confirm the Discord-bound challenge first. Humanify uses the same signed session identity that created this
                          link.
                        </p>
                        {!selectedProviderAvailability.allowed && selectedProviderAvailability.reason ? (
                          <NoticePanel tone="warning">{selectedProviderAvailability.reason}</NoticePanel>
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
                              : "Confirm challenge"}
                        </Button>
                      </>
                    )}

                    {feedbackMessage ? <NoticePanel>{feedbackMessage}</NoticePanel> : null}
                  </Card.Content>
                </Card>

                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Session details</Card.Title>
                    <Card.Description>
                      Signed session context, current guild rules, and the trusted provider boundary.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                    {loadState === "loading" ? (
                      <InlineLoading label="Loading session details…" />
                    ) : effectiveSession ? (
                      <>
                        <DetailRow label="Session" value={effectiveSession.sessionId} />
                        <DetailRow label="Challenge" value={effectiveSession.challengeId} />
                        <DetailRow label="State" value={formatVerificationLabel(effectiveSession.state)} />
                        <DetailRow
                          label="Allowed methods"
                          value={providerOptions.map((provider) => provider.title).join(", ") || "none"}
                        />
                        <DetailRow
                          label="Face check"
                          value={effectiveVerificationConfig?.faceVerificationRequired ? "Required" : "Not required"}
                        />
                        <DetailRow
                          label="Server handoff"
                          value={providerHandoffLabel(
                            activeProviderBoundary?.handoffKind ?? selectedProviderDefinition.integration.handoffKind,
                          )}
                        />
                        <DetailRow
                          label="Server endpoint"
                          value={
                            activeProviderBoundary?.providerServerEndpoint
                            ?? selectedProviderDefinition.integration.serverEndpointPath
                          }
                        />
                        {(effectiveSession.requiredCapabilities ?? []).length > 0 ? (
                          <div className="space-y-2">
                            <p className="font-medium text-foreground">Required capabilities</p>
                            <div className="flex flex-wrap gap-2">
                              {(effectiveSession.requiredCapabilities ?? []).map((capability) => (
                                <MetaBadge key={capability} label={formatVerificationLabel(capability)} />
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p>Session details are unavailable until the signed link loads successfully.</p>
                    )}
                  </Card.Content>
                </Card>

                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>What Humanify keeps</Card.Title>
                    <Card.Description>
                      Minimal facts only. Raw identity materials stay outside Humanify.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-4 text-sm leading-7 text-muted">
                    <div>
                      <p className="font-medium text-foreground">Stored for this session</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {humanifyKnowledge.learns.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Never stored here</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {humanifyKnowledge.doesNotLearn.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-3xl border border-content3 bg-content1 px-4 py-4">
                      <p className="font-medium text-foreground">{faceVerificationSummary.title}</p>
                      <p className="mt-2 text-sm leading-6 text-muted">{faceVerificationSummary.detail}</p>
                    </div>
                  </Card.Content>
                </Card>
              </div>
            </div>

            {(activeVerificationSummary || activeReusableCredentialBridge || proofVerificationData) ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <Card.Header className="gap-2">
                    <Card.Title>Current proof summary</Card.Title>
                    <Card.Description>
                      The latest server-side verification facts attached to this session.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                    {activeVerificationSummary ? (
                      <>
                        {activeVerificationSummary.verificationDecision?.message ? (
                          <NoticePanel
                            tone={activeVerificationSummary.verificationDecision.releaseEligible
                              ? "success"
                              : activeVerificationSummary.verificationDecision.reviewRequired
                                ? "warning"
                                : "default"}
                          >
                            {activeVerificationSummary.verificationDecision.message}
                          </NoticePanel>
                        ) : null}
                        {activeVerificationSummary.status ? <DetailRow label="Status" value={activeVerificationSummary.status} /> : null}
                        {activeVerificationSummary.verificationDecision ? (
                          <DetailRow
                            label="Decision"
                            value={formatVerificationLabel(activeVerificationSummary.verificationDecision.action)}
                          />
                        ) : null}
                        {activeVerificationSummary.providerReferenceId ? (
                          <DetailRow label="Provider reference" value={activeVerificationSummary.providerReferenceId} />
                        ) : null}
                        {activeVerificationSummary.proofReceiptRef ? (
                          <DetailRow label="Receipt ref" value={activeVerificationSummary.proofReceiptRef} />
                        ) : null}
                        {activeVerificationSummary.satisfiedClaims?.length ? (
                          <DetailRow
                            label="Satisfied claims"
                            value={activeVerificationSummary.satisfiedClaims.map((claim) => formatVerificationLabel(claim)).join(", ")}
                          />
                        ) : null}
                        {typeof activeVerificationSummary.faceVerificationPassed === "boolean" ? (
                          <DetailRow
                            label="Face check passed"
                            value={activeVerificationSummary.faceVerificationPassed ? "Yes" : "No"}
                          />
                        ) : null}
                      </>
                    ) : proofVerificationData ? (
                      <>
                        <DetailRow label="Status" value={proofVerificationData.verification.status} />
                        <DetailRow label="Provider" value={proofVerificationData.verification.providerId} />
                        <DetailRow
                          label="Satisfied claims"
                          value={
                            proofVerificationData.verification.satisfiedClaims.length > 0
                              ? proofVerificationData.verification.satisfiedClaims.map((claim) => formatVerificationLabel(claim)).join(", ")
                              : "none yet"
                          }
                        />
                        <DetailRow
                          label="Receipt ref"
                          value={proofVerificationData.verification.proofReceipt.proofReceiptRef ?? "not issued yet"}
                        />
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
                      If Humanify prepared a reusable handoff, it appears here without pretending the proof already passed.
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                    {activeReusableCredentialBridge ? (
                      <>
                        {activeReusableCredentialBridge.status ? (
                          <DetailRow label="Bridge status" value={activeReusableCredentialBridge.status} />
                        ) : null}
                        {activeReusableCredentialBridge.targetProvider ? (
                          <DetailRow label="Target provider" value={activeReusableCredentialBridge.targetProvider} />
                        ) : null}
                        {activeReusableCredentialBridge.approvedClaims?.length ? (
                          <DetailRow
                            label="Approved claims"
                            value={activeReusableCredentialBridge.approvedClaims.map((claim) => formatVerificationLabel(claim)).join(", ")}
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
    </div>
  );
}

function DetailRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-content3 bg-content1 px-3 py-3 sm:flex-row sm:items-baseline sm:justify-between">
      <span className="font-medium text-foreground">{label}</span>
      <span className="break-all text-muted">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: "blocked" | "complete" | "pending" }>) {
  const tone =
    status === "complete"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : status === "blocked"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : "border-content3 bg-content2 text-muted";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase ${tone}`}>
      {status}
    </span>
  );
}

function MetaBadge({ label }: Readonly<{ label: string }>) {
  return (
    <span className="rounded-full border border-content3 bg-content2 px-3 py-1 text-[11px] font-medium tracking-[0.14em] text-foreground">
      {label}
    </span>
  );
}

function InlineLoading({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-content3 bg-content1 px-4 py-3">
      <Spinner size="sm" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

function NoticePanel({
  children,
  tone = "default",
}: Readonly<{
  children: ReactNode;
  tone?: "danger" | "default" | "success" | "warning";
}>) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
        : tone === "danger"
          ? "border-danger/20 bg-danger/10 text-danger"
          : "border-content3 bg-content2 text-foreground";

  return <div className={`rounded-3xl border px-4 py-3 text-sm leading-6 ${toneClasses}`}>{children}</div>;
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
      <div className="space-y-2">
        <div className="space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm leading-6 text-muted">{description}</p>
        </div>
        <p className="rounded-3xl border border-content3 bg-content1 px-4 py-4 text-sm leading-6 text-muted">{emptyState}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm leading-6 text-muted">{description}</p>
      </div>
      <div className="space-y-3">
        {providers.map((provider) => {
          const current = selectedProvider === provider.id;
          const availability = getVerificationProviderAvailability({
            faceVerificationRequired,
            provider,
            requestedClaims: selectedBundleClaims,
          });
          return (
            <div
              className={`rounded-3xl border px-4 py-4 ${
                current ? "border-accent/25 bg-accent/5" : "border-content3 bg-content1"
              }`}
              key={provider.id}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{provider.title}</p>
                    <MetaBadge label={provider.privacySummary} />
                    {!availability.allowed ? <MetaBadge label="Unavailable" /> : null}
                  </div>
                  <p className="text-sm leading-6 text-muted">{provider.summary}</p>
                  <p className="text-xs leading-6 text-muted">{provider.whatYouNeed}</p>
                  {!availability.allowed && availability.reason ? (
                    <p className="text-xs leading-6 text-foreground">{availability.reason}</p>
                  ) : null}
                </div>
                <Button
                  isDisabled={!availability.allowed}
                  onPress={() => setSelectedProvider(provider.id)}
                  variant={current ? "primary" : "outline"}
                >
                  {current ? "Selected" : "Use"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
