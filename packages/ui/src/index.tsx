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
  sidebar?: ReactNode;
  sidebarDescription?: string;
  sidebarTitle?: string;
  title: string;
};

export function ProductShell({
  children,
  description,
  eyebrow,
  panels,
  sidebar,
  sidebarDescription,
  sidebarTitle,
  title,
}: Readonly<ProductShellProps>) {
  const shellTitle = sidebarTitle ?? title;
  const shellDescription = sidebarDescription ?? description;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_14%),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100%_100%,28px_28px,28px_28px] opacity-40" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(92,109,255,0.14),transparent)]" />

      <div className="relative mx-auto grid min-h-screen max-w-[1560px] gap-5 px-4 py-4 md:px-6 md:py-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:px-8">
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <Surface
            className="flex h-full flex-col rounded-[28px] border border-white/10 bg-content1/90 px-5 py-5 shadow-[0_20px_60px_rgba(3,7,18,0.34)] backdrop-blur-xl"
            variant="default"
          >
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-accent uppercase">
                  {eyebrow}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
                  Bun authoritative
                </span>
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{shellTitle}</h1>
                <p className="text-sm leading-7 text-muted">{shellDescription}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {panels.map((panel) => (
                <Card
                  className="border border-white/10 bg-content2/80 shadow-none transition-transform duration-200 motion-safe:hover:-translate-y-0.5"
                  key={panel.title}
                  variant={panel.variant ?? "default"}
                >
                  <Card.Header className="gap-1 pb-2">
                    <Card.Description className="text-[11px] font-semibold tracking-[0.16em] uppercase">
                      {panel.title}
                    </Card.Description>
                    <Card.Title className="text-xl font-semibold tracking-tight text-foreground">
                      {panel.value}
                    </Card.Title>
                  </Card.Header>
                  <Card.Content className="pt-0">
                    <p className="text-sm leading-6 text-muted">{panel.description}</p>
                  </Card.Content>
                </Card>
              ))}
            </div>

            {sidebar ? (
              <div className="mt-6 min-h-0 flex-1 border-t border-white/10 pt-5">
                {sidebar}
              </div>
            ) : null}
          </Surface>
        </aside>

        <main className="min-w-0 space-y-5 pb-8">
          <Surface
            className="rounded-[28px] border border-white/10 bg-content1/88 px-5 py-5 shadow-[0_18px_48px_rgba(3,7,18,0.24)] backdrop-blur-xl md:px-7 md:py-6"
            variant="default"
          >
            <div className="space-y-3">
              <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">Owner visibility</p>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h2>
                <p className="max-w-4xl text-base leading-8 text-muted">{description}</p>
              </div>
            </div>
          </Surface>

          {children ? <div className="space-y-5">{children}</div> : null}
        </main>
      </div>
    </div>
  );
}
