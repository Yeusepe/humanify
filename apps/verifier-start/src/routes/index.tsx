/**
 * Purpose: Renders the minimal verifier shell aligned with verification-session, callback-security, and shared-contract planning.
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
      description="A Bun-hosted verification shell reserved for challenge sessions, provider callback results, and release decisions that remain constrained by Bun-side policy and audit rules."
      eyebrow="HUMANIFY / VERIFIER"
      panels={[
        {
          description: "Shared schema metadata available without copying Rust-owned contract definitions.",
          title: "Contracts",
          value: `v${contractSummary.contractVersion}`,
        },
        {
          description: "Future verifier sessions should sync from Postgres read models before any user-visible release state is displayed.",
          title: "Session sync",
          value: "Postgres → Electric",
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
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Operational guardrail</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted">
          Keep this app limited to verification-session UX until callback verification and audit
          receipts are wired through the API. The shell exists so product-facing routes, styles, and
          shared workspace packages validate today without inventing verification semantics early.
        </p>
      </div>
    </ProductShell>
  );
}
