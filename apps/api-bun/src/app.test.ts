/**
 * Purpose: Verifies the Elysia Bun API domain spine exposes validated route groups, safe policy clamps, and honest planning envelopes.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\verification.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://elysiajs.com/at-glance
 * - https://elysiajs.com/essential/validation
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { expect, test } from "bun:test";

import { humanifyContractVersion } from "@humanify/contracts";

import { createApiApp } from "./app";

const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);

const testEnv = {
  DISCORD_CLIENT_ID: "client_123",
  DISCORD_CLIENT_SECRET: "secret_123",
  DISCORD_REDIRECT_URI: "https://humanify.test/auth/discord/callback",
  HUMANIFY_ENVIRONMENT: "test",
  HUMANIFY_MAX_AUTOMATIC_ACTION: "quarantine",
  HUMANIFY_POSTGRES_URL: "postgres://humanify:secret@localhost:5432/humanify",
  HUMANIFY_REDIST_URL: undefined,
  HUMANIFY_REDIS_URL: "redis://localhost:6379",
  HUMANIFY_RELEASE: "test-suite",
  HUMANIFY_SECURE_COOKIES: "false",
  HUMANIFY_SERVICE_NAME: "api-bun",
  HUMANIFY_SESSION_COOKIE_NAME: "humanify_session",
  HUMANIFY_SESSION_SECRET: "session-secret",
  HUMANIFY_SESSION_TTL_SECONDS: "3600",
} satisfies Record<string, string | undefined>;

function createTestApp() {
  return createApiApp({
    env: testEnv,
    now: () => fixedNow,
  });
}

test("health route reports Bun-side API status", async () => {
  const app = createTestApp();
  const response = await app.handle(new Request("http://humanify.local/health"));
  const json = (await response.json()) as {
    contractVersion: string;
    status: string;
  };

  expect(response.status).toBe(200);
  expect(json).toEqual({
    contractVersion: humanifyContractVersion,
    status: "ok",
  });
});

test("service-info exposes the implemented domain route groups", async () => {
  const app = createTestApp();
  const response = await app.handle(new Request("http://humanify.local/service-info"));
  const json = (await response.json()) as {
    contractVersion: string;
    data: {
      routeGroups: string[];
    };
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.data.routeGroups).toEqual(
    expect.arrayContaining([
      "auth",
      "guild-config",
      "cases",
      "reports",
      "verification",
      "moderation",
      "read-models",
    ]),
  );
});

test("auth start builds a signed Discord OAuth bootstrap without inventing session completion", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/auth/discord/start", {
      body: JSON.stringify({
        guildId: "guild_123",
        redirectTo: "/dashboard/guild_123",
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    contractVersion: string;
    data: {
      authUrl: string;
      cookie: {
        name: string;
      };
      state: string;
    };
    requestId: string;
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(response.headers.get("x-request-id")).toBe(json.requestId);
  expect(json.data.cookie.name).toBe("humanify_session");
  expect(new URL(json.data.authUrl).origin).toBe("https://discord.com");
  expect(json.data.state).toContain(".");
});

test("policy writes produce a Postgres-first planning envelope", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/policy", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        allowAutoBan: false,
        maxAutomaticAction: "quarantine",
        quarantineAtOrAbove: 7,
        verificationRequiredAtOrAbove: 6,
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "policy-key-1",
      },
      method: "PUT",
    }),
  );
  const json = (await response.json()) as {
    contractVersion: string;
    data: {
      queueEnvelope: {
        stream: string;
      };
      writePlan: {
        canonicalMutations: Array<{
          table: string;
        }>;
        commitOrder: string[];
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.data.writePlan.commitOrder).toEqual(["postgres", "outbox", "redis-streams"]);
  expect(json.data.writePlan.canonicalMutations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: "guild_policy_versions" }),
      expect.objectContaining({ table: "audit_records" }),
    ]),
  );
  expect(json.data.queueEnvelope.stream).toBe("projection.refresh");
});

test("report intake validates request bodies and returns the documented error envelope", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/reports", {
      body: JSON.stringify({
        reportReason: "",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    requestId: string;
    retryable: boolean;
  };

  expect(response.status).toBe(400);
  expect(json.errorCode).toBe("validation_failed");
  expect(response.headers.get("x-request-id")).toBe(json.requestId);
  expect(json.retryable).toBe(false);
});

test("verification session creation returns an honest planned write plus challenge token", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/verification/sessions", {
      body: JSON.stringify({
        requiredCapabilities: ["captcha"],
        userId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "verification-key-1",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    data: {
      challengeToken: string;
      queueEnvelope: {
        stream: string;
      };
      session: {
        guildId: string;
        state: string;
        userId: string;
      };
    };
  };

  expect(response.status).toBe(202);
  expect(json.data.session).toMatchObject({
    guildId: "guild_123",
    state: "challenge_issued",
    userId: "user_123",
  });
  expect(json.data.challengeToken).toContain(".");
  expect(json.data.queueEnvelope.stream).toBe("verification.events");
});

test("moderation routes refuse actions that exceed Bun policy clamps", async () => {
  const app = createTestApp();
  const response = await app.handle(
    new Request("http://humanify.local/guilds/guild_123/moderation/ban", {
      body: JSON.stringify({
        actorUserId: "mod_123",
        capabilityContext: {
          canBan: true,
          canKick: true,
          canManageRoles: true,
          canTimeout: true,
        },
        caseContext: {
          appealOpen: false,
          existingOpenCase: false,
          verificationStatus: "unknown",
        },
        caseId: "case_123",
        riskDecision: {
          confidence: 0.99,
          evidenceRefs: [],
          recommendedAction: "ban",
          reasonCodes: ["behavior_raid_spike"],
          score: 10,
        },
        serverPolicy: {
          allowAutoBan: false,
          maxAutomaticAction: "quarantine",
        },
        subjectUserId: "user_123",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  const json = (await response.json()) as {
    errorCode: string;
    message: string;
  };

  expect(response.status).toBe(403);
  expect(json.errorCode).toBe("forbidden");
  expect(json.message).toContain("server_policy_clamp");
});

test("contracts summary route exposes the shared schema metadata", async () => {
  const app = createTestApp();
  const response = await app.handle(new Request("http://humanify.local/contracts/summary"));
  const json = (await response.json()) as {
    contractVersion: string;
    schemaPath: string;
  };

  expect(response.status).toBe(200);
  expect(json.contractVersion).toBe(humanifyContractVersion);
  expect(json.schemaPath).toBe("docs\\contracts\\humanify-contracts.schema.json");
});
