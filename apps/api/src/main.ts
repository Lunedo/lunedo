import "reflect-metadata";
import cluster from "node:cluster";
import {
  aggregateClusterMetrics,
  applyConfiguredSetup,
  ConfigError,
  createLogger,
  createServerRuntime,
  instanceUrlSetting,
  loadConfig,
  registerShutdown,
  runApiCluster,
  StartupError,
  waitForTurnToListen,
} from "@lunedo/server";
import { createApp } from "./app.js";
import { apiContextOf } from "./context.js";
import { attachCollabProxy } from "./http/collab-proxy.js";

type Runtime = Awaited<ReturnType<typeof createServerRuntime>>;

function fail(error: unknown): never {
  if (!(error instanceof ConfigError) && !(error instanceof StartupError)) throw error;
  createLogger({ service: "api", level: "info" }).fatal(error.message);
  process.exit(error instanceof ConfigError ? 78 : 1);
}

async function prepare(runtime: Runtime): Promise<void> {
  const { config, services, settings, logger } = runtime;
  if (config.setup) {
    await applyConfiguredSetup({
      setup: config.setup,
      service: services.setup,
      accounts: services.accounts,
      settings,
      mail: services.mail,
      organizations: services.organizations,
      logger,
    });
  }
  await services.setup.issueCode(logger, {
    configuredCode: config.setupCode,
    instanceUrl: (await settings.get(instanceUrlSetting, {})) || config.instanceUrl,
  });
}

async function serve() {
  let runtime: Runtime;
  try {
    runtime = await createServerRuntime({ role: "api", env: process.env });
    if (cluster.isWorker) runtime.metrics.shareWithCluster();
    if (!cluster.isWorker || cluster.worker?.id === 1) await prepare(runtime);
  } catch (error) {
    fail(error);
  }

  const { config, logger } = runtime;
  const app = await createApp(apiContextOf(runtime));
  attachCollabProxy(app.getHttpServer(), {
    upstream: config.collabUpstream,
    trustedProxies: config.trustedProxies,
    logger,
  });
  if (cluster.isWorker) await waitForTurnToListen();
  await app.listen({ port: config.ports.api, host: config.host });
  logger.info({ port: config.ports.api }, "API listening");
  registerShutdown(
    logger,
    async () => {
      await app.close();
      await runtime.close();
    },
    { timeoutSeconds: config.shutdownTimeoutSeconds },
  );
}

async function main() {
  if (cluster.isWorker) return serve();
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    fail(error);
  }
  if (config.apiProcesses <= 1) return serve();
  aggregateClusterMetrics();
  runApiCluster({
    processes: config.apiProcesses,
    fork: () => cluster.fork(),
    logger: createLogger({ service: "api", level: config.logLevel }),
    timeoutSeconds: config.shutdownTimeoutSeconds,
  });
}

await main();
