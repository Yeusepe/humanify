/**
 * Purpose: Applies the canonical Humanify SQL migration set against Postgres and reports durable migration status.
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
 * - https://www.postgresql.org/docs/current/ddl-constraints.html
 * - https://github.com/pgvector/pgvector/blob/master/README.md
 * Tests:
 * - packages/db/src/migrator.test.ts
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

export type DatabaseConfig = {
  connectionString?: string;
  database: string;
  host: string;
  password: string;
  port: number;
  username: string;
};

export type DiscoveredMigration = {
  checksum: string;
  fileName: string;
  path: string;
  sql: string;
  version: string;
};

export type AppliedMigration = {
  appliedAt: string;
  checksum: string;
  fileName: string;
  version: string;
};

export type MigrationStatus = {
  applied: AppliedMigration[];
  connectionTarget: string;
  drifted: {
    appliedChecksum: string;
    fileName: string;
    version: string;
  }[];
  pending: DiscoveredMigration[];
};

export type MigrationResult = MigrationStatus & {
  executed: AppliedMigration[];
};

const defaultDatabaseHost = "127.0.0.1";
const defaultDatabaseName = "humanify";
const defaultDatabasePassword = "humanify";
const defaultDatabasePort = 5432;
const defaultDatabaseUser = "humanify";
const migrationTableName = "schema_migrations";
const migrationDirectoryPath = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function resolvePort(rawValue: string | undefined, fallback: number, variableName: string) {
  const value = rawValue?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${variableName} must be a valid TCP port, received ${JSON.stringify(rawValue)}.`);
  }

  return parsed;
}

function buildChecksum(sqlText: string) {
  return createHash("sha256").update(sqlText).digest("hex");
}

function redactConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);

    if (url.password) {
      url.password = "***";
    }

    return url.toString();
  } catch {
    return "<invalid HUMANIFY_DATABASE_URL>";
  }
}

function createSqlClient(config: DatabaseConfig) {
  if (config.connectionString) {
    return postgres(config.connectionString, {
      max: 1,
    });
  }

  return postgres({
    database: config.database,
    host: config.host,
    max: 1,
    password: config.password,
    port: config.port,
    username: config.username,
  });
}

export function getMigrationDirectoryPath() {
  return migrationDirectoryPath;
}

export function createDatabaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const connectionString = env.HUMANIFY_DATABASE_URL?.trim();

  if (connectionString) {
    return {
      connectionString,
      database: defaultDatabaseName,
      host: defaultDatabaseHost,
      password: defaultDatabasePassword,
      port: defaultDatabasePort,
      username: defaultDatabaseUser,
    };
  }

  return {
    database: env.HUMANIFY_POSTGRES_DB?.trim() || defaultDatabaseName,
    host: env.HUMANIFY_POSTGRES_HOST?.trim() || defaultDatabaseHost,
    password: env.HUMANIFY_POSTGRES_PASSWORD?.trim() || defaultDatabasePassword,
    port: resolvePort(env.HUMANIFY_POSTGRES_PORT, defaultDatabasePort, "HUMANIFY_POSTGRES_PORT"),
    username: env.HUMANIFY_POSTGRES_USER?.trim() || defaultDatabaseUser,
  };
}

export function getConnectionTarget(config = createDatabaseConfigFromEnv()) {
  if (config.connectionString) {
    return redactConnectionString(config.connectionString);
  }

  return `postgres://${config.username}:***@${config.host}:${config.port}/${config.database}`;
}

export function getDiscoveredMigrations() {
  return readdirSync(migrationDirectoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/u.test(entry.name))
    .map<DiscoveredMigration>((entry) => {
      const path = join(migrationDirectoryPath, entry.name);
      const sql = readFileSync(path, "utf8");
      const version = entry.name.replace(/\.sql$/u, "");

      return {
        checksum: buildChecksum(sql),
        fileName: entry.name,
        path,
        sql,
        version,
      };
    })
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function ensureMigrationTable(sql: ReturnType<typeof createSqlClient>) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${migrationTableName} (
      version text PRIMARY KEY,
      file_name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function loadAppliedMigrations(sql: ReturnType<typeof createSqlClient>) {
  const rows = await sql<{
    applied_at: string;
    checksum: string;
    file_name: string;
    version: string;
  }[]>`
    SELECT
      version,
      file_name,
      checksum,
      applied_at
    FROM schema_migrations
    ORDER BY version ASC
  `;

  return rows.map<AppliedMigration>((row) => ({
    appliedAt: row.applied_at,
    checksum: row.checksum,
    fileName: row.file_name,
    version: row.version,
  }));
}

export async function getMigrationStatus(env: NodeJS.ProcessEnv = process.env): Promise<MigrationStatus> {
  const config = createDatabaseConfigFromEnv(env);
  const sql = createSqlClient(config);

  try {
    await ensureMigrationTable(sql);
    const discovered = getDiscoveredMigrations();
    const applied = await loadAppliedMigrations(sql);
    const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
    const pending = discovered.filter((migration) => !appliedByVersion.has(migration.version));
    const drifted = discovered.flatMap((migration) => {
      const appliedMigration = appliedByVersion.get(migration.version);

      if (!appliedMigration || appliedMigration.checksum === migration.checksum) {
        return [];
      }

      return [
        {
          appliedChecksum: appliedMigration.checksum,
          fileName: migration.fileName,
          version: migration.version,
        },
      ];
    });

    return {
      applied,
      connectionTarget: getConnectionTarget(config),
      drifted,
      pending,
    };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function migrateDatabase(env: NodeJS.ProcessEnv = process.env): Promise<MigrationResult> {
  const config = createDatabaseConfigFromEnv(env);
  const sql = createSqlClient(config);

  try {
    await ensureMigrationTable(sql);
    const discovered = getDiscoveredMigrations();
    const applied = await loadAppliedMigrations(sql);
    const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
    const drifted = discovered.flatMap((migration) => {
      const appliedMigration = appliedByVersion.get(migration.version);

      if (!appliedMigration || appliedMigration.checksum === migration.checksum) {
        return [];
      }

      return [
        {
          appliedChecksum: appliedMigration.checksum,
          fileName: migration.fileName,
          version: migration.version,
        },
      ];
    });

    if (drifted.length > 0) {
      throw new Error(
        `Detected checksum drift for applied migrations: ${drifted
          .map((migration) => `${migration.version} (${migration.fileName})`)
          .join(", ")}.`,
      );
    }

    const pending = discovered.filter((migration) => !appliedByVersion.has(migration.version));
    const executed: AppliedMigration[] = [];

    for (const migration of pending) {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.sql);
        const [inserted] = await transaction<{
          applied_at: string;
          checksum: string;
          file_name: string;
          version: string;
        }[]>`
          INSERT INTO schema_migrations (
            version,
            file_name,
            checksum
          )
          VALUES (
            ${migration.version},
            ${migration.fileName},
            ${migration.checksum}
          )
          RETURNING
            version,
            file_name,
            checksum,
            applied_at
        `;

        executed.push({
          appliedAt: inserted.applied_at,
          checksum: inserted.checksum,
          fileName: inserted.file_name,
          version: inserted.version,
        });
      });
    }

    const refreshedApplied = await loadAppliedMigrations(sql);

    return {
      applied: refreshedApplied,
      connectionTarget: getConnectionTarget(config),
      drifted: [],
      executed,
      pending: [],
    };
  } finally {
    await sql.end({ timeout: 1 });
  }
}
