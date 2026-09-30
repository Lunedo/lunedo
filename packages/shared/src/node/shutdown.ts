import type { Logger } from "./logger.js";

const FORCED_EXIT_AFTER_MS = 10_000;

/** Closes resources once on SIGTERM or SIGINT and exits the process afterwards. */
export function registerShutdown(logger: Logger, close: () => Promise<void>): void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    setTimeout(() => {
      logger.error("Shutdown timed out");
      process.exit(1);
    }, FORCED_EXIT_AFTER_MS).unref();
    close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "Shutdown failed");
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
