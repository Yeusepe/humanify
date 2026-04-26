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
      description="A Bun-hosted verification shell for signed challenge sessions, explicit provider callback boundaries, and release decisions that remain constrained by Bun-side policy and audit rules."
      eyebrow="HUMANIFY / VERIFIER"
      panels={[
        {
          description: "The first concrete verifier route now accepts Bun-authored signed links and confirms the Discord-bound challenge.",
          title: "Live route",
          value: "/verify",
        },
        {
          description: "Shared schema metadata is still available without copying Rust-owned contract definitions.",
          title: "Contracts",
          value: `v${contractSummary.contractVersion}`,
          variant: "secondary",
        },
        {
          description: "Inbound provider callbacks stay untrusted until signatures, replay checks, and retention rules are enforced server-side.",
          title: "Callback trust",
          value: "Verify first",
          variant: "tertiary",
        },
      ]}
      title="Verification shell"
    >
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Current concrete path</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted">
          Open <code className="rounded bg-content2 px-2 py-1 text-xs">/verify?sessionId=&lt;...&gt;&amp;token=&lt;...&gt;</code>{" "}
          with a Bun-issued challenge token to load signed session context, confirm the Discord-bound challenge, and stop
          before any unsupported provider callback or release step.
        </p>
        <p className="max-w-3xl text-sm leading-7 text-muted">
          This keeps the verifier honest: no fake provider completion, no synthetic release state, and no bypass around
          signed challenge/session inputs while the canonical Postgres and callback layers are still being wired.
        </p>
      </div>
    </ProductShell>
  );
}
