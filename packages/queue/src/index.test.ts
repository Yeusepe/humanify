/**
 * Purpose: Verifies Redis Streams envelopes preserve canonical refs and trace propagation for Humanify queue work.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\operations.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://redis.io/docs/latest/develop/data-types/streams/
 * Tests:
 * - packages/queue/src/index.test.ts
 */

import { expect, test } from "bun:test";

import { createTraceContext, formatTraceParent } from "@humanify/telemetry";

import { buildConsumerRecoveryPlan, createQueueEnvelope, parseQueueEnvelopeFields, queueEnvelopeToStreamFields } from "./index";

test("queue envelopes round-trip through Redis Streams field serialization", () => {
  const traceContext = createTraceContext();
  const envelope = createQueueEnvelope({
    canonicalRef: {
      aggregateId: "case_123",
      aggregateType: "case",
      eventId: "evt_123",
    },
    kind: "policy.decision.created",
    payload: {
      allowedAction: "quarantine",
    },
    producer: "api-bun",
    requestId: "req_123",
    stream: "policy.actions",
    traceContext,
  });
  const fields = queueEnvelopeToStreamFields(envelope);
  const parsed = parseQueueEnvelopeFields<{ allowedAction: string }>(fields);

  expect(parsed.traceparent).toBe(formatTraceParent(traceContext));
  expect(parsed.canonicalRef.aggregateId).toBe("case_123");
  expect(parsed.payload.allowedAction).toBe("quarantine");
});

test("consumer recovery plans default to XAUTOCLAIM-compatible settings", () => {
  expect(
    buildConsumerRecoveryPlan({
      consumer: "worker-1",
      group: "policy-workers",
      minIdleMs: 60000,
      stream: "policy.actions",
    }),
  ).toEqual({
    batchSize: 100,
    command: "XAUTOCLAIM",
    consumer: "worker-1",
    group: "policy-workers",
    minIdleMs: 60000,
    startId: "0-0",
    stream: "policy.actions",
  });
});
