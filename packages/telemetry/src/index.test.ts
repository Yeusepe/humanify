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
  createStructuredLogFields,
  createTraceContext,
  extractTraceContext,
  injectTraceContext,
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
