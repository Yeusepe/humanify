/**
 * Purpose: Mounts the dashboard verification route for session-state and release-gate visibility.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\verification.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://www.heroui.com/docs/react/components/modal
 * - https://www.heroui.com/docs/react/components/table
 * Tests:
 * - apps/dashboard-start/src/dashboard-mvp.test.tsx
 * - apps/dashboard-start package build
 */

import { createFileRoute } from "@tanstack/react-router";

import { DashboardVerificationPage } from "../dashboard-mvp";

export const Route = createFileRoute("/verification")({
  component: DashboardVerificationPage,
});
