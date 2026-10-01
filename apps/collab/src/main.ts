import {
  ConfigError,
  createLogger,
  createServerRuntime,
  registerShutdown,
  StartupError,
} from "@pagehall/server";
import { createCollabServer } from "./server.js";

let runtime: Awaited<ReturnType<typeof createServerRuntime>>;
try {
  runtime = await createServerRuntime({ role: "collab", env: process.env });
} catch (error) {
  if (!(error instanceof ConfigError) && !(error instanceof StartupError)) throw error;
  createLogger({ service: "collab", level: "info" }).fatal(error.message);
  process.exit(error instanceof ConfigError ? 78 : 1);
}

const { config, logger } = runtime;
const server = createCollabServer({
  host: config.host,
  port: config.ports.collab,
  endpoints: {
    ready: runtime.readiness,
    logger,
    metrics: runtime.metrics,
    metricsToken: runtime.metricsToken.reveal(),
  },
});

await server.listen();
logger.info({ port: server.address.port }, "Collaboration server listening");

registerShutdown(
  logger,
  async () => {
    await server.destroy();
    await runtime.close();
  },
  { timeoutSeconds: config.shutdownTimeoutSeconds },
);
