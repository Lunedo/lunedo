import {
  ConfigError,
  createDatabasePool,
  createLogger,
  readServiceConfig,
  registerShutdown,
  type ServiceConfig,
} from "@pagehall/shared/node";
import { createCollabServer } from "./server.js";

let config: ServiceConfig;
try {
  config = readServiceConfig(process.env, "PAGEHALL_COLLAB_PORT", 3001);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  createLogger({ service: "collab", level: "info" }).fatal(error.message);
  process.exit(1);
}

const logger = createLogger({ service: "collab", level: config.logLevel });
const pool = createDatabasePool({ connectionString: config.databaseUrl, applicationName: "pagehall-collab" });
const server = createCollabServer({ config, logger, pool });

await server.listen();
logger.info({ port: server.address.port }, "Collaboration server listening");

registerShutdown(logger, async () => {
  await server.destroy();
  await pool.end();
});
