import type { Logger } from "../logging/logger.js";
import { SHUTDOWN_MARGIN_SECONDS } from "./shutdown.js";

export interface ClusterProcess {
  readonly id: number;
  on(event: "listening", listener: () => void): unknown;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: string): void;
}

export interface ApiClusterOptions {
  processes: number;
  fork: () => ClusterProcess;
  logger: Logger;
  timeoutSeconds: number;
  exit?: (code: number) => void;
  signals?: { once(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown };
}

export function runApiCluster(options: ApiClusterOptions): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? process;
  const running = new Set<ClusterProcess>();
  let stopping = false;
  let exitCode = 0;

  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    const forced = setTimeout(
      () => {
        options.logger.error("API processes did not stop in time");
        exit(1);
      },
      (options.timeoutSeconds + SHUTDOWN_MARGIN_SECONDS) * 1000,
    );
    forced.unref();
    if (running.size === 0) exit(exitCode);
    for (const child of running) child.kill("SIGTERM");
  };

  const start = (onListening?: () => void) => {
    const child = options.fork();
    running.add(child);
    child.on("listening", () => onListening?.());
    child.on("exit", (code, signal) => {
      running.delete(child);
      if (stopping) {
        if (running.size === 0) exit(exitCode);
        return;
      }
      const failed = code !== 0;
      options.logger[failed ? "error" : "info"](
        { process: child.id, code, signal },
        "An API process stopped; stopping the others",
      );
      stop(failed ? code || 1 : 0);
    });
  };

  const shutdown = (signal: NodeJS.Signals) => {
    options.logger.info({ signal, processes: running.size }, "Shutting down the API processes");
    stop(0);
  };
  signals.once("SIGTERM", shutdown);
  signals.once("SIGINT", shutdown);

  start(() => {
    if (stopping) return;
    for (let index = 1; index < options.processes; index++) start();
    options.logger.info({ processes: options.processes }, "API processes started");
  });
}
