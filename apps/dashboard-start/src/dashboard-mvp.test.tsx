/**
 * Purpose: Verifies the dashboard MVP renders honest moderation/operator screens and preserves explicit read-model boundaries.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\verification.md
 * - docs\cases-and-reports.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://www.heroui.com/docs/react/components/tabs
 * - https://www.heroui.com/docs/react/components/table
 * Tests:
 * - apps/dashboard-start/src/dashboard-mvp.test.tsx
 */

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";

import {
  buildCaseQueryPlan,
} from "./dashboard-mvp";
import { routeTree } from "./routeTree.gen";

async function renderRoute(path: "/" | "/cases" | "/policy" | "/verification") {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree,
  });

  await router.load();

  return renderToStaticMarkup(<RouterProvider router={router} />);
}

test("overview renders the moderation dashboard framing", async () => {
  const markup = await renderRoute("/");

  expect(markup).toContain("Moderation dashboard MVP");
  expect(markup).toContain("Pending projections");
  expect(markup).toContain("Bun authoritative");
});

test("cases query plan keeps list and detail boundaries honest", () => {
  expect(buildCaseQueryPlan({ caseId: "", guildId: "", subjectUserId: "" })).toEqual({
    audience: "case list",
    readModelStatus: "pending_postgres_projection",
    scope: "Provide a guild ID to describe the queue and case-list projection boundary.",
    summary: "Add a guild ID before preparing a queue read plan.",
  });

  expect(
    buildCaseQueryPlan({
      caseId: "case_123",
      guildId: "guild_123",
      subjectUserId: "user_123",
    }),
  ).toEqual({
    audience: "case detail",
    readModelStatus: "dependency_unavailable",
    scope: "Guild guild_123, case case_123, subject user_123.",
    summary: "Case detail remains unavailable until Postgres-backed case projections land.",
  });
});

test("cases route renders queue-boundary copy", async () => {
  const markup = await renderRoute("/cases");

  expect(markup).toContain("Risk queue and case reads");
  expect(markup).toContain("Projection filter prep");
  expect(markup).toContain("Queue read boundary");
});

test("verification route renders lifecycle guidance", async () => {
  const markup = await renderRoute("/verification");

  expect(markup).toContain("Verification state");
  expect(markup).toContain("provider_pending");
  expect(markup).toContain("Release rules");
});

test("policy route renders Bun-side action clamps", async () => {
  const markup = await renderRoute("/policy");

  expect(markup).toContain("Action and policy boundary");
  expect(markup).toContain("allowAutoBan defaults to false");
  expect(markup).toContain("Action ladder");
});
