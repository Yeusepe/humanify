/**
 * Purpose: Exposes a Bun-first CLI for Humanify Postgres migration status and application.
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
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/sql-createextension.html
 * - https://github.com/pgvector/pgvector/blob/master/README.md
 * Tests:
 * - packages/db/src/migrator.test.ts
 */

import { getMigrationStatus, migrateDatabase } from "./migrator";

function printUsage() {
  console.error("Usage: bun run packages/db/src/cli.ts <status|migrate>");
}

async function main() {
  const command = Bun.argv[2];

  if (command === "status") {
    const status = await getMigrationStatus();

    console.log(`Database: ${status.connectionTarget}`);
    console.log(`Applied migrations: ${status.applied.length}`);
    console.log(`Pending migrations: ${status.pending.length}`);

    if (status.drifted.length > 0) {
      console.error("Checksum drift detected:");

      for (const driftedMigration of status.drifted) {
        console.error(
          `- ${driftedMigration.version} (${driftedMigration.fileName}) applied checksum ${driftedMigration.appliedChecksum}`,
        );
      }

      process.exit(1);
    }

    for (const migration of status.pending) {
      console.log(`- pending ${migration.version}`);
    }

    return;
  }

  if (command === "migrate") {
    const result = await migrateDatabase();

    console.log(`Database: ${result.connectionTarget}`);

    if (result.executed.length === 0) {
      console.log("Schema is already up to date.");
      return;
    }

    console.log("Applied migrations:");

    for (const migration of result.executed) {
      console.log(`- ${migration.version} (${migration.fileName})`);
    }

    return;
  }

  printUsage();
  process.exit(1);
}

await main();
