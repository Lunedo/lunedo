import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logging/logger.js";
import {
  type ClusterProcess,
  LISTEN_MESSAGE,
  PREPARED_MESSAGE,
  runApiCluster,
  waitForTurnToListen,
} from "./api-cluster.js";

class FakeProcess extends EventEmitter implements ClusterProcess {
  readonly signals: string[] = [];
  readonly received: unknown[] = [];

  constructor(readonly id: number) {
    super();
  }

  kill(signal = "SIGTERM"): void {
    this.signals.push(signal);
  }

  send(message: unknown): void {
    this.received.push(message);
    if (message === LISTEN_MESSAGE) this.emit("listening");
  }

  prepare(): void {
    this.emit("message", PREPARED_MESSAGE);
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

function allListening(processes: number) {
  const running = cluster(processes);
  for (const child of [...running.started]) child.prepare();
  return running;
}

describe("API processes", () => {
  it("starts the others only after the first one is prepared, so setup runs once before them", () => {
    const { started } = cluster(4);
    expect(started).toHaveLength(1);
    started[0]?.prepare();
    expect(started.map((child) => child.id)).toEqual([1, 2, 3, 4]);
  });

  it("lets no process take requests before every process is prepared", () => {
    const { started } = cluster(3);
    started[0]?.prepare();
    started[1]?.prepare();
    expect(started.map((child) => child.received)).toEqual([[], [], []]);
    started[2]?.prepare();
    expect(started.map((child) => child.received)).toEqual([
      [LISTEN_MESSAGE],
      [LISTEN_MESSAGE],
      [LISTEN_MESSAGE],
    ]);
  });

  it("ignores other messages of a process", () => {
    const { started } = cluster(2);
    started[0]?.emit("message", "something else");
    expect(started).toHaveLength(1);
  });

  it("stops all processes and exits with the code of a process that stopped on its own", () => {
    const { started, exit } = allListening(3);
    started[1]?.stop(78);
    expect(started[0]?.signals).toEqual(["SIGTERM"]);
    expect(started[2]?.signals).toEqual(["SIGTERM"]);
    expect(exit).not.toHaveBeenCalled();
    started[0]?.stop(0);
    started[2]?.stop(0);
    expect(exit).toHaveBeenCalledWith(78);
  });

  it("exits cleanly when a process stops cleanly on its own, as after a restore", () => {
    const { started, exit } = allListening(3);
    started[2]?.stop(0);
    expect(started[0]?.signals).toEqual(["SIGTERM"]);
    expect(started[1]?.signals).toEqual(["SIGTERM"]);
    started[0]?.stop(0);
    started[1]?.stop(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits with an error and lets no process listen when one fails while the others prepare", () => {
    const { started, exit } = cluster(3);
    started[0]?.prepare();
    started[1]?.prepare();
    started[2]?.stop(1);
    started[2]?.prepare();
    expect(started.map((child) => child.received)).toEqual([[], [], []]);
    started[0]?.stop(null, "SIGTERM");
    started[1]?.stop(null, "SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits with an error when the first process fails before it is prepared", () => {
    const { started, exit } = cluster(4);
    started[0]?.stop(null, "SIGKILL");
    expect(started).toHaveLength(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("passes a shutdown signal to every process and exits once all have stopped", () => {
    const { started, signals, exit } = allListening(2);
    signals.emit("SIGTERM", "SIGTERM");
    expect(started.map((child) => child.signals)).toEqual([["SIGTERM"], ["SIGTERM"]]);
    started[0]?.stop(0);
    expect(exit).not.toHaveBeenCalled();
    started[1]?.stop(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("starts no further processes when a shutdown arrives before the first one is prepared", () => {
    const { started, signals, exit } = cluster(4);
    signals.emit("SIGINT", "SIGINT");
    started[0]?.prepare();
    expect(started).toHaveLength(1);
    started[0]?.stop(0);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("a single API process", () => {
  it("reports that it is prepared and listens only when the primary process says so", async () => {
    const channel = new EventEmitter() as EventEmitter & { send: (message: unknown) => void };
    const sent: unknown[] = [];
    channel.send = (message) => sent.push(message);
    let turn = false;
    const waiting = waitForTurnToListen(channel).then(() => {
      turn = true;
    });
    expect(sent).toEqual([PREPARED_MESSAGE]);
    channel.emit("message", "something else");
    await Promise.resolve();
    expect(turn).toBe(false);
    channel.emit("message", LISTEN_MESSAGE);
    await waiting;
    expect(turn).toBe(true);
    expect(channel.listenerCount("message")).toBe(0);
  });

  it("listens at once when it runs without a primary process", async () => {
    const channel = new EventEmitter();
    await expect(waitForTurnToListen(channel)).resolves.toBeUndefined();
  });
});
