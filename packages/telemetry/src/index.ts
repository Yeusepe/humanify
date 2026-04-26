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
  release?: string;
  serviceName: string;
  traceContext?: TraceContext;
};

export type TelemetryBootstrap = {
  environment: string;
  propagationHeader: "traceparent";
  requestIdHeader: "x-request-id";
  release?: string;
  sentryEnabled: boolean;
  sentryTracesSampleRate: number;
  serviceName: string;
};

export type RequestTelemetryContext = {
  requestId: string;
  traceContext: TraceContext;
};

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
const sensitiveHeaderPattern = /^(authorization|cookie|set-cookie|x-signature|x-api-key)$/iu;
const sensitiveFieldPattern = /(authorization|cookie|secret|token|signature|password|session|dsn|api[-_]?key|code|state)/iu;
export const traceparentHeaderName = "traceparent" as const;
export const requestIdHeaderName = "x-request-id" as const;

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

function readHeader(
  headers: Headers | Record<string, string | undefined>,
  key: string,
) {
  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }

  return headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
}

export function createRequestTelemetryContext(input: {
  headers?: Headers | Record<string, string | undefined>;
  requestId?: string;
  traceContext?: TraceContext;
} = {}): RequestTelemetryContext {
  const requestId = input.requestId ?? (input.headers ? readHeader(input.headers, requestIdHeaderName) : undefined) ?? crypto.randomUUID();
  const traceContext = input.traceContext ?? (input.headers ? extractTraceContext(input.headers) : undefined) ?? createTraceContext();

  return {
    requestId,
    traceContext,
  };
}

export function injectRequestTelemetryHeaders(headers: Headers, requestTelemetry: RequestTelemetryContext): Headers;
export function injectRequestTelemetryHeaders(
  headers: Record<string, string>,
  requestTelemetry: RequestTelemetryContext,
): Record<string, string>;
export function injectRequestTelemetryHeaders(
  headers: Headers | Record<string, string>,
  requestTelemetry: RequestTelemetryContext,
): Headers | Record<string, string> {
  if (headers instanceof Headers) {
    const tracedHeaders = injectTraceContext(headers, requestTelemetry.traceContext);
    tracedHeaders.set(requestIdHeaderName, requestTelemetry.requestId);
    return tracedHeaders;
  }

  const tracedHeaders = injectTraceContext(headers, requestTelemetry.traceContext);
  return {
    ...tracedHeaders,
    [requestIdHeaderName]: requestTelemetry.requestId,
  };
}

function redactSensitiveString(value: string) {
  const bearerRedacted = value.replace(/(bearer\s+)[^\s]+/giu, "$1[redacted]");

  try {
    const parsed = new URL(bearerRedacted);
    if (parsed.password) {
      parsed.password = "[redacted]";
    }

    for (const [key] of parsed.searchParams.entries()) {
      if (sensitiveFieldPattern.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    return parsed.toString();
  } catch {
    return bearerRedacted;
  }
}

export function redactSensitiveValue(value: unknown, fieldName?: string): unknown {
  if (fieldName && sensitiveFieldPattern.test(fieldName)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, redactSensitiveValue(nestedValue, key)]),
    );
  }

  return value;
}

export function redactSensitiveHeaders(headers: Headers | Record<string, string | undefined>): Record<string, string> {
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);

  return Object.fromEntries(
    Array.from(entries, ([key, value]) => [key, sensitiveHeaderPattern.test(key) ? "[redacted]" : String(redactSensitiveValue(value ?? "", key))]),
  );
}

export function createStructuredLogFields<TFields extends Record<string, unknown>>(
  context: StructuredLogContext,
  fields: TFields = {} as TFields,
) : {
  environment: string;
  requestId?: string;
  release?: string;
  service: string;
  spanId?: string;
  timestamp: string;
  traceId?: string;
} & TFields {
  const safeFields = redactSensitiveValue(fields) as Record<string, unknown>;

  return {
    environment: context.environment,
    requestId: context.requestId,
    release: context.release,
    service: context.serviceName,
    spanId: context.traceContext?.spanId,
    timestamp: new Date().toISOString(),
    traceId: context.traceContext?.traceId,
    ...safeFields,
  } as {
    environment: string;
    requestId?: string;
    release?: string;
    service: string;
    spanId?: string;
    timestamp: string;
    traceId?: string;
  } & TFields;
}

export function createTelemetryBootstrap(input: {
  environment: string;
  release?: string;
  sentryDsn?: string;
  sentryTracesSampleRate?: number;
  serviceName: string;
}): TelemetryBootstrap {
  return {
    environment: input.environment,
    propagationHeader: traceparentHeaderName,
    requestIdHeader: requestIdHeaderName,
    release: input.release,
    sentryEnabled: Boolean(input.sentryDsn),
    sentryTracesSampleRate: input.sentryTracesSampleRate ?? 0,
    serviceName: input.serviceName,
  };
}

export function createStructuredErrorFields<TFields extends Record<string, unknown>>(
  context: StructuredLogContext,
  error: unknown,
  fields: TFields = {} as TFields,
) : ({
  environment: string;
  requestId?: string;
  release?: string;
  service: string;
  spanId?: string;
  timestamp: string;
  traceId?: string;
} & TFields & {
  errorMessage: string;
  errorName: string;
}) {
  const normalizedError =
    error instanceof Error
      ? {
          errorMessage: error.message,
          errorName: error.name,
        }
      : {
          errorMessage: String(error),
          errorName: "NonErrorThrown",
        };

  return createStructuredLogFields(context, {
    ...fields,
    ...normalizedError,
  });
}
