/**
 * Purpose: Defines Postgres-first canonical write plans while re-exporting the Bun-first migration/status helpers for Humanify services.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\local-development.md
 * - docs\operations.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * - https://redis.io/docs/latest/develop/data-types/streams/
 * - https://bun.sh/docs/typescript
 * Tests:
 * - packages/db/src/index.test.ts
 * - packages/db/src/migrator.test.ts
 */

export {
  createDatabaseConfigFromEnv,
  getConnectionTarget,
  getDiscoveredMigrations,
  getMigrationDirectoryPath,
  getMigrationStatus,
  migrateDatabase,
} from "./migrator";
export type {
  AppliedMigration,
  DatabaseConfig,
  DiscoveredMigration,
  MigrationResult,
  MigrationStatus,
} from "./migrator";

export type CanonicalMutation = {
  dataRef: string;
  operation: "insert" | "update" | "delete";
  primaryKey: string;
  table: string;
};

export type IdempotencyReceipt = {
  actorId?: string;
  createdAt: string;
  key: string;
  receiptId: string;
  requestId: string;
  scope: string;
};

export type OutboxEvent = {
  aggregateId: string;
  aggregateType: string;
  eventId: string;
  kind: string;
  payloadRef: string;
  requestId: string;
  stream: string;
};

export type CanonicalWritePlan = {
  auditRefs: string[];
  canonicalMutations: CanonicalMutation[];
  commitOrder: readonly ["postgres", "outbox", "redis-streams"];
  idempotency: IdempotencyReceipt;
  outbox: OutboxEvent[];
  transactionName: string;
};

export type PostgresConnectionInfo = {
  database: string;
  hostname: string;
  password?: string;
  port?: number;
  scheme: string;
  sslMode?: string;
  username?: string;
};

export function parsePostgresConnectionString(connectionString: string): PostgresConnectionInfo {
  const parsed = new URL(connectionString);
  const database = parsed.pathname.replace(/^\//u, "");

  return {
    database,
    hostname: parsed.hostname,
    password: parsed.password || undefined,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : undefined,
    scheme: parsed.protocol.replace(/:$/u, ""),
    sslMode: parsed.searchParams.get("sslmode") ?? undefined,
    username: parsed.username || undefined,
  };
}

export function redactPostgresConnectionString(connectionString: string): string {
  const parsed = new URL(connectionString);

  if (parsed.password) {
    parsed.password = "[redacted]";
  }

  return parsed.toString();
}

export function createIdempotencyReceipt(input: {
  actorId?: string;
  createdAt?: string;
  key: string;
  requestId: string;
  scope: string;
}): IdempotencyReceipt {
  return {
    actorId: input.actorId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    key: input.key,
    receiptId: crypto.randomUUID(),
    requestId: input.requestId,
    scope: input.scope,
  };
}

export function createOutboxEvent(input: {
  aggregateId: string;
  aggregateType: string;
  kind: string;
  payloadRef: string;
  requestId: string;
  stream: string;
}): OutboxEvent {
  return {
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    eventId: crypto.randomUUID(),
    kind: input.kind,
    payloadRef: input.payloadRef,
    requestId: input.requestId,
    stream: input.stream,
  };
}

export function planCanonicalWrite(input: {
  auditRefs?: string[];
  canonicalMutations: CanonicalMutation[];
  idempotency: IdempotencyReceipt;
  outbox?: OutboxEvent[];
  transactionName: string;
}): CanonicalWritePlan {
  if (input.canonicalMutations.length === 0) {
    throw new Error("Canonical writes must include at least one Postgres mutation before outbox fan-out.");
  }

  return {
    auditRefs: input.auditRefs ?? [],
    canonicalMutations: input.canonicalMutations,
    commitOrder: ["postgres", "outbox", "redis-streams"] as const,
    idempotency: input.idempotency,
    outbox: input.outbox ?? [],
    transactionName: input.transactionName,
  };
}

export function summarizeCanonicalWritePlan(plan: CanonicalWritePlan) {
  return {
    auditRefCount: plan.auditRefs.length,
    canonicalMutationCount: plan.canonicalMutations.length,
    commitOrder: plan.commitOrder,
    outboxEventCount: plan.outbox.length,
    transactionName: plan.transactionName,
  };
}
