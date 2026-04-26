/**
 * Purpose: Verifies guild channel configuration persists canonically in Postgres for setup and moderator-warning workflows when a test database is available.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\discord-bot.md
 * - docs\testing.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * Tests:
 * - packages/db/src/guild-channel-config.integration.test.ts
 */

import { afterAll, expect, test } from "bun:test";

import { createPostgresGuildChannelConfigRepository } from "./guild-channel-config";

const connectionString = process.env.HUMANIFY_DATABASE_URL ?? process.env.HUMANIFY_POSTGRES_URL;
const repository = connectionString
  ? createPostgresGuildChannelConfigRepository({
      connectionString,
    })
  : undefined;

afterAll(async () => {
  await repository?.close();
});

const integrationTest = repository ? test : test.skip;

integrationTest("guild channel config persists canonical moderator alert and log channels", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const actorUserId = `mod_${scope}`;

  const persisted = await repository!.upsertConfig({
    artifacts: {
      idempotency: {
        key: `guild-channel-config:${scope}`,
        requestId: `req_${scope}`,
        scope: `guild-channel-config:${guildId}`,
      },
      queueEnvelope: {
        canonicalRef: {
          aggregateId: guildId,
          aggregateType: "guild_channel_config",
          eventId: crypto.randomUUID(),
        },
        kind: "guild.channels.updated",
        messageId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          guildId,
          moderatorAlertChannelId: `alerts_${scope}`,
        },
        producer: {
          serviceName: "api-bun",
        },
        requestId: `req_${scope}`,
        schemaVersion: "1",
        stream: "projection.refresh",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      },
    },
    body: {
      actorUserId,
      auditLogChannelId: `audit_${scope}`,
      moderationLogChannelId: `warning_log_${scope}`,
      moderatorAlertChannelId: `alerts_${scope}`,
      reviewChannelId: `review_${scope}`,
    },
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(persisted.persistence).toBe("persisted");
  expect(persisted.queueDelivery).toBe("pending_outbox_publish");
  expect(persisted.channelConfig).toEqual(
    expect.objectContaining({
      auditLogChannelId: `audit_${scope}`,
      moderationLogChannelId: `warning_log_${scope}`,
      moderatorAlertChannelId: `alerts_${scope}`,
      reviewChannelId: `review_${scope}`,
    }),
  );

  const readBack = await repository!.getConfig(guildId);
  expect(readBack).toEqual(
    expect.objectContaining({
      auditLogChannelId: `audit_${scope}`,
      moderationLogChannelId: `warning_log_${scope}`,
      moderatorAlertChannelId: `alerts_${scope}`,
      reviewChannelId: `review_${scope}`,
    }),
  );
});
