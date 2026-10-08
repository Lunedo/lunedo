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
    const warning = vi.spyOn(process, "emitWarning");
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
    expect(warning.mock.calls.map(([message]) => String(message))).not.toContainEqual(
      expect.stringContaining("already executing a query"),
    );

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
