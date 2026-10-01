import "reflect-metadata";
import { ConfigError, createLogger, createServerRuntime, registerShutdown } from "@pagehall/server";
import { createApp } from "./app.js";
import { apiContextOf } from "./context.js";

async function main() {
  let runtime: Awaited<ReturnType<typeof createServerRuntime>>;
  try {
    runtime = await createServerRuntime({ role: "api", env: process.env });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ service: "api", level: "info" }).fatal(error.message);
    process.exit(78);
  }

  const { config, logger } = runtime;
  const app = await createApp(apiContextOf(runtime));
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

await main();
