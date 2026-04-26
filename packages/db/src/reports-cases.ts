/**
 * Purpose: Persists canonical report, case, evidence, and case-read state in Postgres for the first real Humanify moderation backbone.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\cases-and-reports.md
 * - docs\operations.md
 * - docs\observability-security.md
 * - docs\testing.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * Tests:
 * - packages/db/src/reports-cases.integration.test.ts
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

type CaseDisposition = "created" | "existing" | "not_requested";

export type PersistedReportResult = {
  caseLinkage: {
    caseId?: string;
    disposition: CaseDisposition;
  };
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
  report: {
    caseId?: string;
    guildId: string;
    intakeSource: string;
    openCase: boolean;
    reportId: string;
    reportReason: string;
    reporterNotes?: string;
    reporterUserId: string;
    subjectUserId: string;
    triggerFingerprint: string;
  };
};

export type PersistedEvidenceResult = {
  evidence: {
    actorUserId: string;
    captureSource: string;
    channelId?: string;
    evidenceId: string;
    evidenceType: string;
    externalRef: string;
    guildId: string;
    messageId: string;
    messagePreview?: string;
    reportId: string;
    subjectUserId: string;
  };
  persistence: "persisted";
  processingState: "message_link_canonical";
  queueDelivery: "pending_outbox_publish";
  reportContext: {
    caseId?: string;
    reportId: string;
  };
};

export type CaseOutcomeKind =
  | "confirmed_scam"
  | "confirmed_bot"
  | "confirmed_hacked_account"
  | "false_positive"
  | "dismissed"
  | "overturned";

export type LearnedSignalFamily =
  | "text_similarity"
  | "domain_reputation"
  | "invite_reputation"
  | "image_hash"
  | "behavior_pattern"
  | "reporter_reputation"
  | "server_trust";

export type LearningFeedbackSummary = {
  accepted: boolean;
  candidateSignals: Array<{
    confidence: number;
    id: string;
    sourceCaseIds: string[];
    type: LearnedSignalFamily;
    valueHash: string;
    weight: number;
  }>;
  notes: string[];
};

export type LearnedSignalCandidateRecord = {
  confidence: number;
  falsePositiveCount: number;
  freshnessState: string;
  id: string;
  isSuppressed: boolean;
  reasonCode: string;
  sourceCaseIds: string[];
  text: string;
  truePositiveCount: number;
  type: LearnedSignalFamily;
  valueHash: string;
  weight: number;
};

export type AppliedLearningResult = {
  accepted: boolean;
  appliedSignalCount: number;
  candidateSignals: LearnedSignalCandidateRecord[];
  notes: string[];
  status: "applied" | "no_reusable_signal";
  suppressedSignalCount: number;
};

export type PersistedCaseReviewResult = {
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
  review: {
    actorUserId: string;
    caseEventId: string;
    caseId: string;
    confidence: number;
    evidenceRefs: string[];
    guildId: string;
    outcome: CaseOutcomeKind;
    outcomeId: string;
    rationale?: string;
    reasonCodes: string[];
    subjectUserId: string;
    supersedesOutcomeId?: string;
  };
};

export type CaseSummary = {
  closedAt?: string;
  evidenceCount: number;
  lastEventAt?: string;
  openedAt: string;
  reason: string;
  reportCount: number;
  severity: number;
  status: string;
  subjectUserId: string;
  caseId: string;
};

export type RiskQueueItem = {
  advisoryOnly: true;
  anomalySignals: string[];
  caseId: string;
  lastEventAt?: string;
  openedAt: string;
  reportCount: number;
  severity: number;
  status: string;
  subjectUserId: string;
  trustSignals: {
    lowCredibilityReporterCount: number;
    reporterConsensusConfidence: number;
    reporterConsensusScore: number;
    subjectAnomalyConfidence: number;
    subjectAnomalyScore: number;
    trustedReporterCount: number;
    uniqueReporterCount: number;
  };
};

export type CaseDetail = {
  case: {
    caseId: string;
    closedAt?: string;
    openedAt: string;
    reason: string;
    severity: number;
    status: string;
    subjectUserId: string;
  };
  evidence: Array<{
    actorUserId?: string;
    captureSource: string;
    channelId?: string;
    createdAt: string;
    evidenceId: string;
    evidenceType: string;
    externalRef?: string;
    messageId?: string;
    messagePreview?: string;
    reportId?: string;
    subjectUserId?: string;
  }>;
  events: Array<{
    actorService?: string;
    actorUserId?: string;
    createdAt: string;
    eventPayload: Record<string, unknown>;
    eventType: string;
    summary?: string;
  }>;
  reports: Array<{
    createdAt: string;
    intakeSource: string;
    reportId: string;
    reportReason: string;
    reporterNotes?: string;
    reporterUserId?: string;
    subjectUserId?: string;
    triggerFingerprint: string;
  }>;
};

export type ReportCasesRepository = {
  applyLearningOutcome(input: {
    caseId: string;
    guildId: string;
    learningSummary: LearningFeedbackSummary;
    outcome: CaseOutcomeKind;
    outcomeId: string;
    reasonCodes: string[];
  }): Promise<AppliedLearningResult>;
  attachMessageEvidence(input: {
    artifacts: CanonicalArtifacts;
    body: {
      actorUserId: string;
      captureSource: string;
      channelId: string;
      externalRef: string;
      messageId: string;
      messagePreview?: string;
      subjectUserId: string;
    };
    evidenceId: string;
    guildId: string;
    reportId: string;
    requestFingerprint: string;
    traceId?: string;
  }): Promise<PersistedEvidenceResult>;
  createReport(input: {
    artifacts: CanonicalArtifacts;
    body: {
      intakeSource: string;
      openCase: boolean;
      reportReason: string;
      reporterNotes?: string;
      reporterUserId: string;
      subjectUserId: string;
      triggerFingerprint: string;
    };
    guildId: string;
    proposedCaseId?: string;
    reportId: string;
    traceId?: string;
  }): Promise<PersistedReportResult>;
  listLearnedSignalCandidates(input: {
    guildId: string;
    limit?: number;
  }): Promise<LearnedSignalCandidateRecord[]>;
  recordCaseReview(input: {
    artifacts: CanonicalArtifacts;
    body: {
      actorUserId: string;
      confidence: number;
      outcome: CaseOutcomeKind;
      rationale?: string;
      reasonCodes: string[];
    };
    caseId: string;
    guildId: string;
    traceId?: string;
  }): Promise<PersistedCaseReviewResult>;
  getCaseDetail(input: {
    caseId: string;
    guildId: string;
  }): Promise<CaseDetail | undefined>;
  listRiskQueue(input: {
    guildId: string;
    limit?: number;
  }): Promise<RiskQueueItem[]>;
  listCases(input: {
    guildId: string;
  }): Promise<CaseSummary[]>;
  close(): Promise<void>;
};

function createSqlClient(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
  });
}

function normalizeSignalText(value: string) {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

async function hashSignalValue(value: string) {
  const normalized = normalizeSignalText(value);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, "0")).join("");
  return {
    normalized,
    valueHash: `sha256:${hex}`,
  };
}

function mapCaseOutcomeToStatus(outcome: CaseOutcomeKind) {
  switch (outcome) {
    case "confirmed_scam":
    case "confirmed_bot":
    case "confirmed_hacked_account":
      return "actioned";
    case "false_positive":
    case "dismissed":
      return "dismissed";
    case "overturned":
      return "overturned";
  }
}

function defaultReasonCode(reasonCodes: string[], outcome: CaseOutcomeKind) {
  const [firstReasonCode] = reasonCodes;
  if (firstReasonCode) {
    return firstReasonCode;
  }

  switch (outcome) {
    case "confirmed_scam":
      return "similar_to_confirmed_scam_template";
    case "confirmed_bot":
      return "behavior_pattern_match";
    case "confirmed_hacked_account":
      return "outcome_no_elevated_signal";
    case "false_positive":
    case "dismissed":
    case "overturned":
      return "prior_false_positive";
  }
}

function mapLearnedSignalRow(row: {
  confidence: number;
  false_positive_count: number;
  freshness_state: string;
  is_suppressed: boolean;
  metadata: Record<string, unknown>;
  signal_family: string;
  signal_id: string;
  true_positive_count: number;
  weight: number;
  source_case_id: string | null;
}) {
  const metadata = row.metadata ?? {};
  const text = typeof metadata.normalizedText === "string" ? metadata.normalizedText : "";
  const reasonCode = typeof metadata.reasonCode === "string" ? metadata.reasonCode : "outcome_no_elevated_signal";
  const valueHash = typeof metadata.valueHash === "string" ? metadata.valueHash : "";
  const metadataSourceCaseIds = Array.isArray(metadata.sourceCaseIds)
    ? metadata.sourceCaseIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const sourceCaseIds = metadataSourceCaseIds.length > 0
    ? metadataSourceCaseIds
    : row.source_case_id
      ? [row.source_case_id]
      : [];

  return {
    confidence: row.confidence,
    falsePositiveCount: row.false_positive_count,
    freshnessState: row.freshness_state,
    id: row.signal_id,
    isSuppressed: row.is_suppressed,
    reasonCode,
    sourceCaseIds,
    text,
    truePositiveCount: row.true_positive_count,
    type: row.signal_family as LearnedSignalFamily,
    valueHash,
    weight: row.weight,
  } satisfies LearnedSignalCandidateRecord;
}

type ReputationViewRow = {
  score: number;
  confidence: number;
  summary: Record<string, unknown>;
};

async function upsertReputationView(
  sql: QueryClient,
  input: {
    confidence: number;
    guildId: string;
    reputationKind: string;
    score: number;
    subjectKey: string;
    summary: Record<string, unknown>;
  },
) {
  await sql`
    INSERT INTO reputation_views (
      guild_id,
      reputation_kind,
      subject_key,
      score,
      confidence,
      summary
    )
    VALUES (
      ${input.guildId},
      ${input.reputationKind},
      ${input.subjectKey},
      ${input.score},
      ${input.confidence},
      ${sql.json(input.summary)}
    )
    ON CONFLICT (guild_id, reputation_kind, subject_key)
    DO UPDATE SET
      score = excluded.score,
      confidence = excluded.confidence,
      summary = excluded.summary,
      updated_at = now()
  `;
}

async function refreshSubjectReportAnomaly(
  sql: QueryClient,
  input: {
    guildId: string;
    subjectUserId: string;
  },
) {
  const [counts] = await sql<{
    repeated_trigger_count: number;
    reports_last_15_minutes: number;
    reports_last_24_hours: number;
    unique_reporters_last_15_minutes: number;
    unique_reporters_last_24_hours: number;
  }[]>`
    WITH subject_reports AS (
      SELECT
        reporter_user_id,
        trigger_fingerprint,
        created_at
      FROM reports
      WHERE
        guild_id = ${input.guildId}
        AND subject_user_id = ${input.subjectUserId}
    )
    SELECT
      COALESCE(MAX(trigger_count), 0)::int AS repeated_trigger_count,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '15 minutes')::int AS reports_last_15_minutes,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS reports_last_24_hours,
      COUNT(DISTINCT reporter_user_id) FILTER (
        WHERE created_at >= now() - interval '15 minutes'
          AND reporter_user_id IS NOT NULL
      )::int AS unique_reporters_last_15_minutes,
      COUNT(DISTINCT reporter_user_id) FILTER (
        WHERE created_at >= now() - interval '24 hours'
          AND reporter_user_id IS NOT NULL
      )::int AS unique_reporters_last_24_hours
    FROM (
      SELECT
        reporter_user_id,
        trigger_fingerprint,
        created_at,
        COUNT(*) OVER (PARTITION BY trigger_fingerprint) AS trigger_count
      FROM subject_reports
    ) AS counted_reports
  `;

  const reportsLast15Minutes = counts?.reports_last_15_minutes ?? 0;
  const reportsLast24Hours = counts?.reports_last_24_hours ?? 0;
  const uniqueReportersLast15Minutes = counts?.unique_reporters_last_15_minutes ?? 0;
  const uniqueReportersLast24Hours = counts?.unique_reporters_last_24_hours ?? 0;
  const repeatedTriggerCount = counts?.repeated_trigger_count ?? 0;
  const coordinatedReportBurst = reportsLast15Minutes >= 3 && uniqueReportersLast15Minutes >= 3;
  const score = Math.min(
    10,
    reportsLast24Hours
      + uniqueReportersLast24Hours * 0.5
      + (coordinatedReportBurst ? 1.5 : 0)
      + (repeatedTriggerCount > 1 ? 0.5 : 0),
  );
  const confidence = Math.min(
    0.95,
    0.2
      + uniqueReportersLast24Hours * 0.15
      + Math.min(reportsLast24Hours, 4) * 0.08
      + (repeatedTriggerCount > 1 ? 0.08 : 0),
  );

  await upsertReputationView(sql, {
    confidence,
    guildId: input.guildId,
    reputationKind: "subject_report_anomaly",
    score,
    subjectKey: input.subjectUserId,
    summary: {
      advisoryOnly: true,
      coordinatedReportBurst,
      note: "Canonical report anomalies are advisory-only and must not directly authorize moderation.",
      privacyBoundary: "Reporter identities stay guild-scoped; only aggregated counts belong in shared trust summaries.",
      repeatedTriggerCount,
      reportsLast15Minutes,
      reportsLast24Hours,
      uniqueReportersLast15Minutes,
      uniqueReportersLast24Hours,
    },
  });
}

async function refreshReporterReputation(
  sql: QueryClient,
  input: {
    caseId: string;
    guildId: string;
  },
) {
  const reporterRows = await sql<{
    reporter_user_id: string;
  }[]>`
    SELECT DISTINCT reporter_user_id
    FROM reports
    WHERE
      guild_id = ${input.guildId}
      AND case_id = ${input.caseId}
      AND reporter_user_id IS NOT NULL
  `;

  for (const row of reporterRows) {
    const [summary] = await sql<{
      confirmed_count: number;
      false_positive_count: number;
      last_outcome_at: string | null;
      reviewed_case_count: number;
    }[]>`
      WITH reporter_cases AS (
        SELECT DISTINCT case_id
        FROM reports
        WHERE
          guild_id = ${input.guildId}
          AND reporter_user_id = ${row.reporter_user_id}
          AND case_id IS NOT NULL
      ),
      latest_outcomes AS (
        SELECT DISTINCT ON (co.case_id)
          co.case_id,
          co.created_at,
          co.outcome::text AS outcome
        FROM case_outcomes AS co
        INNER JOIN reporter_cases AS rc
          ON rc.case_id = co.case_id
        ORDER BY co.case_id, co.created_at DESC
      )
      SELECT
        COUNT(*) FILTER (
          WHERE outcome IN ('confirmed_scam', 'confirmed_bot', 'confirmed_hacked_account')
        )::int AS confirmed_count,
        COUNT(*) FILTER (
          WHERE outcome IN ('false_positive', 'dismissed', 'overturned')
        )::int AS false_positive_count,
        MAX(created_at)::text AS last_outcome_at,
        COUNT(*)::int AS reviewed_case_count
      FROM latest_outcomes
    `;

    const reviewedCaseCount = summary?.reviewed_case_count ?? 0;
    const confirmedCount = summary?.confirmed_count ?? 0;
    const falsePositiveCount = summary?.false_positive_count ?? 0;
    const score = reviewedCaseCount === 0 ? 0 : (confirmedCount + 0.5) / (reviewedCaseCount + 1);
    const confidence = Math.min(0.95, reviewedCaseCount / 5);

    await upsertReputationView(sql, {
      confidence,
      guildId: input.guildId,
      reputationKind: "reporter_reputation",
      score,
      subjectKey: row.reporter_user_id,
      summary: {
        advisoryOnly: true,
        confirmedCount,
        falsePositiveCount,
        lastOutcomeAt: summary?.last_outcome_at ?? undefined,
        note: "Reporter reputation is advisory weighting for review surfaces only; it never directly authorizes enforcement.",
        reviewedCaseCount,
      },
    });
  }
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
      ${sql.json({ canonicalWorkflow: "reports_evidence_cases_v1" })}
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

async function persistOutboxEvent(
  sql: QueryClient,
  artifacts: CanonicalArtifacts,
) {
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
    action: string;
    actorUserId?: string;
    guildId: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
    relatedCaseEventId?: string;
    relatedCaseId?: string;
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
      related_case_id,
      related_case_event_id,
      metadata
    )
    VALUES (
      ${input.guildId},
      ${input.actorUserId ? "user" : "service"},
      ${input.actorUserId ?? null},
      ${input.targetType},
      ${input.targetId},
      ${input.action},
      ${input.requestId},
      ${input.traceId ?? null},
      ${input.idempotencyKey},
      ${input.relatedCaseId ?? null},
      ${input.relatedCaseEventId ?? null},
      ${sql.json(input.metadata)}
    )
  `;
}

export function createPostgresReportCasesRepository(input: {
  connectionString: string;
}): ReportCasesRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async attachMessageEvidence(input) {
      return sql.begin(async (transaction) => {
        const receipt = await reserveIdempotency<PersistedEvidenceResult>(transaction, {
          boundary: input.artifacts.idempotency.scope,
          idempotencyKey: input.artifacts.idempotency.key,
          requestFingerprint: input.requestFingerprint,
        });

        if (receipt.response_body) {
          return receipt.response_body;
        }

        await ensureGuild(transaction, input.guildId);
        await ensureUser(transaction, input.body.actorUserId);
        await ensureUser(transaction, input.body.subjectUserId);

        const [reportRow] = await transaction<{
          case_id: string | null;
          report_id: string;
        }[]>`
          SELECT
            report_id,
            case_id
          FROM reports
          WHERE
            guild_id = ${input.guildId}
            AND report_id = ${input.reportId}
        `;

        if (!reportRow) {
          throw new Error(`Report ${input.reportId} was not found in guild ${input.guildId}.`);
        }

        await transaction`
          INSERT INTO evidence_records (
            evidence_id,
            case_id,
            report_id,
            guild_id,
            evidence_type,
            capture_source,
            actor_user_id,
            metadata
          )
          VALUES (
            ${input.evidenceId},
            ${reportRow.case_id ?? null},
            ${reportRow.report_id},
            ${input.guildId},
            ${"message_link"},
            ${input.body.captureSource},
            ${input.body.actorUserId},
            ${transaction.json({
              channelId: input.body.channelId,
              messageId: input.body.messageId,
              messagePreview: input.body.messagePreview,
              subjectUserId: input.body.subjectUserId,
            })}
          )
        `;

        await transaction`
          INSERT INTO evidence_links (
            evidence_id,
            discord_message_url,
            redacted_text_snapshot
          )
          VALUES (
            ${input.evidenceId},
            ${input.body.externalRef},
            ${input.body.messagePreview ?? null}
          )
        `;

        let caseEventId: string | undefined;
        if (reportRow.case_id) {
          caseEventId = crypto.randomUUID();
          await transaction`
            INSERT INTO case_events (
              case_event_id,
              case_id,
              guild_id,
              actor_user_id,
              event_type,
              summary,
              event_payload
            )
            VALUES (
              ${caseEventId},
              ${reportRow.case_id},
              ${input.guildId},
              ${input.body.actorUserId},
              ${"evidence_attached"},
              ${"Canonical Discord message-link evidence attached to the case."},
              ${transaction.json({
                channelId: input.body.channelId,
                evidenceId: input.evidenceId,
                messageId: input.body.messageId,
                reportId: input.reportId,
              })}
            )
          `;
        }

        await persistAuditRecord(transaction, {
          action: "attach",
          actorUserId: input.body.actorUserId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            captureSource: input.body.captureSource,
            evidenceType: "message_link",
            messageId: input.body.messageId,
            reportId: input.reportId,
          },
          relatedCaseEventId: caseEventId,
          relatedCaseId: reportRow.case_id ?? undefined,
          requestId: input.artifacts.idempotency.requestId,
          targetId: input.evidenceId,
          targetType: "evidence",
          traceId: input.traceId,
        });

        await persistOutboxEvent(transaction, input.artifacts);

        const result: PersistedEvidenceResult = {
          evidence: {
            actorUserId: input.body.actorUserId,
            captureSource: input.body.captureSource,
            channelId: input.body.channelId,
            evidenceId: input.evidenceId,
            evidenceType: "message_link",
            externalRef: input.body.externalRef,
            guildId: input.guildId,
            messageId: input.body.messageId,
            messagePreview: input.body.messagePreview,
            reportId: input.reportId,
            subjectUserId: input.body.subjectUserId,
          },
          persistence: "persisted",
          processingState: "message_link_canonical",
          queueDelivery: "pending_outbox_publish",
          reportContext: {
            caseId: reportRow.case_id ?? undefined,
            reportId: input.reportId,
          },
        };

        await completeIdempotency(transaction, receipt.idempotency_receipt_id, result, 201);

        return result;
      });
    },

    async createReport(input) {
      return sql.begin(async (transaction) => {
        const receipt = await reserveIdempotency<PersistedReportResult>(transaction, {
          boundary: input.artifacts.idempotency.scope,
          idempotencyKey: input.artifacts.idempotency.key,
          requestFingerprint: input.body.triggerFingerprint,
        });

        if (receipt.response_body) {
          return receipt.response_body;
        }

        await ensureGuild(transaction, input.guildId);
        await ensureUser(transaction, input.body.reporterUserId);
        await ensureUser(transaction, input.body.subjectUserId);

        let caseId: string | undefined;
        let caseDisposition: CaseDisposition = "not_requested";

        if (input.body.openCase) {
          const [caseRow] = await transaction<{
            case_id: string;
            inserted: boolean;
          }[]>`
            WITH inserted_case AS (
              INSERT INTO cases (
                case_id,
                guild_id,
                subject_user_id,
                opening_fingerprint,
                reason,
                severity,
                status
              )
              VALUES (
                ${input.proposedCaseId ?? crypto.randomUUID()},
                ${input.guildId},
                ${input.body.subjectUserId},
                ${input.body.triggerFingerprint},
                ${input.body.reportReason},
                ${6},
                ${"open"}
              )
              ON CONFLICT DO NOTHING
              RETURNING
                case_id,
                true AS inserted
            )
            SELECT
              case_id,
              inserted
            FROM inserted_case
            UNION ALL
            SELECT
              case_id,
              false AS inserted
            FROM cases
            WHERE
              guild_id = ${input.guildId}
              AND opening_fingerprint = ${input.body.triggerFingerprint}
            LIMIT 1
          `;

          caseId = caseRow?.case_id;
          caseDisposition = caseRow?.inserted ? "created" : "existing";
        }

        const [reportRow] = await transaction<{
          case_id: string | null;
          report_id: string;
        }[]>`
          WITH inserted_report AS (
            INSERT INTO reports (
              report_id,
              guild_id,
              case_id,
              reporter_user_id,
              subject_user_id,
              intake_source,
              trigger_fingerprint,
              report_reason,
              reporter_notes,
              abuse_metadata,
              payload
            )
              VALUES (
                ${input.reportId},
                ${input.guildId},
                ${caseId ?? null},
                ${input.body.reporterUserId},
                ${input.body.subjectUserId},
                ${input.body.intakeSource}::report_intake_source,
                ${input.body.triggerFingerprint},
                ${input.body.reportReason},
                ${input.body.reporterNotes ?? null},
                ${transaction.json({
                  dedupeStrategy: "guild+intake_source+trigger_fingerprint+reporter_user_id",
                })},
              ${transaction.json({
                openCaseRequested: input.body.openCase,
                reporterNotesPresent: Boolean(input.body.reporterNotes),
                severitySeed: 6,
              })}
            )
            ON CONFLICT DO NOTHING
            RETURNING
              report_id,
              case_id
          )
          SELECT
            report_id,
            case_id
          FROM inserted_report
          UNION ALL
          SELECT
            report_id,
            case_id
          FROM reports
          WHERE
            guild_id = ${input.guildId}
            AND intake_source = ${input.body.intakeSource}::report_intake_source
            AND trigger_fingerprint = ${input.body.triggerFingerprint}
            AND reporter_user_id = ${input.body.reporterUserId}
          LIMIT 1
        `;

        if (!reportRow) {
          throw new Error(`Report intake for ${input.body.triggerFingerprint} could not be persisted.`);
        }

        caseId = reportRow.case_id ?? caseId;

        await refreshSubjectReportAnomaly(transaction, {
          guildId: input.guildId,
          subjectUserId: input.body.subjectUserId,
        });

        let caseEventId: string | undefined;
        if (caseId) {
          caseEventId = crypto.randomUUID();
          await transaction`
            INSERT INTO case_events (
              case_event_id,
              case_id,
              guild_id,
              actor_user_id,
              event_type,
              summary,
              event_payload
            )
            VALUES (
              ${caseEventId},
              ${caseId},
              ${input.guildId},
              ${input.body.reporterUserId},
              ${"report_received"},
              ${caseDisposition === "created"
                ? "Canonical report intake opened a new case."
                : "Canonical report intake linked to an existing case."},
              ${transaction.json({
                intakeSource: input.body.intakeSource,
                reportId: reportRow.report_id,
                triggerFingerprint: input.body.triggerFingerprint,
              })}
            )
          `;
        }

        await persistAuditRecord(transaction, {
          action: "intake",
          actorUserId: input.body.reporterUserId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            caseDisposition,
            intakeSource: input.body.intakeSource,
            triggerFingerprint: input.body.triggerFingerprint,
          },
          relatedCaseEventId: caseEventId,
          relatedCaseId: caseId,
          requestId: input.artifacts.idempotency.requestId,
          targetId: reportRow.report_id,
          targetType: "report",
          traceId: input.traceId,
        });

        await persistOutboxEvent(transaction, input.artifacts);

        const result: PersistedReportResult = {
          caseLinkage: {
            caseId,
            disposition: caseDisposition,
          },
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          report: {
            caseId,
            guildId: input.guildId,
            intakeSource: input.body.intakeSource,
            openCase: input.body.openCase,
            reportId: reportRow.report_id,
            reportReason: input.body.reportReason,
            reporterNotes: input.body.reporterNotes,
            reporterUserId: input.body.reporterUserId,
            subjectUserId: input.body.subjectUserId,
            triggerFingerprint: input.body.triggerFingerprint,
          },
        };

        await completeIdempotency(transaction, receipt.idempotency_receipt_id, result, 201);

        return result;
      });
    },

    async recordCaseReview(input) {
      return sql.begin(async (transaction) => {
        const receipt = await reserveIdempotency<PersistedCaseReviewResult>(transaction, {
          boundary: input.artifacts.idempotency.scope,
          idempotencyKey: input.artifacts.idempotency.key,
          requestFingerprint: `${input.caseId}:${input.body.outcome}:${input.body.actorUserId}`,
        });

        if (receipt.response_body) {
          return receipt.response_body;
        }

        await ensureGuild(transaction, input.guildId);
        await ensureUser(transaction, input.body.actorUserId);

        const [caseRow] = await transaction<{
          subject_user_id: string;
        }[]>`
          SELECT subject_user_id
          FROM cases
          WHERE
            guild_id = ${input.guildId}
            AND case_id = ${input.caseId}
        `;

        if (!caseRow) {
          throw new Error(`Case ${input.caseId} was not found in guild ${input.guildId}.`);
        }

        await ensureUser(transaction, caseRow.subject_user_id);

        const evidenceRefs = await transaction<{
          evidence_id: string;
        }[]>`
          SELECT evidence_id
          FROM evidence_records
          WHERE case_id = ${input.caseId}
          ORDER BY created_at ASC
        `;

        const [previousOutcome] = await transaction<{
          outcome_id: string;
        }[]>`
          SELECT outcome_id
          FROM case_outcomes
          WHERE case_id = ${input.caseId}
          ORDER BY created_at DESC
          LIMIT 1
        `;

        const caseEventId = crypto.randomUUID();
        const outcomeId = crypto.randomUUID();
        const caseStatus = mapCaseOutcomeToStatus(input.body.outcome);

        await transaction`
          INSERT INTO case_events (
            case_event_id,
            case_id,
            guild_id,
            actor_user_id,
            event_type,
            summary,
            event_payload
          )
          VALUES (
            ${caseEventId},
            ${input.caseId},
            ${input.guildId},
            ${input.body.actorUserId},
            ${"review_recorded"},
            ${`Moderator recorded ${input.body.outcome} for the case.`},
            ${transaction.json({
              confidence: input.body.confidence,
              outcome: input.body.outcome,
              previousOutcomeId: previousOutcome?.outcome_id,
              rationalePresent: Boolean(input.body.rationale),
              reasonCodes: input.body.reasonCodes,
            })}
          )
        `;

        await transaction`
          INSERT INTO case_outcomes (
            outcome_id,
            case_id,
            guild_id,
            subject_user_id,
            moderator_user_id,
            outcome,
            confidence,
            rationale,
            reason_codes,
            source_event_id,
            supersedes_outcome_id
          )
          VALUES (
            ${outcomeId},
            ${input.caseId},
            ${input.guildId},
            ${caseRow.subject_user_id},
            ${input.body.actorUserId},
            ${input.body.outcome}::case_outcome_kind,
            ${input.body.confidence},
            ${input.body.rationale ?? null},
            ${input.body.reasonCodes},
            ${caseEventId},
            ${previousOutcome?.outcome_id ?? null}
          )
        `;

        await transaction`
          UPDATE cases
          SET
            status = ${caseStatus}::case_status,
            closed_at = CASE
              WHEN ${caseStatus} = 'actioned' OR ${caseStatus} = 'dismissed' OR ${caseStatus} = 'overturned'
                THEN now()
              ELSE closed_at
            END
          WHERE case_id = ${input.caseId}
        `;

        await refreshReporterReputation(transaction, {
          caseId: input.caseId,
          guildId: input.guildId,
        });

        await persistAuditRecord(transaction, {
          action: "review",
          actorUserId: input.body.actorUserId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            confidence: input.body.confidence,
            evidenceRefs: evidenceRefs.map((row) => row.evidence_id),
            outcome: input.body.outcome,
            reasonCodes: input.body.reasonCodes,
          },
          relatedCaseEventId: caseEventId,
          relatedCaseId: input.caseId,
          requestId: input.artifacts.idempotency.requestId,
          targetId: outcomeId,
          targetType: "case_outcome",
          traceId: input.traceId,
        });

        await persistOutboxEvent(transaction, input.artifacts);

        const result: PersistedCaseReviewResult = {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          review: {
            actorUserId: input.body.actorUserId,
            caseEventId,
            caseId: input.caseId,
            confidence: input.body.confidence,
            evidenceRefs: evidenceRefs.map((row) => row.evidence_id),
            guildId: input.guildId,
            outcome: input.body.outcome,
            outcomeId,
            rationale: input.body.rationale,
            reasonCodes: input.body.reasonCodes,
            subjectUserId: caseRow.subject_user_id,
            supersedesOutcomeId: previousOutcome?.outcome_id ?? undefined,
          },
        };

        await completeIdempotency(transaction, receipt.idempotency_receipt_id, result, 201);

        return result;
      });
    },

    async applyLearningOutcome(input) {
      return sql.begin(async (transaction) => {
        const reusableSources = await transaction<{
          evidence_id: string | null;
          source_kind: string;
          source_text: string;
        }[]>`
          SELECT
            e.evidence_id,
            ${"evidence_preview"} AS source_kind,
            l.redacted_text_snapshot AS source_text
          FROM evidence_records AS e
          INNER JOIN evidence_links AS l
            ON l.evidence_id = e.evidence_id
          WHERE
            e.case_id = ${input.caseId}
            AND l.redacted_text_snapshot IS NOT NULL
            AND btrim(l.redacted_text_snapshot) <> ''
          UNION ALL
          SELECT
            NULL AS evidence_id,
            ${"report_context"} AS source_kind,
            concat_ws(' ', r.report_reason, r.reporter_notes) AS source_text
          FROM reports AS r
          WHERE
            r.case_id = ${input.caseId}
            AND btrim(concat_ws(' ', r.report_reason, r.reporter_notes)) <> ''
        `;

        const sourceMap = new Map<string, {
          evidenceId?: string;
          sourceKind: string;
          text: string;
          valueHash: string;
        }>();

        for (const row of reusableSources) {
          const { normalized, valueHash } = await hashSignalValue(row.source_text);
          if (normalized.length < 12) {
            continue;
          }

          if (!sourceMap.has(valueHash)) {
            sourceMap.set(valueHash, {
              evidenceId: row.evidence_id ?? undefined,
              sourceKind: row.source_kind,
              text: normalized,
              valueHash,
            });
          }
        }

        const sources = Array.from(sourceMap.values());
        if (sources.length === 0) {
          return {
            accepted: input.learningSummary.accepted,
            appliedSignalCount: 0,
            candidateSignals: [],
            notes: [
              ...input.learningSummary.notes,
              "No reusable redacted text was available for learned-signal persistence.",
            ],
            status: "no_reusable_signal",
            suppressedSignalCount: 0,
          } satisfies AppliedLearningResult;
        }

        const candidateTemplates = input.learningSummary.candidateSignals.length > 0
          ? input.learningSummary.candidateSignals
          : [];
        const appliedSignals: LearnedSignalCandidateRecord[] = [];
        let suppressedSignalCount = 0;

        for (const source of sources) {
          const reasonCode = defaultReasonCode(input.reasonCodes, input.outcome);
          const matchingPositiveSignals = await transaction<{
            confidence: number;
            false_positive_count: number;
            freshness_state: string;
            is_suppressed: boolean;
            metadata: Record<string, unknown>;
            signal_family: string;
            signal_id: string;
            source_case_id: string | null;
            true_positive_count: number;
            weight: number;
          }[]>`
            SELECT
              signal_id,
              signal_family::text,
              source_case_id::text,
              weight::float8,
              confidence::float8,
              true_positive_count,
              false_positive_count,
              freshness_state,
              is_suppressed,
              metadata
            FROM learned_signals
            WHERE
              guild_id = ${input.guildId}
              AND metadata ->> 'valueHash' = ${source.valueHash}
              AND signal_family <> ${"false_positive_suppression"}::signal_type
            ORDER BY updated_at DESC
          `;

          if (input.outcome === "false_positive" || input.outcome === "dismissed" || input.outcome === "overturned") {
            for (const existingSignal of matchingPositiveSignals) {
              const [existingExample] = await transaction<{
                example_id: string;
              }[]>`
                SELECT example_id
                FROM signal_examples
                WHERE
                  signal_id = ${existingSignal.signal_id}
                  AND source_outcome_id = ${input.outcomeId}
                  AND normalized_value_hash = ${source.valueHash}
                LIMIT 1
              `;

              if (existingExample) {
                continue;
              }

              const suppressImmediately = input.outcome === "overturned";
              const nextFalsePositiveCount = existingSignal.false_positive_count + 1;
              const shouldSuppress = suppressImmediately
                || nextFalsePositiveCount >= Math.max(existingSignal.true_positive_count, 1)
                || nextFalsePositiveCount >= 2;

              const [updatedSignal] = await transaction<{
                confidence: number;
                false_positive_count: number;
                freshness_state: string;
                is_suppressed: boolean;
                metadata: Record<string, unknown>;
                signal_family: string;
                signal_id: string;
                source_case_id: string | null;
                true_positive_count: number;
                weight: number;
              }[]>`
                UPDATE learned_signals
                SET
                  source_case_id = ${input.caseId},
                  source_outcome_id = ${input.outcomeId},
                  weight = GREATEST(0, weight - 0.75),
                  confidence = GREATEST(0.05, confidence * 0.65),
                  false_positive_count = false_positive_count + 1,
                  freshness_state = ${shouldSuppress ? "suppressed" : "needs_review"},
                  is_suppressed = ${shouldSuppress},
                  suppressed_at = CASE WHEN ${shouldSuppress} THEN now() ELSE suppressed_at END,
                  updated_at = now(),
                  metadata = learned_signals.metadata || ${transaction.json({
                    lastOutcome: input.outcome,
                    lastOutcomeId: input.outcomeId,
                    lastSuppressedByCaseId: input.caseId,
                    reasonCode,
                    sourceCaseIds: [input.caseId],
                    valueHash: source.valueHash,
                  })}
                WHERE signal_id = ${existingSignal.signal_id}
                RETURNING
                  signal_id,
                  signal_family::text,
                  source_case_id::text,
                  weight::float8,
                  confidence::float8,
                  true_positive_count,
                  false_positive_count,
                  freshness_state,
                  is_suppressed,
                  metadata
              `;

              await transaction`
                INSERT INTO signal_examples (
                  signal_id,
                  source_case_id,
                  source_outcome_id,
                  evidence_id,
                  normalized_value_hash,
                  label,
                  metadata
                )
                VALUES (
                  ${existingSignal.signal_id},
                  ${input.caseId},
                  ${input.outcomeId},
                  ${source.evidenceId ?? null},
                  ${source.valueHash},
                  ${input.outcome}::case_outcome_kind,
                  ${transaction.json({
                    reasonCode,
                    sourceKind: source.sourceKind,
                    sourceTextPreview: source.text.slice(0, 160),
                  })}
                )
              `;

              if (updatedSignal?.is_suppressed) {
                suppressedSignalCount += 1;
              }
            }

            continue;
          }

          for (const template of candidateTemplates) {
            const [existingSignal] = await transaction<{
              confidence: number;
              false_positive_count: number;
              freshness_state: string;
              is_suppressed: boolean;
              metadata: Record<string, unknown>;
              signal_family: string;
              signal_id: string;
              source_case_id: string | null;
              true_positive_count: number;
              weight: number;
            }[]>`
              SELECT
                signal_id,
                signal_family::text,
                source_case_id::text,
                weight::float8,
                confidence::float8,
                true_positive_count,
                false_positive_count,
                freshness_state,
                is_suppressed,
                metadata
              FROM learned_signals
              WHERE
                guild_id = ${input.guildId}
                AND signal_family = ${template.type}::signal_type
                AND metadata ->> 'valueHash' = ${source.valueHash}
              ORDER BY updated_at DESC
              LIMIT 1
            `;

            if (existingSignal) {
              const [existingExample] = await transaction<{
                example_id: string;
              }[]>`
                SELECT example_id
                FROM signal_examples
                WHERE
                  signal_id = ${existingSignal.signal_id}
                  AND source_outcome_id = ${input.outcomeId}
                  AND normalized_value_hash = ${source.valueHash}
                LIMIT 1
              `;

              if (existingExample) {
                appliedSignals.push(mapLearnedSignalRow(existingSignal));
                continue;
              }

              const [updatedSignal] = await transaction<{
                confidence: number;
                false_positive_count: number;
                freshness_state: string;
                is_suppressed: boolean;
                metadata: Record<string, unknown>;
                signal_family: string;
                signal_id: string;
                source_case_id: string | null;
                true_positive_count: number;
                weight: number;
              }[]>`
                UPDATE learned_signals
                SET
                  source_case_id = ${input.caseId},
                  source_outcome_id = ${input.outcomeId},
                  weight = LEAST(4.5, weight + 0.25),
                  confidence = LEAST(0.99, confidence + ${Math.max(0.03, template.confidence * 0.08)}),
                  true_positive_count = true_positive_count + 1,
                  freshness_state = ${"fresh"},
                  is_suppressed = false,
                  suppressed_at = null,
                  updated_at = now(),
                  metadata = learned_signals.metadata || ${transaction.json({
                    lastOutcome: input.outcome,
                    lastOutcomeId: input.outcomeId,
                    normalizedText: source.text,
                    reasonCode,
                    sourceCaseIds: Array.from(new Set([...template.sourceCaseIds, input.caseId])),
                    sourceKind: source.sourceKind,
                    valueHash: source.valueHash,
                  })}
                WHERE signal_id = ${existingSignal.signal_id}
                RETURNING
                  signal_id,
                  signal_family::text,
                  source_case_id::text,
                  weight::float8,
                  confidence::float8,
                  true_positive_count,
                  false_positive_count,
                  freshness_state,
                  is_suppressed,
                  metadata
              `;

              await transaction`
                INSERT INTO signal_examples (
                  signal_id,
                  source_case_id,
                  source_outcome_id,
                  evidence_id,
                  normalized_value_hash,
                  label,
                  metadata
                )
                VALUES (
                  ${existingSignal.signal_id},
                  ${input.caseId},
                  ${input.outcomeId},
                  ${source.evidenceId ?? null},
                  ${source.valueHash},
                  ${input.outcome}::case_outcome_kind,
                  ${transaction.json({
                    reasonCode,
                    sourceKind: source.sourceKind,
                    sourceTextPreview: source.text.slice(0, 160),
                  })}
                )
              `;

              await transaction`
                INSERT INTO signal_embeddings (
                  owner_entity_type,
                  owner_entity_id,
                  signal_id,
                  embedding_model,
                  embedding_version,
                  embedding,
                  freshness_state,
                  metadata
                )
                VALUES (
                  ${"learned_signal"},
                  ${existingSignal.signal_id},
                  ${existingSignal.signal_id},
                  ${"fastembed-text"},
                  ${"pending_projection"},
                  ${null},
                  ${"pending_projection"},
                  ${transaction.json({
                    normalizedText: source.text,
                    projectionStatus: "pending",
                    valueHash: source.valueHash,
                  })}
                )
                ON CONFLICT (owner_entity_type, owner_entity_id, embedding_model, embedding_version)
                DO UPDATE SET
                  signal_id = excluded.signal_id,
                  freshness_state = excluded.freshness_state,
                  metadata = excluded.metadata,
                  updated_at = now()
              `;

              appliedSignals.push(mapLearnedSignalRow(updatedSignal));
              continue;
            }

            const signalId = crypto.randomUUID();
            const [insertedSignal] = await transaction<{
              confidence: number;
              false_positive_count: number;
              freshness_state: string;
              is_suppressed: boolean;
              metadata: Record<string, unknown>;
              signal_family: string;
              signal_id: string;
              source_case_id: string | null;
              true_positive_count: number;
              weight: number;
            }[]>`
              INSERT INTO learned_signals (
                signal_id,
                guild_id,
                signal_family,
                source_case_id,
                source_outcome_id,
                weight,
                confidence,
                true_positive_count,
                false_positive_count,
                freshness_state,
                metadata
              )
              VALUES (
                ${signalId},
                ${input.guildId},
                ${template.type}::signal_type,
                ${input.caseId},
                ${input.outcomeId},
                ${template.weight},
                ${template.confidence},
                ${1},
                ${0},
                ${"fresh"},
                ${transaction.json({
                  firstOutcomeId: input.outcomeId,
                  normalizedText: source.text,
                  reasonCode,
                  sourceCaseIds: Array.from(new Set([...template.sourceCaseIds, input.caseId])),
                  sourceKind: source.sourceKind,
                  valueHash: source.valueHash,
                })}
              )
              RETURNING
                signal_id,
                signal_family::text,
                source_case_id::text,
                weight::float8,
                confidence::float8,
                true_positive_count,
                false_positive_count,
                freshness_state,
                is_suppressed,
                metadata
            `;

            await transaction`
              INSERT INTO signal_examples (
                signal_id,
                source_case_id,
                source_outcome_id,
                evidence_id,
                normalized_value_hash,
                label,
                metadata
              )
              VALUES (
                ${signalId},
                ${input.caseId},
                ${input.outcomeId},
                ${source.evidenceId ?? null},
                ${source.valueHash},
                ${input.outcome}::case_outcome_kind,
                ${transaction.json({
                  reasonCode,
                  sourceKind: source.sourceKind,
                  sourceTextPreview: source.text.slice(0, 160),
                })}
              )
            `;

            await transaction`
              INSERT INTO signal_embeddings (
                owner_entity_type,
                owner_entity_id,
                signal_id,
                embedding_model,
                embedding_version,
                embedding,
                freshness_state,
                metadata
              )
              VALUES (
                ${"learned_signal"},
                ${signalId},
                ${signalId},
                ${"fastembed-text"},
                ${"pending_projection"},
                ${null},
                ${"pending_projection"},
                ${transaction.json({
                  normalizedText: source.text,
                  projectionStatus: "pending",
                  valueHash: source.valueHash,
                })}
              )
            `;

            appliedSignals.push(mapLearnedSignalRow(insertedSignal));
          }
        }

        return {
          accepted: input.learningSummary.accepted,
          appliedSignalCount: appliedSignals.length,
          candidateSignals: appliedSignals.filter((signal, index, collection) =>
            collection.findIndex((candidate) => candidate.id === signal.id) === index),
          notes: input.learningSummary.notes,
          status: appliedSignals.length > 0 || suppressedSignalCount > 0 ? "applied" : "no_reusable_signal",
          suppressedSignalCount,
        } satisfies AppliedLearningResult;
      });
    },

    async listLearnedSignalCandidates(input) {
      const rows = await sql<{
        confidence: number;
        false_positive_count: number;
        freshness_state: string;
        is_suppressed: boolean;
        metadata: Record<string, unknown>;
        signal_family: string;
        signal_id: string;
        source_case_id: string | null;
        true_positive_count: number;
        weight: number;
      }[]>`
        SELECT
          signal_id,
          signal_family::text,
          source_case_id::text,
          weight::float8,
          confidence::float8,
          true_positive_count,
          false_positive_count,
          freshness_state,
          is_suppressed,
          metadata
        FROM learned_signals
        WHERE
          guild_id = ${input.guildId}
          AND signal_family <> ${"false_positive_suppression"}::signal_type
          AND is_suppressed = false
          AND COALESCE(metadata ->> 'normalizedText', '') <> ''
        ORDER BY updated_at DESC
        LIMIT ${input.limit ?? 50}
      `;

      return rows.map(mapLearnedSignalRow);
    },

    async listRiskQueue(input) {
      const rows = await sql<{
        anomaly_confidence: number | null;
        anomaly_score: number | null;
        anomaly_summary: Record<string, unknown> | null;
        case_id: string;
        last_event_at: string | null;
        opened_at: string;
        report_count: number;
        severity: number;
        status: string;
        subject_user_id: string;
        trusted_reporter_count: number;
        low_credibility_reporter_count: number;
        unique_reporter_count: number;
      }[]>`
        WITH queued_cases AS (
          SELECT
            c.case_id,
            c.subject_user_id,
            c.severity,
            c.status::text AS status,
            c.opened_at
          FROM cases AS c
          WHERE
            c.guild_id = ${input.guildId}
            AND c.status IN ('open', 'reviewing', 'appealed', 'reopened')
          ORDER BY c.opened_at DESC
          LIMIT ${input.limit ?? 50}
        ),
        last_case_events AS (
          SELECT
            ce.case_id,
            MAX(ce.created_at)::text AS last_event_at
          FROM case_events AS ce
          INNER JOIN queued_cases AS qc
            ON qc.case_id = ce.case_id
          GROUP BY ce.case_id
        ),
        reporter_rollup AS (
          SELECT
            r.case_id,
            COUNT(*)::int AS report_count,
            COUNT(DISTINCT r.reporter_user_id)::int AS unique_reporter_count,
            COUNT(DISTINCT r.reporter_user_id) FILTER (
              WHERE
                COALESCE(rv.score, 0) >= 0.7
                AND COALESCE(rv.confidence, 0) >= 0.2
            )::int AS trusted_reporter_count,
            COUNT(DISTINCT r.reporter_user_id) FILTER (
              WHERE
                COALESCE(rv.score, 1) <= 0.35
                AND COALESCE(rv.confidence, 0) >= 0.2
            )::int AS low_credibility_reporter_count
          FROM reports AS r
          INNER JOIN queued_cases AS qc
            ON qc.case_id = r.case_id
          LEFT JOIN reputation_views AS rv
            ON rv.guild_id = r.guild_id
            AND rv.reputation_kind = ${"reporter_reputation"}
            AND rv.subject_key = r.reporter_user_id
          GROUP BY r.case_id
        )
        SELECT
          qc.case_id,
          qc.subject_user_id,
          qc.severity,
          qc.status,
          qc.opened_at,
          lce.last_event_at,
          COALESCE(rr.report_count, 0) AS report_count,
          COALESCE(rr.unique_reporter_count, 0) AS unique_reporter_count,
          COALESCE(rr.trusted_reporter_count, 0) AS trusted_reporter_count,
          COALESCE(rr.low_credibility_reporter_count, 0) AS low_credibility_reporter_count,
          rv_subject.score::float8 AS anomaly_score,
          rv_subject.confidence::float8 AS anomaly_confidence,
          rv_subject.summary AS anomaly_summary
        FROM queued_cases AS qc
        LEFT JOIN last_case_events AS lce
          ON lce.case_id = qc.case_id
        LEFT JOIN reporter_rollup AS rr
          ON rr.case_id = qc.case_id
        LEFT JOIN reputation_views AS rv_subject
          ON rv_subject.guild_id = ${input.guildId}
          AND rv_subject.reputation_kind = ${"subject_report_anomaly"}
          AND rv_subject.subject_key = qc.subject_user_id
        ORDER BY
          COALESCE(rv_subject.score, 0) DESC,
          qc.severity DESC,
          qc.opened_at DESC
      `;

      return rows.map((row) => {
        const anomalySummary = (row.anomaly_summary ?? {}) as Record<string, unknown>;
        const coordinatedReportBurst = anomalySummary.coordinatedReportBurst === true;
        const anomalySignals = [
          ...(coordinatedReportBurst ? ["coordinated_report_burst"] : []),
          ...(row.trusted_reporter_count > 0 ? ["trusted_reporter_consensus"] : []),
          ...(row.low_credibility_reporter_count > 0 ? ["low_credibility_reporter_present"] : []),
        ];
        const reporterConsensusScore = row.unique_reporter_count === 0
          ? 0
          : row.trusted_reporter_count / row.unique_reporter_count;
        const reporterConsensusConfidence = Math.min(
          0.95,
          row.unique_reporter_count * 0.2 + row.trusted_reporter_count * 0.1,
        );

        return {
          advisoryOnly: true,
          anomalySignals,
          caseId: row.case_id,
          lastEventAt: row.last_event_at ?? undefined,
          openedAt: row.opened_at,
          reportCount: row.report_count,
          severity: row.severity,
          status: row.status,
          subjectUserId: row.subject_user_id,
          trustSignals: {
            lowCredibilityReporterCount: row.low_credibility_reporter_count,
            reporterConsensusConfidence,
            reporterConsensusScore,
            subjectAnomalyConfidence: row.anomaly_confidence ?? 0,
            subjectAnomalyScore: row.anomaly_score ?? 0,
            trustedReporterCount: row.trusted_reporter_count,
            uniqueReporterCount: row.unique_reporter_count,
          },
        } satisfies RiskQueueItem;
      });
    },

    async getCaseDetail(input) {
      const [caseRow] = await sql<{
        case_id: string;
        closed_at: string | null;
        opened_at: string;
        reason: string;
        severity: number;
        status: string;
        subject_user_id: string;
      }[]>`
        SELECT
          case_id,
          subject_user_id,
          reason,
          severity,
          status::text,
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

      const reports = await sql<{
        created_at: string;
        intake_source: string;
        report_id: string;
        report_reason: string;
        reporter_notes: string | null;
        reporter_user_id: string | null;
        subject_user_id: string | null;
        trigger_fingerprint: string;
      }[]>`
        SELECT
          report_id,
          intake_source::text,
          report_reason,
          reporter_notes,
          reporter_user_id,
          subject_user_id,
          trigger_fingerprint,
          created_at
        FROM reports
        WHERE case_id = ${input.caseId}
        ORDER BY created_at ASC
      `;

      const evidence = await sql<{
        actor_user_id: string | null;
        capture_source: string;
        channel_id: string | null;
        created_at: string;
        discord_message_url: string | null;
        evidence_id: string;
        evidence_type: string;
        message_id: string | null;
        message_preview: string | null;
        report_id: string | null;
        subject_user_id: string | null;
      }[]>`
        SELECT
          e.evidence_id,
          e.evidence_type::text,
          e.capture_source,
          e.actor_user_id,
          e.report_id,
          e.created_at,
          l.discord_message_url,
          l.redacted_text_snapshot AS message_preview,
          e.metadata ->> 'channelId' AS channel_id,
          e.metadata ->> 'messageId' AS message_id,
          e.metadata ->> 'subjectUserId' AS subject_user_id
        FROM evidence_records AS e
        LEFT JOIN evidence_links AS l
          ON l.evidence_id = e.evidence_id
        WHERE e.case_id = ${input.caseId}
        ORDER BY e.created_at ASC
      `;

      const events = await sql<{
        actor_service: string | null;
        actor_user_id: string | null;
        created_at: string;
        event_payload: Record<string, unknown>;
        event_type: string;
        summary: string | null;
      }[]>`
        SELECT
          event_type,
          summary,
          actor_user_id,
          actor_service,
          event_payload,
          created_at
        FROM case_events
        WHERE case_id = ${input.caseId}
        ORDER BY created_at ASC
      `;

      return {
        case: {
          caseId: caseRow.case_id,
          closedAt: caseRow.closed_at ?? undefined,
          openedAt: caseRow.opened_at,
          reason: caseRow.reason,
          severity: caseRow.severity,
          status: caseRow.status,
          subjectUserId: caseRow.subject_user_id,
        },
        evidence: evidence.map((row) => ({
          actorUserId: row.actor_user_id ?? undefined,
          captureSource: row.capture_source,
          channelId: row.channel_id ?? undefined,
          createdAt: row.created_at,
          evidenceId: row.evidence_id,
          evidenceType: row.evidence_type,
          externalRef: row.discord_message_url ?? undefined,
          messageId: row.message_id ?? undefined,
          messagePreview: row.message_preview ?? undefined,
          reportId: row.report_id ?? undefined,
          subjectUserId: row.subject_user_id ?? undefined,
        })),
        events: events.map((row) => ({
          actorService: row.actor_service ?? undefined,
          actorUserId: row.actor_user_id ?? undefined,
          createdAt: row.created_at,
          eventPayload: row.event_payload,
          eventType: row.event_type,
          summary: row.summary ?? undefined,
        })),
        reports: reports.map((row) => ({
          createdAt: row.created_at,
          intakeSource: row.intake_source,
          reportId: row.report_id,
          reportReason: row.report_reason,
          reporterNotes: row.reporter_notes ?? undefined,
          reporterUserId: row.reporter_user_id ?? undefined,
          subjectUserId: row.subject_user_id ?? undefined,
          triggerFingerprint: row.trigger_fingerprint,
        })),
      };
    },

    async listCases(input) {
      const rows = await sql<{
        case_id: string;
        closed_at: string | null;
        evidence_count: number;
        last_event_at: string | null;
        opened_at: string;
        reason: string;
        report_count: number;
        severity: number;
        status: string;
        subject_user_id: string;
      }[]>`
        SELECT
          c.case_id,
          c.subject_user_id,
          c.reason,
          c.severity,
          c.status::text,
          c.opened_at,
          c.closed_at,
          COUNT(DISTINCT r.report_id)::int AS report_count,
          COUNT(DISTINCT e.evidence_id)::int AS evidence_count,
          MAX(ce.created_at) AS last_event_at
        FROM cases AS c
        LEFT JOIN reports AS r
          ON r.case_id = c.case_id
        LEFT JOIN evidence_records AS e
          ON e.case_id = c.case_id
        LEFT JOIN case_events AS ce
          ON ce.case_id = c.case_id
        WHERE c.guild_id = ${input.guildId}
        GROUP BY
          c.case_id,
          c.subject_user_id,
          c.reason,
          c.severity,
          c.status,
          c.opened_at,
          c.closed_at
        ORDER BY c.opened_at DESC
      `;

      return rows.map((row) => ({
        caseId: row.case_id,
        closedAt: row.closed_at ?? undefined,
        evidenceCount: row.evidence_count,
        lastEventAt: row.last_event_at ?? undefined,
        openedAt: row.opened_at,
        reason: row.reason,
        reportCount: row.report_count,
        severity: row.severity,
        status: row.status,
        subjectUserId: row.subject_user_id,
      }));
    },

    close() {
      return sql.end({ timeout: 1 });
    },
  };
}
