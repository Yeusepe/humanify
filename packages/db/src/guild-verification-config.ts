/**
 * Purpose: Persists canonical guild verification configuration for enabled providers, proof bundles, face-verification policy, and verification role fallbacks.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\observability-security.md
 * - docs\verification.md
 * External references:
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * - https://www.postgresql.org/docs/current/sql-insert.html
 * Tests:
 * - apps/api-bun/src/app.test.ts
 * - packages/db/src/guild-verification-config.integration.test.ts
 */

import postgres from "postgres";

type QueryClient = any;

const guildVerificationRequirementKey = "guild_verification_config";

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

export type GuildVerificationConfigRecord = {
  createdAt: string;
  defaultProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledProviderIds: string[];
  faceVerificationRequired: boolean;
  guildId: string;
  requiredBundleIds: string[];
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
  updatedAt: string;
};

export type PersistedGuildVerificationConfigResult = {
  persistence: "persisted";
  queueDelivery: "pending_outbox_publish";
  verificationConfig: GuildVerificationConfigRecord;
};

export type GuildVerificationConfigRepository = {
  close(): Promise<void>;
  getConfig(guildId: string): Promise<GuildVerificationConfigRecord | undefined>;
  upsertConfig(input: {
    artifacts: CanonicalArtifacts;
    body: {
      actorUserId: string;
      defaultProviderId: string;
      defaultReusableProofBackendId?: string;
      enabledProviderIds: string[];
      faceVerificationRequired: boolean;
      requiredBundleIds: string[];
      requiredCapabilities: string[];
      suspiciousRoleIds: string[];
      trustedRoleIds: string[];
    };
    guildId: string;
    requestFingerprint?: string;
    traceId?: string;
  }): Promise<PersistedGuildVerificationConfigResult>;
};

type GuildVerificationConfigRow = {
  challenge_rules: Record<string, unknown> | null;
  created_at: string | Date;
  fallback_rules: Record<string, unknown> | null;
  guild_id: string;
  provider_config: Record<string, unknown> | null;
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
      ${sql.json({ canonicalWorkflow: "guild_verification_config_v1" })}
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
      ${"guild.verification_config.updated"},
      ${input.requestId},
      ${input.traceId ?? null},
      ${input.idempotencyKey},
      ${sql.json(input.metadata)}
    )
  `;
}

function readStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`Stored ${fieldName} must be an array of non-empty strings.`);
    }

    return [entry];
  });
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function mapRow(row: GuildVerificationConfigRow): GuildVerificationConfigRecord {
  const providerConfig = row.provider_config ?? {};
  const challengeRules = row.challenge_rules ?? {};
  const fallbackRules = row.fallback_rules ?? {};
  const defaultProviderId = readOptionalString(providerConfig.defaultProviderId);

  if (!defaultProviderId) {
    throw new Error("Stored verification config is missing defaultProviderId.");
  }

  return {
    createdAt: new Date(row.created_at).toISOString(),
    defaultProviderId,
    defaultReusableProofBackendId: readOptionalString(providerConfig.defaultReusableProofBackendId),
    enabledProviderIds: readStringArray(providerConfig.enabledProviderIds, "provider_config.enabledProviderIds"),
    faceVerificationRequired: readBoolean(challengeRules.faceVerificationRequired),
    guildId: row.guild_id,
    requiredBundleIds: readStringArray(challengeRules.requiredBundleIds, "challenge_rules.requiredBundleIds"),
    suspiciousRoleIds: readStringArray(fallbackRules.suspiciousRoleIds, "fallback_rules.suspiciousRoleIds"),
    trustedRoleIds: readStringArray(fallbackRules.trustedRoleIds, "fallback_rules.trustedRoleIds"),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readConfig(sql: QueryClient, guildId: string) {
  const [row] = await sql<GuildVerificationConfigRow[]>`
    SELECT
      guild_id,
      provider_config,
      challenge_rules,
      fallback_rules,
      created_at,
      updated_at
    FROM verification_requirements
    WHERE
      guild_id = ${guildId}
      AND requirement_key = ${guildVerificationRequirementKey}
      AND enabled = true
  `;

  return row ? mapRow(row) : undefined;
}

export function createPostgresGuildVerificationConfigRepository(input: {
  connectionString: string;
}): GuildVerificationConfigRepository {
  const sql = createSqlClient(input.connectionString);

  return {
    async getConfig(guildId) {
      return await readConfig(sql, guildId);
    },

    async upsertConfig(input) {
      return sql.begin(async (transaction) => {
        const receipt = await reserveIdempotency<PersistedGuildVerificationConfigResult>(transaction, {
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
          INSERT INTO verification_requirements (
            guild_id,
            policy_version_id,
            requirement_key,
            required_capabilities,
            challenge_rules,
            fallback_rules,
            retention_rules,
            provider_config,
            enabled
          )
          VALUES (
            ${input.guildId},
            ${null},
            ${guildVerificationRequirementKey},
            ${input.body.requiredCapabilities},
            ${transaction.json({
              faceVerificationRequired: input.body.faceVerificationRequired,
              requiredBundleIds: input.body.requiredBundleIds,
            })},
            ${transaction.json({
              suspiciousRoleIds: input.body.suspiciousRoleIds,
              trustedRoleIds: input.body.trustedRoleIds,
            })},
            ${transaction.json({})},
            ${transaction.json({
              defaultProviderId: input.body.defaultProviderId,
              defaultReusableProofBackendId: input.body.defaultReusableProofBackendId ?? null,
              enabledProviderIds: input.body.enabledProviderIds,
            })},
            ${true}
          )
          ON CONFLICT (guild_id, requirement_key) DO UPDATE
          SET
            required_capabilities = excluded.required_capabilities,
            challenge_rules = excluded.challenge_rules,
            fallback_rules = excluded.fallback_rules,
            retention_rules = excluded.retention_rules,
            provider_config = excluded.provider_config,
            enabled = excluded.enabled,
            updated_at = now()
        `;

        await persistAuditRecord(transaction, {
          actorUserId: input.body.actorUserId,
          guildId: input.guildId,
          idempotencyKey: input.artifacts.idempotency.key,
          metadata: {
            defaultProviderId: input.body.defaultProviderId,
            defaultReusableProofBackendId: input.body.defaultReusableProofBackendId ?? null,
            enabledProviderIds: input.body.enabledProviderIds,
            faceVerificationRequired: input.body.faceVerificationRequired,
            requiredBundleIds: input.body.requiredBundleIds,
            suspiciousRoleIds: input.body.suspiciousRoleIds,
            trustedRoleIds: input.body.trustedRoleIds,
          },
          requestId: input.artifacts.idempotency.requestId,
          targetId: input.guildId,
          targetType: "guild_verification_config",
          traceId: input.traceId,
        });

        await persistOutboxEvent(transaction, input.artifacts);

        const verificationConfig = (await readConfig(transaction, input.guildId))!;
        const result = {
          persistence: "persisted",
          queueDelivery: "pending_outbox_publish",
          verificationConfig,
        } satisfies PersistedGuildVerificationConfigResult;

        await completeIdempotency(transaction, receipt.idempotency_receipt_id, result, 200);

        return result;
      });
    },

    close() {
      return sql.end({ timeout: 1 });
    },
  };
}
