/**
 * Purpose: Renders the minimal dashboard shell aligned with shared contracts, Electric sync planning, and HeroUI styling.
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
 * - https://tanstack.com/db/latest/docs/overview
 * - https://electric-sql.com/primitives/postgres-sync
 * - https://www.heroui.com/docs/react/components/card
 * Tests:
 * - apps/dashboard-start package build
 */

import { createFileRoute } from "@tanstack/react-router";

import { getHumanifyContractSummary } from "@humanify/contracts";
import { ProductShell } from "@humanify/ui";

const contractSummary = getHumanifyContractSummary();

export const Route = createFileRoute("/")({
  component: DashboardHome,
});

function DashboardHome() {
  return (
    <ProductShell
      description="A Bun-hosted TanStack Start shell for operator-facing moderation workflows. This scaffold reserves the live data lane for TanStack DB collections fed by Electric Postgres Sync once canonical Postgres read models land."
      eyebrow="HUMANIFY / DASHBOARD"
      panels={[
        {
          description: "Shared Bun ↔ Rust schema metadata pulled directly from docs/contracts.",
          title: "Contracts",
          value: `v${contractSummary.contractVersion}`,
        },
        {
          description: "Reserved for TanStack DB collections and Electric shapes sourced from Postgres-owned read models.",
          title: "Live data path",
          value: "TanStack DB + Electric",
          variant: "secondary",
        },
        {
          description: "Moderation actions stay Bun-authoritative even when Rust services provide advisory risk signals.",
          title: "Policy boundary",
          value: "Advisory only",
          variant: "tertiary",
        },
      ]}
      title="Moderation dashboard shell"
    >
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Next integration seam</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted">
          Wire Electric-backed read models for cases, verification summaries, and audit views before
          adding workflow mutations. The shared contracts package already exposes the canonical
          schema ID so app code can stay traceable without copying Rust definitions.
        </p>
      </div>
    </ProductShell>
  );
}
