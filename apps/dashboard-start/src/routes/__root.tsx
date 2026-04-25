/**
 * Purpose: Defines the root document shell for the dashboard TanStack Start app and wires HeroUI/Tailwind styles.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.dev/start/latest/docs/framework/react/build-from-scratch
 * - https://tanstack.dev/start/latest/docs/framework/react/guide/tailwind-integration
 * - https://www.heroui.com/docs/react/getting-started/theming
 * Tests:
 * - apps/dashboard-start package build
 */

/// <reference types="vite/client" />

import type { ReactNode } from "react";

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";

import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    links: [{ href: appCss, rel: "stylesheet" }],
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "Humanify Dashboard",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className="light" data-theme="light" lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
