/**
 * Purpose: Verifies the real Postgres reports, evidence, and case repository persists the first canonical moderation backbone when a test database is available.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\cases-and-reports.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * Tests:
 * - packages/db/src/reports-cases.integration.test.ts
 */

import { afterAll, expect, test } from "bun:test";

import { createPostgresReportCasesRepository } from "./reports-cases";

const connectionString = process.env.HUMANIFY_DATABASE_URL ?? process.env.HUMANIFY_POSTGRES_URL;
const repository = connectionString
  ? createPostgresReportCasesRepository({
      connectionString,
    })
  : undefined;

afterAll(async () => {
  await repository?.close();
});

const integrationTest = repository ? test : test.skip;

integrationTest("report intake and message-link evidence persist to canonical Postgres state", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const reporterUserId = `mod_${scope}`;
  const subjectUserId = `user_${scope}`;
  const reportId = crypto.randomUUID();
  const caseId = crypto.randomUUID();

  const report = await repository!.createReport({
    artifacts: {
      idempotency: {
        key: `report:${scope}`,
        requestId: `req_${scope}`,
        scope: `report-intake:${guildId}`,
      },
      queueEnvelope: {
        canonicalRef: {
          aggregateId: caseId,
          aggregateType: "case",
          eventId: crypto.randomUUID(),
        },
        kind: "report.received",
        messageId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          guildId,
          reportId,
          subjectUserId,
        },
        producer: {
          serviceName: "api-bun",
        },
        requestId: `req_${scope}`,
        schemaVersion: "1",
        stream: "risk.ingest",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      },
    },
    body: {
      intakeSource: "message_context",
      openCase: true,
      reportReason: "spam link",
      reporterNotes: "integration coverage",
      reporterUserId,
      subjectUserId,
      triggerFingerprint: `discord-message:${guildId}:channel_${scope}:message_${scope}`,
    },
    guildId,
    proposedCaseId: caseId,
    reportId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(report.persistence).toBe("persisted");
  expect(report.report.caseId).toBeTruthy();

  const evidence = await repository!.attachMessageEvidence({
    artifacts: {
      idempotency: {
        key: `evidence:${scope}`,
        requestId: `req_evidence_${scope}`,
        scope: `report-evidence:${report.report.reportId}`,
      },
      queueEnvelope: {
        canonicalRef: {
          aggregateId: crypto.randomUUID(),
          aggregateType: "evidence",
          eventId: crypto.randomUUID(),
        },
        kind: "report.evidence.attached",
        messageId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          guildId,
          reportId: report.report.reportId,
        },
        producer: {
          serviceName: "api-bun",
        },
        requestId: `req_evidence_${scope}`,
        schemaVersion: "1",
        stream: "evidence.ingest",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cccccccccccccccc-01",
      },
    },
    body: {
      actorUserId: reporterUserId,
      captureSource: "discord_message_context",
      channelId: `channel_${scope}`,
      externalRef: `https://discord.com/channels/${guildId}/channel_${scope}/message_${scope}`,
      messageId: `message_${scope}`,
      messagePreview: "Join my scam server",
      subjectUserId,
    },
    evidenceId: crypto.randomUUID(),
    guildId,
    reportId: report.report.reportId,
    requestFingerprint: `message_${scope}`,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(evidence.persistence).toBe("persisted");
  expect(evidence.processingState).toBe("message_link_canonical");

  const cases = await repository!.listCases({ guildId });
  expect(cases).toEqual([
    expect.objectContaining({
      caseId: report.report.caseId,
      evidenceCount: 1,
      reportCount: 1,
      subjectUserId,
    }),
  ]);

  const detail = await repository!.getCaseDetail({
    caseId: report.report.caseId!,
    guildId,
  });

  expect(detail).toBeDefined();
  expect(detail?.reports).toEqual([
    expect.objectContaining({
      reportId: report.report.reportId,
    }),
  ]);
  expect(detail?.evidence).toEqual([
    expect.objectContaining({
      externalRef: `https://discord.com/channels/${guildId}/channel_${scope}/message_${scope}`,
      reportId: report.report.reportId,
    }),
  ]);
});

integrationTest("moderator outcomes create learned candidates and later false positives suppress them", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const reporterUserId = `mod_${scope}`;
  const subjectUserId = `user_${scope}`;
  const reportId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const createArtifacts = (requestId: string, stream: string, aggregateId: string, aggregateType: string, kind: string) => ({
    idempotency: {
      key: `${kind}:${scope}:${requestId}`,
      requestId,
      scope: `${kind}:${aggregateId}`,
    },
    queueEnvelope: {
      canonicalRef: {
        aggregateId,
        aggregateType,
        eventId: crypto.randomUUID(),
      },
      kind,
      messageId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        aggregateId,
        guildId,
      },
      producer: {
        serviceName: "api-bun",
      },
      requestId,
      schemaVersion: "1" as const,
      stream,
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
  });

  const report = await repository!.createReport({
    artifacts: createArtifacts(`req_report_${scope}`, "risk.ingest", caseId, "case", "report.received"),
    body: {
      intakeSource: "message_context",
      openCase: true,
      reportReason: "free nitro scam",
      reporterNotes: "same scam copy",
      reporterUserId,
      subjectUserId,
      triggerFingerprint: `discord-message:${guildId}:channel_${scope}:message_${scope}`,
    },
    guildId,
    proposedCaseId: caseId,
    reportId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  await repository!.attachMessageEvidence({
    artifacts: createArtifacts(`req_evidence_${scope}`, "evidence.ingest", crypto.randomUUID(), "evidence", "report.evidence.attached"),
    body: {
      actorUserId: reporterUserId,
      captureSource: "discord_message_context",
      channelId: `channel_${scope}`,
      externalRef: `https://discord.com/channels/${guildId}/channel_${scope}/message_${scope}`,
      messageId: `message_${scope}`,
      messagePreview: "Claim your free Nitro gift now at http://scam.example",
      subjectUserId,
    },
    evidenceId: crypto.randomUUID(),
    guildId,
    reportId: report.report.reportId,
    requestFingerprint: `message_${scope}`,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const review = await repository!.recordCaseReview({
    artifacts: createArtifacts(`req_review_${scope}`, "learning.feedback", caseId, "case", "case.review.recorded"),
    body: {
      actorUserId: reporterUserId,
      confidence: 0.94,
      outcome: "confirmed_scam",
      rationale: "confirmed",
      reasonCodes: ["similar_to_confirmed_scam_template"],
    },
    caseId: report.report.caseId!,
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const learned = await repository!.applyLearningOutcome({
    caseId: report.report.caseId!,
    guildId,
    learningSummary: {
      accepted: true,
      candidateSignals: [{
        confidence: 0.94,
        id: `candidate:${scope}`,
        sourceCaseIds: [report.report.caseId!],
        type: "text_similarity",
        valueHash: "sha256:placeholder",
        weight: 2.5,
      }],
      notes: ["learning accepted"],
    },
    outcome: "confirmed_scam",
    outcomeId: review.review.outcomeId,
    reasonCodes: ["similar_to_confirmed_scam_template"],
  });

  expect(learned.status).toBe("applied");
  expect(learned.candidateSignals).toEqual([
    expect.objectContaining({
      isSuppressed: false,
      reasonCode: "similar_to_confirmed_scam_template",
      type: "text_similarity",
    }),
  ]);

  const dismissedReview = await repository!.recordCaseReview({
    artifacts: createArtifacts(`req_review_dismissed_${scope}`, "learning.feedback", caseId, "case", "case.review.recorded"),
    body: {
      actorUserId: reporterUserId,
      confidence: 0.7,
      outcome: "false_positive",
      reasonCodes: ["prior_false_positive"],
    },
    caseId: report.report.caseId!,
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const suppressed = await repository!.applyLearningOutcome({
    caseId: report.report.caseId!,
    guildId,
    learningSummary: {
      accepted: true,
      candidateSignals: [],
      notes: ["suppression accepted"],
    },
    outcome: "false_positive",
    outcomeId: dismissedReview.review.outcomeId,
    reasonCodes: ["prior_false_positive"],
  });

  expect(suppressed.suppressedSignalCount).toBeGreaterThan(0);
  expect(await repository!.listLearnedSignalCandidates({ guildId })).toEqual([]);
});

integrationTest("risk queue exposes canonical reporter trust and coordinated-report anomalies", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const createArtifacts = (requestId: string, stream: string, aggregateId: string, aggregateType: string, kind: string) => ({
    idempotency: {
      key: `${kind}:${scope}:${requestId}`,
      requestId,
      scope: `${kind}:${aggregateId}`,
    },
    queueEnvelope: {
      canonicalRef: {
        aggregateId,
        aggregateType,
        eventId: crypto.randomUUID(),
      },
      kind,
      messageId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        aggregateId,
        guildId,
      },
      producer: {
        serviceName: "api-bun",
      },
      requestId,
      schemaVersion: "1" as const,
      stream,
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
  });

  const seedCaseId = crypto.randomUUID();
  const seedReport = await repository!.createReport({
    artifacts: createArtifacts(`req_seed_${scope}`, "risk.ingest", seedCaseId, "case", "report.received"),
    body: {
      intakeSource: "message_context",
      openCase: true,
      reportReason: "nitro scam",
      reporterUserId: "trusted_mod",
      subjectUserId: "seed_user",
      triggerFingerprint: `discord-message:${guildId}:channel_seed:message_seed`,
    },
    guildId,
    proposedCaseId: seedCaseId,
    reportId: crypto.randomUUID(),
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  await repository!.recordCaseReview({
    artifacts: createArtifacts(`req_seed_review_${scope}`, "learning.feedback", seedCaseId, "case", "case.review.recorded"),
    body: {
      actorUserId: "lead_mod",
      confidence: 0.93,
      outcome: "confirmed_scam",
      reasonCodes: ["similar_to_confirmed_scam_template"],
    },
    caseId: seedReport.report.caseId!,
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const burstCaseId = crypto.randomUUID();
  const triggerFingerprint = `discord-message:${guildId}:channel_burst:message_burst`;
  for (const reporterUserId of ["trusted_mod", "reporter_two", "reporter_three"]) {
    await repository!.createReport({
      artifacts: createArtifacts(`req_${reporterUserId}_${scope}`, "risk.ingest", burstCaseId, "case", "report.received"),
      body: {
        intakeSource: "message_context",
        openCase: true,
        reportReason: "coordinated scam burst",
        reporterUserId,
        subjectUserId: "burst_user",
        triggerFingerprint,
      },
      guildId,
      proposedCaseId: burstCaseId,
      reportId: crypto.randomUUID(),
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  }

  const queue = await repository!.listRiskQueue({ guildId });
  expect(queue).toEqual(expect.arrayContaining([
    expect.objectContaining({
      advisoryOnly: true,
      anomalySignals: expect.arrayContaining(["coordinated_report_burst", "trusted_reporter_consensus"]),
      caseId: burstCaseId,
      reportCount: 3,
      subjectUserId: "burst_user",
      trustSignals: expect.objectContaining({
        reporterConsensusScore: 1 / 3,
        trustedReporterCount: 1,
        uniqueReporterCount: 3,
      }),
    }),
  ]));
});

integrationTest("report, evidence, and review retries reuse canonical idempotency receipts", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const reporterUserId = `mod_${scope}`;
  const subjectUserId = `user_${scope}`;
  const reportId = crypto.randomUUID();
  const duplicateReportId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const duplicateCaseId = crypto.randomUUID();
  const evidenceId = crypto.randomUUID();
  const duplicateEvidenceId = crypto.randomUUID();
  const createArtifacts = (requestId: string, stream: string, aggregateId: string, aggregateType: string, kind: string, key: string, scopeKey: string) => ({
    idempotency: {
      key,
      requestId,
      scope: scopeKey,
    },
    queueEnvelope: {
      canonicalRef: {
        aggregateId,
        aggregateType,
        eventId: crypto.randomUUID(),
      },
      kind,
      messageId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        aggregateId,
        guildId,
      },
      producer: {
        serviceName: "api-bun",
      },
      requestId,
      schemaVersion: "1" as const,
      stream,
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
  });

  const reportArtifacts = createArtifacts(
    `req_report_${scope}`,
    "risk.ingest",
    caseId,
    "case",
    "report.received",
    `report:${scope}`,
    `report-intake:${guildId}`,
  );
  const firstReport = await repository!.createReport({
    artifacts: reportArtifacts,
    body: {
      intakeSource: "message_context",
      openCase: true,
      reportReason: "raid invite spam",
      reporterNotes: "duplicate delivery",
      reporterUserId,
      subjectUserId,
      triggerFingerprint: `discord-message:${guildId}:channel_${scope}:message_${scope}`,
    },
    guildId,
    proposedCaseId: caseId,
    reportId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const replayedReport = await repository!.createReport({
    artifacts: createArtifacts(
      `req_report_retry_${scope}`,
      "risk.ingest",
      duplicateCaseId,
      "case",
      "report.received",
      `report:${scope}`,
      `report-intake:${guildId}`,
    ),
    body: {
      intakeSource: "message_context",
      openCase: true,
      reportReason: "raid invite spam",
      reporterNotes: "changed notes should not duplicate canonical rows",
      reporterUserId,
      subjectUserId,
      triggerFingerprint: `discord-message:${guildId}:channel_${scope}:message_${scope}`,
    },
    guildId,
    proposedCaseId: duplicateCaseId,
    reportId: duplicateReportId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(replayedReport).toEqual(firstReport);

  const firstEvidence = await repository!.attachMessageEvidence({
    artifacts: createArtifacts(
      `req_evidence_${scope}`,
      "evidence.ingest",
      evidenceId,
      "evidence",
      "report.evidence.attached",
      `evidence:${scope}`,
      `report-evidence:${firstReport.report.reportId}`,
    ),
    body: {
      actorUserId: reporterUserId,
      captureSource: "discord_message_context",
      channelId: `channel_${scope}`,
      externalRef: `https://discord.com/channels/${guildId}/channel_${scope}/message_${scope}`,
      messageId: `message_${scope}`,
      messagePreview: "raid invite spam",
      subjectUserId,
    },
    evidenceId,
    guildId,
    reportId: firstReport.report.reportId,
    requestFingerprint: `message_${scope}`,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const replayedEvidence = await repository!.attachMessageEvidence({
    artifacts: createArtifacts(
      `req_evidence_retry_${scope}`,
      "evidence.ingest",
      duplicateEvidenceId,
      "evidence",
      "report.evidence.attached",
      `evidence:${scope}`,
      `report-evidence:${firstReport.report.reportId}`,
    ),
    body: {
      actorUserId: reporterUserId,
      captureSource: "discord_message_context",
      channelId: `channel_${scope}`,
      externalRef: `https://discord.com/channels/${guildId}/channel_${scope}/message_${scope}`,
      messageId: `message_${scope}`,
      messagePreview: "changed preview should not duplicate canonical rows",
      subjectUserId,
    },
    evidenceId: duplicateEvidenceId,
    guildId,
    reportId: firstReport.report.reportId,
    requestFingerprint: `message_${scope}`,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(replayedEvidence).toEqual(firstEvidence);

  const firstReview = await repository!.recordCaseReview({
    artifacts: createArtifacts(
      `req_review_${scope}`,
      "learning.feedback",
      firstReport.report.caseId!,
      "case",
      "case.review.recorded",
      `review:${scope}`,
      `case-review:${firstReport.report.caseId!}`,
    ),
    body: {
      actorUserId: reporterUserId,
      confidence: 0.93,
      outcome: "confirmed_scam",
      rationale: "duplicate moderator delivery",
      reasonCodes: ["similar_to_confirmed_scam_template"],
    },
    caseId: firstReport.report.caseId!,
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const replayedReview = await repository!.recordCaseReview({
    artifacts: createArtifacts(
      `req_review_retry_${scope}`,
      "learning.feedback",
      firstReport.report.caseId!,
      "case",
      "case.review.recorded",
      `review:${scope}`,
      `case-review:${firstReport.report.caseId!}`,
    ),
    body: {
      actorUserId: reporterUserId,
      confidence: 0.42,
      outcome: "confirmed_scam",
      rationale: "retry should not create a second outcome",
      reasonCodes: ["similar_to_confirmed_scam_template"],
    },
    caseId: firstReport.report.caseId!,
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(replayedReview).toEqual(firstReview);

  const detail = await repository!.getCaseDetail({
    caseId: firstReport.report.caseId!,
    guildId,
  });

  expect(detail?.reports).toHaveLength(1);
  expect(detail?.evidence).toHaveLength(1);
  expect(detail?.events.filter((event) => event.eventType === "review_recorded")).toHaveLength(1);
});
