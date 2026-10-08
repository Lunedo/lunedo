import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../logging/logger.js";
import { NotificationListener, notify } from "./notifications.js";

const url = process.env.PAGEHALL_TEST_DATABASE_URL;

describe.skipIf(!url)("notification listener", () => {
  const listeners: NotificationListener[] = [];

  afterEach(async () => {
    for (const listener of listeners.splice(0)) await listener.close();
  });

  it("subscribes to channels registered at the same moment one query at a time", async () => {
    const original = pg.Client.prototype.query;
    let running = 0;
    let most = 0;
    vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: Parameters<pg.Client["query"]>
    ) {
      running += 1;
      most = Math.max(most, running);
      const result = (original as (...input: unknown[]) => unknown).apply(this, args);
      if (result instanceof Promise) return result.finally(() => (running -= 1));
      running -= 1;
      return result;
    } as unknown as pg.Client["query"]);
    const listener = new NotificationListener({
      connectionString: url ?? "",
      logger: createLogger({ service: "test", level: "silent" }),
    });
    listeners.push(listener);
    const received: string[] = [];
    const channels = ["listener_test_first", "listener_test_second", "listener_test_third"];
    await Promise.all(
      channels.map((channel) =>
        listener.listen(channel, (payload) => received.push(`${channel}:${payload}`)),
      ),
    );
    expect(most).toBe(1);
    vi.restoreAllMocks();

    const pool = new pg.Pool({ connectionString: url ?? "" });
    try {
      for (const channel of channels) await notify(pool, channel, "ping");
    } finally {
      await pool.end();
    }
    await expect
      .poll(() => [...received].sort())
      .toEqual(channels.map((channel) => `${channel}:ping`).sort());
  });
});
