import "reflect-metadata";
import { ConfigError, createLogger, registerShutdown } from "@pagehall/shared/node";
import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";

async function main() {
  let config: ReturnType<typeof readApiConfig>;
  try {
    config = readApiConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ service: "api", level: "info" }).fatal(error.message);
    process.exit(1);
  }

  const logger = createLogger({ service: "api", level: config.logLevel });
  const app = await createApp(config, logger);
  await app.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port }, "API listening");
  registerShutdown(logger, () => app.close());
}

await main();
