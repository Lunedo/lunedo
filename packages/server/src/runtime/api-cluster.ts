import type { Logger } from "../logging/logger.js";
import { SHUTDOWN_MARGIN_SECONDS } from "./shutdown.js";

export const PREPARED_MESSAGE = "lunedo:prepared";
export const LISTEN_MESSAGE = "lunedo:listen";

export interface ClusterProcess {
  readonly id: number;
  on(event: "listening", listener: () => void): unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  send(message: unknown): unknown;
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

  const start = (onPrepared: () => void, onListening: () => void) => {
    const child = options.fork();
    running.add(child);
    child.on("message", (message) => {
      if (message === PREPARED_MESSAGE && !stopping) onPrepared();
    });
    child.on("listening", onListening);
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
    return child;
  };

  const shutdown = (signal: NodeJS.Signals) => {
    options.logger.info({ signal, processes: running.size }, "Shutting down the API processes");
    stop(0);
  };
  signals.once("SIGTERM", shutdown);
  signals.once("SIGINT", shutdown);

  const started: ClusterProcess[] = [];
  let prepared = 0;
  let listening = 0;
  const onPrepared = () => {
    prepared += 1;
    if (prepared === 1) {
      for (let index = 1; index < options.processes; index++) started.push(start(onPrepared, onListening));
    }
    if (prepared === options.processes) for (const child of started) child.send(LISTEN_MESSAGE);
  };
  const onListening = () => {
    listening += 1;
    if (listening === options.processes && !stopping) {
      options.logger.info({ processes: options.processes }, "API processes started");
    }
  };
  started.push(start(onPrepared, onListening));
}

export interface ClusterChannel {
  send?: (message: unknown) => unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
}

export function waitForTurnToListen(channel: ClusterChannel = process): Promise<void> {
  const send = channel.send;
  if (!send) return Promise.resolve();
  return new Promise((resolve) => {
    const listener = (message: unknown) => {
      if (message !== LISTEN_MESSAGE) return;
      channel.off("message", listener);
      resolve();
    };
    channel.on("message", listener);
    send.call(channel, PREPARED_MESSAGE);
  });
}
