/**
 * Purpose: Wraps Better Auth's Discord social flow behind a narrow bridge so api-bun can start OAuth, read the signed session, and fetch normalized Discord account signals without scattering Better Auth details through app.ts.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\api.md
 * - docs\contracts.md
 * - docs\observability-security.md
 * - docs\verification.md
 * External references:
 * - https://better-auth.com/docs/authentication/discord
 * - https://better-auth.com/docs/concepts/oauth
 * - https://better-auth.com/docs/basic-usage#server-side
 * - https://discord.com/developers/docs/resources/user#get-current-user
 * - https://discord.com/developers/docs/resources/user#get-user-connections
 * Tests:
 * - apps/api-bun/src/app.test.ts
 */

import { betterAuth } from "better-auth";

import type { DiscordVerificationAuthConfig } from "@humanify/config";

export type BetterAuthSessionSummary = Awaited<ReturnType<BetterAuthBridge["getSession"]>>;

export type DiscordAccountInfoSummary = {
  data: Record<string, unknown>;
  user: {
    email?: string | null;
    emailVerified?: boolean;
    id: string;
    image?: string | null;
    name?: string | null;
  };
};

export type DiscordConnectionSummary = {
  id: string;
  name?: string;
  type: string;
  verified?: boolean;
  visibility?: number;
};

export type BetterAuthBridge = {
  getDiscordAccountInfo(headers: Headers): Promise<DiscordAccountInfoSummary | null>;
  getDiscordAccessToken(headers: Headers): Promise<{
    accessToken: string;
    scopes: string[];
  } | null>;
  getDiscordConnections(input: {
    accessToken: string;
  }): Promise<DiscordConnectionSummary[]>;
  getSession(headers: Headers): Promise<{
    session: {
      expiresAt: Date;
      id: string;
      userId: string;
    };
    user: {
      email: string;
      emailVerified: boolean;
      id: string;
      image?: string | null;
      name: string;
    };
  } | null>;
  handle(request: Request): Promise<Response>;
  signInDiscord(input: {
    callbackURL: string;
    errorCallbackURL?: string;
    requestHeaders: Headers;
    scopes?: string[];
  }): Promise<Response>;
  signOut(headers: Headers): Promise<Response>;
};

function mapDiscordProfileToUser(profile: Record<string, unknown>) {
  const profileId = typeof profile.id === "string" && profile.id.length > 0 ? profile.id : "unknown";
  const email = typeof profile.email === "string" && profile.email.length > 0
    ? profile.email
    : `discord-${profileId}@users.humanify.invalid`;
  const username = typeof profile.username === "string" && profile.username.length > 0 ? profile.username : "Discord user";
  const globalName = typeof profile.global_name === "string" && profile.global_name.length > 0 ? profile.global_name : undefined;
  const avatar = typeof profile.avatar === "string" && profile.avatar.length > 0
    ? `https://cdn.discordapp.com/avatars/${profileId}/${profile.avatar}.png`
    : undefined;

  return {
    email,
    emailVerified: profile.verified === true,
    image: avatar,
    name: globalName ?? username,
  };
}

export function createBetterAuthBridge(input: {
  config: DiscordVerificationAuthConfig;
  fetchFn?: typeof fetch;
  sessionTtlSeconds: number;
}): BetterAuthBridge {
  const fetchFn = input.fetchFn ?? fetch;
  const auth = betterAuth({
    advanced: {
      cookiePrefix: "humanify-auth",
    },
    account: {
      storeAccountCookie: true,
      storeStateStrategy: "cookie",
    },
    basePath: input.config.authBasePath,
    baseURL: input.config.apiBaseUrl,
    secret: input.config.betterAuthSecret,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: input.sessionTtlSeconds,
        refreshCache: true,
        strategy: "jwe",
      },
      expiresIn: input.sessionTtlSeconds,
    },
    socialProviders: {
      discord: {
        clientId: input.config.clientId,
        clientSecret: input.config.clientSecret,
        mapProfileToUser: mapDiscordProfileToUser,
        scope: input.config.scopes,
      },
    },
    trustedOrigins: [
      input.config.apiBaseUrl,
      input.config.verifierBaseUrl,
    ],
  });

  return {
    async getDiscordAccountInfo(headers) {
      const result = await auth.api.accountInfo({
        headers,
      });
      if (!result) {
        return null;
      }
      const userId = typeof result.user.id === "string" ? result.user.id : String(result.user.id);

      return {
        data: result.data,
        user: {
          email: typeof result.user.email === "string" ? result.user.email : undefined,
          emailVerified: result.user.emailVerified === true,
          id: userId,
          image: typeof result.user.image === "string" ? result.user.image : undefined,
          name: typeof result.user.name === "string" ? result.user.name : undefined,
        },
      };
    },
    async getDiscordAccessToken(headers) {
      const result = await auth.api.getAccessToken({
        body: {
          providerId: "discord",
        },
        headers,
      });
      if (!result?.accessToken) {
        return null;
      }

      return {
        accessToken: result.accessToken,
        scopes: result.scopes,
      };
    },
    async getDiscordConnections({ accessToken }) {
      const response = await fetchFn("https://discord.com/api/users/@me/connections", {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`discord_connections_unavailable:${response.status}`);
      }

      const payload = await response.json() as Array<Record<string, unknown>>;
      return payload.map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
        name: typeof entry.name === "string" ? entry.name : undefined,
        type: typeof entry.type === "string" ? entry.type : "unknown",
        verified: entry.verified === true,
        visibility: typeof entry.visibility === "number" ? entry.visibility : undefined,
      }));
    },
    async getSession(headers) {
      return await auth.api.getSession({
        headers,
      });
    },
    async handle(request) {
      return await auth.handler(request);
    },
    async signInDiscord(inputValue) {
      return await auth.api.signInSocial({
        asResponse: true,
        body: {
          callbackURL: inputValue.callbackURL,
          errorCallbackURL: inputValue.errorCallbackURL,
          provider: "discord",
          scopes: inputValue.scopes ?? input.config.scopes,
        },
        headers: inputValue.requestHeaders,
      });
    },
    async signOut(headers) {
      return await auth.api.signOut({
        asResponse: true,
        headers,
      });
    },
  };
}
