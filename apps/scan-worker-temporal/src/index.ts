/**
 * Purpose: Boots the supported-runtime Temporal member-scan worker that claims canonical Postgres requests and executes durable Discord scans.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\discord-bot.md
 * - docs\local-development.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/workers
 * - https://typescript.temporal.io/api/classes/client.WorkflowClient
 * - https://typescript.temporal.io/api/classes/worker.Worker
 * Tests:
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { REST } from "@discordjs/rest";
import { WorkflowClient } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

import {
  loadBotApiConfig,
  loadBotTokenConfig,
  loadDataPlaneConfig,
  loadObservabilityConfig,
  loadServiceIdentityConfig,
  loadTemporalWorkerConfig,
  summarizeConfigForLogs,
} from "@humanify/config";
import { createPostgresGuildScanRequestRepository, type GuildScanRequestRecord, type GuildScanRequestRepository } from "@humanify/db";
import {
  createStructuredErrorFields,
  createStructuredLogFields,
  createTelemetryBootstrap,
} from "@humanify/telemetry";

import { createScanActivities } from "./activities";
import { createScanWorkerApiClient } from "./api-client";
import { createDiscordRestWarningRuntime } from "./moderator-warning";
import type { RunGuildScanWorkflowInput } from "./workflows";

type LoggerLike = Pick<Console, "error" | "info">;

type HealthState = {
  lastError?: string;
  ready: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildTemporalWorkflowId(scanRequestId: string) {
  return `guild-scan:${scanRequestId}`;
}

function buildWorkflowInput(record: GuildScanRequestRecord): RunGuildScanWorkflowInput {
  return {
    guildId: record.guildId,
    requestedByUserId: record.requestedByUserId,
    scanRequestId: record.scanRequestId,
    scope: record.scope,
    targetUserId: record.targetUserId,
  };
}

async function startHealthServer(port: number, state: HealthState): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    response.setHeader("content-type", "application/json");
    response.statusCode = state.ready && !state.lastError ? 200 : 503;
    response.end(JSON.stringify({
      lastError: state.lastError,
      ready: state.ready,
      service: "scan-worker-temporal",
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function claimAndStartPendingScan(input: {
  logger: LoggerLike;
  logContext: {
    environment: string;
    release?: string;
    serviceName: string;
  };
  repository: GuildScanRequestRepository;
  scanTaskQueue: string;
  serviceName: string;
  workflowClient: WorkflowClient;
}) {
  const claimed = await input.repository.claimNextQueuedRequest({
    taskQueue: input.scanTaskQueue,
    workflowIdPrefix: "guild-scan:",
  });
  if (!claimed) {
    return false;
  }

  try {
    await input.workflowClient.start("runGuildScanWorkflow", {
      args: [buildWorkflowInput(claimed)],
      taskQueue: input.scanTaskQueue,
      workflowId: claimed.workflowId ?? buildTemporalWorkflowId(claimed.scanRequestId),
    });

    input.logger.info(JSON.stringify(createStructuredLogFields({
      ...input.logContext,
      requestId: claimed.scanRequestId,
    }, {
      event: "scan.workflow.started",
      guildId: claimed.guildId,
      scanRequestId: claimed.scanRequestId,
      taskQueue: input.scanTaskQueue,
      workflowId: claimed.workflowId ?? buildTemporalWorkflowId(claimed.scanRequestId),
    })));
    return true;
  } catch (error) {
    await input.repository.markFailed({
      errorMessage: error instanceof Error ? error.message : "Temporal workflow start failed.",
      scanRequestId: claimed.scanRequestId,
      summary: {
        ...claimed.summary,
        notes: [...claimed.summary.notes, "Temporal worker failed before the workflow could start."],
      },
    });
    throw error;
  }
}

async function runClaimLoop(input: {
  healthState: HealthState;
  logger: LoggerLike;
  logContext: {
    environment: string;
    release?: string;
    serviceName: string;
  };
  pollIntervalMs: number;
  repository: GuildScanRequestRepository;
  scanTaskQueue: string;
  serviceName: string;
  stopSignal: AbortSignal;
  workflowClient: WorkflowClient;
}) {
  while (!input.stopSignal.aborted) {
    try {
      const startedWork = await claimAndStartPendingScan({
        logger: input.logger,
        logContext: input.logContext,
        repository: input.repository,
        scanTaskQueue: input.scanTaskQueue,
        serviceName: input.serviceName,
        workflowClient: input.workflowClient,
      });
      input.healthState.lastError = undefined;
      if (!startedWork) {
        await sleep(input.pollIntervalMs);
      }
    } catch (error) {
      input.healthState.lastError = error instanceof Error ? error.message : "Unknown claim-loop failure.";
      input.logger.error(JSON.stringify(createStructuredErrorFields({
        ...input.logContext,
      }, error, {
        event: "scan.claim_loop.failed",
      })));
      await sleep(input.pollIntervalMs);
    }
  }
}

export async function startScanWorker(input: {
  environment?: NodeJS.ProcessEnv;
  logger?: LoggerLike;
}) {
  const environment = input.environment ?? process.env;
  const logger = input.logger ?? console;
  const serviceIdentity = loadServiceIdentityConfig(environment, { serviceName: "scan-worker-temporal" });
  const observability = loadObservabilityConfig(environment);
  const telemetryBootstrap = createTelemetryBootstrap({
    environment: serviceIdentity.environment,
    release: serviceIdentity.release,
    sentryDsn: observability.sentryDsn,
    sentryTracesSampleRate: observability.sentryTracesSampleRate,
    serviceName: serviceIdentity.serviceName,
  });
  const logContext = {
    environment: telemetryBootstrap.environment,
    release: telemetryBootstrap.release,
    serviceName: telemetryBootstrap.serviceName,
  };
  const botApiConfig = loadBotApiConfig(environment);
  const botTokenConfig = loadBotTokenConfig(environment);
  const dataPlaneConfig = loadDataPlaneConfig(environment);
  const temporalConfig = loadTemporalWorkerConfig(environment);
  const healthState: HealthState = {
    ready: false,
  };

  logger.info(JSON.stringify(createStructuredLogFields(logContext, {
    event: "scan.worker.booting",
    temporal: summarizeConfigForLogs(temporalConfig),
  })));

  const repository = createPostgresGuildScanRequestRepository({
    connectionString: dataPlaneConfig.postgresUrl,
  });
  const rest = new REST({ version: "10" }).setToken(botTokenConfig.botToken);
  const apiClient = createScanWorkerApiClient({
    apiBaseUrl: botApiConfig.apiBaseUrl,
  });
  const messageRuntime = createDiscordRestWarningRuntime(rest);
  const connection = await NativeConnection.connect({
    address: temporalConfig.address,
  });
  const workflowClient = new WorkflowClient({
    connection,
    namespace: temporalConfig.namespace,
  });
  const worker = await Worker.create({
    activities: createScanActivities({
      actorService: serviceIdentity.serviceName,
      apiClient,
      messageRuntime,
      repository,
      rest,
    }),
    connection,
    namespace: temporalConfig.namespace,
    taskQueue: temporalConfig.scanTaskQueue,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
  });

  const abortController = new AbortController();
  const healthServer = await startHealthServer(temporalConfig.healthPort, healthState);

  healthState.ready = true;
  const claimLoop = runClaimLoop({
    healthState,
    logger,
    logContext,
    pollIntervalMs: temporalConfig.pollIntervalMs,
    repository,
    scanTaskQueue: temporalConfig.scanTaskQueue,
    serviceName: serviceIdentity.serviceName,
    stopSignal: abortController.signal,
    workflowClient,
  });
  const workerRunPromise = worker.run();

  const stop = async () => {
    if (abortController.signal.aborted) {
      return;
    }

    abortController.abort();
    healthState.ready = false;
    worker.shutdown();
    await Promise.allSettled([
      claimLoop,
      workerRunPromise,
      new Promise<void>((resolve, reject) => healthServer.close((error) => (error ? reject(error) : resolve()))),
      repository.close(),
    ]);
  };

  return {
    stop,
  };
}

async function main() {
  const runtime = await startScanWorker({});
  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(JSON.stringify(createStructuredErrorFields({
      environment: process.env.HUMANIFY_ENVIRONMENT ?? "development",
      release: process.env.HUMANIFY_RELEASE,
      serviceName: "scan-worker-temporal",
    }, error, {
      event: "scan.worker.startup_failed",
    })));
    process.exit(1);
  });
}
