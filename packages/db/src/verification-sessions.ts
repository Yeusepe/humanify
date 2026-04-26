/**
 * Purpose: Persists the minimal-custody verification session spine for challenge issuance, Didit handoff tracking, and server-authoritative reconciliation.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\observability-security.md
 * - docs\verification.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.didit.me/integration/webhooks
 * - https://docs.didit.me/console/data-retention
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import postgres from "postgres";

type QueryClient = any;
type JsonCompatible =
  | boolean
  | number
  | null
  | string
  | JsonCompatible[]
  | { [key: string]: JsonCompatible };

export type VerificationSessionState =
  | "challenge_issued"
  | "provider_pending"
  | "passed"
  | "failed"
  | "expired"
  | "cancelled"
  | "released";

export type VerificationSessionRecord = {
  challengeExpiresAt: string;
  challengeId: string;
  guildId: string;
  initiatedBy: string;
  providerStatus: Record<string, unknown>;
  requiredCapabilities: string[];
  resultSummary: Record<string, unknown>;
  sessionId: string;
  state: VerificationSessionState;
  userId: string;
};

export type VerificationSessionsRepository = {
  createSession(input: {
    challengeExpiresAt: string;
    challengeId: string;
    guildId: string;
    initiatedBy: string;
    requiredCapabilities: string[];
    sessionId: string;
    userId: string;
  }): Promise<VerificationSessionRecord>;
  getSession(sessionId: string): Promise<VerificationSessionRecord | undefined>;
  markDiditSessionCreated(input: {
    callbackUrl: string;
    providerSessionId: string;
    providerSessionStatus: string;
    requestedClaims: string[];
    sessionId: string;
    verificationUrl: string;
    workflowId: string;
  }): Promise<VerificationSessionRecord | undefined>;
  recordDiditResult(input: {
    providerSessionId: string;
    providerStatus: string;
    purge: Record<string, unknown>;
    requestedClaims?: string[];
    resultSummary: Record<string, unknown>;
    sessionId: string;
    state: Exclude<VerificationSessionState, "challenge_issued" | "released">;
    webhook: Record<string, unknown>;
  }): Promise<VerificationSessionRecord | undefined>;
  close(): Promise<void>;
};

type VerificationSessionRow = {
  challenge_expires_at: string | Date;
  challenge_id: string;
  guild_id: string;
  initiated_by: string;
  provider_status: Record<string, unknown> | null;
  required_capabilities: string[] | null;
  result_summary: Record<string, unknown> | null;
  session_id: string;
  state: VerificationSessionState;
  user_id: string;
};

function createSqlClient(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
  });
}

async function ensureGuild(sql: QueryClient, guildId: string) {
  await sql`
    INSERT INTO guilds (
      guild_id
    )
    VALUES (
      ${guildId}
    )
    ON CONFLICT (guild_id) DO NOTHING
  `;
}

async function ensureUser(sql: QueryClient, userId: string) {
  await sql`
    INSERT INTO user_identities (
      user_id,
      updated_at
    )
    VALUES (
      ${userId},
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET updated_at = excluded.updated_at
  `;
}

function mapRow(row: VerificationSessionRow): VerificationSessionRecord {
  return {
    challengeExpiresAt: new Date(row.challenge_expires_at).toISOString(),
    challengeId: row.challenge_id,
    guildId: row.guild_id,
    initiatedBy: row.initiated_by,
    providerStatus: row.provider_status ?? {},
    requiredCapabilities: row.required_capabilities ?? [],
    resultSummary: row.result_summary ?? {},
    sessionId: row.session_id,
    state: row.state,
    userId: row.user_id,
  };
}

function toJsonCompatible(value: unknown): JsonCompatible {
  return JSON.parse(JSON.stringify(value)) as JsonCompatible;
}

async function readSession(sql: QueryClient, sessionId: string) {
  const [row] = await sql<VerificationSessionRow[]>`
    SELECT
      challenge_expires_at,
      challenge_id,
      guild_id,
      initiated_by,
      provider_status,
      required_capabilities,
      result_summary,
      session_id,
      state,
      user_id
    FROM verification_sessions
    WHERE session_id = ${sessionId}::uuid
  `;

  return row ? mapRow(row) : undefined;
}

export function createPostgresVerificationSessionsRepository(input: {
  connectionString: string;
}): VerificationSessionsRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async createSession(input) {
      await sql.begin(async (transaction) => {
        await ensureGuild(transaction, input.guildId);
        await ensureUser(transaction, input.userId);
        await transaction`
          INSERT INTO verification_sessions (
            session_id,
            challenge_id,
            guild_id,
            user_id,
            state,
            initiated_by,
            required_capabilities,
            challenge_metadata,
            challenge_expires_at,
            expires_at,
            provider_status,
            result_summary
          )
          VALUES (
            ${input.sessionId}::uuid,
            ${input.challengeId}::uuid,
            ${input.guildId},
            ${input.userId},
            ${"challenge_issued"},
            ${input.initiatedBy},
            ${input.requiredCapabilities},
            ${transaction.json({
              challengeBound: true,
              challengeExpiresAt: input.challengeExpiresAt,
            })},
            ${input.challengeExpiresAt},
            ${input.challengeExpiresAt},
            ${transaction.json({})},
            ${transaction.json({})}
          )
        `;
      });

      return (await readSession(sql, input.sessionId))!;
    },

    async getSession(sessionId) {
      return await readSession(sql, sessionId);
    },

    async markDiditSessionCreated(input) {
      await sql`
        UPDATE verification_sessions
        SET
          state = ${"provider_pending"},
          provider_status = ${sql.json({
            callbackUrl: input.callbackUrl,
            launch: {
              mode: "didit_sdk",
              packageName: "@didit-protocol/sdk-web",
              providerId: "didit",
              providerSessionId: input.providerSessionId,
              providerStatus: input.providerSessionStatus,
              url: input.verificationUrl,
            },
            requestedClaims: input.requestedClaims,
            selectedProvider: "didit",
            status: "didit_session_created",
            workflowId: input.workflowId,
          })},
          updated_at = now()
        WHERE session_id = ${input.sessionId}::uuid
      `;

      return await readSession(sql, input.sessionId);
    },

    async recordDiditResult(input) {
      const current = await readSession(sql, input.sessionId);
      if (!current) {
        return undefined;
      }

      await sql.begin(async (transaction) => {
        const providerStatus = {
          ...current.providerStatus,
          launch: current.providerStatus.launch,
          purge: input.purge,
          requestedClaims: input.requestedClaims ?? current.providerStatus.requestedClaims ?? [],
          selectedProvider: "didit",
          status: input.state === "passed" ? "provider_webhook_verified" : "provider_webhook_recorded",
          verifiedWebhook: input.webhook,
        };

        await transaction`
          UPDATE verification_sessions
          SET
            state = ${input.state},
            provider_status = ${transaction.json(toJsonCompatible(providerStatus))},
            result_summary = ${transaction.json(toJsonCompatible(input.resultSummary))},
            passed_at = ${input.state === "passed" ? new Date().toISOString() : null},
            updated_at = now()
          WHERE session_id = ${input.sessionId}::uuid
        `;

        await transaction`
          DELETE FROM verification_artifacts
          WHERE
            session_id = ${input.sessionId}::uuid
            AND provider_name = ${"didit"}
            AND provider_reference_id = ${input.providerSessionId}
        `;

        await transaction`
          INSERT INTO verification_artifacts (
            session_id,
            guild_id,
            user_id,
            provider_name,
            artifact_kind,
            provider_reference_id,
            attestation_status,
            redacted_payload
          )
          VALUES (
            ${input.sessionId}::uuid,
            ${current.guildId},
            ${current.userId},
            ${"didit"},
            ${"capture_attestation"},
            ${input.providerSessionId},
            ${input.state},
            ${transaction.json(toJsonCompatible(input.resultSummary))}
          )
        `;
      });

      return await readSession(sql, input.sessionId);
    },

    async close() {
      await sql.end();
    },
  };
}
