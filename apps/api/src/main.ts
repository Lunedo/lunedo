import "reflect-metadata";
import {
  applyConfiguredSetup,
  ConfigError,
  createLogger,
  createServerRuntime,
  instanceUrlSetting,
  registerShutdown,
  StartupError,
} from "@pagehall/server";
import { createApp } from "./app.js";
import { apiContextOf } from "./context.js";
import { attachCollabProxy } from "./http/collab-proxy.js";

async function main() {
  let runtime: Awaited<ReturnType<typeof createServerRuntime>>;
  try {
    runtime = await createServerRuntime({ role: "api", env: process.env });
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
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof StartupError)) throw error;
    createLogger({ service: "api", level: "info" }).fatal(error.message);
    process.exit(error instanceof ConfigError ? 78 : 1);
  }

  const { config, logger } = runtime;
  const app = await createApp(apiContextOf(runtime));
  attachCollabProxy(app.getHttpServer(), {
    upstream: config.collabUpstream,
    trustedProxies: config.trustedProxies,
    logger,
  });
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
