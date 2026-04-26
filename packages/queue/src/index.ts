/**
 * Purpose: Defines Redis Streams transport envelopes and consumer recovery helpers for Humanify outbox fan-out.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\operations.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://redis.io/docs/latest/develop/data-types/streams/
 * - https://redis.io/docs/latest/commands/xautoclaim/
 * - https://opentelemetry.io/docs/concepts/context-propagation/
 * Tests:
 * - packages/queue/src/index.test.ts
 */

import { createTraceContext, formatTraceParent, type TraceContext } from "@humanify/telemetry";

export type CanonicalQueueReference = {
  aggregateId: string;
  aggregateType: string;
  eventId: string;
};

export type QueueEnvelope<TPayload> = {
  canonicalRef: CanonicalQueueReference;
  kind: string;
  messageId: string;
  occurredAt: string;
  payload: TPayload;
  producer: {
    serviceName: string;
  };
  requestId: string;
  schemaVersion: "1";
  stream: string;
  traceparent: string;
};

export type ConsumerRecoveryPlan = {
  batchSize: number;
  command: "XAUTOCLAIM";
  consumer: string;
  group: string;
  minIdleMs: number;
  startId: string;
  stream: string;
};

export function createQueueEnvelope<TPayload>(input: {
  canonicalRef: CanonicalQueueReference;
  kind: string;
  occurredAt?: string;
  payload: TPayload;
  producer: string;
  requestId: string;
  stream: string;
  traceContext?: TraceContext;
}): QueueEnvelope<TPayload> {
  return {
    canonicalRef: input.canonicalRef,
    kind: input.kind,
    messageId: crypto.randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payload: input.payload,
    producer: {
      serviceName: input.producer,
    },
    requestId: input.requestId,
    schemaVersion: "1",
    stream: input.stream,
    traceparent: formatTraceParent(input.traceContext ?? createTraceContext()),
  };
}

export function queueEnvelopeToStreamFields<TPayload>(envelope: QueueEnvelope<TPayload>): Record<string, string> {
  return {
    canonicalRef: JSON.stringify(envelope.canonicalRef),
    kind: envelope.kind,
    messageId: envelope.messageId,
    occurredAt: envelope.occurredAt,
    payload: JSON.stringify(envelope.payload),
    producer: envelope.producer.serviceName,
    requestId: envelope.requestId,
    schemaVersion: envelope.schemaVersion,
    stream: envelope.stream,
    traceparent: envelope.traceparent,
  };
}

export function parseQueueEnvelopeFields<TPayload>(fields: Record<string, string>): QueueEnvelope<TPayload> {
  return {
    canonicalRef: JSON.parse(fields.canonicalRef) as CanonicalQueueReference,
    kind: fields.kind,
    messageId: fields.messageId,
    occurredAt: fields.occurredAt,
    payload: JSON.parse(fields.payload) as TPayload,
    producer: {
      serviceName: fields.producer,
    },
    requestId: fields.requestId,
    schemaVersion: "1",
    stream: fields.stream,
    traceparent: fields.traceparent,
  };
}

export function buildConsumerRecoveryPlan(input: {
  batchSize?: number;
  consumer: string;
  group: string;
  minIdleMs: number;
  startId?: string;
  stream: string;
}): ConsumerRecoveryPlan {
  return {
    batchSize: input.batchSize ?? 100,
    command: "XAUTOCLAIM",
    consumer: input.consumer,
    group: input.group,
    minIdleMs: input.minIdleMs,
    startId: input.startId ?? "0-0",
    stream: input.stream,
  };
}
