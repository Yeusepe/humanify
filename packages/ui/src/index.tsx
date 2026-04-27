/**
 * Purpose: Provides shared HeroUI-based shell components for the Bun dashboard and verifier Start apps.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://www.heroui.com/docs/react/getting-started
 * - https://www.heroui.com/docs/react/components/card
 * - https://www.heroui.com/docs/react/components/surface
 * Tests:
 * - apps/dashboard-start package build
 * - apps/verifier-start package build
 */

import type { ReactNode } from "react";

import { Card, Surface } from "@heroui/react";

export type ShellPanel = {
  description: string;
  title: string;
  value: string;
  variant?: "default" | "secondary" | "tertiary";
};

export type ProductShellProps = {
  children?: ReactNode;
  description: string;
  eyebrow: string;
  panels: ShellPanel[];
  title: string;
};

export function ProductShell({
  children,
  description,
  eyebrow,
  panels,
  title,
}: Readonly<ProductShellProps>) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(92,109,255,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(34,197,94,0.12),_transparent_24%),linear-gradient(180deg,_rgba(255,255,255,0.02),_transparent_42%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 md:px-8 lg:px-10">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <Surface
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-content2/75 px-6 py-8 shadow-[0_24px_80px_rgba(3,7,18,0.45)] backdrop-blur-xl md:px-8 md:py-10"
            variant="default"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(92,109,255,0.18),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.05),_transparent_55%)]" />
            <div className="relative flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold tracking-[0.22em] text-accent uppercase">
                  {eyebrow}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
                  Bun authoritative
                </span>
              </div>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                  {title}
                </h1>
                <p className="max-w-3xl text-base leading-8 text-muted md:text-lg">
                  {description}
                </p>
              </div>
            </div>
          </Surface>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            {panels.map((panel) => (
              <Card
                className="min-h-40 border border-white/10 bg-content2/75 shadow-[0_16px_48px_rgba(3,7,18,0.28)] backdrop-blur-sm"
                key={panel.title}
                variant={panel.variant ?? "default"}
              >
                <Card.Header className="gap-2 pb-3">
                  <Card.Description className="text-[11px] font-semibold tracking-[0.18em] uppercase">
                    {panel.title}
                  </Card.Description>
                  <Card.Title className="text-3xl font-semibold tracking-tight text-foreground">
                    {panel.value}
                  </Card.Title>
                </Card.Header>
                <Card.Content className="pt-0">
                  <p className="text-sm leading-6 text-muted">{panel.description}</p>
                </Card.Content>
              </Card>
            ))}
          </div>
        </div>

        {children ? (
          <Surface
            className="rounded-[2rem] border border-white/10 bg-content2/80 px-5 py-5 shadow-[0_20px_70px_rgba(3,7,18,0.32)] backdrop-blur-xl md:px-7 md:py-7"
            variant="default"
          >
            {children}
          </Surface>
        ) : null}
      </div>
    </div>
  );
}
