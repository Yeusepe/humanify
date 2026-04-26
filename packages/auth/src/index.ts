/**
 * Purpose: Provides Discord OAuth2 URL builders, signed state tokens, and verifier challenge helpers for Humanify Bun services.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\verification.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://discord.com/developers/docs/topics/oauth2
 * - https://bun.sh/docs/runtime/env
 * - https://bun.sh/docs/typescript
 * Tests:
 * - packages/auth/src/index.test.ts
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type DiscordOAuthAuthorizeUrlInput = {
  clientId: string;
  prompt?: "consent" | "none";
  redirectUri: string;
  scopes: string[];
  state: string;
};

export type SessionCookieOptions = {
  httpOnly: true;
  maxAge: number;
  path: "/";
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
};

export type DiscordOAuthStatePayload = {
  guildId: string;
  redirectTo: string;
  stateId: string;
  userId: string;
};

export type VerifierChallengePayload = {
  challengeId: string;
  guildId: string;
  sessionId: string;
  userId: string;
};

type SignedTokenType = "discord-oauth-state" | "verifier-challenge";

type SignedTokenPayload = Record<string, unknown> & {
  exp: number;
  iat: number;
  type: SignedTokenType;
};

export const defaultSessionCookieName = "humanify_session" as const;

function encodePayload(payload: SignedTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload<TPayload extends SignedTokenPayload>(segment: string): TPayload {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as TPayload;
}

function signSegment(segment: string, secret: string): string {
  return createHmac("sha256", secret).update(segment).digest("base64url");
}

function verifySignature(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function issueSignedToken<TPayload extends Record<string, unknown>>(
  type: SignedTokenType,
  payload: TPayload,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const tokenPayload: SignedTokenPayload = {
    ...payload,
    exp: Math.floor(now / 1000) + ttlSeconds,
    iat: Math.floor(now / 1000),
    type,
  };
  const encodedPayload = encodePayload(tokenPayload);
  const signature = signSegment(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifySignedToken<TPayload extends SignedTokenPayload>(
  token: string,
  secret: string,
  expectedType: SignedTokenType,
  now = Date.now(),
): TPayload {
  const [segment, signature] = token.split(".");
  if (!segment || !signature) {
    throw new Error("Signed token is malformed.");
  }

  const expectedSignature = signSegment(segment, secret);
  if (!verifySignature(expectedSignature, signature)) {
    throw new Error("Signed token signature is invalid.");
  }

  const payload = decodePayload<TPayload>(segment);
  if (payload.type !== expectedType) {
    throw new Error(`Signed token type must be ${expectedType}.`);
  }

  if (payload.exp < Math.floor(now / 1000)) {
    throw new Error("Signed token has expired.");
  }

  return payload;
}

export function buildDiscordOAuthAuthorizeUrl(input: DiscordOAuthAuthorizeUrlInput): string {
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", input.prompt ?? "consent");
  return url.toString();
}

export function issueDiscordOAuthState(
  payload: DiscordOAuthStatePayload,
  secret: string,
  ttlSeconds = 600,
  now = Date.now(),
): string {
  return issueSignedToken("discord-oauth-state", payload, secret, ttlSeconds, now);
}

export function verifyDiscordOAuthState(token: string, secret: string, now = Date.now()) {
  return verifySignedToken<DiscordOAuthStatePayload & SignedTokenPayload>(token, secret, "discord-oauth-state", now);
}

export function issueVerifierChallengeToken(
  payload: VerifierChallengePayload,
  secret: string,
  ttlSeconds = 300,
  now = Date.now(),
): string {
  return issueSignedToken("verifier-challenge", payload, secret, ttlSeconds, now);
}

export function verifyVerifierChallengeToken(token: string, secret: string, now = Date.now()) {
  return verifySignedToken<VerifierChallengePayload & SignedTokenPayload>(token, secret, "verifier-challenge", now);
}

export function createSessionCookieOptions(input: {
  secure: boolean;
  ttlSeconds: number;
  sameSite?: SessionCookieOptions["sameSite"];
}): SessionCookieOptions {
  return {
    httpOnly: true,
    maxAge: input.ttlSeconds,
    path: "/",
    sameSite: input.sameSite ?? "lax",
    secure: input.secure,
  };
}
