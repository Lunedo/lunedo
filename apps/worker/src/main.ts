import { ConfigError, createLogger, createServerRuntime, registerShutdown } from "@pagehall/server";
import { createOperationsServer } from "./worker.js";

let runtime: Awaited<ReturnType<typeof createServerRuntime>>;
try {
  runtime = await createServerRuntime({ role: "worker", env: process.env });
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  createLogger({ service: "worker", level: "info" }).fatal(error.message);
  process.exit(78);
}

const { config, logger } = runtime;
const server = createOperationsServer({
  host: config.host,
  port: config.ports.worker,
  endpoints: {
    ready: runtime.readiness,
    logger,
    metrics: runtime.metrics,
    metricsToken: runtime.metricsToken.reveal(),
  },
});

const address = await server.start();
logger.info({ port: address.port }, "Worker listening");

registerShutdown(logger, async () => {
  await server.stop();
  await runtime.close();
});
