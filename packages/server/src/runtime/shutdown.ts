import type { Logger } from "../logging/logger.js";

/**
 * Time added to the shutdown timeout before the process is ended forcibly. It covers the work
 * after the timeout: the job queue hands unfinished jobs back and connections close.
 * Orchestrators need a stop grace period of at least the timeout plus this margin.
 */
export const SHUTDOWN_MARGIN_SECONDS = 10;

export interface ShutdownOptions {
  /** `PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS`: how long running work may take to finish. */
  timeoutSeconds: number;
  marginSeconds?: number;
  signals?: Pick<NodeJS.Process, "once">;
  exit?: (code: number) => void;
}

/**
 * Closes resources once on SIGTERM or SIGINT and exits afterwards. The process is ended
 * forcibly only when closing takes longer than the timeout plus the margin.
 */
export function registerShutdown(logger: Logger, close: () => Promise<void>, options: ShutdownOptions): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? process;
  const forcedAfterMs = (options.timeoutSeconds + (options.marginSeconds ?? SHUTDOWN_MARGIN_SECONDS)) * 1000;
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, timeoutSeconds: options.timeoutSeconds }, "Shutting down");
    const forced = setTimeout(() => {
      logger.error({ afterSeconds: forcedAfterMs / 1000 }, "Shutdown timed out");
      exit(1);
    }, forcedAfterMs);
    forced.unref();
    close().then(
      () => {
        clearTimeout(forced);
        exit(0);
      },
      (error: unknown) => {
        clearTimeout(forced);
        logger.error({ err: error }, "Shutdown failed");
        exit(1);
      },
    );
  };
  signals.once("SIGTERM", shutdown);
  signals.once("SIGINT", shutdown);
}
