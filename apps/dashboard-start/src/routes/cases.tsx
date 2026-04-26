/**
 * Purpose: Mounts the dashboard cases route for honest risk-queue and case-read boundary visibility.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://www.heroui.com/docs/react/components/form
 * - https://www.heroui.com/docs/react/components/drawer
 * Tests:
 * - apps/dashboard-start/src/dashboard-mvp.test.tsx
 * - apps/dashboard-start package build
 */

import { createFileRoute } from "@tanstack/react-router";

import { DashboardCasesPage } from "../dashboard-mvp";

export const Route = createFileRoute("/cases")({
  component: DashboardCasesPage,
});
