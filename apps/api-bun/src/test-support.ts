/**
 * Purpose: Provides deterministic in-memory report, evidence, review, and learned-signal state for API route tests that should not hit shared Postgres infrastructure.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\cases-and-reports.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * Tests:
 * - apps/api-bun/src/app.test.ts
 * - apps/api-bun/src/app.bot-intake.test.ts
 */

import type {
  AppliedLearningResult,
  CaseOutcomeKind,
  LearnedSignalCandidateRecord,
  LearnedSignalFamily,
  LearningFeedbackSummary,
  PersistedCaseReviewResult,
  RiskQueueItem,
  ReportCasesRepository,
} from "@humanify/db";

function normalizeSignalText(value: string) {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

async function hashSignalValue(value: string) {
  const normalized = normalizeSignalText(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, "0")).join("");
  return {
    normalized,
    valueHash: `sha256:${hash}`,
  };
}

function defaultReasonCode(reasonCodes: string[], outcome: CaseOutcomeKind) {
  return reasonCodes[0]
    ?? (outcome === "confirmed_bot"
      ? "behavior_pattern_match"
      : outcome === "confirmed_scam"
        ? "similar_to_confirmed_scam_template"
        : outcome === "confirmed_hacked_account"
          ? "outcome_no_elevated_signal"
          : "prior_false_positive");
}

export function createInMemoryReportCasesRepository(): ReportCasesRepository {
  const cases = new Map<string, {
    caseId: string;
    closedAt?: string;
    guildId: string;
    lastEventAt: string;
    openedAt: string;
    reason: string;
    reports: Array<{
      createdAt: string;
      intakeSource: string;
      reportId: string;
      reportReason: string;
      reporterNotes?: string;
      reporterUserId: string;
      subjectUserId: string;
      triggerFingerprint: string;
    }>;
    status: string;
    subjectUserId: string;
  }>();
  const reports = new Map<string, {
    caseId?: string;
    createdAt: string;
    guildId: string;
    intakeSource: string;
    reportId: string;
    reportReason: string;
    reporterNotes?: string;
    reporterUserId: string;
    subjectUserId: string;
    triggerFingerprint: string;
  }>();
  const evidence = new Map<string, {
    actorUserId: string;
    captureSource: string;
    channelId: string;
    createdAt: string;
    evidenceId: string;
    externalRef: string;
    messageId: string;
    messagePreview?: string;
    reportId: string;
    subjectUserId: string;
  }>();
  const reviews = new Map<string, PersistedCaseReviewResult["review"][]>();
  const learnedSignals = new Map<string, LearnedSignalCandidateRecord>();
  const idempotencyReceipts = new Map<string, unknown>();
  const reporterReputations = new Map<string, {
    confidence: number;
    falsePositiveCount: number;
    reviewedCaseCount: number;
    score: number;
    trusted: boolean;
  }>();
  const reporterCaseOutcomes = new Map<string, CaseOutcomeKind>();
  const subjectAnomalies = new Map<string, {
    confidence: number;
    coordinatedReportBurst: boolean;
    repeatedTriggerCount: number;
    reportsLast15Minutes: number;
    reportsLast24Hours: number;
    score: number;
    uniqueReportersLast15Minutes: number;
    uniqueReportersLast24Hours: number;
  }>();

  function buildIdempotencyReceiptKey(scope: string, key: string) {
    return `${scope}::${key}`;
  }

  function readIdempotencyReceipt<TResult>(scope: string, key: string) {
    return idempotencyReceipts.get(buildIdempotencyReceiptKey(scope, key)) as TResult | undefined;
  }

  function storeIdempotencyReceipt<TResult>(scope: string, key: string, result: TResult) {
    idempotencyReceipts.set(buildIdempotencyReceiptKey(scope, key), result);
  }

  function recalculateSubjectAnomaly(guildId: string, subjectUserId: string) {
    const subjectReports = Array.from(reports.values()).filter((entry) =>
      entry.guildId === guildId && entry.subjectUserId === subjectUserId
    );
    const now = Date.now();
    const last15Minutes = subjectReports.filter((entry) => now - new Date(entry.createdAt).getTime() <= 15 * 60 * 1000);
    const last24Hours = subjectReports.filter((entry) => now - new Date(entry.createdAt).getTime() <= 24 * 60 * 60 * 1000);
    const repeatedTriggerCount = subjectReports.reduce((max, entry) => {
      const matching = subjectReports.filter((candidate) => candidate.triggerFingerprint === entry.triggerFingerprint).length;
      return Math.max(max, matching);
    }, 0);
    const uniqueReportersLast15Minutes = new Set(last15Minutes.map((entry) => entry.reporterUserId)).size;
    const uniqueReportersLast24Hours = new Set(last24Hours.map((entry) => entry.reporterUserId)).size;
    const coordinatedReportBurst = last15Minutes.length >= 3 && uniqueReportersLast15Minutes >= 3;
    const score = Math.min(
      10,
      last24Hours.length
        + uniqueReportersLast24Hours * 0.5
        + (coordinatedReportBurst ? 1.5 : 0)
        + (repeatedTriggerCount > 1 ? 0.5 : 0),
    );
    const confidence = Math.min(
      0.95,
      0.2 + uniqueReportersLast24Hours * 0.15 + Math.min(last24Hours.length, 4) * 0.08 + (repeatedTriggerCount > 1 ? 0.08 : 0),
    );

    subjectAnomalies.set(`${guildId}:${subjectUserId}`, {
      confidence,
      coordinatedReportBurst,
      repeatedTriggerCount,
      reportsLast15Minutes: last15Minutes.length,
      reportsLast24Hours: last24Hours.length,
      score,
      uniqueReportersLast15Minutes,
      uniqueReportersLast24Hours,
    });
  }

  function recalculateReporterReputation(guildId: string, reporterUserId: string) {
    const reporterReports = Array.from(reports.values()).filter((entry) =>
      entry.guildId === guildId && entry.reporterUserId === reporterUserId && entry.caseId
    );
    const reviewedCaseIds = Array.from(new Set(reporterReports.map((entry) => entry.caseId!)));
    let confirmedCount = 0;
    let falsePositiveCount = 0;

    for (const caseId of reviewedCaseIds) {
      const outcome = reporterCaseOutcomes.get(`${guildId}:${reporterUserId}:${caseId}`);
      if (!outcome) {
        continue;
      }

      if (outcome === "confirmed_scam" || outcome === "confirmed_bot" || outcome === "confirmed_hacked_account") {
        confirmedCount += 1;
      } else {
        falsePositiveCount += 1;
      }
    }

    const reviewedCaseCount = confirmedCount + falsePositiveCount;
    const score = reviewedCaseCount === 0 ? 0 : (confirmedCount + 0.5) / (reviewedCaseCount + 1);
    const confidence = Math.min(0.95, reviewedCaseCount / 5);

    reporterReputations.set(`${guildId}:${reporterUserId}`, {
      confidence,
      falsePositiveCount,
      reviewedCaseCount,
      score,
      trusted: score >= 0.7 && confidence >= 0.2,
    });
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

  return {
    async applyLearningOutcome(input) {
      const caseReports = Array.from(reports.values()).filter((entry) => entry.caseId === input.caseId);
      const caseEvidence = Array.from(evidence.values()).filter((entry) => reports.get(entry.reportId)?.caseId === input.caseId);
      const reusableTexts = [
        ...caseEvidence.map((entry) => entry.messagePreview).filter((entry): entry is string => Boolean(entry?.trim())),
        ...caseReports.map((entry) => `${entry.reportReason} ${entry.reporterNotes ?? ""}`.trim()).filter(Boolean),
      ];

      if (reusableTexts.length === 0) {
        return {
          accepted: input.learningSummary.accepted,
          appliedSignalCount: 0,
          candidateSignals: [],
          notes: [...input.learningSummary.notes, "No reusable redacted text was available for learned-signal persistence."],
          status: "no_reusable_signal",
          suppressedSignalCount: 0,
        } satisfies AppliedLearningResult;
      }

      let suppressedSignalCount = 0;
      const candidateSignals: LearnedSignalCandidateRecord[] = [];

      for (const reusableText of reusableTexts) {
        const { normalized, valueHash } = await hashSignalValue(reusableText);
        if (normalized.length < 12) {
          continue;
        }

        if (
          (input.outcome === "false_positive" || input.outcome === "dismissed" || input.outcome === "overturned")
          && input.learningSummary.candidateSignals.length === 0
        ) {
          for (const current of learnedSignals.values()) {
            if (current.valueHash !== valueHash) {
              continue;
            }

            current.falsePositiveCount += 1;
            current.confidence = Math.max(0.05, current.confidence * 0.65);
            current.weight = Math.max(0, current.weight - 0.75);
            current.isSuppressed = input.outcome === "overturned" || current.falsePositiveCount >= Math.max(current.truePositiveCount, 1);
            current.freshnessState = current.isSuppressed ? "suppressed" : "needs_review";
            if (current.isSuppressed) {
              suppressedSignalCount += 1;
            }
          }

          continue;
        }

        for (const template of input.learningSummary.candidateSignals) {
          const existing = Array.from(learnedSignals.values()).find((entry) =>
            entry.type === template.type
            && entry.valueHash === valueHash
            && entry.sourceCaseIds.includes(input.caseId),
          );
          if (existing) {
            candidateSignals.push(existing);
            continue;
          }

          const key = `${template.type}:${valueHash}`;
          const current = learnedSignals.get(key);

          if (input.outcome === "false_positive" || input.outcome === "dismissed" || input.outcome === "overturned") {
            if (current) {
              current.falsePositiveCount += 1;
              current.confidence = Math.max(0.05, current.confidence * 0.65);
              current.weight = Math.max(0, current.weight - 0.75);
              current.isSuppressed = input.outcome === "overturned" || current.falsePositiveCount >= Math.max(current.truePositiveCount, 1);
              current.freshnessState = current.isSuppressed ? "suppressed" : "needs_review";
              if (current.isSuppressed) {
                suppressedSignalCount += 1;
              }
            }
            continue;
          }

          const next: LearnedSignalCandidateRecord = current ?? {
            confidence: template.confidence,
            falsePositiveCount: 0,
            freshnessState: "fresh",
            id: `signal_${crypto.randomUUID()}`,
            isSuppressed: false,
            reasonCode: defaultReasonCode(input.reasonCodes, input.outcome),
            sourceCaseIds: Array.from(new Set([...template.sourceCaseIds, input.caseId])),
            text: normalized,
            truePositiveCount: 1,
            type: template.type as LearnedSignalFamily,
            valueHash,
            weight: template.weight,
          };

          if (current) {
            next.truePositiveCount += 1;
            next.confidence = Math.min(0.99, next.confidence + 0.08);
            next.weight = Math.min(4.5, next.weight + 0.25);
            next.freshnessState = "fresh";
            next.isSuppressed = false;
            next.sourceCaseIds = Array.from(new Set([...next.sourceCaseIds, input.caseId]));
          }

          learnedSignals.set(key, next);
          candidateSignals.push(next);
        }
      }

      return {
        accepted: input.learningSummary.accepted,
        appliedSignalCount: candidateSignals.length,
        candidateSignals,
        notes: input.learningSummary.notes,
        status: candidateSignals.length > 0 || suppressedSignalCount > 0 ? "applied" : "no_reusable_signal",
        suppressedSignalCount,
      } satisfies AppliedLearningResult;
    },

    async attachMessageEvidence(input) {
      const existing = readIdempotencyReceipt<Awaited<ReturnType<ReportCasesRepository["attachMessageEvidence"]>>>(
        input.artifacts.idempotency.scope,
        input.artifacts.idempotency.key,
      );
      if (existing) {
        return existing;
      }

      const report = reports.get(input.reportId);
      if (!report) {
        throw new Error(`Missing report ${input.reportId}`);
      }

      const createdAt = new Date().toISOString();
      evidence.set(input.evidenceId, {
        actorUserId: input.body.actorUserId,
        captureSource: input.body.captureSource,
        channelId: input.body.channelId,
        createdAt,
        evidenceId: input.evidenceId,
        externalRef: input.body.externalRef,
        messageId: input.body.messageId,
        messagePreview: input.body.messagePreview,
        reportId: input.reportId,
        subjectUserId: input.body.subjectUserId,
      });

      const result = {
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
          caseId: report.caseId,
          reportId: input.reportId,
        },
      } satisfies Awaited<ReturnType<ReportCasesRepository["attachMessageEvidence"]>>;

      storeIdempotencyReceipt(input.artifacts.idempotency.scope, input.artifacts.idempotency.key, result);

      return result;
    },

    async createReport(input) {
      const existing = readIdempotencyReceipt<Awaited<ReturnType<ReportCasesRepository["createReport"]>>>(
        input.artifacts.idempotency.scope,
        input.artifacts.idempotency.key,
      );
      if (existing) {
        return existing;
      }

      const createdAt = new Date().toISOString();
      let caseId: string | undefined;
      let disposition: "created" | "existing" | "not_requested" = "not_requested";

      if (input.body.openCase) {
        const existing = Array.from(cases.values()).find((entry) => entry.guildId === input.guildId && entry.reason === input.body.reportReason && entry.subjectUserId === input.body.subjectUserId && entry.reports.some((report) => report.triggerFingerprint === input.body.triggerFingerprint));
        if (existing) {
          caseId = existing.caseId;
          disposition = "existing";
        } else if (input.proposedCaseId) {
          caseId = input.proposedCaseId;
          disposition = "created";
          cases.set(caseId, {
            caseId,
            guildId: input.guildId,
            lastEventAt: createdAt,
            openedAt: createdAt,
            reason: input.body.reportReason,
            reports: [],
            status: "open",
            subjectUserId: input.body.subjectUserId,
          });
        }
      }

      reports.set(input.reportId, {
        caseId,
        createdAt,
        guildId: input.guildId,
        intakeSource: input.body.intakeSource,
        reportId: input.reportId,
        reportReason: input.body.reportReason,
        reporterNotes: input.body.reporterNotes,
        reporterUserId: input.body.reporterUserId,
        subjectUserId: input.body.subjectUserId,
        triggerFingerprint: input.body.triggerFingerprint,
      });

      if (caseId) {
        const caseEntry = cases.get(caseId);
        caseEntry?.reports.push({
          createdAt,
          intakeSource: input.body.intakeSource,
          reportId: input.reportId,
          reportReason: input.body.reportReason,
          reporterNotes: input.body.reporterNotes,
          reporterUserId: input.body.reporterUserId,
          subjectUserId: input.body.subjectUserId,
          triggerFingerprint: input.body.triggerFingerprint,
        });
        if (caseEntry) {
          caseEntry.lastEventAt = createdAt;
        }
      }

      recalculateSubjectAnomaly(input.guildId, input.body.subjectUserId);

      const result = {
        caseLinkage: {
          caseId,
          disposition,
        },
        persistence: "persisted",
        queueDelivery: "pending_outbox_publish",
        report: {
          caseId,
          guildId: input.guildId,
          intakeSource: input.body.intakeSource,
          openCase: input.body.openCase,
          reportId: input.reportId,
          reportReason: input.body.reportReason,
          reporterNotes: input.body.reporterNotes,
          reporterUserId: input.body.reporterUserId,
          subjectUserId: input.body.subjectUserId,
          triggerFingerprint: input.body.triggerFingerprint,
        },
      } satisfies Awaited<ReturnType<ReportCasesRepository["createReport"]>>;

      storeIdempotencyReceipt(input.artifacts.idempotency.scope, input.artifacts.idempotency.key, result);

      return result;
    },

    async listLearnedSignalCandidates(input) {
      return Array.from(learnedSignals.values())
        .filter((entry) => !entry.isSuppressed && cases.get(entry.sourceCaseIds[0] ?? "")?.guildId === input.guildId)
        .slice(0, input.limit ?? 50);
    },

    async recordCaseReview(input) {
      const existing = readIdempotencyReceipt<Awaited<ReturnType<ReportCasesRepository["recordCaseReview"]>>>(
        input.artifacts.idempotency.scope,
        input.artifacts.idempotency.key,
      );
      if (existing) {
        return existing;
      }

      const caseEntry = cases.get(input.caseId);
      if (!caseEntry || caseEntry.guildId !== input.guildId) {
        throw new Error(`Case ${input.caseId} was not found in guild ${input.guildId}.`);
      }

      const review = {
        actorUserId: input.body.actorUserId,
        caseEventId: crypto.randomUUID(),
        caseId: input.caseId,
        confidence: input.body.confidence,
        evidenceRefs: Array.from(evidence.values())
          .filter((entry) => reports.get(entry.reportId)?.caseId === input.caseId)
          .map((entry) => entry.evidenceId),
        guildId: input.guildId,
        outcome: input.body.outcome,
        outcomeId: crypto.randomUUID(),
        rationale: input.body.rationale,
        reasonCodes: input.body.reasonCodes,
        subjectUserId: caseEntry.subjectUserId,
        supersedesOutcomeId: reviews.get(input.caseId)?.at(-1)?.outcomeId,
      } satisfies PersistedCaseReviewResult["review"];

      reviews.set(input.caseId, [...(reviews.get(input.caseId) ?? []), review]);

      for (const report of caseEntry.reports) {
        reporterCaseOutcomes.set(`${input.guildId}:${report.reporterUserId}:${input.caseId}`, input.body.outcome);
        recalculateReporterReputation(input.guildId, report.reporterUserId);
      }

      caseEntry.status = mapCaseOutcomeToStatus(input.body.outcome);
      caseEntry.closedAt = new Date().toISOString();
      caseEntry.lastEventAt = caseEntry.closedAt;

      const result = {
        persistence: "persisted",
        queueDelivery: "pending_outbox_publish",
        review,
      } satisfies PersistedCaseReviewResult;

      storeIdempotencyReceipt(input.artifacts.idempotency.scope, input.artifacts.idempotency.key, result);

      return result;
    },

    async listRiskQueue(input) {
      return Array.from(cases.values())
        .filter((entry) => entry.guildId === input.guildId && ["open", "reviewing", "appealed", "reopened"].includes(entry.status))
        .sort((left, right) => {
          const rightScore = subjectAnomalies.get(`${input.guildId}:${right.subjectUserId}`)?.score ?? 0;
          const leftScore = subjectAnomalies.get(`${input.guildId}:${left.subjectUserId}`)?.score ?? 0;
          return rightScore - leftScore || right.openedAt.localeCompare(left.openedAt);
        })
        .slice(0, input.limit ?? 50)
        .map((entry) => {
          const anomaly = subjectAnomalies.get(`${input.guildId}:${entry.subjectUserId}`);
          const reporterStats = entry.reports.reduce((accumulator, report) => {
            const reputation = reporterReputations.get(`${input.guildId}:${report.reporterUserId}`);
            accumulator.uniqueReporters.add(report.reporterUserId);
            if (reputation?.trusted) {
              accumulator.trustedReporters.add(report.reporterUserId);
            }
            if ((reputation?.score ?? 1) <= 0.35 && (reputation?.confidence ?? 0) >= 0.2) {
              accumulator.lowCredibilityReporters.add(report.reporterUserId);
            }
            return accumulator;
          }, {
            lowCredibilityReporters: new Set<string>(),
            trustedReporters: new Set<string>(),
            uniqueReporters: new Set<string>(),
          });
          const uniqueReporterCount = reporterStats.uniqueReporters.size;
          const trustedReporterCount = reporterStats.trustedReporters.size;
          const lowCredibilityReporterCount = reporterStats.lowCredibilityReporters.size;
          const anomalySignals = [
            ...(anomaly?.coordinatedReportBurst ? ["coordinated_report_burst"] : []),
            ...(trustedReporterCount > 0 ? ["trusted_reporter_consensus"] : []),
            ...(lowCredibilityReporterCount > 0 ? ["low_credibility_reporter_present"] : []),
          ];

          return {
            advisoryOnly: true,
            anomalySignals,
            caseId: entry.caseId,
            lastEventAt: entry.lastEventAt,
            openedAt: entry.openedAt,
            reportCount: entry.reports.length,
            severity: 6,
            status: entry.status,
            subjectUserId: entry.subjectUserId,
            trustSignals: {
              lowCredibilityReporterCount,
              reporterConsensusConfidence: Math.min(0.95, uniqueReporterCount * 0.2 + trustedReporterCount * 0.1),
              reporterConsensusScore: uniqueReporterCount === 0 ? 0 : trustedReporterCount / uniqueReporterCount,
              subjectAnomalyConfidence: anomaly?.confidence ?? 0,
              subjectAnomalyScore: anomaly?.score ?? 0,
              trustedReporterCount,
              uniqueReporterCount,
            },
          } satisfies RiskQueueItem;
        });
    },

    async getCaseDetail(input) {
      const caseEntry = cases.get(input.caseId);
      if (!caseEntry || caseEntry.guildId !== input.guildId) {
        return undefined;
      }

      const caseEvidence = Array.from(evidence.values())
        .filter((entry) => reports.get(entry.reportId)?.caseId === input.caseId)
        .map((entry) => ({
          actorUserId: entry.actorUserId,
          captureSource: entry.captureSource,
          channelId: entry.channelId,
          createdAt: entry.createdAt,
          evidenceId: entry.evidenceId,
          evidenceType: "message_link",
          externalRef: entry.externalRef,
          messageId: entry.messageId,
          messagePreview: entry.messagePreview,
          reportId: entry.reportId,
          subjectUserId: entry.subjectUserId,
        }));

      const events: Array<{
        actorUserId?: string;
        createdAt: string;
        eventPayload: Record<string, unknown>;
        eventType: string;
        summary: string;
      }> = caseEntry.reports.map((report) => ({
        actorUserId: report.reporterUserId,
        createdAt: report.createdAt,
        eventPayload: {
          reportId: report.reportId,
          triggerFingerprint: report.triggerFingerprint,
        },
        eventType: "report_received",
        summary: "Canonical report intake opened or linked a case.",
      }));

      events.push(...(reviews.get(input.caseId) ?? []).map((review) => ({
        actorUserId: review.actorUserId,
        createdAt: new Date().toISOString(),
        eventPayload: {
          confidence: review.confidence,
          outcome: review.outcome,
          outcomeId: review.outcomeId,
        },
        eventType: "review_recorded",
        summary: `Moderator recorded ${review.outcome} for the case.`,
      })));

        return {
          case: {
            caseId: caseEntry.caseId,
            closedAt: caseEntry.closedAt,
            openedAt: caseEntry.openedAt,
            reason: caseEntry.reason,
            severity: 6,
            status: caseEntry.status,
            subjectUserId: caseEntry.subjectUserId,
          },
        evidence: caseEvidence,
        events,
        reports: caseEntry.reports,
      };
    },

    async listCases(input) {
      return Array.from(cases.values())
        .filter((entry) => entry.guildId === input.guildId)
        .map((entry) => ({
          caseId: entry.caseId,
          closedAt: entry.closedAt,
          evidenceCount: Array.from(evidence.values()).filter((item) => reports.get(item.reportId)?.caseId === entry.caseId).length,
          lastEventAt: entry.reports.at(-1)?.createdAt,
          openedAt: entry.openedAt,
          reason: entry.reason,
          reportCount: entry.reports.length,
          severity: 6,
          status: entry.status,
          subjectUserId: entry.subjectUserId,
        }));
    },

    async close() {
      return;
    },
  };
}
