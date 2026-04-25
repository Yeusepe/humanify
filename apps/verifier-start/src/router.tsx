/**
 * Purpose: Creates the TanStack Start router for the verifier shell.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.dev/start/latest/docs/framework/react/build-from-scratch
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * Tests:
 * - apps/verifier-start package build
 */

import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
