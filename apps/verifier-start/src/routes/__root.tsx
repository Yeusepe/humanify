/**
 * Purpose: Defines the root document shell for the verifier TanStack Start app and wires HeroUI/Tailwind styles.
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
 * - apps/verifier-start package build
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
        title: "Humanify Verifier",
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
    <html className="dark" data-theme="dark" lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
