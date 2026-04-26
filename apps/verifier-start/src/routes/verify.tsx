/**
 * Purpose: Renders the first real verifier flow: load signed-link session context, confirm the Discord-bound challenge, and stop before unsupported provider callbacks.
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

import { Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { ProductShell } from "@humanify/ui";

import {
  buildVerificationChecklist,
  completeVerificationChallenge,
  fetchVerificationSession,
  getVerifierApiBaseUrl,
  hasVerificationLink,
  parseVerificationSearch,
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
  const [loadState, setLoadState] = useState<"error" | "idle" | "loading" | "ready">(
    hasVerificationLink(search) ? "loading" : "idle",
  );
  const [actionState, setActionState] = useState<"error" | "idle" | "submitting" | "success">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const apiBaseUrl = getVerifierApiBaseUrl(import.meta.env as Record<string, string | undefined>);

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
  const providerCallbacksConfigured =
    challengeData?.providerBoundary.providerCallbacksConfigured ??
    sessionData?.callbackBoundary.providerCallbacksConfigured ??
    false;
  const releaseEligible =
    challengeData?.providerBoundary.releaseEligible ?? sessionData?.callbackBoundary.releaseEligible ?? false;
  const challengeCompleted = challengeData?.challenge.verified ?? false;
  const checklist = useMemo(
    () =>
      buildVerificationChecklist({
        challengeCompleted,
        providerCallbacksConfigured,
        releaseEligible,
      }),
    [challengeCompleted, providerCallbacksConfigured, releaseEligible],
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
        sessionId: effectiveSession.sessionId,
        token: search.token,
        userId: effectiveSession.userId,
      });

      setChallengeData(data);
      setActionState("success");
      setFeedbackMessage(
        "Challenge accepted. The session is now waiting for a server-verified provider callback before release can happen.",
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
          description: "Provider callbacks remain explicit until Bun documents and verifies a concrete provider contract.",
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
                a signed link from the API, confirms the challenge, and then waits for future provider callback wiring.
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
                  <button
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!effectiveSession || actionState === "submitting" || challengeCompleted}
                    onClick={handleChallengeConfirmation}
                    type="button"
                  >
                    {challengeCompleted
                      ? "Challenge confirmed"
                      : actionState === "submitting"
                        ? "Confirming challenge…"
                        : "Confirm Discord-bound challenge"}
                  </button>
                  {feedbackMessage ? <p className="text-sm leading-6 text-foreground">{feedbackMessage}</p> : null}
                </Card.Content>
              </Card>

              <Card>
                <Card.Header className="gap-2">
                  <Card.Title>Provider boundary</Card.Title>
                  <Card.Description>
                    Required assurance capabilities are visible, but no browser-only provider success is trusted.
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
                    Provider callbacks are still disabled in the Bun API. This page therefore stops at{" "}
                    <span className="font-semibold text-foreground">provider_pending</span> and does not attempt release,
                    fake completion, or invented callback polling.
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
