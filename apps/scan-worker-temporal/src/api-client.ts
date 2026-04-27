/**
 * Purpose: Calls the Bun-authoritative Humanify API from the Temporal scan worker.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\discord-bot.md
 * - docs\architecture.md
 * External references:
 * - https://developer.mozilla.org/docs/Web/API/Fetch_API
 * - https://discord.com/developers/docs/resources/guild
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { createRequestTelemetryContext, injectRequestTelemetryHeaders, type RequestTelemetryContext } from "@humanify/telemetry";

export type ScanWorkerReportBody = {
  intakeSource: "detector_bridge" | "internal";
  openCase: boolean;
  reportReason: string;
  reporterNotes?: string;
  reporterUserId: string;
  subjectUserId: string;
  triggerFingerprint: string;
};

export type ScanWorkerReportResponse = {
  persistence: string;
  report: {
    caseId?: string;
    reportId: string;
  };
};

export type ScanWorkerChannelConfigReadResponse = {
  channelConfig: {
    guildId: string;
    moderatorAlertChannelId?: string;
    source: "not_configured" | "persisted";
  };
  persistence: "not_configured" | "persisted";
};

export type ScanWorkerWarningAlertMessageRef = {
  channelId: string;
  messageId: string;
  messageState: "active" | "deleted";
};

export type ScanWorkerCaseWarningCardReadResponse = {
  alertMessageRef?: ScanWorkerWarningAlertMessageRef;
  case: {
    caseId: string;
    reason: string;
    severity: number;
    status: string;
    subjectUserId: string;
  };
  evidenceSummary: {
    evidenceCount: number;
    latestEvidence?: {
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
    latestReportReason?: string;
    reportCount: number;
    reporterCount: number;
  };
  reusableCredentialBridge?: Record<string, unknown>;
  verification?: {
    caseLinkage: "case_linked" | "subject_latest";
    providerId?: string;
    providerStatus?: string;
    state: string;
    summary?: Record<string, unknown>;
  };
};

export type ScanWorkerWarningAlertMessageWriteBody = {
  actorService: string;
  channelId: string;
  messageId: string;
  messageState?: "active" | "deleted";
};

export type ScanWorkerWarningAlertMessageWriteResponse = {
  persistence: "persisted";
};

export type ScanWorkerApiClient = {
  createReport(
    guildId: string,
    body: ScanWorkerReportBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<ScanWorkerReportResponse>;
  getCaseWarningCard(
    guildId: string,
    caseId: string,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<ScanWorkerCaseWarningCardReadResponse>;
  getGuildChannelConfig(guildId: string, requestTelemetry?: RequestTelemetryContext): Promise<ScanWorkerChannelConfigReadResponse>;
  updateWarningCardAlertMessage(
    guildId: string,
    caseId: string,
    body: ScanWorkerWarningAlertMessageWriteBody,
    requestTelemetry?: RequestTelemetryContext,
  ): Promise<ScanWorkerWarningAlertMessageWriteResponse>;
};

export class ScanWorkerApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ScanWorkerApiRequestError";
    this.status = status;
  }
}

async function readJsonResponse<TData>(response: Response): Promise<TData> {
  const body = await response.json() as {
    data?: TData;
    message?: string;
  };

  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `${response.status} ${response.statusText}`.trim();
    throw new ScanWorkerApiRequestError(response.status, message);
  }

  return body.data as TData;
}

export function createScanWorkerApiClient(input: {
  apiBaseUrl: string;
  fetchFn?: typeof fetch;
}): ScanWorkerApiClient {
  const fetchFn = input.fetchFn ?? fetch;
  const request = async <TData>(requestInput: {
    body?: unknown;
    method: "GET" | "POST" | "PUT";
    path: string;
    requestTelemetry?: RequestTelemetryContext;
  }) => {
    const response = await fetchFn(`${input.apiBaseUrl}${requestInput.path}`, {
      body: requestInput.body === undefined ? undefined : JSON.stringify(requestInput.body),
      headers: injectRequestTelemetryHeaders({
        accept: "application/json",
        ...(requestInput.body === undefined ? {} : { "content-type": "application/json" }),
      }, requestInput.requestTelemetry ?? createRequestTelemetryContext()),
      method: requestInput.method,
    });

    return readJsonResponse<TData>(response);
  };

  return {
    createReport(guildId, body, requestTelemetry) {
      return request<ScanWorkerReportResponse>({
        body,
        method: "POST",
        path: `/guilds/${guildId}/reports`,
        requestTelemetry,
      });
    },
    getCaseWarningCard(guildId, caseId, requestTelemetry) {
      return request<ScanWorkerCaseWarningCardReadResponse>({
        method: "GET",
        path: `/guilds/${guildId}/cases/${caseId}/warning-card`,
        requestTelemetry,
      });
    },
    getGuildChannelConfig(guildId, requestTelemetry) {
      return request<ScanWorkerChannelConfigReadResponse>({
        method: "GET",
        path: `/guilds/${guildId}/channels`,
        requestTelemetry,
      });
    },
    updateWarningCardAlertMessage(guildId, caseId, body, requestTelemetry) {
      return request<ScanWorkerWarningAlertMessageWriteResponse>({
        body,
        method: "PUT",
        path: `/guilds/${guildId}/cases/${caseId}/warning-card/alert-message`,
        requestTelemetry,
      });
    },
  };
}
