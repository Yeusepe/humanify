/**
 * Purpose: Verifies moderator warning-card reads and alert-message refs persist canonically in Postgres when a test database is available.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\discord-bot.md
 * - docs\verification.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * Tests:
 * - packages/db/src/moderator-warning-cards.integration.test.ts
 */

import { afterAll, expect, test } from "bun:test";

import { createPostgresModeratorWarningCardsRepository } from "./moderator-warning-cards";
import { createPostgresReportCasesRepository } from "./reports-cases";
import { createPostgresVerificationSessionsRepository } from "./verification-sessions";

const connectionString = process.env.HUMANIFY_DATABASE_URL ?? process.env.HUMANIFY_POSTGRES_URL;
const warningRepository = connectionString
  ? createPostgresModeratorWarningCardsRepository({
      connectionString,
    })
  : undefined;
const reportRepository = connectionString
  ? createPostgresReportCasesRepository({
      connectionString,
    })
  : undefined;
const verificationRepository = connectionString
  ? createPostgresVerificationSessionsRepository({
      connectionString,
    })
  : undefined;

afterAll(async () => {
  await warningRepository?.close();
  await reportRepository?.close();
  await verificationRepository?.close();
});

const integrationTest = warningRepository && reportRepository && verificationRepository ? test : test.skip;

integrationTest("warning card reads canonical case summary, linked verification state, and persisted alert ref", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const reporterUserId = `mod_${scope}`;
  const subjectUserId = `user_${scope}`;
  const reportId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const challengeId = crypto.randomUUID();

  const createArtifacts = (requestId: string, aggregateId: string, aggregateType: string, kind: string, stream: string) => ({
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

  const report = await reportRepository!.createReport({
    artifacts: createArtifacts(`req_report_${scope}`, caseId, "case", "report.received", "risk.ingest"),
    body: {
      intakeSource: "message_context",
      openCase: true,
      reportReason: "fake Nitro lure",
      reporterNotes: "integration moderator warning coverage",
      reporterUserId,
      subjectUserId,
      triggerFingerprint: `discord-message:${guildId}:channel_${scope}:message_${scope}`,
    },
    guildId,
    proposedCaseId: caseId,
    reportId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  await reportRepository!.attachMessageEvidence({
    artifacts: createArtifacts(`req_evidence_${scope}`, crypto.randomUUID(), "evidence", "report.evidence.attached", "evidence.ingest"),
    body: {
      actorUserId: reporterUserId,
      captureSource: "discord_message_context",
      channelId: `channel_${scope}`,
      externalRef: `https://discord.com/channels/${guildId}/channel_${scope}/message_${scope}`,
      messageId: `message_${scope}`,
      messagePreview: "Claim your free Nitro gift now",
      subjectUserId,
    },
    evidenceId: crypto.randomUUID(),
    guildId,
    reportId: report.report.reportId,
    requestFingerprint: `message_${scope}`,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  await verificationRepository!.createSession({
    artifacts: createArtifacts(`req_verification_${scope}`, sessionId, "verification_session", "verification.session.created", "verification.events"),
    caseId: report.report.caseId,
    challengeExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    challengeId,
    guildId,
    initiatedBy: reporterUserId,
    requiredCapabilities: ["document_identity", "face_verification"],
    sessionId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    userId: subjectUserId,
  });

  await verificationRepository!.recordDiditResult({
    providerSessionId: `didit_${scope}`,
    providerStatus: "Approved",
    purge: {
      attemptedAt: "2026-01-01T00:00:00.000Z",
      outcome: "deleted",
    },
    requestedClaims: ["age_over_18", "nationality"],
    reusableCredentialBridge: {
      artifactPayload: {
        approvedClaims: ["age_over_18", "nationality"],
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18"],
        },
        contractVersion: "reusable_identity_handoff_v1",
        policyInputs: {
          faceVerification: {
            evidenceSource: "capture_provider",
            passed: true,
            performed: true,
            satisfiesFaceVerificationRequirement: true,
          },
        },
        status: "issuer_handoff_required",
        targetProvider: "privado",
      },
      artifactStatus: "issuer_handoff_required",
      bridgeId: `bridge_${scope}`,
      expiresAt: "2026-01-01T01:00:00.000Z",
      summary: {
        approvedClaims: ["age_over_18", "nationality"],
        claims: {
          disclosedAttributes: {
            nationality: "ESP",
          },
          proofOnlyPredicates: ["age_over_18"],
        },
        contractVersion: "reusable_identity_handoff_v1",
        policyInputs: {
          faceVerification: {
            evidenceSource: "capture_provider",
            passed: true,
            performed: true,
            satisfiesFaceVerificationRequirement: true,
          },
        },
        status: "issuer_handoff_required",
        targetProvider: "privado",
      },
      targetProvider: "privado",
    },
    resultSummary: {
      authoritativeSource: "didit_decision_api",
      faceVerificationPassed: true,
      faceVerificationPerformed: true,
      providerReferenceId: `didit_${scope}`,
      providerStatus: "Approved",
      requestedClaims: ["age_over_18", "nationality"],
      satisfiedClaims: ["age_over_18", "nationality", "face_verification"],
    },
    sessionId,
    state: "passed",
    webhook: {
      providerStatus: "Approved",
      timestamp: "1735689600",
      webhookType: "status.updated",
      workflowId: "11111111-2222-3333-4444-555555555555",
    },
  });

  const alertRef = await warningRepository!.upsertAlertMessageRef({
    artifacts: createArtifacts(`req_warning_${scope}`, report.report.caseId!, "moderator_warning_card", "moderator.warning_card.alert_message.upserted", "projection.refresh"),
    body: {
      actorService: "bot-bun",
      channelId: `warning_channel_${scope}`,
      messageId: `warning_message_${scope}`,
    },
    caseId: report.report.caseId!,
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(alertRef.alertMessageRef.messageUrl).toBe(
    `https://discord.com/channels/${guildId}/warning_channel_${scope}/warning_message_${scope}`,
  );

  const warningCard = await warningRepository!.getWarningCard({
    caseId: report.report.caseId!,
    guildId,
  });

  expect(warningCard).toBeDefined();
  expect(warningCard?.reportsSummary).toEqual(expect.objectContaining({
    latestReportReason: "fake Nitro lure",
    reportCount: 1,
  }));
  expect(warningCard?.evidenceSummary).toEqual(expect.objectContaining({
    evidenceCount: 1,
    latestEvidence: expect.objectContaining({
      messagePreview: "Claim your free Nitro gift now",
    }),
  }));
  expect(warningCard?.verification).toEqual(expect.objectContaining({
    caseLinkage: "case_linked",
    providerId: "didit",
    sessionId,
    state: "passed",
  }));
  expect(warningCard?.reusableCredentialBridge).toEqual(expect.objectContaining({
    status: "issuer_handoff_required",
    targetProvider: "privado",
  }));
  expect(warningCard?.faceCheck).toEqual(expect.objectContaining({
    passed: true,
    performed: true,
    source: "verification_summary",
  }));
  expect(warningCard?.alertMessageRef).toEqual(expect.objectContaining({
    channelId: `warning_channel_${scope}`,
    messageId: `warning_message_${scope}`,
    messageState: "active",
  }));
});
