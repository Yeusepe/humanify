/**
 * Purpose: Persists canonical single-member and full-guild scan requests for durable Temporal-backed member scanning.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\discord-bot.md
 * - docs\local-development.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * - https://docs.temporal.io/typescript/introduction
 * - https://typescript.temporal.io/api/classes/client.WorkflowClient
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

export type GuildScanRequestScope = "all_members" | "single_member";
export type GuildScanRequestStatus = "claimed" | "completed" | "failed" | "pending" | "running";

export type GuildScanRequestSummary = {
  completedAt?: string;
  lastScannedUserId?: string;
  notes: string[];
  processedMemberCount: number;
  suspiciousFindings: Array<{
    caseId?: string;
    reasonCodes: string[];
    userId: string;
  }>;
  suspiciousMemberCount: number;
};

export type GuildScanRequestRecord = {
  claimedAt?: string;
  createdAt: string;
  errorMessage?: string;
  finishedAt?: string;
  guildId: string;
  requestedByUserId: string;
  scope: GuildScanRequestScope;
  scanRequestId: string;
  startedAt?: string;
  status: GuildScanRequestStatus;
  summary: GuildScanRequestSummary;
  targetUserId?: string;
  temporalTaskQueue?: string;
  updatedAt: string;
  workflowId?: string;
};

export type PersistedGuildScanRequestResult = {
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
  scanRequest: GuildScanRequestRecord;
};

export type GuildScanRequestRepository = {
  claimNextQueuedRequest(input: {
    taskQueue: string;
    workflowIdPrefix?: string;
  }): Promise<GuildScanRequestRecord | undefined>;
  close(): Promise<void>;
  createScanRequest(input: {
    artifacts: CanonicalArtifacts;
    body: {
      actorUserId: string;
      scope: GuildScanRequestScope;
      targetUserId?: string;
    };
    guildId: string;
    requestFingerprint?: string;
    scanRequestId: string;
    traceId?: string;
  }): Promise<PersistedGuildScanRequestResult>;
  getScanRequest(input: {
    guildId: string;
    scanRequestId: string;
  }): Promise<GuildScanRequestRecord | undefined>;
  markCompleted(input: {
    scanRequestId: string;
    summary: GuildScanRequestSummary;
  }): Promise<GuildScanRequestRecord | undefined>;
  markFailed(input: {
    errorMessage: string;
    scanRequestId: string;
    summary?: GuildScanRequestSummary;
  }): Promise<GuildScanRequestRecord | undefined>;
  markRunning(input: {
    scanRequestId: string;
    summary?: GuildScanRequestSummary;
  }): Promise<GuildScanRequestRecord | undefined>;
};

type GuildScanRequestRow = {
  claimed_at: string | Date | null;
  created_at: string | Date;
  error_message: string | null;
  finished_at: string | Date | null;
  guild_id: string;
  requested_by_user_id: string;
  scope: GuildScanRequestScope;
  scan_request_id: string;
  started_at: string | Date | null;
  status: GuildScanRequestStatus;
  summary: GuildScanRequestSummary | null;
  target_user_id: string | null;
  temporal_task_queue: string | null;
  updated_at: string | Date;
  workflow_id: string | null;
};

function createSqlClient(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
  });
}

function toIsoString(value: string | Date | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizeSummary(summary: GuildScanRequestSummary | null | undefined): GuildScanRequestSummary {
  return {
    completedAt: summary?.completedAt,
    lastScannedUserId: summary?.lastScannedUserId,
    notes: [...(summary?.notes ?? [])],
    processedMemberCount: summary?.processedMemberCount ?? 0,
    suspiciousFindings: (summary?.suspiciousFindings ?? []).map((finding) => ({
      caseId: finding.caseId,
      reasonCodes: [...finding.reasonCodes],
      userId: finding.userId,
    })),
    suspiciousMemberCount: summary?.suspiciousMemberCount ?? 0,
  };
}

function mapRow(row: GuildScanRequestRow): GuildScanRequestRecord {
  return {
    claimedAt: toIsoString(row.claimed_at),
    createdAt: toIsoString(row.created_at)!,
    errorMessage: row.error_message ?? undefined,
    finishedAt: toIsoString(row.finished_at),
    guildId: row.guild_id,
    requestedByUserId: row.requested_by_user_id,
    scope: row.scope,
    scanRequestId: row.scan_request_id,
    startedAt: toIsoString(row.started_at),
    status: row.status,
    summary: normalizeSummary(row.summary),
    targetUserId: row.target_user_id ?? undefined,
    temporalTaskQueue: row.temporal_task_queue ?? undefined,
    updatedAt: toIsoString(row.updated_at)!,
    workflowId: row.workflow_id ?? undefined,
  };
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
      ${sql.json({ canonicalWorkflow: "guild_scan_request_v1" })}
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
    actorUserId: string;
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
      target_type,
      target_id,
      action,
      request_id,
      trace_id,
      idempotency_key,
      metadata
    )
    VALUES (
      ${input.guildId},
      ${"user"},
      ${input.actorUserId},
      ${input.targetType},
      ${input.targetId},
      ${"guild.scan.requested"},
      ${input.requestId},
      ${input.traceId ?? null},
      ${input.idempotencyKey},
      ${sql.json(input.metadata)}
    )
  `;
}

export function createPostgresGuildScanRequestRepository(input: {
  connectionString: string;
}): GuildScanRequestRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async createScanRequest(inputArgs) {
      return sql.begin(async (transaction) => {
        const existing = await reserveIdempotency<PersistedGuildScanRequestResult>(transaction, {
          boundary: inputArgs.artifacts.idempotency.scope,
          idempotencyKey: inputArgs.artifacts.idempotency.key,
          requestFingerprint: inputArgs.requestFingerprint,
        });

        if (existing.completed_at && existing.response_body) {
          return existing.response_body;
        }

        await ensureGuild(transaction, inputArgs.guildId);
        await ensureUser(transaction, inputArgs.body.actorUserId);
        if (inputArgs.body.targetUserId) {
          await ensureUser(transaction, inputArgs.body.targetUserId);
        }

        const [row] = await transaction<GuildScanRequestRow[]>`
          INSERT INTO guild_scan_requests (
            scan_request_id,
            guild_id,
            requested_by_user_id,
            scope,
            target_user_id,
            status,
            summary
          )
          VALUES (
            ${inputArgs.scanRequestId},
            ${inputArgs.guildId},
            ${inputArgs.body.actorUserId},
            ${inputArgs.body.scope},
            ${inputArgs.body.targetUserId ?? null},
            ${"pending"},
            ${transaction.json(normalizeSummary(undefined))}
          )
          RETURNING
            scan_request_id,
            guild_id,
            requested_by_user_id,
            scope,
            target_user_id,
            status,
            workflow_id,
            temporal_task_queue,
            claimed_at,
            started_at,
            finished_at,
            error_message,
            summary,
            created_at,
            updated_at
        `;

        await persistOutboxEvent(transaction, inputArgs.artifacts);
        await persistAuditRecord(transaction, {
          actorUserId: inputArgs.body.actorUserId,
          guildId: inputArgs.guildId,
          idempotencyKey: inputArgs.artifacts.idempotency.key,
          metadata: {
            scanRequestId: inputArgs.scanRequestId,
            scope: inputArgs.body.scope,
            targetUserId: inputArgs.body.targetUserId ?? null,
          },
          requestId: inputArgs.artifacts.idempotency.requestId,
          targetId: inputArgs.scanRequestId,
          targetType: "guild_scan_request",
          traceId: inputArgs.traceId,
        });

        const result = {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          scanRequest: mapRow(row),
        } satisfies PersistedGuildScanRequestResult;

        await completeIdempotency(transaction, existing.idempotency_receipt_id, result, 201);

        return result;
      });
    },

    async getScanRequest(inputArgs) {
      const [row] = await sql<GuildScanRequestRow[]>`
        SELECT
          scan_request_id,
          guild_id,
          requested_by_user_id,
          scope,
          target_user_id,
          status,
          workflow_id,
          temporal_task_queue,
          claimed_at,
          started_at,
          finished_at,
          error_message,
          summary,
          created_at,
          updated_at
        FROM guild_scan_requests
        WHERE
          guild_id = ${inputArgs.guildId}
          AND scan_request_id = ${inputArgs.scanRequestId}
      `;

      return row ? mapRow(row) : undefined;
    },

    async claimNextQueuedRequest(inputArgs) {
      const workflowIdPrefix = inputArgs.workflowIdPrefix ?? "guild-scan:";
      return sql.begin(async (transaction) => {
        const [row] = await transaction<GuildScanRequestRow[]>`
          WITH next_scan AS (
            SELECT scan_request_id
            FROM guild_scan_requests
            WHERE status = 'pending'
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE guild_scan_requests AS scans
          SET
            status = 'claimed',
            workflow_id = ${workflowIdPrefix} || next_scan.scan_request_id,
            temporal_task_queue = ${inputArgs.taskQueue},
            claimed_at = now(),
            updated_at = now()
          FROM next_scan
          WHERE scans.scan_request_id = next_scan.scan_request_id
          RETURNING
            scans.scan_request_id,
            scans.guild_id,
            scans.requested_by_user_id,
            scans.scope,
            scans.target_user_id,
            scans.status,
            scans.workflow_id,
            scans.temporal_task_queue,
            scans.claimed_at,
            scans.started_at,
            scans.finished_at,
            scans.error_message,
            scans.summary,
            scans.created_at,
            scans.updated_at
        `;

        return row ? mapRow(row) : undefined;
      });
    },

    async markRunning(inputArgs) {
      const [row] = await sql<GuildScanRequestRow[]>`
        UPDATE guild_scan_requests
        SET
          status = 'running',
          started_at = COALESCE(started_at, now()),
          summary = ${sql.json(normalizeSummary(inputArgs.summary))},
          updated_at = now()
        WHERE scan_request_id = ${inputArgs.scanRequestId}
        RETURNING
          scan_request_id,
          guild_id,
          requested_by_user_id,
          scope,
          target_user_id,
          status,
          workflow_id,
          temporal_task_queue,
          claimed_at,
          started_at,
          finished_at,
          error_message,
          summary,
          created_at,
          updated_at
      `;

      return row ? mapRow(row) : undefined;
    },

    async markCompleted(inputArgs) {
      const summary = normalizeSummary({
        ...inputArgs.summary,
        completedAt: inputArgs.summary.completedAt ?? new Date().toISOString(),
      });
      const [row] = await sql<GuildScanRequestRow[]>`
        UPDATE guild_scan_requests
        SET
          status = 'completed',
          finished_at = now(),
          error_message = null,
          summary = ${sql.json(summary)},
          updated_at = now()
        WHERE scan_request_id = ${inputArgs.scanRequestId}
        RETURNING
          scan_request_id,
          guild_id,
          requested_by_user_id,
          scope,
          target_user_id,
          status,
          workflow_id,
          temporal_task_queue,
          claimed_at,
          started_at,
          finished_at,
          error_message,
          summary,
          created_at,
          updated_at
      `;

      return row ? mapRow(row) : undefined;
    },

    async markFailed(inputArgs) {
      const summary = inputArgs.summary ? normalizeSummary(inputArgs.summary) : undefined;
      const [row] = await sql<GuildScanRequestRow[]>`
        UPDATE guild_scan_requests
        SET
          status = 'failed',
          finished_at = now(),
          error_message = ${inputArgs.errorMessage},
          summary = COALESCE(${summary ? sql.json(summary) : null}, summary),
          updated_at = now()
        WHERE scan_request_id = ${inputArgs.scanRequestId}
        RETURNING
          scan_request_id,
          guild_id,
          requested_by_user_id,
          scope,
          target_user_id,
          status,
          workflow_id,
          temporal_task_queue,
          claimed_at,
          started_at,
          finished_at,
          error_message,
          summary,
          created_at,
          updated_at
      `;

      return row ? mapRow(row) : undefined;
    },

    async close() {
      await sql.end();
    },
  };
}
