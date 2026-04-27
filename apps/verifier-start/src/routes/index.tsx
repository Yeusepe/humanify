/**
 * Purpose: Renders the verifier landing page and points operators or testers to the signed-link verification flow.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\contracts.md
 * - docs\data-platform.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://electric-sql.com/primitives/postgres-sync
 * - https://www.heroui.com/docs/react/components/card
 * Tests:
 * - apps/verifier-start package build
 */

import { Alert, Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";

import { getHumanifyContractSummary } from "@humanify/contracts";
import { ProductShell } from "@humanify/ui";

const contractSummary = getHumanifyContractSummary();

export const Route = createFileRoute("/")({
  component: VerifierHome,
});

function VerifierHome() {
  return (
    <ProductShell
      description="Humanify walks members through signed verification sessions, explains what the server is asking for, and only releases Discord access after the Bun-side policy contract confirms the result."
      eyebrow="HUMANIFY / VERIFIER"
      panels={[
        {
          description: "Every real verification session arrives through a signed Bun-issued link tied to the Discord member and guild.",
          title: "Live route",
          value: "/verify",
        },
        {
          description: "Shared schema metadata still comes from the workspace contract package instead of duplicated UI constants.",
          title: "Contract schema",
          value: `v${contractSummary.contractVersion}`,
          variant: "secondary",
        },
        {
          description: "Release waits for the server-side verification contract, not for a browser screen to claim success.",
          title: "Release control",
          value: "Server enforced",
          variant: "tertiary",
        },
      ]}
      title="Secure verification"
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
        <div className="space-y-5">
          <Alert className="border border-white/10 bg-content2/55" status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Signed session links only</Alert.Title>
              <Alert.Description>
                Open a signed link from Discord to begin. Humanify only renders real session context when the Bun API
                already created and signed the challenge.
              </Alert.Description>
            </Alert.Content>
          </Alert>

          <Card className="border border-white/10 bg-content2/55 shadow-[0_18px_44px_rgba(3,7,18,0.24)]">
            <Card.Header className="gap-2">
              <Card.Title>What members see</Card.Title>
              <Card.Description>
                The verifier is designed as a guided flow instead of a debug page.
              </Card.Description>
            </Card.Header>
            <Card.Content className="grid gap-3 text-sm leading-7 text-muted md:grid-cols-3">
              <div className="rounded-3xl border border-white/8 bg-white/4 px-4 py-4">
                <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">1. Confirm context</p>
                <p className="mt-2">
                  Humanify shows which server requested the check, why the step is needed, and which proof path is available.
                </p>
              </div>
              <div className="rounded-3xl border border-white/8 bg-white/4 px-4 py-4">
                <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">2. Complete proof</p>
                <p className="mt-2">
                  Members finish the selected capture or reusable proof flow without the UI pretending a provider response already happened.
                </p>
              </div>
              <div className="rounded-3xl border border-white/8 bg-white/4 px-4 py-4">
                <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">3. Release access</p>
                <p className="mt-2">
                  Discord role release only happens after the server-side verification contract confirms the result and applies policy.
                </p>
              </div>
            </Card.Content>
          </Card>
        </div>

        <Card className="border border-white/10 bg-content2/55 shadow-[0_18px_44px_rgba(3,7,18,0.24)]">
          <Card.Header className="gap-2">
            <Card.Title>Current concrete path</Card.Title>
            <Card.Description>
              The live entry route stays narrow on purpose so the verifier never invents unsupported state.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4 text-sm leading-7 text-muted">
            <p>
              Open <code className="rounded-xl border border-white/10 bg-content2 px-2 py-1 text-xs text-foreground">/verify?sessionId=&lt;...&gt;&amp;token=&lt;...&gt;</code>{" "}
              with a Bun-issued challenge token to load the signed session context.
            </p>
            <div className="rounded-3xl border border-white/8 bg-white/4 px-4 py-4">
              <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">Trust boundary</p>
              <p className="mt-2">
                Provider callbacks, replay checks, and release decisions remain server-owned. The browser reflects them; it does not substitute for them.
              </p>
            </div>
            <div className="rounded-3xl border border-white/8 bg-white/4 px-4 py-4">
              <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">What Humanify keeps</p>
              <p className="mt-2">
                Normalized pass/fail facts, proof receipts, and policy outputs. Not raw documents, not full provider payloads, and not synthetic success flags.
              </p>
            </div>
          </Card.Content>
        </Card>
      </div>
    </ProductShell>
  );
}
