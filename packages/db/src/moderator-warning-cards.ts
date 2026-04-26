/**
 * Purpose: Persists canonical moderator-warning alert refs and reads the bounded warning-card model for Discord moderator alerts.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\discord-bot.md
 * - docs\verification.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * - https://www.postgresql.org/docs/current/sql-insert.html
 * Tests:
 * - apps/api-bun/src/app.test.ts
 * - packages/db/src/moderator-warning-cards.integration.test.ts
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

export type ModeratorWarningAlertMessageRef = {
  caseId: string;
  channelId: string;
  createdAt: string;
  lastActorService: string;
  messageId: string;
  messageState: "active" | "deleted";
  messageUrl: string;
  subjectUserId: string;
  updatedAt: string;
};

export type PersistedModeratorWarningAlertMessageRefResult = {
  alertMessageRef: ModeratorWarningAlertMessageRef;
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
};

export type ModeratorWarningCard = {
  alertMessageRef?: ModeratorWarningAlertMessageRef;
  case: {
    caseId: string;
    closedAt?: string;
    openedAt: string;
    reason: string;
    severity: number;
    status: string;
    subjectUserId: string;
  };
  evidenceSummary: {
    evidenceCount: number;
    latestEvidence?: {
      channelId?: string;
      createdAt: string;
      evidenceId: string;
      externalRef?: string;
      messageId?: string;
      messagePreview?: string;
    };
  };
  faceCheck?: {
    passed: boolean;
    performed: boolean;
    satisfiesFaceVerificationRequirement?: boolean;
    source: "reusable_credential_bridge" | "verification_summary";
  };
  reportsSummary: {
    latestReportAt?: string;
    latestReportReason?: string;
    reportCount: number;
    reporterCount: number;
  };
  reusableCredentialBridge?: Record<string, unknown>;
  verification?: {
    caseLinkage: "case_linked" | "subject_latest";
    initiatedBy: string;
    providerId?: string;
    providerStatus?: string;
    sessionId: string;
    state: string;
    summary?: Record<string, unknown>;
    updatedAt: string;
  };
};

export type ModeratorWarningCardsRepository = {
  close(): Promise<void>;
  getWarningCard(input: {
    caseId: string;
    guildId: string;
  }): Promise<ModeratorWarningCard | undefined>;
  upsertAlertMessageRef(input: {
    artifacts: CanonicalArtifacts;
    body: {
      actorService: string;
      channelId: string;
      messageId: string;
      messageState?: "active" | "deleted";
    };
    caseId: string;
    guildId: string;
    traceId?: string;
  }): Promise<PersistedModeratorWarningAlertMessageRefResult>;
};

type CaseRow = {
  case_id: string;
  closed_at: string | null;
  opened_at: string;
  reason: string;
  severity: number;
  status: string;
  subject_user_id: string;
};

type LatestEvidenceRow = {
  channel_id: string | null;
  created_at: string;
  discord_message_url: string | null;
  evidence_id: string;
  message_id: string | null;
  message_preview: string | null;
};

type LatestReportRow = {
  created_at: string;
  report_reason: string;
};

type SummaryCountsRow = {
  evidence_count: number;
  latest_report_at: string | null;
  report_count: number;
  reporter_count: number;
};

type WarningMessageRefRow = {
  case_id: string;
  channel_id: string;
  created_at: string | Date;
  last_actor_service: string;
  message_id: string;
  message_state: "active" | "deleted";
  subject_user_id: string;
  updated_at: string | Date;
  warning_message_ref_id?: string;
};

type VerificationRow = {
  case_id: string | null;
  initiated_by: string;
  provider_status: Record<string, unknown> | null;
  result_summary: Record<string, unknown> | null;
  session_id: string;
  state: string;
  updated_at: string | Date;
};

function createSqlClient(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
  });
}

function buildDiscordMessageUrl(guildId: string, channelId: string, messageId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function toJsonCompatible(value: unknown): JsonCompatible {
  return JSON.parse(JSON.stringify(value)) as JsonCompatible;
}

function readReusableCredentialBridge(providerStatus: Record<string, unknown> | null | undefined) {
  const bridge = (providerStatus as {
    reusableCredentialBridge?: Record<string, unknown>;
  } | null | undefined)?.reusableCredentialBridge;
  return bridge && typeof bridge === "object" ? bridge : undefined;
}

function readFaceCheck(input: {
  reusableCredentialBridge?: Record<string, unknown>;
  verificationSummary?: Record<string, unknown>;
}) {
  const verificationSummary = input.verificationSummary ?? {};
  if (
    typeof verificationSummary.faceVerificationPerformed === "boolean"
    && typeof verificationSummary.faceVerificationPassed === "boolean"
  ) {
    return {
      passed: verificationSummary.faceVerificationPassed,
      performed: verificationSummary.faceVerificationPerformed,
      source: "verification_summary" as const,
    };
  }

  const faceVerification = (input.reusableCredentialBridge as {
    policyInputs?: {
      faceVerification?: {
        passed?: boolean;
        performed?: boolean;
        satisfiesFaceVerificationRequirement?: boolean;
      };
    };
  } | undefined)?.policyInputs?.faceVerification;

  if (typeof faceVerification?.performed === "boolean" && typeof faceVerification.passed === "boolean") {
    return {
      passed: faceVerification.passed,
      performed: faceVerification.performed,
      satisfiesFaceVerificationRequirement:
        typeof faceVerification.satisfiesFaceVerificationRequirement === "boolean"
          ? faceVerification.satisfiesFaceVerificationRequirement
          : undefined,
      source: "reusable_credential_bridge" as const,
    };
  }

  return undefined;
}

function mapWarningMessageRef(row: WarningMessageRefRow, guildId: string): ModeratorWarningAlertMessageRef {
  return {
    caseId: row.case_id,
    channelId: row.channel_id,
    createdAt: new Date(row.created_at).toISOString(),
    lastActorService: row.last_actor_service,
    messageId: row.message_id,
    messageState: row.message_state,
    messageUrl: buildDiscordMessageUrl(guildId, row.channel_id, row.message_id),
    subjectUserId: row.subject_user_id,
    updatedAt: new Date(row.updated_at).toISOString(),
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
      ${sql.json({ canonicalWorkflow: "moderator_warning_card_v1" })}
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
    actorService: string;
    caseId: string;
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
      ${"service"},
      ${input.actorService},
      ${input.targetType},
      ${input.targetId},
      ${"moderator_warning.alert_message_ref_upserted"},
      ${input.requestId},
      ${input.traceId ?? null},
      ${input.idempotencyKey},
      ${input.caseId},
      ${sql.json(input.metadata)}
    )
  `;
}

export function createPostgresModeratorWarningCardsRepository(input: {
  connectionString: string;
}): ModeratorWarningCardsRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async getWarningCard(input) {
      const [caseRow] = await sql<CaseRow[]>`
        SELECT
          case_id,
          subject_user_id,
          reason,
          severity,
          status::text AS status,
          opened_at,
          closed_at
        FROM cases
        WHERE
          guild_id = ${input.guildId}
          AND case_id = ${input.caseId}
      `;

      if (!caseRow) {
        return undefined;
      }

      const [summaryCounts] = await sql<SummaryCountsRow[]>`
        SELECT
          COUNT(DISTINCT r.report_id)::int AS report_count,
          COUNT(DISTINCT r.reporter_user_id)::int AS reporter_count,
          MAX(r.created_at)::text AS latest_report_at,
          COUNT(DISTINCT e.evidence_id)::int AS evidence_count
        FROM cases AS c
        LEFT JOIN reports AS r
          ON r.case_id = c.case_id
        LEFT JOIN evidence_records AS e
          ON e.case_id = c.case_id
        WHERE
          c.guild_id = ${input.guildId}
          AND c.case_id = ${input.caseId}
        GROUP BY c.case_id
      `;

      const [latestReport] = await sql<LatestReportRow[]>`
        SELECT
          report_reason,
          created_at
        FROM reports
        WHERE case_id = ${input.caseId}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const [latestEvidence] = await sql<LatestEvidenceRow[]>`
        SELECT
          e.evidence_id,
          e.created_at,
          l.discord_message_url,
          l.redacted_text_snapshot AS message_preview,
          e.metadata ->> 'channelId' AS channel_id,
          e.metadata ->> 'messageId' AS message_id
        FROM evidence_records AS e
        LEFT JOIN evidence_links AS l
          ON l.evidence_id = e.evidence_id
        WHERE e.case_id = ${input.caseId}
        ORDER BY e.created_at DESC
        LIMIT 1
      `;

      const [verificationRow] = await sql<VerificationRow[]>`
        SELECT
          session_id,
          case_id::text,
          initiated_by,
          state::text AS state,
          provider_status,
          result_summary,
          updated_at
        FROM verification_sessions
        WHERE
          guild_id = ${input.guildId}
          AND user_id = ${caseRow.subject_user_id}
        ORDER BY
          CASE
            WHEN case_id = ${input.caseId}::uuid THEN 0
            ELSE 1
          END,
          updated_at DESC,
          created_at DESC
        LIMIT 1
      `;

      const [warningMessageRef] = await sql<WarningMessageRefRow[]>`
        SELECT
          case_id::text,
          subject_user_id,
          channel_id,
          message_id,
          message_state,
          last_actor_service,
          created_at,
          updated_at
        FROM moderator_warning_message_refs
        WHERE
          guild_id = ${input.guildId}
          AND case_id = ${input.caseId}::uuid
        LIMIT 1
      `;

      const reusableCredentialBridge = readReusableCredentialBridge(verificationRow?.provider_status);
      const verificationSummary =
        verificationRow?.result_summary && Object.keys(verificationRow.result_summary).length > 0
          ? verificationRow.result_summary
          : undefined;

      return {
        alertMessageRef: warningMessageRef ? mapWarningMessageRef(warningMessageRef, input.guildId) : undefined,
        case: {
          caseId: caseRow.case_id,
          closedAt: caseRow.closed_at ?? undefined,
          openedAt: caseRow.opened_at,
          reason: caseRow.reason,
          severity: caseRow.severity,
          status: caseRow.status,
          subjectUserId: caseRow.subject_user_id,
        },
        evidenceSummary: {
          evidenceCount: summaryCounts?.evidence_count ?? 0,
          latestEvidence: latestEvidence
            ? {
                channelId: latestEvidence.channel_id ?? undefined,
                createdAt: latestEvidence.created_at,
                evidenceId: latestEvidence.evidence_id,
                externalRef: latestEvidence.discord_message_url ?? undefined,
                messageId: latestEvidence.message_id ?? undefined,
                messagePreview: latestEvidence.message_preview ?? undefined,
              }
            : undefined,
        },
        faceCheck: readFaceCheck({
          reusableCredentialBridge,
          verificationSummary,
        }),
        reportsSummary: {
          latestReportAt: latestReport?.created_at ?? summaryCounts?.latest_report_at ?? undefined,
          latestReportReason: latestReport?.report_reason,
          reportCount: summaryCounts?.report_count ?? 0,
          reporterCount: summaryCounts?.reporter_count ?? 0,
        },
        reusableCredentialBridge,
        verification: verificationRow
          ? {
              caseLinkage: verificationRow.case_id === input.caseId ? "case_linked" : "subject_latest",
              initiatedBy: verificationRow.initiated_by,
              providerId: typeof verificationRow.provider_status?.selectedProvider === "string"
                ? verificationRow.provider_status.selectedProvider
                : undefined,
              providerStatus: typeof verificationRow.provider_status?.status === "string"
                ? verificationRow.provider_status.status
                : undefined,
              sessionId: verificationRow.session_id,
              state: verificationRow.state,
              summary: verificationSummary,
              updatedAt: new Date(verificationRow.updated_at).toISOString(),
            }
          : undefined,
      } satisfies ModeratorWarningCard;
    },

    async upsertAlertMessageRef(input) {
      return sql.begin(async (transaction) => {
        const receipt = await reserveIdempotency<PersistedModeratorWarningAlertMessageRefResult>(transaction, {
          boundary: input.artifacts.idempotency.scope,
          idempotencyKey: input.artifacts.idempotency.key,
          requestFingerprint: `${input.body.channelId}:${input.body.messageId}:${input.body.messageState ?? "active"}`,
        });

        if (receipt.response_body) {
          return receipt.response_body;
        }

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

        const [warningMessageRef] = await transaction<WarningMessageRefRow[]>`
          INSERT INTO moderator_warning_message_refs (
            guild_id,
            case_id,
            subject_user_id,
            channel_id,
            message_id,
            message_state,
            last_actor_service
          )
          VALUES (
            ${input.guildId},
            ${input.caseId}::uuid,
            ${caseRow.subject_user_id},
            ${input.body.channelId},
            ${input.body.messageId},
            ${input.body.messageState ?? "active"},
            ${input.body.actorService}
          )
          ON CONFLICT (case_id)
          DO UPDATE SET
            channel_id = excluded.channel_id,
            message_id = excluded.message_id,
            message_state = excluded.message_state,
            last_actor_service = excluded.last_actor_service,
            updated_at = now()
          RETURNING
            warning_message_ref_id::text,
            case_id::text,
            subject_user_id,
            channel_id,
            message_id,
            message_state,
            last_actor_service,
            created_at,
            updated_at
        `;

        await transaction`
          INSERT INTO case_events (
            case_event_id,
            case_id,
            guild_id,
            actor_service,
            event_type,
            summary,
            event_payload
          )
          VALUES (
            ${crypto.randomUUID()},
            ${input.caseId}::uuid,
            ${input.guildId},
            ${input.body.actorService},
            ${"moderator_warning_alert_ref_updated"},
            ${input.body.messageState === "deleted"
              ? "Moderator warning alert ref was marked deleted."
              : "Moderator warning alert ref was created or updated."},
            ${transaction.json(toJsonCompatible({
              channelId: input.body.channelId,
              messageId: input.body.messageId,
              messageState: input.body.messageState ?? "active",
            }))}
          )
        `;

        await persistAuditRecord(transaction, {
          actorService: input.body.actorService,
          caseId: input.caseId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            channelId: input.body.channelId,
            messageId: input.body.messageId,
            messageState: input.body.messageState ?? "active",
            subjectUserId: caseRow.subject_user_id,
          },
          requestId: input.artifacts.idempotency.requestId,
          targetId: warningMessageRef.warning_message_ref_id ?? input.caseId,
          targetType: "moderator_warning_message_ref",
          traceId: input.traceId,
        });

        await persistOutboxEvent(transaction, input.artifacts);

        const result = {
          alertMessageRef: mapWarningMessageRef(warningMessageRef, input.guildId),
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
        } satisfies PersistedModeratorWarningAlertMessageRefResult;

        await completeIdempotency(transaction, receipt.idempotency_receipt_id, result, 200);

        return result;
      });
    },

    async close() {
      await sql.end();
    },
  };
}
