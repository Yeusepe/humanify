/**
 * Purpose: Verifies shared database helpers keep Postgres canonical before queue publication or retries.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\operations.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://www.postgresql.org/docs/current/index.html
 * Tests:
 * - packages/db/src/index.test.ts
 */

import { expect, test } from "bun:test";

import { createIdempotencyReceipt, createOutboxEvent, parsePostgresConnectionString, planCanonicalWrite, redactPostgresConnectionString } from "./index";

test("postgres connection parsing keeps canonical connection details typed", () => {
  expect(parsePostgresConnectionString("postgres://humanify:secret@localhost:5432/humanify?sslmode=require")).toEqual({
    database: "humanify",
    hostname: "localhost",
    password: "secret",
    port: 5432,
    scheme: "postgres",
    sslMode: "require",
    username: "humanify",
  });

  expect(
    decodeURIComponent(new URL(redactPostgresConnectionString("postgres://humanify:secret@localhost:5432/humanify")).password),
  ).toBe("[redacted]");
});

test("canonical write plans require at least one postgres mutation before outbox publish", () => {
  const idempotency = createIdempotencyReceipt({
    key: "guild:123:policy:update",
    requestId: "req_123",
    scope: "guild_policy",
  });

  expect(() => planCanonicalWrite({ canonicalMutations: [], idempotency, transactionName: "policy-update" })).toThrow();
});

test("canonical write plans preserve outbox events after postgres commit", () => {
  const plan = planCanonicalWrite({
    auditRefs: ["audit_123"],
    canonicalMutations: [
      {
        dataRef: "guild_policy:123",
        operation: "update",
        primaryKey: "123",
        table: "guild_policies",
      },
    ],
    idempotency: createIdempotencyReceipt({
      key: "guild:123:policy:update",
      requestId: "req_123",
      scope: "guild_policy",
    }),
    outbox: [
      createOutboxEvent({
        aggregateId: "123",
        aggregateType: "guild_policy",
        kind: "guild.policy.updated",
        payloadRef: "guild_policy:123",
        requestId: "req_123",
        stream: "policy.actions",
      }),
    ],
    transactionName: "policy-update",
  });

  expect(plan.commitOrder).toEqual(["postgres", "outbox", "redis-streams"]);
  expect(plan.outbox[0]?.kind).toBe("guild.policy.updated");
});

test("the db package can be imported by the Node-based scan worker runtime", () => {
  const result = Bun.spawnSync([
    "node",
    "--input-type=module",
    "--experimental-strip-types",
    "-e",
    "const mod = await import('./packages/db/src/index.ts'); console.log(typeof mod.createPostgresGuildScanRequestRepository);",
  ], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.stdout).toString("utf8").trim()).toBe("function");
});
