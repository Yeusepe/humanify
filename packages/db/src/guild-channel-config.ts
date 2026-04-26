/**
 * Purpose: Persists canonical guild channel configuration for moderator alerts, review routing, and audit/log workflows.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\discord-bot.md
 * - docs\observability-security.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * - https://www.postgresql.org/docs/current/sql-insert.html
 * Tests:
 * - apps/api-bun/src/app.test.ts
 * - packages/db/src/guild-channel-config.integration.test.ts
 */

import postgres from "postgres";

type QueryClient = any;

type CanonicalArtifacts = {
  idempotency: {
    key: string;
    requestId: string;
    scope: string;
  };
  queueEnvelope: {
    canonicalRef: {
      aggregateId: string;
      aggregateType: string;
      eventId: string;
    };
    kind: string;
    messageId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
    producer: {
      serviceName: string;
    };
    requestId: string;
    schemaVersion: "1";
    stream: string;
    traceparent: string;
  };
};

type IdempotencyRow<TResult> = {
  completed_at: string | null;
  idempotency_receipt_id: string;
  response_body: TResult | null;
};

export type GuildChannelConfigRecord = {
  auditLogChannelId?: string;
  createdAt: string;
  guildId: string;
  moderationLogChannelId?: string;
  moderatorAlertChannelId: string;
  reviewChannelId?: string;
  updatedAt: string;
};

export type PersistedGuildChannelConfigResult = {
  channelConfig: GuildChannelConfigRecord;
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
};

export type GuildChannelConfigRepository = {
  close(): Promise<void>;
  getConfig(guildId: string): Promise<GuildChannelConfigRecord | undefined>;
  upsertConfig(input: {
    artifacts: CanonicalArtifacts;
    body: {
      actorUserId: string;
      auditLogChannelId?: string;
      moderationLogChannelId?: string;
      moderatorAlertChannelId: string;
      reviewChannelId?: string;
    };
    guildId: string;
    requestFingerprint?: string;
    traceId?: string;
  }): Promise<PersistedGuildChannelConfigResult>;
};

type GuildChannelConfigRow = {
  audit_log_channel_id: string | null;
  created_at: string | Date;
  guild_id: string;
  moderation_log_channel_id: string | null;
  moderator_alert_channel_id: string;
  review_channel_id: string | null;
  updated_at: string | Date;
};

function createSqlClient(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
  });
}

async function reserveIdempotency<TResult extends Record<string, unknown>>(
  sql: QueryClient,
  input: {
    boundary: string;
    idempotencyKey: string;
    requestFingerprint?: string;
  },
) {
  const [inserted] = await sql<IdempotencyRow<TResult>[]>`
    INSERT INTO idempotency_receipts (
      boundary,
      idempotency_key,
      request_fingerprint,
      metadata
    )
    VALUES (
      ${input.boundary},
      ${input.idempotencyKey},
      ${input.requestFingerprint ?? null},
      ${sql.json({ canonicalWorkflow: "guild_channel_config_v1" })}
    )
    ON CONFLICT DO NOTHING
    RETURNING
      idempotency_receipt_id,
      response_body,
      completed_at
  `;

  if (inserted) {
    return inserted;
  }

  const [existing] = await sql<IdempotencyRow<TResult>[]>`
    UPDATE idempotency_receipts
    SET last_seen_at = now()
    WHERE
      boundary = ${input.boundary}
      AND idempotency_key = ${input.idempotencyKey}
    RETURNING
      idempotency_receipt_id,
      response_body,
      completed_at
  `;

  if (existing?.completed_at && existing.response_body) {
    return existing;
  }

  throw new Error(`Canonical idempotency boundary ${input.boundary} is already processing ${input.idempotencyKey}.`);
}

async function completeIdempotency<TResult extends Record<string, unknown>>(
  sql: QueryClient,
  receiptId: string,
  result: TResult,
  responseCode: number,
) {
  await sql`
    UPDATE idempotency_receipts
    SET
      completed_at = now(),
      last_seen_at = now(),
      response_code = ${responseCode},
      response_body = ${sql.json(result as Record<string, unknown>)}
    WHERE idempotency_receipt_id = ${receiptId}
  `;
}

async function ensureGuild(sql: QueryClient, guildId: string) {
  await sql`
    INSERT INTO guilds (
      guild_id
    )
    VALUES (
      ${guildId}
    )
    ON CONFLICT (guild_id) DO NOTHING
  `;
}

async function ensureUser(sql: QueryClient, userId: string) {
  await sql`
    INSERT INTO user_identities (
      user_id,
      updated_at
    )
    VALUES (
      ${userId},
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET updated_at = excluded.updated_at
  `;
}

async function persistOutboxEvent(sql: QueryClient, artifacts: CanonicalArtifacts) {
  await sql`
    INSERT INTO outbox_events (
      topic,
      aggregate_type,
      aggregate_id,
      event_key,
      idempotency_key,
      payload,
      headers
    )
    VALUES (
      ${artifacts.queueEnvelope.stream},
      ${artifacts.queueEnvelope.canonicalRef.aggregateType},
      ${artifacts.queueEnvelope.canonicalRef.aggregateId},
      ${artifacts.queueEnvelope.canonicalRef.eventId},
      ${artifacts.idempotency.key},
      ${sql.json(artifacts.queueEnvelope)},
      ${sql.json({
        requestId: artifacts.queueEnvelope.requestId,
        traceparent: artifacts.queueEnvelope.traceparent,
      })}
    )
  `;
}

async function persistAuditRecord(
  sql: QueryClient,
  input: {
    actorUserId: string;
    guildId: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
    requestId: string;
    targetId: string;
    targetType: string;
    traceId?: string;
  },
) {
  await sql`
    INSERT INTO audit_records (
      guild_id,
      actor_type,
      actor_user_id,
      target_type,
      target_id,
      action,
      request_id,
      trace_id,
      idempotency_key,
      metadata
    )
    VALUES (
      ${input.guildId},
      ${"user"},
      ${input.actorUserId},
      ${input.targetType},
      ${input.targetId},
      ${"guild.channel_config.updated"},
      ${input.requestId},
      ${input.traceId ?? null},
      ${input.idempotencyKey},
      ${sql.json(input.metadata)}
    )
  `;
}

function mapRow(row: GuildChannelConfigRow): GuildChannelConfigRecord {
  return {
    auditLogChannelId: row.audit_log_channel_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    guildId: row.guild_id,
    moderationLogChannelId: row.moderation_log_channel_id ?? undefined,
    moderatorAlertChannelId: row.moderator_alert_channel_id,
    reviewChannelId: row.review_channel_id ?? undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readConfig(sql: QueryClient, guildId: string) {
  const [row] = await sql<GuildChannelConfigRow[]>`
    SELECT
      guild_id,
      moderator_alert_channel_id,
      review_channel_id,
      audit_log_channel_id,
      moderation_log_channel_id,
      created_at,
      updated_at
    FROM guild_channel_configs
    WHERE guild_id = ${guildId}
  `;

  return row ? mapRow(row) : undefined;
}

export function createPostgresGuildChannelConfigRepository(input: {
  connectionString: string;
}): GuildChannelConfigRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async getConfig(guildId) {
      return await readConfig(sql, guildId);
    },

    async upsertConfig(input) {
      return sql.begin(async (transaction) => {
        const receipt = await reserveIdempotency<PersistedGuildChannelConfigResult>(transaction, {
          boundary: input.artifacts.idempotency.scope,
          idempotencyKey: input.artifacts.idempotency.key,
          requestFingerprint: input.requestFingerprint,
        });

        if (receipt.response_body) {
          return receipt.response_body;
        }

        await ensureGuild(transaction, input.guildId);
        await ensureUser(transaction, input.body.actorUserId);

        await transaction`
          INSERT INTO guild_channel_configs (
            guild_id,
            moderator_alert_channel_id,
            review_channel_id,
            audit_log_channel_id,
            moderation_log_channel_id,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (
            ${input.guildId},
            ${input.body.moderatorAlertChannelId},
            ${input.body.reviewChannelId ?? null},
            ${input.body.auditLogChannelId ?? null},
            ${input.body.moderationLogChannelId ?? null},
            ${input.body.actorUserId},
            ${input.body.actorUserId}
          )
          ON CONFLICT (guild_id) DO UPDATE
          SET
            moderator_alert_channel_id = excluded.moderator_alert_channel_id,
            review_channel_id = excluded.review_channel_id,
            audit_log_channel_id = excluded.audit_log_channel_id,
            moderation_log_channel_id = excluded.moderation_log_channel_id,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = now()
        `;

        await persistAuditRecord(transaction, {
          actorUserId: input.body.actorUserId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            auditLogChannelId: input.body.auditLogChannelId ?? null,
            moderationLogChannelId: input.body.moderationLogChannelId ?? null,
            moderatorAlertChannelId: input.body.moderatorAlertChannelId,
            reviewChannelId: input.body.reviewChannelId ?? null,
          },
          requestId: input.artifacts.idempotency.requestId,
          targetId: input.guildId,
          targetType: "guild_channel_config",
          traceId: input.traceId,
        });

        await persistOutboxEvent(transaction, input.artifacts);

        const channelConfig = (await readConfig(transaction, input.guildId))!;
        const result = {
          channelConfig,
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
        } satisfies PersistedGuildChannelConfigResult;

        await completeIdempotency(transaction, receipt.idempotency_receipt_id, result, 200);

        return result;
      });
    },

    close() {
      return sql.end({ timeout: 1 });
    },
  };
}
