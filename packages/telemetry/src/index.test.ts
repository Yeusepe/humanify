/**
 * Purpose: Verifies shared telemetry helpers preserve trace context and redact sensitive headers before egress.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\observability-security.md
 * - docs\operations.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://opentelemetry.io/docs/concepts/context-propagation/
 * Tests:
 * - packages/telemetry/src/index.test.ts
 */

import { expect, test } from "bun:test";

import {
  createRequestTelemetryContext,
  createStructuredErrorFields,
  createStructuredLogFields,
  createTraceContext,
  extractTraceContext,
  injectRequestTelemetryHeaders,
  injectTraceContext,
  requestIdHeaderName,
  redactSensitiveValue,
  redactSensitiveHeaders,
  traceparentHeaderName,
} from "./index";

test("trace context round-trips through traceparent injection", () => {
  const context = createTraceContext();
  const headers = injectTraceContext(new Headers(), context);
  const extracted = extractTraceContext(headers);

  expect(headers.get(traceparentHeaderName)).toBeTruthy();
  expect(extracted?.traceId).toBe(context.traceId);
  expect(extracted?.parentSpanId).toBe(context.spanId);
});

test("sensitive headers are redacted for logs and telemetry egress", () => {
  expect(
    redactSensitiveHeaders({
      Authorization: "Bearer secret",
      Cookie: "session=token",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    }),
  ).toEqual({
    Authorization: "[redacted]",
    Cookie: "[redacted]",
    traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
  });
});

test("structured log fields include trace correlation without losing custom fields", () => {
  const context = createTraceContext();
  const fields = createStructuredLogFields(
    {
      environment: "test",
      requestId: "req_123",
      serviceName: "api-bun",
      traceContext: context,
    },
    {
      event: "config.loaded",
    },
  );

  expect(fields.service).toBe("api-bun");
  expect(fields.requestId).toBe("req_123");
  expect(fields.traceId).toBe(context.traceId);
  expect(fields.event).toBe("config.loaded");
});

test("request telemetry headers inject both request and trace correlation", () => {
  const requestTelemetry = createRequestTelemetryContext();
  const headers = injectRequestTelemetryHeaders(new Headers(), requestTelemetry);

  expect(headers.get(requestIdHeaderName)).toBe(requestTelemetry.requestId);
  expect(headers.get(traceparentHeaderName)).toBeTruthy();
});

test("structured error fields redact sensitive values before logging", () => {
  const fields = createStructuredErrorFields(
    {
      environment: "test",
      requestId: "req_123",
      serviceName: "api-bun",
    },
    new Error("authorization Bearer secret"),
    {
      callbackUrl: "https://humanify.test/callback?code=secret-code",
      sessionToken: "top-secret",
    },
  );

  expect(fields.errorMessage).toContain("[redacted]");
  expect(fields.callbackUrl).toBe("https://humanify.test/callback?code=%5Bredacted%5D");
  expect(fields.sessionToken).toBe("[redacted]");
});

test("redactSensitiveValue scrubs nested telemetry payloads recursively", () => {
  expect(
    redactSensitiveValue({
      headers: {
        authorization: "Bearer secret",
      },
      providerCallback: {
        rawUrl: "https://humanify.test/providers/callback?token=abc",
      },
    }),
  ).toEqual({
    headers: {
      authorization: "[redacted]",
    },
    providerCallback: {
      rawUrl: "https://humanify.test/providers/callback?token=%5Bredacted%5D",
    },
  });
});
