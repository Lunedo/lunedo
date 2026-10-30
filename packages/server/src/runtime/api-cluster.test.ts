import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logging/logger.js";
import { type ClusterProcess, runApiCluster } from "./api-cluster.js";

class FakeProcess extends EventEmitter implements ClusterProcess {
  readonly signals: string[] = [];

  constructor(readonly id: number) {
    super();
  }

  kill(signal = "SIGTERM"): void {
    this.signals.push(signal);
  }

  listen(): void {
    this.emit("listening");
  }

  stop(code: number | null, signal: string | null = null): void {
    this.emit("exit", code, signal);
  }
}

function cluster(processes: number) {
  const started: FakeProcess[] = [];
  const signals = new EventEmitter();
  const exit = vi.fn();
  runApiCluster({
    processes,
    fork: () => {
      const child = new FakeProcess(started.length + 1);
      started.push(child);
      return child;
    },
    logger: createLogger({ service: "api", level: "silent" }),
    timeoutSeconds: 1,
    exit,
    signals,
  });
  return { started, signals, exit };
}

describe("API processes", () => {
  it("starts the others only after the first one listens, so setup runs once before them", () => {
    const { started } = cluster(4);
    expect(started).toHaveLength(1);
    started[0]?.listen();
    expect(started.map((child) => child.id)).toEqual([1, 2, 3, 4]);
  });

  it("stops all processes and exits with the code of a process that stopped on its own", () => {
    const { started, exit } = cluster(3);
    started[0]?.listen();
    started[1]?.stop(78);
    expect(started[0]?.signals).toEqual(["SIGTERM"]);
    expect(started[2]?.signals).toEqual(["SIGTERM"]);
    expect(exit).not.toHaveBeenCalled();
    started[0]?.stop(0);
    started[2]?.stop(0);
    expect(exit).toHaveBeenCalledWith(78);
  });

  it("exits with an error when the first process fails before it listens", () => {
    const { started, exit } = cluster(4);
    started[0]?.stop(null, "SIGKILL");
    expect(started).toHaveLength(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("passes a shutdown signal to every process and exits once all have stopped", () => {
    const { started, signals, exit } = cluster(2);
    started[0]?.listen();
    signals.emit("SIGTERM", "SIGTERM");
    expect(started.map((child) => child.signals)).toEqual([["SIGTERM"], ["SIGTERM"]]);
    started[0]?.stop(0);
    expect(exit).not.toHaveBeenCalled();
    started[1]?.stop(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("starts no further processes when a shutdown arrives before the first one listens", () => {
    const { started, signals, exit } = cluster(4);
    signals.emit("SIGINT", "SIGINT");
    started[0]?.listen();
    expect(started).toHaveLength(1);
    started[0]?.stop(0);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
