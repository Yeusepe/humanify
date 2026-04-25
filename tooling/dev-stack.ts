/**
 * Purpose: Starts the full local Humanify Bun + Rust development stack from the repo root.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * - docs\contracts.md
 * - docs\data-platform.md
 * - docs\observability-security.md
 * External references:
 * - https://bun.sh/docs/api/spawn
 * - https://bun.sh/docs/runtime/env
 * - https://doc.rust-lang.org/cargo/commands/cargo-run.html
 * Tests:
 * - tooling/dev-stack.test.ts
 */

type DevProcessSpec = {
  name: string;
  command: string[];
};

type DevStackPlan = {
  notices: string[];
  processes: DevProcessSpec[];
};

const rootDirectory = process.cwd();

export function createDevStackPlan(env: NodeJS.ProcessEnv = process.env): DevStackPlan {
  const notices: string[] = [];
  const processes: DevProcessSpec[] = [
    {
      name: "@humanify/api-bun",
      command: ["bun", "run", "--filter", "@humanify/api-bun", "dev"],
    },
    {
      name: "@humanify/dashboard-start",
      command: ["bun", "run", "--filter", "@humanify/dashboard-start", "dev"],
    },
    {
      name: "@humanify/verifier-start",
      command: ["bun", "run", "--filter", "@humanify/verifier-start", "dev"],
    },
    {
      name: "inference-rs",
      command: ["cargo", "run", "-p", "inference-rs"],
    },
    {
      name: "learning-rs",
      command: ["cargo", "run", "-p", "learning-rs"],
    },
    {
      name: "evidence-rs",
      command: ["cargo", "run", "-p", "evidence-rs"],
    },
    {
      name: "trust-rs",
      command: ["cargo", "run", "-p", "trust-rs"],
    },
  ];

  if (env.DISCORD_BOT_TOKEN?.trim()) {
    processes.unshift({
      name: "@humanify/bot-bun",
      command: ["bun", "run", "--filter", "@humanify/bot-bun", "dev"],
    });
  } else {
    notices.push("Skipping @humanify/bot-bun because DISCORD_BOT_TOKEN is not set.");
  }

  return { notices, processes };
}

function readEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
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

    process.exit(exitCode);
  };

  process.on("SIGINT", () => {
    void shutdown("Received SIGINT. Stopping the local development stack.", 0);
  });

  process.on("SIGTERM", () => {
    void shutdown("Received SIGTERM. Stopping the local development stack.", 0);
  });

  console.log("[dev-stack] Starting the Humanify local development stack.");
  console.log("[dev-stack] Dashboard: http://localhost:3000");
  console.log("[dev-stack] Verifier:  http://localhost:3002");
  console.log("[dev-stack] API:       http://localhost:3001");
  console.log("[dev-stack] Rust:      inference-rs=4101 learning-rs=4102 evidence-rs=4103 trust-rs=4104");

  for (const notice of plan.notices) {
    console.warn(`[dev-stack] ${notice}`);
  }

  const firstExit = await Promise.race(
    children.map(async (child) => ({
      name: child.spec.name,
      exitCode: await child.subprocess.exited,
    })),
  );

  const exitCode = firstExit.exitCode === 0 ? 1 : firstExit.exitCode;
  await shutdown(`${firstExit.name} exited with code ${firstExit.exitCode}. Stopping the remaining stack.`, exitCode);
}

if (import.meta.main) {
  await runDevStack();
}
