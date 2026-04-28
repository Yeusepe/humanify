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
  managedResources: GuildManagedDiscordResourceRecord[];
  moderationLogChannelId?: string;
  moderatorAlertChannelId: string;
  reviewChannelId?: string;
  setupMode: "automatic" | "manual";
  verificationChannelId?: string;
  verificationPanelMessageId?: string;
  updatedAt: string;
};

export type GuildManagedDiscordResourceRecord = {
  id: string;
  kind: "channel" | "message" | "role";
  ownedBy: "humanify";
  purpose:
    | "age_over_18_role"
    | "age_over_21_role"
    | "quarantine_role"
    | "verification_channel"
    | "verification_panel_message"
    | "verified_human_role";
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
      managedResources?: GuildManagedDiscordResourceRecord[];
      moderationLogChannelId?: string;
      moderatorAlertChannelId: string;
      reviewChannelId?: string;
      setupMode?: "automatic" | "manual";
      verificationChannelId?: string;
      verificationPanelMessageId?: string;
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
  managed_resources: unknown;
  moderation_log_channel_id: string | null;
  moderator_alert_channel_id: string;
  review_channel_id: string | null;
  setup_mode: string;
  updated_at: string | Date;
  verification_channel_id: string | null;
  verification_panel_message_id: string | null;
};

function normalizeManagedResources(value: unknown): GuildManagedDiscordResourceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: GuildManagedDiscordResourceRecord[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const kind = candidate.kind;
    const ownedBy = candidate.ownedBy;
    const purpose = candidate.purpose;
    if (
      !id
      || (kind !== "channel" && kind !== "message" && kind !== "role")
      || ownedBy !== "humanify"
      || (
        purpose !== "age_over_18_role"
        && purpose !== "age_over_21_role"
        && purpose !== "quarantine_role"
        && purpose !== "verification_channel"
        && purpose !== "verification_panel_message"
        && purpose !== "verified_human_role"
      )
    ) {
      continue;
    }

    const dedupeKey = `${kind}:${purpose}:${id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      id,
      kind,
      ownedBy,
      purpose,
    });
  }

  return normalized;
}

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
    managedResources: normalizeManagedResources(row.managed_resources),
    moderationLogChannelId: row.moderation_log_channel_id ?? undefined,
    moderatorAlertChannelId: row.moderator_alert_channel_id,
    reviewChannelId: row.review_channel_id ?? undefined,
    setupMode: row.setup_mode === "automatic" ? "automatic" : "manual",
    updatedAt: new Date(row.updated_at).toISOString(),
    verificationChannelId: row.verification_channel_id ?? undefined,
    verificationPanelMessageId: row.verification_panel_message_id ?? undefined,
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
      setup_mode,
      verification_channel_id,
      verification_panel_message_id,
      managed_resources,
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
            setup_mode,
            verification_channel_id,
            verification_panel_message_id,
            managed_resources,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (
            ${input.guildId},
            ${input.body.moderatorAlertChannelId},
            ${input.body.reviewChannelId ?? null},
            ${input.body.auditLogChannelId ?? null},
            ${input.body.moderationLogChannelId ?? null},
            ${input.body.setupMode ?? "manual"},
            ${input.body.verificationChannelId ?? null},
            ${input.body.verificationPanelMessageId ?? null},
            ${transaction.json(normalizeManagedResources(input.body.managedResources))},
            ${input.body.actorUserId},
            ${input.body.actorUserId}
          )
          ON CONFLICT (guild_id) DO UPDATE
          SET
            moderator_alert_channel_id = excluded.moderator_alert_channel_id,
            review_channel_id = excluded.review_channel_id,
            audit_log_channel_id = excluded.audit_log_channel_id,
            moderation_log_channel_id = excluded.moderation_log_channel_id,
            setup_mode = excluded.setup_mode,
            verification_channel_id = excluded.verification_channel_id,
            verification_panel_message_id = excluded.verification_panel_message_id,
            managed_resources = excluded.managed_resources,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = now()
        `;

        await persistAuditRecord(transaction, {
          actorUserId: input.body.actorUserId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            auditLogChannelId: input.body.auditLogChannelId ?? null,
            managedResources: normalizeManagedResources(input.body.managedResources),
            moderationLogChannelId: input.body.moderationLogChannelId ?? null,
            moderatorAlertChannelId: input.body.moderatorAlertChannelId,
            reviewChannelId: input.body.reviewChannelId ?? null,
            setupMode: input.body.setupMode ?? "manual",
            verificationChannelId: input.body.verificationChannelId ?? null,
            verificationPanelMessageId: input.body.verificationPanelMessageId ?? null,
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
