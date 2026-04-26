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
    guildId: string;
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

      return {
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
      };
    },

    async createReport(input) {
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
            openedAt: createdAt,
            reason: input.body.reportReason,
            reports: [],
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
        cases.get(caseId)?.reports.push({
          createdAt,
          intakeSource: input.body.intakeSource,
          reportId: input.reportId,
          reportReason: input.body.reportReason,
          reporterNotes: input.body.reporterNotes,
          reporterUserId: input.body.reporterUserId,
          subjectUserId: input.body.subjectUserId,
          triggerFingerprint: input.body.triggerFingerprint,
        });
      }

      return {
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
      };
    },

    async listLearnedSignalCandidates(input) {
      return Array.from(learnedSignals.values())
        .filter((entry) => !entry.isSuppressed && cases.get(entry.sourceCaseIds[0] ?? "")?.guildId === input.guildId)
        .slice(0, input.limit ?? 50);
    },

    async recordCaseReview(input) {
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

      return {
        persistence: "persisted",
        queueDelivery: "pending_outbox_publish",
        review,
      } satisfies PersistedCaseReviewResult;
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
          openedAt: caseEntry.openedAt,
          reason: caseEntry.reason,
          severity: 6,
          status: "open",
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
          evidenceCount: Array.from(evidence.values()).filter((item) => reports.get(item.reportId)?.caseId === entry.caseId).length,
          lastEventAt: entry.reports.at(-1)?.createdAt,
          openedAt: entry.openedAt,
          reason: entry.reason,
          reportCount: entry.reports.length,
          severity: 6,
          status: "open",
          subjectUserId: entry.subjectUserId,
        }));
    },

    async close() {
      return;
    },
  };
}
