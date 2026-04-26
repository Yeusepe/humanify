/**
 * Purpose: Verifies the canonical Humanify migration runner keeps Postgres bootstrap inputs and migration inventory aligned.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\data-platform.md
 * - docs\operations.md
 * - docs\local-development.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://github.com/porsager/postgres
 * - https://github.com/pgvector/pgvector/blob/master/README.md
 * Tests:
 * - packages/db/src/migrator.test.ts
 */

import { expect, test } from "bun:test";

import { createDatabaseConfigFromEnv, getConnectionTarget, getDiscoveredMigrations } from "./migrator";

test("database config falls back to the documented local Postgres defaults", () => {
  const config = createDatabaseConfigFromEnv({});

  expect(config).toEqual({
    database: "humanify",
    host: "127.0.0.1",
    password: "humanify",
    port: 5432,
    username: "humanify",
  });
  expect(getConnectionTarget(config)).toBe("postgres://humanify:***@127.0.0.1:5432/humanify");
});

test("database config prefers HUMANIFY_DATABASE_URL when provided", () => {
  const config = createDatabaseConfigFromEnv({
    HUMANIFY_DATABASE_URL: "postgres://humanify:secret@db.example.com:6543/humanify_prod",
  });

  expect(config.connectionString).toBe("postgres://humanify:secret@db.example.com:6543/humanify_prod");
  expect(getConnectionTarget(config)).toBe("postgres://humanify:***@db.example.com:6543/humanify_prod");
});

test("migration inventory contains the canonical Postgres spine bootstrap", () => {
  const migrations = getDiscoveredMigrations();

  expect(migrations.map((migration) => migration.fileName)).toEqual(["0001_canonical_spine.sql"]);
  expect(migrations[0]?.sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS guilds");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS verification_sessions");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS cases");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS reports");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS evidence_records");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS case_outcomes");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS outbox_events");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS idempotency_receipts");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS audit_records");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS action_execution_receipts");
  expect(migrations[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS signal_embeddings");
});
