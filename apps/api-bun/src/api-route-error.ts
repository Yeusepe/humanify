/**
 * Purpose: Shares the API route error contract with verification option runtimes so provider-specific failures stay out of the main app entry flow.
 * Governing docs:
 * - AGENTS.md
 * - docs\api.md
 * - docs\verification.md
 * - docs\workspaces.md
 * External references:
 * - https://elysiajs.com/patterns/error-handling
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_failed"
  | "conflict"
  | "not_found"
  | "rate_limited"
  | "provider_callback_invalid"
  | "dependency_unavailable"
  | "internal_error";

export class ApiRouteError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: ApiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiRouteError";
  }
}
