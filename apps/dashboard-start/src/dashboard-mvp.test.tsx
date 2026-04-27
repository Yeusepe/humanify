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
  createVerificationEditorState,
  fetchGuildVerificationConfig,
  getDashboardApiBaseUrl,
  saveGuildVerificationConfig,
  updateVerificationOptionConfiguration,
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

  expect(markup).toContain("Moderation command center");
  expect(markup).toContain("Pending projections");
  expect(markup).toContain("Bun authoritative");
  expect(markup).toContain("Operator navigation");
  expect(markup).toContain("Owner visibility");
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
  expect(markup).toContain("Load server verification settings");
  expect(markup).toContain("First-time capture flows");
  expect(markup).toContain("Reusable proof backends");
  expect(markup).toContain("Required proof bundles");
  expect(markup).toContain("Face verification policy");
  expect(markup).toContain("Trusted roles");
  expect(markup).toContain("Suspicious roles");
  expect(markup).toContain("Release rules");
});

test("dashboard verification flow defaults to the local Bun API port unless configured", () => {
  expect(getDashboardApiBaseUrl()).toBe("http://127.0.0.1:3211");
  expect(getDashboardApiBaseUrl({ VITE_HUMANIFY_API_BASE_URL: "https://api.humanify.test/" })).toBe(
    "https://api.humanify.test",
  );
});

test("createVerificationEditorState hydrates persisted verification config into editable fields", () => {
  expect(
    createVerificationEditorState({
      actorUserId: "mod_123",
      guildId: "guild_123",
      verificationConfig: {
        availableProviderIds: ["didit", "privado", "self"],
        defaultProviderId: "didit",
        defaultReusableProofBackendId: "privado",
        enabledProviderIds: ["didit", "privado"],
        faceVerificationRequired: true,
        fallbackRoles: ["role_verified"],
        requiredBundleIds: ["humanify_id_nationality_v1"],
        source: "persisted",
        suspiciousRoleIds: ["role_suspicious"],
        trustedRoleIds: ["role_verified"],
      },
    }),
  ).toEqual({
    actorUserId: "mod_123",
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    guildId: "guild_123",
    requiredBundleIds: ["humanify_id_nationality_v1"],
    suspiciousRoleIdsInput: "role_suspicious",
    trustedRoleIdsInput: "role_verified",
  });
});

test("fetchGuildVerificationConfig reads the persisted guild verification config snapshot", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          persistence: "persisted",
          verificationConfig: {
            availableProviderIds: ["didit", "privado", "self"],
            defaultProviderId: "didit",
            defaultReusableProofBackendId: "privado",
            enabledProviderIds: ["didit", "privado"],
            faceVerificationRequired: true,
            fallbackRoles: ["role_verified"],
            requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
            source: "persisted",
            suspiciousRoleIds: ["role_suspicious"],
            trustedRoleIds: ["role_verified"],
          },
        },
        requestId: "request_123",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
    );
  };

  const result = await fetchGuildVerificationConfig(fetchImpl, {
    apiBaseUrl: "http://127.0.0.1:3211",
    guildId: "guild_123",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3211/guilds/guild_123/verification");
  expect(result.persistence).toBe("persisted");
  expect(result.verificationConfig.enabledProviderIds).toEqual(["didit", "privado"]);
});

test("saveGuildVerificationConfig persists the editable guild verification fields", async () => {
  const requests: Request[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        contractVersion: "0.1.0",
        data: {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          verificationConfig: {
            availableProviderIds: ["didit", "privado", "self"],
            defaultProviderId: "didit",
            defaultReusableProofBackendId: "privado",
            enabledProviderIds: ["didit", "privado"],
            faceVerificationRequired: true,
            fallbackRoles: ["role_verified"],
            requiredBundleIds: ["humanify_id_nationality_v1"],
            source: "persisted",
            suspiciousRoleIds: ["role_suspicious"],
            trustedRoleIds: ["role_verified"],
          },
        },
        requestId: "request_456",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
    );
  };

  const result = await saveGuildVerificationConfig(fetchImpl, {
    actorUserId: "mod_123",
    apiBaseUrl: "http://127.0.0.1:3211",
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    guildId: "guild_123",
    requiredBundleIds: ["humanify_id_nationality_v1"],
    suspiciousRoleIdsInput: "role_suspicious",
    trustedRoleIdsInput: "role_verified",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.method).toBe("PUT");
  expect(await requests[0]?.json()).toEqual({
    actorUserId: "mod_123",
    defaultProviderId: "didit",
    defaultReusableProofBackendId: "privado",
    enabledProviderIds: ["didit", "privado"],
    faceVerificationRequired: true,
    requiredBundleIds: ["humanify_id_nationality_v1"],
    suspiciousRoleIds: ["role_suspicious"],
    trustedRoleIds: ["role_verified"],
  });
  expect(result.verificationConfig.requiredBundleIds).toEqual(["humanify_id_nationality_v1"]);
});

test("verification option configuration keeps the default capture flow enabled", () => {
  const toggled = updateVerificationOptionConfiguration(
    {
      availableOptionIds: ["didit", "privado", "self", "world_id"],
      availablePipelineIds: [
        "humanify_didit_capture_v1",
        "humanify_privado_reusable_v1",
        "humanify_self_reusable_v1",
        "humanify_world_id_uniqueness_v1",
      ],
      defaultOptionId: "didit",
      enabledPipelineIds: [
        "humanify_didit_capture_v1",
        "humanify_privado_reusable_v1",
        "humanify_self_reusable_v1",
        "humanify_world_id_uniqueness_v1",
      ],
      enabledOptionIds: ["didit", "privado", "self", "world_id"],
      policyConsumerId: "humanify",
    },
    {
      optionId: "self",
      type: "toggle-option",
    },
  );

  expect(toggled.enabledOptionIds).toEqual(["didit", "privado", "world_id"]);
  expect(toggled.defaultOptionId).toBe("didit");

  expect(() =>
    updateVerificationOptionConfiguration(toggled, {
      optionId: "self",
      type: "set-default",
    }),
  ).toThrow('Unknown verification option "self".');

  const reusableDefault = updateVerificationOptionConfiguration(toggled, {
    optionId: "world_id",
    type: "set-default-reusable",
  });

  expect(reusableDefault.defaultOptionId).toBe("didit");
  expect(reusableDefault.defaultReusableProofBackendId).toBe("world_id");
});

test("policy route renders Bun-side action clamps", async () => {
  const markup = await renderRoute("/policy");

  expect(markup).toContain("Action and policy boundary");
  expect(markup).toContain("allowAutoBan defaults to false");
  expect(markup).toContain("Action ladder");
});
