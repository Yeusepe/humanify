/**
 * Purpose: Wires the Didit API, webhook signature verification, and process-and-purge helpers behind a small API-owned client.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\observability-security.md
 * - docs\verification.md
 * External references:
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.didit.me/integration/webhooks
 * - https://docs.didit.me/console/data-retention
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { DiditConfig } from "@humanify/config";

export type DiditCreateSessionInput = {
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  vendorData: string;
  workflowId: string;
};

export type DiditCreatedSession = {
  callback: string;
  sessionId: string;
  sessionStatus: string;
  verificationUrl: string;
  workflowId: string;
};

export type DiditDecisionPayload = {
  decision?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sessionId: string;
  status: string;
  vendorData?: string;
  workflowId?: string;
};

export type DiditDeleteSessionResult = {
  outcome: "already_deleted" | "deleted" | "pending_retry";
};

export type DiditClient = {
  createSession(input: DiditCreateSessionInput): Promise<DiditCreatedSession>;
  deleteSession(sessionId: string): Promise<DiditDeleteSessionResult>;
  retrieveDecision(sessionId: string): Promise<DiditDecisionPayload>;
  verifyWebhookSignature(input: {
    rawBody: string;
    signature?: string | null;
    timestamp?: string | null;
  }): boolean;
};

function assertOk(response: Response, operation: string) {
  if (!response.ok) {
    throw new Error(`didit_${operation}_failed:${response.status}`);
  }
}

function createDiditHeaders(apiKey: string) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
  };
}

export function createDiditClient(config: DiditConfig, fetchImpl: typeof fetch = fetch): DiditClient {
  return {
    async createSession(input) {
      const response = await fetchImpl(`${config.verificationApiBaseUrl}/v3/session/`, {
        body: JSON.stringify({
          callback: input.callbackUrl,
          metadata: input.metadata ?? {},
          vendor_data: input.vendorData,
          workflow_id: input.workflowId,
        }),
        headers: createDiditHeaders(config.apiKey),
        method: "POST",
      });
      assertOk(response, "create_session");
      const json = await response.json() as {
        callback: string;
        session_id: string;
        status: string;
        verification_url: string;
        workflow_id: string;
      };

      return {
        callback: json.callback,
        sessionId: json.session_id,
        sessionStatus: json.status,
        verificationUrl: json.verification_url,
        workflowId: json.workflow_id,
      };
    },

    async deleteSession(sessionId) {
      const response = await fetchImpl(`${config.verificationApiBaseUrl}/v3/session/${encodeURIComponent(sessionId)}/`, {
        headers: {
          "x-api-key": config.apiKey,
        },
        method: "DELETE",
      });

      if (response.status === 204) {
        return { outcome: "deleted" };
      }

      if (response.status === 404) {
        return { outcome: "already_deleted" };
      }

      return { outcome: "pending_retry" };
    },

    async retrieveDecision(sessionId) {
      const response = await fetchImpl(
        `${config.verificationApiBaseUrl}/v3/session/${encodeURIComponent(sessionId)}/decision/`,
        {
          headers: {
            "x-api-key": config.apiKey,
          },
        },
      );
      assertOk(response, "retrieve_decision");
      const json = await response.json() as Record<string, unknown>;

      return {
        decision: typeof json.decision === "object" && json.decision ? json.decision as Record<string, unknown> : json,
        metadata: typeof json.metadata === "object" && json.metadata ? json.metadata as Record<string, unknown> : undefined,
        sessionId: String(json.session_id ?? (json.decision as Record<string, unknown> | undefined)?.session_id ?? sessionId),
        status: String(json.status ?? (json.decision as Record<string, unknown> | undefined)?.status ?? "Unknown"),
        vendorData: typeof json.vendor_data === "string" ? json.vendor_data : undefined,
        workflowId: typeof json.workflow_id === "string" ? json.workflow_id : undefined,
      };
    },

    verifyWebhookSignature(input) {
      if (!input.signature || !input.timestamp) {
        return false;
      }

      const currentTime = Math.floor(Date.now() / 1_000);
      const receivedTimestamp = Number.parseInt(input.timestamp, 10);
      if (!Number.isFinite(receivedTimestamp) || Math.abs(currentTime - receivedTimestamp) > 300) {
        return false;
      }

      const expectedSignature = createHmac("sha256", config.webhookSecret)
        .update(input.rawBody)
        .digest("hex");

      try {
        return timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(input.signature));
      } catch {
        return false;
      }
    },
  };
}
