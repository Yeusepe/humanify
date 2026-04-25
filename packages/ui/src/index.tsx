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
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8 md:px-10">
      <Surface className="rounded-4xl px-6 py-8 md:px-8" variant="secondary">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold tracking-[0.2em] text-muted uppercase">{eyebrow}</p>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="max-w-3xl text-base leading-7 text-muted">{description}</p>
          </div>
        </div>
      </Surface>

      <div className="grid gap-4 md:grid-cols-3">
        {panels.map((panel) => (
          <Card key={panel.title} className="min-h-48" variant={panel.variant ?? "default"}>
            <Card.Header className="gap-2">
              <Card.Title>{panel.title}</Card.Title>
              <Card.Description>{panel.description}</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-1 items-end">
              <p className="text-2xl font-semibold tracking-tight text-foreground">{panel.value}</p>
            </Card.Content>
          </Card>
        ))}
      </div>

      {children ? (
        <Surface className="rounded-4xl px-6 py-6 md:px-8" variant="default">
          {children}
        </Surface>
      ) : null}
    </div>
  );
}
