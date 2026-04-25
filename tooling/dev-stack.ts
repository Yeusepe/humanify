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

type DevProcessSpec = {
  name: string;
  command: string[];
  readinessUrl?: string;
};

type DevStackPlan = {
  notices: string[];
  composeFile: string;
  composeProjectName: string;
  processes: DevProcessSpec[];
};

const rootDirectory = process.cwd();
const composeProjectName = "humanify-local";
const composeFile = "docker-compose.local.yml";
const readinessTimeoutMs = 120_000;
const readinessPollIntervalMs = 1_000;

export function createDevStackPlan(env: NodeJS.ProcessEnv = process.env): DevStackPlan {
  const notices: string[] = [];
  const processes: DevProcessSpec[] = [
    {
      name: "@humanify/api-bun",
      command: ["bun", "run", "--filter", "@humanify/api-bun", "dev"],
      readinessUrl: "http://127.0.0.1:3211/healthz",
    },
    {
      name: "@humanify/dashboard-start",
      command: ["bun", "run", "--filter", "@humanify/dashboard-start", "dev"],
      readinessUrl: "http://127.0.0.1:3210/",
    },
    {
      name: "@humanify/verifier-start",
      command: ["bun", "run", "--filter", "@humanify/verifier-start", "dev"],
      readinessUrl: "http://127.0.0.1:3212/",
    },
    {
      name: "inference-rs",
      command: ["cargo", "run", "-p", "inference-rs"],
      readinessUrl: "http://127.0.0.1:4101/healthz",
    },
    {
      name: "learning-rs",
      command: ["cargo", "run", "-p", "learning-rs"],
      readinessUrl: "http://127.0.0.1:4102/healthz",
    },
    {
      name: "evidence-rs",
      command: ["cargo", "run", "-p", "evidence-rs"],
      readinessUrl: "http://127.0.0.1:4103/healthz",
    },
    {
      name: "trust-rs",
      command: ["cargo", "run", "-p", "trust-rs"],
      readinessUrl: "http://127.0.0.1:4104/healthz",
    },
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

  return { notices, composeFile, composeProjectName, processes };
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
  console.log("[dev-stack] Starting local infrastructure with Docker Compose.");
  runComposeCommand(plan, environment, ["up", "-d", "--wait", "--remove-orphans"]);

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
  console.log("[dev-stack] Dashboard: http://localhost:3210");
  console.log("[dev-stack] Verifier:  http://localhost:3212");
  console.log("[dev-stack] API:       http://localhost:3211");
  console.log("[dev-stack] Rust:      inference-rs=4101 learning-rs=4102 evidence-rs=4103 trust-rs=4104");
  console.log("[dev-stack] Infra:     postgres=5432 redis=6379 electric=5133 minio=9000/9001 qdrant=6333/6334 grafana=4300");

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
