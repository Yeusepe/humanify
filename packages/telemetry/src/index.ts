/**
 * Purpose: Provides Humanify trace-context, redaction, and structured-log helpers for Bun services and queue boundaries.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\observability-security.md
 * - docs\operations.md
 * - docs\workspaces.md
 * External references:
 * - https://opentelemetry.io/docs/concepts/context-propagation/
 * - https://opentelemetry.io/docs/languages/js/propagation/
 * - https://bun.sh/docs/runtime/env
 * Tests:
 * - packages/telemetry/src/index.test.ts
 */

export type TraceContext = {
  parentSpanId?: string;
  sampled: boolean;
  spanId: string;
  traceId: string;
};

export type StructuredLogContext = {
  environment: string;
  requestId?: string;
  serviceName: string;
  traceContext?: TraceContext;
};

export type TelemetryBootstrap = {
  environment: string;
  propagationHeader: "traceparent";
  release?: string;
  serviceName: string;
};

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
const sensitiveHeaderPattern = /^(authorization|cookie|set-cookie|x-signature|x-api-key)$/iu;
export const traceparentHeaderName = "traceparent" as const;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createTraceContext(parent?: Pick<TraceContext, "spanId" | "traceId">, sampled = true): TraceContext {
  return {
    parentSpanId: parent?.spanId,
    sampled,
    spanId: randomHex(8),
    traceId: parent?.traceId ?? randomHex(16),
  };
}

export function formatTraceParent(traceContext: TraceContext): string {
  return `00-${traceContext.traceId}-${traceContext.spanId}-${traceContext.sampled ? "01" : "00"}`;
}

export function parseTraceParent(value: string): TraceContext | undefined {
  const match = traceparentPattern.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const [, traceId, parentSpanId, flags] = match;
  return {
    parentSpanId,
    sampled: (Number.parseInt(flags, 16) & 0x01) === 0x01,
    spanId: randomHex(8),
    traceId,
  };
}

export function injectTraceContext(headers: Headers, traceContext: TraceContext): Headers;
export function injectTraceContext(
  headers: Record<string, string>,
  traceContext: TraceContext,
): Record<string, string>;
export function injectTraceContext(
  headers: Headers | Record<string, string>,
  traceContext: TraceContext,
): Headers | Record<string, string> {
  const traceparent = formatTraceParent(traceContext);

  if (headers instanceof Headers) {
    headers.set(traceparentHeaderName, traceparent);
    return headers;
  }

  return {
    ...headers,
    [traceparentHeaderName]: traceparent,
  };
}

export function extractTraceContext(headers: Headers | Record<string, string | undefined>): TraceContext | undefined {
  const traceparent = headers instanceof Headers ? headers.get(traceparentHeaderName) : headers[traceparentHeaderName];
  return traceparent ? parseTraceParent(traceparent) : undefined;
}

export function redactSensitiveHeaders(headers: Headers | Record<string, string | undefined>): Record<string, string> {
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);

  return Object.fromEntries(
    Array.from(entries, ([key, value]) => [key, sensitiveHeaderPattern.test(key) ? "[redacted]" : value ?? ""]),
  );
}

export function createStructuredLogFields<TFields extends Record<string, unknown>>(
  context: StructuredLogContext,
  fields: TFields = {} as TFields,
) {
  return {
    environment: context.environment,
    requestId: context.requestId,
    service: context.serviceName,
    spanId: context.traceContext?.spanId,
    timestamp: new Date().toISOString(),
    traceId: context.traceContext?.traceId,
    ...fields,
  };
}

export function createTelemetryBootstrap(input: {
  environment: string;
  release?: string;
  serviceName: string;
}): TelemetryBootstrap {
  return {
    environment: input.environment,
    propagationHeader: traceparentHeaderName,
    release: input.release,
    serviceName: input.serviceName,
  };
}
