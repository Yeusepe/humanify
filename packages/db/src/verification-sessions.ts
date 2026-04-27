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
type CanonicalArtifacts = {
  idempotency: {
    key: string;
    requestId: string;
    scope: string;
  };
  queueEnvelope: {
    canonicalRef: {
      aggregateId: string;
      aggregateType: string;
      eventId: string;
    };
    kind: string;
    messageId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
    producer: {
      serviceName: string;
    };
    requestId: string;
    schemaVersion: "1";
    stream: string;
    traceparent: string;
  };
};
type IdempotencyRow<TResult> = {
  completed_at: string | null;
  idempotency_receipt_id: string;
  response_body: TResult | null;
};
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
  caseId?: string;
  challengeExpiresAt: string;
  challengeId: string;
  createdAt: string;
  guildId: string;
  initiatedBy: string;
  providerStatus: Record<string, unknown>;
  requiredCapabilities: string[];
  resultSummary: Record<string, unknown>;
  sessionId: string;
  state: VerificationSessionState;
  updatedAt: string;
  userId: string;
};

export type VerificationSessionReleaseResult = {
  appliedRoleIds: string[];
  releasedAt: string;
  triggerKeys: string[];
};

export type VerificationSessionsRepository = {
  createSession(input: {
    artifacts?: CanonicalArtifacts;
    caseId?: string;
    challengeExpiresAt: string;
    challengeId: string;
    guildId: string;
    initiatedBy: string;
    requiredCapabilities: string[];
    sessionId: string;
    traceId?: string;
    userId: string;
  }): Promise<VerificationSessionRecord>;
  getSession(sessionId: string): Promise<VerificationSessionRecord | undefined>;
  listSessionsForSubject(input: {
    guildId: string;
    userId: string;
  }): Promise<VerificationSessionRecord[]>;
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
    reusableCredentialBridge?: {
      artifactPayload: Record<string, unknown>;
      artifactStatus: string;
      bridgeId: string;
      expiresAt: string;
      summary: Record<string, unknown>;
      targetProvider: string;
    };
    resultSummary: Record<string, unknown>;
    sessionId: string;
    state: Exclude<VerificationSessionState, "challenge_issued" | "released">;
    webhook: Record<string, unknown>;
  }): Promise<VerificationSessionRecord | undefined>;
  recordReusableProofResult(input: {
    providerId: string;
    providerSessionId: string;
    requestedClaims: string[];
    resultSummary: Record<string, unknown>;
    sessionId: string;
    state: Exclude<VerificationSessionState, "challenge_issued" | "released">;
  }): Promise<VerificationSessionRecord | undefined>;
  markReleased(input: {
    release: VerificationSessionReleaseResult;
    sessionId: string;
  }): Promise<VerificationSessionRecord | undefined>;
  close(): Promise<void>;
};

type VerificationSessionRow = {
  case_id: string | null;
  challenge_expires_at: string | Date;
  challenge_id: string;
  created_at: string | Date;
  guild_id: string;
  initiated_by: string;
  provider_status: Record<string, unknown> | null;
  required_capabilities: string[] | null;
  result_summary: Record<string, unknown> | null;
  session_id: string;
  state: VerificationSessionState;
  updated_at: string | Date;
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

async function reserveIdempotency<TResult extends Record<string, unknown>>(
  sql: QueryClient,
  input: {
    boundary: string;
    idempotencyKey: string;
    requestFingerprint?: string;
  },
) {
  const [inserted] = await sql<IdempotencyRow<TResult>[]>`
    INSERT INTO idempotency_receipts (
      boundary,
      idempotency_key,
      request_fingerprint,
      metadata
    )
    VALUES (
      ${input.boundary},
      ${input.idempotencyKey},
      ${input.requestFingerprint ?? null},
      ${sql.json({ canonicalWorkflow: "verification_session_v1" })}
    )
    ON CONFLICT DO NOTHING
    RETURNING
      idempotency_receipt_id,
      response_body,
      completed_at
  `;

  if (inserted) {
    return inserted;
  }

  const [existing] = await sql<IdempotencyRow<TResult>[]>`
    UPDATE idempotency_receipts
    SET last_seen_at = now()
    WHERE
      boundary = ${input.boundary}
      AND idempotency_key = ${input.idempotencyKey}
    RETURNING
      idempotency_receipt_id,
      response_body,
      completed_at
  `;

  if (existing?.completed_at && existing.response_body) {
    return existing;
  }

  throw new Error(`Canonical idempotency boundary ${input.boundary} is already processing ${input.idempotencyKey}.`);
}

async function completeIdempotency<TResult extends Record<string, unknown>>(
  sql: QueryClient,
  receiptId: string,
  result: TResult,
  responseCode: number,
) {
  await sql`
    UPDATE idempotency_receipts
    SET
      completed_at = now(),
      last_seen_at = now(),
      response_code = ${responseCode},
      response_body = ${sql.json(result as Record<string, unknown>)}
    WHERE idempotency_receipt_id = ${receiptId}
  `;
}

async function persistOutboxEvent(sql: QueryClient, artifacts: CanonicalArtifacts) {
  await sql`
    INSERT INTO outbox_events (
      topic,
      aggregate_type,
      aggregate_id,
      event_key,
      idempotency_key,
      payload,
      headers
    )
    VALUES (
      ${artifacts.queueEnvelope.stream},
      ${artifacts.queueEnvelope.canonicalRef.aggregateType},
      ${artifacts.queueEnvelope.canonicalRef.aggregateId},
      ${artifacts.queueEnvelope.canonicalRef.eventId},
      ${artifacts.idempotency.key},
      ${sql.json(artifacts.queueEnvelope)},
      ${sql.json({
        requestId: artifacts.queueEnvelope.requestId,
        traceparent: artifacts.queueEnvelope.traceparent,
      })}
    )
  `;
}

async function persistAuditRecord(
  sql: QueryClient,
  input: {
    actorService?: string;
    actorUserId?: string;
    caseId?: string;
    guildId: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
    requestId: string;
    targetId: string;
    targetType: string;
    traceId?: string;
  },
) {
  await sql`
    INSERT INTO audit_records (
      guild_id,
      actor_type,
      actor_user_id,
      actor_service,
      target_type,
      target_id,
      action,
      request_id,
      trace_id,
      idempotency_key,
      related_case_id,
      metadata
    )
    VALUES (
      ${input.guildId},
      ${input.actorUserId ? "user" : "service"},
      ${input.actorUserId ?? null},
      ${input.actorService ?? null},
      ${input.targetType},
      ${input.targetId},
      ${"verification.session.created"},
      ${input.requestId},
      ${input.traceId ?? null},
      ${input.idempotencyKey},
      ${input.caseId ?? null},
      ${sql.json(input.metadata)}
    )
  `;
}

function mapRow(row: VerificationSessionRow): VerificationSessionRecord {
  return {
    caseId: row.case_id ?? undefined,
    challengeExpiresAt: new Date(row.challenge_expires_at).toISOString(),
    challengeId: row.challenge_id,
    createdAt: new Date(row.created_at).toISOString(),
    guildId: row.guild_id,
    initiatedBy: row.initiated_by,
    providerStatus: row.provider_status ?? {},
    requiredCapabilities: row.required_capabilities ?? [],
    resultSummary: row.result_summary ?? {},
    sessionId: row.session_id,
    state: row.state,
    updatedAt: new Date(row.updated_at).toISOString(),
    userId: row.user_id,
  };
}

function toJsonCompatible(value: unknown): JsonCompatible {
  return JSON.parse(JSON.stringify(value)) as JsonCompatible;
}

async function readSession(sql: QueryClient, sessionId: string) {
  const [row] = await sql<VerificationSessionRow[]>`
    SELECT
      case_id,
      challenge_expires_at,
      challenge_id,
      created_at,
      guild_id,
      initiated_by,
      provider_status,
      required_capabilities,
      result_summary,
      session_id,
      state,
      updated_at,
      user_id
    FROM verification_sessions
    WHERE session_id = ${sessionId}::uuid
  `;

  return row ? mapRow(row) : undefined;
}

async function readSessionsForSubject(sql: QueryClient, input: {
  guildId: string;
  userId: string;
}) {
  const rows = await sql<VerificationSessionRow[]>`
    SELECT
      case_id,
      challenge_expires_at,
      challenge_id,
      created_at,
      guild_id,
      initiated_by,
      provider_status,
      required_capabilities,
      result_summary,
      session_id,
      state,
      updated_at,
      user_id
    FROM verification_sessions
    WHERE
      guild_id = ${input.guildId}
      AND user_id = ${input.userId}
    ORDER BY updated_at DESC, created_at DESC
  `;

  return rows.map(mapRow);
}

export function createPostgresVerificationSessionsRepository(input: {
  connectionString: string;
}): VerificationSessionsRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async createSession(input) {
      const persisted = await sql.begin(async (transaction) => {
        const receipt = input.artifacts
          ? await reserveIdempotency<VerificationSessionRecord>(transaction, {
              boundary: input.artifacts.idempotency.scope,
              idempotencyKey: input.artifacts.idempotency.key,
              requestFingerprint: `${input.guildId}:${input.userId}:${input.caseId ?? "no_case"}`,
            })
          : undefined;

        if (receipt?.response_body) {
          return receipt.response_body;
        }

        await ensureGuild(transaction, input.guildId);
        await ensureUser(transaction, input.userId);

        if (input.initiatedBy && input.initiatedBy !== "system") {
          await ensureUser(transaction, input.initiatedBy);
        }

        if (input.caseId) {
          const [caseRow] = await transaction<{
            subject_user_id: string;
          }[]>`
            SELECT subject_user_id
            FROM cases
            WHERE
              guild_id = ${input.guildId}
              AND case_id = ${input.caseId}::uuid
          `;

          if (!caseRow) {
            throw new Error(`Case ${input.caseId} was not found in guild ${input.guildId}.`);
          }

          if (caseRow.subject_user_id !== input.userId) {
            throw new Error(
              `Case ${input.caseId} in guild ${input.guildId} belongs to ${caseRow.subject_user_id}, not ${input.userId}.`,
            );
          }
        }

        await transaction`
          INSERT INTO verification_sessions (
            session_id,
            challenge_id,
            guild_id,
            user_id,
            case_id,
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
            ${input.caseId ?? null},
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

        if (input.caseId) {
          await transaction`
            INSERT INTO case_events (
              case_event_id,
              case_id,
              guild_id,
              actor_user_id,
              actor_service,
              event_type,
              summary,
              event_payload
            )
            VALUES (
              ${crypto.randomUUID()},
              ${input.caseId}::uuid,
              ${input.guildId},
              ${input.initiatedBy !== "system" ? input.initiatedBy : null},
              ${input.initiatedBy === "system" ? "api-bun" : null},
              ${"verification_session_created"},
              ${"Verification session was created for moderator warning follow-up."},
              ${transaction.json({
                challengeId: input.challengeId,
                initiatedBy: input.initiatedBy,
                requiredCapabilities: input.requiredCapabilities,
                sessionId: input.sessionId,
                userId: input.userId,
              })}
            )
          `;
        }

        if (input.artifacts) {
          await persistAuditRecord(transaction, {
            actorService: input.initiatedBy === "system" ? "api-bun" : undefined,
            actorUserId: input.initiatedBy !== "system" ? input.initiatedBy : undefined,
            caseId: input.caseId,
            guildId: input.guildId,
            idempotencyKey: input.artifacts.idempotency.key,
            metadata: {
              challengeId: input.challengeId,
              requiredCapabilities: input.requiredCapabilities,
              sessionId: input.sessionId,
              userId: input.userId,
            },
            requestId: input.artifacts.idempotency.requestId,
            targetId: input.sessionId,
            targetType: "verification_session",
            traceId: input.traceId,
          });
          await persistOutboxEvent(transaction, input.artifacts);
        }

        const record = (await readSession(transaction, input.sessionId))!;
        if (receipt) {
          await completeIdempotency(transaction, receipt.idempotency_receipt_id, record, 201);
        }
        return record;
      });

      return persisted;
    },

    async getSession(sessionId) {
      return await readSession(sql, sessionId);
    },

    async listSessionsForSubject(input) {
      return await readSessionsForSubject(sql, input);
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
          reusableCredentialBridge: input.reusableCredentialBridge?.summary,
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
          DELETE FROM verification_artifacts
          WHERE
            session_id = ${input.sessionId}::uuid
            AND provider_name = ${"privado"}
            AND artifact_kind = ${"reusable_credential_bridge"}
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

        if (input.reusableCredentialBridge) {
          await transaction`
            INSERT INTO verification_artifacts (
              session_id,
              guild_id,
              user_id,
              provider_name,
              artifact_kind,
              provider_reference_id,
              attestation_status,
              expires_at,
              redacted_payload
            )
            VALUES (
              ${input.sessionId}::uuid,
              ${current.guildId},
              ${current.userId},
              ${input.reusableCredentialBridge.targetProvider},
              ${"reusable_credential_bridge"},
              ${input.reusableCredentialBridge.bridgeId},
              ${input.reusableCredentialBridge.artifactStatus},
              ${input.reusableCredentialBridge.expiresAt},
              ${transaction.json(toJsonCompatible(input.reusableCredentialBridge.artifactPayload))}
            )
          `;
        }
      });

      return await readSession(sql, input.sessionId);
    },

    async recordReusableProofResult(input) {
      const current = await readSession(sql, input.sessionId);
      if (!current) {
        return undefined;
      }

      await sql.begin(async (transaction) => {
        const providerStatus = {
          ...current.providerStatus,
          launch: current.providerStatus.launch,
          providerSessionId: input.providerSessionId,
          requestedClaims: input.requestedClaims,
          selectedProvider: input.providerId,
          status: input.state === "passed"
            ? "provider_proof_verified"
            : input.state === "failed"
              ? "provider_proof_failed"
              : "pending_provider_verification",
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
            AND provider_name = ${input.providerId}
            AND artifact_kind = ${"reusable_proof_receipt"}
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
            ${input.providerId},
            ${"reusable_proof_receipt"},
            ${input.providerSessionId},
            ${input.state},
            ${transaction.json(toJsonCompatible(input.resultSummary))}
          )
        `;
      });

      return await readSession(sql, input.sessionId);
    },

    async markReleased(input) {
      const current = await readSession(sql, input.sessionId);
      if (!current) {
        return undefined;
      }

      const releaseSummary = {
        ...current.resultSummary,
        release: {
          appliedRoleIds: [...input.release.appliedRoleIds],
          releasedAt: input.release.releasedAt,
          triggerKeys: [...input.release.triggerKeys],
        },
      };

      await sql`
        UPDATE verification_sessions
        SET
          state = ${"released"},
          result_summary = ${sql.json(toJsonCompatible(releaseSummary))},
          released_at = ${input.release.releasedAt},
          updated_at = now()
        WHERE session_id = ${input.sessionId}::uuid
      `;

      return await readSession(sql, input.sessionId);
    },

    async close() {
      await sql.end();
    },
  };
}
