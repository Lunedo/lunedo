import {
  ConfigError,
  createDatabasePool,
  createLogger,
  readServiceConfig,
  registerShutdown,
  type ServiceConfig,
} from "@pagehall/shared/node";
import { createWorker } from "./worker.js";

let config: ServiceConfig;
try {
  config = readServiceConfig(process.env, "PAGEHALL_WORKER_PORT", 3002);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  createLogger({ service: "worker", level: "info" }).fatal(error.message);
  process.exit(1);
}

const logger = createLogger({ service: "worker", level: config.logLevel });
const pool = createDatabasePool({ connectionString: config.databaseUrl, applicationName: "pagehall-worker" });
const worker = createWorker({ config, logger, pool });

const address = await worker.start();
logger.info({ port: address.port }, "Worker listening");

registerShutdown(logger, async () => {
  await worker.stop();
  await pool.end();
});
