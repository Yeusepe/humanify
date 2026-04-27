/**
 * Purpose: Verifies guild verification configuration persists canonically in Postgres for provider enablement, proof-bundle policy, and role fallback workflows when a test database is available.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\data-platform.md
 * - docs\testing.md
 * - docs\verification.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://github.com/porsager/postgres
 * - https://www.postgresql.org/docs/current/index.html
 * Tests:
 * - packages/db/src/guild-verification-config.integration.test.ts
 */

import { afterAll, expect, test } from "bun:test";

import { createPostgresGuildVerificationConfigRepository } from "./guild-verification-config";

const connectionString = process.env.HUMANIFY_DATABASE_URL ?? process.env.HUMANIFY_POSTGRES_URL;
const repository = connectionString
  ? createPostgresGuildVerificationConfigRepository({
      connectionString,
    })
  : undefined;

afterAll(async () => {
  await repository?.close();
});

const integrationTest = repository ? test : test.skip;

integrationTest("guild verification config persists canonical provider, bundle, and role policy", async () => {
  const scope = crypto.randomUUID();
  const guildId = `guild_${scope}`;
  const actorUserId = `mod_${scope}`;

  const persisted = await repository!.upsertConfig({
    artifacts: {
      idempotency: {
        key: `guild-verification-config:${scope}`,
        requestId: `req_${scope}`,
        scope: `guild-verification-config:${guildId}`,
      },
      queueEnvelope: {
        canonicalRef: {
          aggregateId: guildId,
          aggregateType: "guild_verification_config",
          eventId: crypto.randomUUID(),
        },
        kind: "guild.verification.updated",
        messageId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          guildId,
        },
        producer: {
          serviceName: "api-bun",
        },
        requestId: `req_${scope}`,
        schemaVersion: "1",
        stream: "verification.events",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      },
    },
    body: {
      actorUserId,
      defaultProviderId: "didit",
      defaultReusableProofBackendId: "privado",
      enabledProviderIds: ["didit", "privado", "self"],
      faceVerificationRequired: true,
      requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
      requiredCapabilities: ["age_over_18", "nationality", "face_verification"],
      roleGrantBindings: [
        { roleId: `role_human_${scope}`, trigger: "verified_human" },
        { roleId: `role_18_${scope}`, trigger: "age_over_18" },
      ],
      suspiciousRoleIds: [`role_suspicious_${scope}`],
      trustedRoleIds: [`role_trusted_${scope}`],
    },
    guildId,
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  expect(persisted.persistence).toBe("persisted");
  expect(persisted.queueDelivery).toBe("pending_outbox_publish");
  expect(persisted.verificationConfig).toEqual(
    expect.objectContaining({
      defaultProviderId: "didit",
      defaultReusableProofBackendId: "privado",
      enabledProviderIds: ["didit", "privado", "self"],
      faceVerificationRequired: true,
      requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
      roleGrantBindings: [
        { roleId: `role_human_${scope}`, trigger: "verified_human" },
        { roleId: `role_18_${scope}`, trigger: "age_over_18" },
      ],
      suspiciousRoleIds: [`role_suspicious_${scope}`],
      trustedRoleIds: [`role_trusted_${scope}`],
    }),
  );

  const readBack = await repository!.getConfig(guildId);
  expect(readBack).toEqual(
    expect.objectContaining({
      defaultProviderId: "didit",
      defaultReusableProofBackendId: "privado",
      enabledProviderIds: ["didit", "privado", "self"],
      faceVerificationRequired: true,
      requiredBundleIds: ["humanify_id_age_and_nationality_v1"],
      roleGrantBindings: [
        { roleId: `role_human_${scope}`, trigger: "verified_human" },
        { roleId: `role_18_${scope}`, trigger: "age_over_18" },
      ],
      suspiciousRoleIds: [`role_suspicious_${scope}`],
      trustedRoleIds: [`role_trusted_${scope}`],
    }),
  );
});
