/**
 * Purpose: Verifies shared auth helpers keep Discord OAuth state and verifier challenges server-signed and replay-safe.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\verification.md
 * - docs\observability-security.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://discord.com/developers/docs/topics/oauth2
 * Tests:
 * - packages/auth/src/index.test.ts
 */

import { expect, test } from "bun:test";

import {
  buildDiscordOAuthAuthorizeUrl,
  createSessionCookieOptions,
  issueDiscordOAuthState,
  issueVerifierChallengeToken,
  verifyDiscordOAuthState,
  verifyVerifierChallengeToken,
} from "./index";

test("discord oauth authorize urls stay server-authored and include state", () => {
  const url = new URL(
    buildDiscordOAuthAuthorizeUrl({
      clientId: "client_123",
      redirectUri: "https://humanify.test/auth/discord/callback",
      scopes: ["identify", "guilds"],
      state: "signed-state",
    }),
  );

  expect(url.origin).toBe("https://discord.com");
  expect(url.searchParams.get("state")).toBe("signed-state");
  expect(url.searchParams.get("scope")).toBe("identify guilds");
});

test("discord oauth state tokens verify and reject tampering", () => {
  const token = issueDiscordOAuthState(
    {
      guildId: "guild_123",
      redirectTo: "/dashboard",
      stateId: "state_123",
      userId: "user_123",
    },
    "super-secret",
  );

  expect(verifyDiscordOAuthState(token, "super-secret").guildId).toBe("guild_123");
  expect(() => verifyDiscordOAuthState(`${token}tampered`, "super-secret")).toThrow();
});

test("verifier challenge tokens expire and remain guild/user scoped", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const token = issueVerifierChallengeToken(
    {
      challengeId: "chal_123",
      guildId: "guild_123",
      requiredCapabilities: ["captcha"],
      sessionId: "session_123",
      userId: "user_123",
    },
    "challenge-secret",
    60,
    now,
  );

  expect(verifyVerifierChallengeToken(token, "challenge-secret", now + 1_000).challengeId).toBe("chal_123");
  expect(verifyVerifierChallengeToken(token, "challenge-secret", now + 1_000).requiredCapabilities).toEqual(["captcha"]);
  expect(() => verifyVerifierChallengeToken(token, "challenge-secret", now + 61_000)).toThrow();
});

test("session cookie helpers default to httpOnly lax cookies", () => {
  expect(createSessionCookieOptions({ secure: true, ttlSeconds: 3600 })).toEqual({
    httpOnly: true,
    maxAge: 3600,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
});
