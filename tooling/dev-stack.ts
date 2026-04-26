/**
 * Purpose: Starts the full local Humanify Docker + Bun + Rust development stack from the repo root.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * - docs\contracts.md
 * - docs\data-platform.md
 * - docs\observability-security.md
 * - docs\local-development.md
 * External references:
 * - https://bun.sh/docs/api/spawn
 * - https://bun.sh/docs/runtime/env
 * - https://docs.docker.com/reference/cli/docker/compose/up/
 * - https://doc.rust-lang.org/cargo/commands/cargo-run.html
 * Tests:
 * - tooling/dev-stack.test.ts
 */

import { fetch as bunFetch } from "bun";
import { createServer } from "node:net";

type DevProcessSpec = {
  name: string;
  command: string[];
  readinessUrl?: string;
};

type SetupCommandSpec = {
  name: string;
  command: string[];
};

type RequiredPortSpec = {
  host: string;
  name: string;
  port: number;
};

type DevStackPortMap = {
  api: number;
  dashboard: number;
  electric: number;
  evidence: number;
  grafana: number;
  inference: number;
  learning: number;
  minioApi: number;
  minioConsole: number;
  postgres: number;
  qdrantGrpc: number;
  qdrantHttp: number;
  redis: number;
  trust: number;
  verifier: number;
};

type DevStackPlan = {
  notices: string[];
  composeFile: string;
  composeProjectName: string;
  processes: DevProcessSpec[];
  setupCommands: SetupCommandSpec[];
  ports: DevStackPortMap;
  requiredPorts: RequiredPortSpec[];
};

const rootDirectory = process.cwd();
const composeProjectName = "humanify-local";
const composeFile = "docker-compose.local.yml";
const readinessTimeoutMs = 120_000;
const readinessPollIntervalMs = 1_000;
const dashboardPort = 3210;
const defaultApiPort = 3211;
const verifierPort = 3212;
const defaultInferencePort = 4101;
const defaultLearningPort = 4102;
const defaultEvidencePort = 4103;
const defaultTrustPort = 4104;
const defaultPostgresPort = 5432;
const defaultRedisPort = 6379;
const defaultElectricPort = 5133;
const defaultMinioApiPort = 9000;
const defaultMinioConsolePort = 9001;
const defaultQdrantHttpPort = 6333;
const defaultQdrantGrpcPort = 6334;
const defaultGrafanaPort = 4300;

function resolvePort(
  rawValue: string | undefined,
  fallback: number,
  variableName: string,
): number {
  const parsed = Number(rawValue?.trim() || fallback);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${variableName} must resolve to a valid TCP port, received ${JSON.stringify(rawValue)}.`);
  }

  return parsed;
}

function resolveBindAddressPort(
  rawValue: string | undefined,
  fallback: number,
  variableName: string,
): number {
  const value = rawValue?.trim();

  if (!value) {
    return fallback;
  }

  const match = value.match(/:(\d+)$/);

  if (!match) {
    throw new Error(`${variableName} must end with :<port>, received ${JSON.stringify(rawValue)}.`);
  }

  return resolvePort(match[1], fallback, variableName);
}

function requiredPort(name: string, port: number): RequiredPortSpec {
  return {
    host: "127.0.0.1",
    name,
    port,
  };
}

export function createDevStackPlan(env: NodeJS.ProcessEnv = process.env): DevStackPlan {
  const notices: string[] = [];
  const apiPort = resolvePort(env.HUMANIFY_API_PORT, defaultApiPort, "HUMANIFY_API_PORT");
  const postgresPort = resolvePort(
    env.HUMANIFY_POSTGRES_PORT,
    defaultPostgresPort,
    "HUMANIFY_POSTGRES_PORT",
  );
  const inferencePort = resolveBindAddressPort(
    env.HUMANIFY_INFERENCE_RS_BIND_ADDR,
    defaultInferencePort,
    "HUMANIFY_INFERENCE_RS_BIND_ADDR",
  );
  const learningPort = resolveBindAddressPort(
    env.HUMANIFY_LEARNING_RS_BIND_ADDR,
    defaultLearningPort,
    "HUMANIFY_LEARNING_RS_BIND_ADDR",
  );
  const evidencePort = resolveBindAddressPort(
    env.HUMANIFY_EVIDENCE_RS_BIND_ADDR,
    defaultEvidencePort,
    "HUMANIFY_EVIDENCE_RS_BIND_ADDR",
  );
  const trustPort = resolveBindAddressPort(
    env.HUMANIFY_TRUST_RS_BIND_ADDR,
    defaultTrustPort,
    "HUMANIFY_TRUST_RS_BIND_ADDR",
  );
  const redisPort = resolvePort(env.HUMANIFY_REDIS_PORT, defaultRedisPort, "HUMANIFY_REDIS_PORT");
  const electricPort = resolvePort(
    env.HUMANIFY_ELECTRIC_PORT,
    defaultElectricPort,
    "HUMANIFY_ELECTRIC_PORT",
  );
  const minioApiPort = resolvePort(
    env.HUMANIFY_MINIO_API_PORT,
    defaultMinioApiPort,
    "HUMANIFY_MINIO_API_PORT",
  );
  const minioConsolePort = resolvePort(
    env.HUMANIFY_MINIO_CONSOLE_PORT,
    defaultMinioConsolePort,
    "HUMANIFY_MINIO_CONSOLE_PORT",
  );
  const qdrantHttpPort = resolvePort(
    env.HUMANIFY_QDRANT_HTTP_PORT,
    defaultQdrantHttpPort,
    "HUMANIFY_QDRANT_HTTP_PORT",
  );
  const qdrantGrpcPort = resolvePort(
    env.HUMANIFY_QDRANT_GRPC_PORT,
    defaultQdrantGrpcPort,
    "HUMANIFY_QDRANT_GRPC_PORT",
  );
  const grafanaPort = resolvePort(
    env.HUMANIFY_GRAFANA_PORT,
    defaultGrafanaPort,
    "HUMANIFY_GRAFANA_PORT",
  );
  const ports: DevStackPortMap = {
    api: apiPort,
    dashboard: dashboardPort,
    electric: electricPort,
    evidence: evidencePort,
    grafana: grafanaPort,
    inference: inferencePort,
    learning: learningPort,
    minioApi: minioApiPort,
    minioConsole: minioConsolePort,
    postgres: postgresPort,
    qdrantGrpc: qdrantGrpcPort,
    qdrantHttp: qdrantHttpPort,
    redis: redisPort,
    trust: trustPort,
    verifier: verifierPort,
  };
  const setupCommands: SetupCommandSpec[] = [
    {
      name: "@humanify/db migrate",
      command: ["bun", "run", "--filter", "@humanify/db", "migrate"],
    },
  ];
  const processes: DevProcessSpec[] = [
    {
      name: "@humanify/api-bun",
      command: ["bun", "run", "--filter", "@humanify/api-bun", "dev"],
      readinessUrl: `http://127.0.0.1:${ports.api}/healthz`,
    },
    {
      name: "@humanify/dashboard-start",
      command: ["bun", "run", "--filter", "@humanify/dashboard-start", "dev"],
      readinessUrl: `http://127.0.0.1:${ports.dashboard}/`,
    },
    {
      name: "@humanify/verifier-start",
      command: ["bun", "run", "--filter", "@humanify/verifier-start", "dev"],
      readinessUrl: `http://127.0.0.1:${ports.verifier}/`,
    },
    {
      name: "inference-rs",
      command: ["cargo", "run", "-p", "inference-rs"],
      readinessUrl: `http://127.0.0.1:${ports.inference}/healthz`,
    },
    {
      name: "learning-rs",
      command: ["cargo", "run", "-p", "learning-rs"],
      readinessUrl: `http://127.0.0.1:${ports.learning}/healthz`,
    },
    {
      name: "evidence-rs",
      command: ["cargo", "run", "-p", "evidence-rs"],
      readinessUrl: `http://127.0.0.1:${ports.evidence}/healthz`,
    },
    {
      name: "trust-rs",
      command: ["cargo", "run", "-p", "trust-rs"],
      readinessUrl: `http://127.0.0.1:${ports.trust}/healthz`,
    },
  ];
  const requiredPorts: RequiredPortSpec[] = [
    requiredPort("dashboard", ports.dashboard),
    requiredPort("api", ports.api),
    requiredPort("verifier", ports.verifier),
    requiredPort("inference-rs", ports.inference),
    requiredPort("learning-rs", ports.learning),
    requiredPort("evidence-rs", ports.evidence),
    requiredPort("trust-rs", ports.trust),
    requiredPort("postgres", ports.postgres),
    requiredPort("redis", ports.redis),
    requiredPort("electric", ports.electric),
    requiredPort("minio-api", ports.minioApi),
    requiredPort("minio-console", ports.minioConsole),
    requiredPort("qdrant-http", ports.qdrantHttp),
    requiredPort("qdrant-grpc", ports.qdrantGrpc),
    requiredPort("grafana", ports.grafana),
  ];

  if (env.HUMANIFY_SKIP_BOT === "1") {
    notices.push("Skipping @humanify/bot-bun because HUMANIFY_SKIP_BOT=1.");
  } else if (env.DISCORD_BOT_TOKEN?.trim()) {
    processes.unshift({
      name: "@humanify/bot-bun",
      command: ["bun", "run", "--filter", "@humanify/bot-bun", "dev"],
    });
  } else {
    throw new Error(
      "DISCORD_BOT_TOKEN is required for the full local stack. Set HUMANIFY_SKIP_BOT=1 only if you intentionally want to run without the Discord bot.",
    );
  }

  return { notices, composeFile, composeProjectName, processes, setupCommands, ports, requiredPorts };
}

function readEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}

function runComposeCommand(
  plan: DevStackPlan,
  environment: Record<string, string>,
  args: string[],
  allowFailure = false,
) {
  const command = ["docker", "compose", "--project-name", plan.composeProjectName, "-f", plan.composeFile, ...args];
  const result = Bun.spawnSync(command, {
    cwd: rootDirectory,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`Docker Compose command failed: ${command.join(" ")}`);
  }
}

function runSetupCommand(commandSpec: SetupCommandSpec, environment: Record<string, string>) {
  const result = Bun.spawnSync(commandSpec.command, {
    cwd: rootDirectory,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(`Setup command failed: ${commandSpec.command.join(" ")}`);
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReadiness(name: string, url: string, timeoutMs = readinessTimeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await bunFetch(url, {
        signal: AbortSignal.timeout(2_000),
      });

      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await sleep(readinessPollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${name} readiness at ${url}.`);
}

async function checkPortAvailability(portSpec: RequiredPortSpec): Promise<RequiredPortSpec | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(portSpec);
        return;
      }

      reject(error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(null);
      });
    });
    server.listen({
      host: portSpec.host,
      port: portSpec.port,
      exclusive: true,
    });
  });
}

async function assertRequiredPortsAvailable(plan: DevStackPlan) {
  const occupiedPorts = (
    await Promise.all(plan.requiredPorts.map((portSpec) => checkPortAvailability(portSpec)))
  ).filter((portSpec): portSpec is RequiredPortSpec => portSpec !== null);

  if (occupiedPorts.length === 0) {
    return;
  }

  const details = occupiedPorts
    .map((portSpec) => `${portSpec.name} (${portSpec.host}:${portSpec.port})`)
    .join(", ");

  throw new Error(
    `Cannot start the full local stack because these required host ports are already in use: ${details}. Stop the conflicting processes and try again.`,
  );
}

async function pipeOutput(
  label: string,
  stream: ReadableStream<Uint8Array> | null | undefined,
  write: (message: string) => void,
) {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      write(`[${label}] ${line}\n`);
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  buffer += decoder.decode();

  if (buffer.length > 0) {
    write(`[${label}] ${buffer.replace(/\r$/, "")}\n`);
  }
}

async function runDevStack() {
  const plan = createDevStackPlan();
  const environment = readEnvironment();
  await assertRequiredPortsAvailable(plan);
  console.log("[dev-stack] Starting local infrastructure with Docker Compose.");
  runComposeCommand(plan, environment, ["up", "-d", "--wait", "--remove-orphans"]);
  console.log("[dev-stack] Applying canonical Postgres migrations.");

  for (const setupCommand of plan.setupCommands) {
    runSetupCommand(setupCommand, environment);
  }

  const children = plan.processes.map((processSpec) => {
    const subprocess = Bun.spawn(processSpec.command, {
      cwd: rootDirectory,
      env: environment,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      spec: processSpec,
      subprocess,
      stdoutTask: pipeOutput(processSpec.name, subprocess.stdout, (message) => process.stdout.write(message)),
      stderrTask: pipeOutput(processSpec.name, subprocess.stderr, (message) => process.stderr.write(message)),
    };
  });

  let isStopping = false;

  const shutdown = async (reason: string, exitCode: number) => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    console.log(`\n[dev-stack] ${reason}`);

    for (const child of children) {
      child.subprocess.kill();
    }

    await Promise.allSettled([
      ...children.map((child) => child.subprocess.exited),
      ...children.map((child) => child.stdoutTask),
      ...children.map((child) => child.stderrTask),
    ]);

    console.log("[dev-stack] Stopping local infrastructure.");
    try {
      runComposeCommand(plan, environment, ["down", "--remove-orphans"], true);
    } catch {
      // Best-effort cleanup only.
    }

    process.exit(exitCode);
  };

  process.on("SIGINT", () => {
    void shutdown("Received SIGINT. Stopping the local development stack.", 0);
  });

  process.on("SIGTERM", () => {
    void shutdown("Received SIGTERM. Stopping the local development stack.", 0);
  });

  console.log("[dev-stack] Starting the Humanify local development stack.");
  console.log(`[dev-stack] Dashboard: http://localhost:${plan.ports.dashboard}`);
  console.log(`[dev-stack] Verifier:  http://localhost:${plan.ports.verifier}`);
  console.log(`[dev-stack] API:       http://localhost:${plan.ports.api}`);
  console.log(
    `[dev-stack] Rust:      inference-rs=${plan.ports.inference} learning-rs=${plan.ports.learning} evidence-rs=${plan.ports.evidence} trust-rs=${plan.ports.trust}`,
  );
  console.log(
    `[dev-stack] Infra:     postgres=${plan.ports.postgres} redis=${plan.ports.redis} electric=${plan.ports.electric} minio=${plan.ports.minioApi}/${plan.ports.minioConsole} qdrant=${plan.ports.qdrantHttp}/${plan.ports.qdrantGrpc} grafana=${plan.ports.grafana}`,
  );

  for (const notice of plan.notices) {
    console.warn(`[dev-stack] ${notice}`);
  }

  const firstExitPromise = Promise.race(
    children.map(async (child) => ({
      name: child.spec.name,
      exitCode: await child.subprocess.exited,
    })),
  );

  const readinessPromise = Promise.all(
    children
      .filter((child) => child.spec.readinessUrl)
      .map((child) => waitForReadiness(child.spec.name, child.spec.readinessUrl!)),
  );

  const startupResult = await Promise.race([
    readinessPromise.then(() => ({ kind: "ready" as const })),
    firstExitPromise.then((result) => ({ kind: "exit" as const, result })),
  ]);

  if (startupResult.kind === "exit") {
    const exitCode = startupResult.result.exitCode === 0 ? 1 : startupResult.result.exitCode;
    await shutdown(
      `${startupResult.result.name} exited with code ${startupResult.result.exitCode} before the full stack became ready. Stopping the remaining stack.`,
      exitCode,
    );
    return;
  }

  console.log("[dev-stack] Full local stack is ready.");

  const firstExit = await firstExitPromise;
  const exitCode = firstExit.exitCode === 0 ? 1 : firstExit.exitCode;
  await shutdown(`${firstExit.name} exited with code ${firstExit.exitCode}. Stopping the remaining stack.`, exitCode);
}

if (import.meta.main) {
  await runDevStack();
}
