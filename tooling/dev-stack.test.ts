/**
 * Purpose: Verifies the root development-stack launcher keeps the documented full-stack process plan.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * - docs\local-development.md
 * External references:
 * - https://bun.sh/docs/test
 * - https://bun.sh/docs/api/spawn
 * - https://docs.docker.com/reference/cli/docker/compose/up/
 * Tests:
 * - tooling/dev-stack.test.ts
 */

import { expect, test } from "bun:test";

import {
  assertDevStackBootConfig,
  createDevStackEnvironment,
  createDevStackPlan,
  isRepoOwnedManagedListener,
  terminateManagedSubprocess,
} from "./dev-stack";

test("dev stack includes Docker Compose orchestration metadata", () => {
  const plan = createDevStackPlan({ DISCORD_BOT_TOKEN: "test-token" });

  expect(plan.composeFile).toBe("docker-compose.local.yml");
  expect(plan.composeProjectName).toBe("humanify-local");
  expect(plan.setupCommands).toEqual([
    {
      command: ["bun", "run", "--filter", "@humanify/db", "migrate"],
      name: "@humanify/db migrate",
    },
  ]);
});

test("dev stack includes all local services and UI surfaces", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });
  const names = plan.processes.map((processSpec) => processSpec.name);

  expect(names).toEqual([
    "@humanify/api-bun",
    "@humanify/dashboard-start",
    "@humanify/verifier-start",
    "inference-rs",
    "learning-rs",
    "evidence-rs",
    "trust-rs",
  ]);
});

test("dev stack includes the Discord bot when DISCORD_BOT_TOKEN is set", () => {
  const plan = createDevStackPlan({ DISCORD_BOT_TOKEN: "test-token" });
  const names = plan.processes.map((processSpec) => processSpec.name);

  expect(names[0]).toBe("@humanify/bot-bun");
  expect(plan.notices).toEqual([]);
});

test("dev stack allows explicit botless work", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });

  expect(plan.notices).toEqual(["Skipping @humanify/bot-bun because HUMANIFY_SKIP_BOT=1."]);
});

test("dev stack fails fast when the bot is required but no token is configured", () => {
  expect(() => createDevStackPlan({})).toThrow(
    "DISCORD_BOT_TOKEN is required for the full local stack. Set HUMANIFY_SKIP_BOT=1 only if you intentionally want to run without the Discord bot.",
  );
});

test("dev stack keeps documented readiness URLs", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });
  const readinessUrls = plan.processes.map((processSpec) => processSpec.readinessUrl).filter(Boolean);

  expect(readinessUrls).toEqual([
    "http://127.0.0.1:3211/healthz",
    "http://127.0.0.1:3210/",
    "http://127.0.0.1:3212/",
    "http://127.0.0.1:4101/healthz",
    "http://127.0.0.1:4102/healthz",
    "http://127.0.0.1:4103/healthz",
    "http://127.0.0.1:4104/healthz",
  ]);
});

test("dev stack preflights the documented fixed host ports", () => {
  const plan = createDevStackPlan({ HUMANIFY_SKIP_BOT: "1" });

  expect(plan.requiredPorts).toEqual([
    { host: "127.0.0.1", name: "dashboard", port: 3210 },
    { host: "127.0.0.1", name: "api", port: 3211 },
    { host: "127.0.0.1", name: "verifier", port: 3212 },
    { host: "127.0.0.1", name: "inference-rs", port: 4101 },
    { host: "127.0.0.1", name: "learning-rs", port: 4102 },
    { host: "127.0.0.1", name: "evidence-rs", port: 4103 },
    { host: "127.0.0.1", name: "trust-rs", port: 4104 },
    { host: "127.0.0.1", name: "postgres", port: 5432 },
    { host: "127.0.0.1", name: "redis", port: 6379 },
    { host: "127.0.0.1", name: "electric", port: 5133 },
    { host: "127.0.0.1", name: "minio-api", port: 9000 },
    { host: "127.0.0.1", name: "minio-console", port: 9001 },
    { host: "127.0.0.1", name: "qdrant-http", port: 6333 },
    { host: "127.0.0.1", name: "qdrant-grpc", port: 6334 },
    { host: "127.0.0.1", name: "grafana", port: 4300 },
  ]);
});

test("dev stack derives readiness and preflight ports from env-configured services", () => {
  const plan = createDevStackPlan({
    HUMANIFY_SKIP_BOT: "1",
    HUMANIFY_API_PORT: "4211",
    HUMANIFY_INFERENCE_RS_BIND_ADDR: "127.0.0.1:5101",
    HUMANIFY_LEARNING_RS_BIND_ADDR: "127.0.0.1:5102",
    HUMANIFY_EVIDENCE_RS_BIND_ADDR: "127.0.0.1:5103",
    HUMANIFY_TRUST_RS_BIND_ADDR: "127.0.0.1:5104",
    HUMANIFY_REDIS_PORT: "6380",
    HUMANIFY_ELECTRIC_PORT: "5233",
      HUMANIFY_MINIO_API_PORT: "9100",
      HUMANIFY_MINIO_CONSOLE_PORT: "9101",
      HUMANIFY_POSTGRES_PORT: "5544",
      HUMANIFY_QDRANT_HTTP_PORT: "6433",
      HUMANIFY_QDRANT_GRPC_PORT: "6434",
      HUMANIFY_GRAFANA_PORT: "4400",
  });

  expect(plan.ports).toEqual({
    api: 4211,
    dashboard: 3210,
    electric: 5233,
    evidence: 5103,
    grafana: 4400,
    inference: 5101,
      learning: 5102,
      minioApi: 9100,
      minioConsole: 9101,
      postgres: 5544,
      qdrantGrpc: 6434,
      qdrantHttp: 6433,
      redis: 6380,
    trust: 5104,
    verifier: 3212,
  });

  const readinessUrls = plan.processes.map((processSpec) => processSpec.readinessUrl).filter(Boolean);

  expect(readinessUrls).toEqual([
    "http://127.0.0.1:4211/healthz",
    "http://127.0.0.1:3210/",
    "http://127.0.0.1:3212/",
    "http://127.0.0.1:5101/healthz",
    "http://127.0.0.1:5102/healthz",
    "http://127.0.0.1:5103/healthz",
    "http://127.0.0.1:5104/healthz",
  ]);
});

test("dev stack derives API-facing data-plane URLs for child processes from the local port plan", () => {
  const sourceEnv = {
    HUMANIFY_POSTGRES_DB: "humanify_dev",
    HUMANIFY_POSTGRES_PASSWORD: "secret",
    HUMANIFY_POSTGRES_PORT: "5544",
    HUMANIFY_POSTGRES_USER: "humanify_app",
    HUMANIFY_REDIS_PORT: "6380",
    HUMANIFY_SKIP_BOT: "1",
  };
  const plan = createDevStackPlan(sourceEnv);
  const environment = createDevStackEnvironment(plan, sourceEnv);

  expect(environment.HUMANIFY_POSTGRES_URL).toBe("postgres://humanify_app:secret@127.0.0.1:5544/humanify_dev");
  expect(environment.HUMANIFY_REDIS_URL).toBe("redis://127.0.0.1:6380");
});

test("dev stack fails before startup when required Discord OAuth credentials are missing", () => {
  const sourceEnv = {
    DISCORD_BOT_TOKEN: "test-token",
    HUMANIFY_SESSION_SECRET: "session-secret",
  };
  const plan = createDevStackPlan(sourceEnv);
  const environment = createDevStackEnvironment(plan, sourceEnv);

  expect(() => assertDevStackBootConfig(environment)).toThrow(
    "Configuration validation failed for DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI.",
  );
});

test("dev stack reports the full missing API boot credential set in one pass", () => {
  const sourceEnv = {
    DISCORD_BOT_TOKEN: "test-token",
  };
  const plan = createDevStackPlan(sourceEnv);
  const environment = createDevStackEnvironment(plan, sourceEnv);

  expect(() => assertDevStackBootConfig(environment)).toThrow(
    "Configuration validation failed for HUMANIFY_SESSION_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI.",
  );
});

test("dev stack accepts the documented API boot credentials before startup", () => {
  const sourceEnv = {
    DISCORD_BOT_TOKEN: "test-token",
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_CLIENT_SECRET: "discord-client-secret",
    DISCORD_REDIRECT_URI: "http://127.0.0.1:3211/auth/discord/callback",
    HUMANIFY_SESSION_SECRET: "session-secret",
  };
  const plan = createDevStackPlan(sourceEnv);
  const environment = createDevStackEnvironment(plan, sourceEnv);

  expect(() => assertDevStackBootConfig(environment)).not.toThrow();
});

test("Windows shutdown kills the managed process tree instead of only the direct child", () => {
  const spawnCalls: string[][] = [];
  let killed = false;

  terminateManagedSubprocess(
    {
      exitCode: null,
      exited: Promise.resolve(0),
      kill() {
        killed = true;
      },
      pid: 4321,
    },
    {
      platform: "win32",
      spawnSync(command) {
        spawnCalls.push(command);
        return {
          exitCode: 0,
        } as ReturnType<typeof Bun.spawnSync>;
      },
    },
  );

  expect(spawnCalls).toEqual([["taskkill", "/pid", "4321", "/t", "/f"]]);
  expect(killed).toBe(false);
});

test("shutdown falls back to direct kill when task-tree termination is unavailable", () => {
  const signals: string[] = [];

  terminateManagedSubprocess(
    {
      exitCode: null,
      exited: Promise.resolve(0),
      kill(signal) {
        signals.push(signal ?? "default");
      },
      pid: 9876,
    },
    {
      platform: "win32",
      spawnSync() {
        return {
          exitCode: 1,
        } as ReturnType<typeof Bun.spawnSync>;
      },
    },
  );

  expect(signals).toEqual(["default"]);
});

test("repo-owned stale listeners are distinguished from unrelated listeners on managed ports", () => {
  expect(
    isRepoOwnedManagedListener({
      commandLine:
        'node "C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\humanify\\apps\\dashboard-start\\node_modules\\vite\\bin\\vite.js" dev --port 3210',
      name: "node.exe",
      port: 3210,
      processId: 1111,
    }),
  ).toBe(true);

  expect(
    isRepoOwnedManagedListener({
      commandLine: 'node "C:\\other-project\\node_modules\\vite\\bin\\vite.js" dev --port 3210',
      name: "node.exe",
      port: 3210,
      processId: 2222,
    }),
  ).toBe(false);
});
