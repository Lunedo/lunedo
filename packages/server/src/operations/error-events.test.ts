import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createMigratedDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import {
  ErrorEvents,
  MAX_ERROR_TYPES_PER_FLUSH,
  recentErrorTypes,
  removeOldErrorEvents,
} from "./error-events.js";

const baseUrl = testDatabaseBaseUrl();
let temporary: TemporaryDatabase;
let pool: DatabasePool;
let database: Database;

beforeAll(async () => {
  if (!baseUrl) return;
  temporary = await createMigratedDatabase(baseUrl, "lunedo_error_events_test");
  pool = createDatabasePool({ connectionString: temporary.url, applicationName: "lunedo-test" });
  database = createDatabase(pool);
});

afterAll(async () => {
  if (!baseUrl) return;
  await pool.end();
  await temporary.drop();
});

beforeEach(async () => {
  if (!baseUrl) return;
  await pool.query("delete from operations_error_events");
});

const at = (iso: string) => () => new Date(iso);

describe.skipIf(!baseUrl)("ErrorEvents", () => {
  it("counts events by type and code and adds up flushes from several processes", async () => {
    const api = new ErrorEvents({ service: "api", now: at("2026-10-21T08:10:00Z") });
    const worker = new ErrorEvents({ service: "worker", now: at("2026-10-21T08:20:00Z") });
    api.record({ type: "Request failed", code: "ECONNRESET" });
    api.record({ type: "Request failed", code: "ECONNRESET" });
    api.record({ type: "Request failed", code: null });
    worker.record({ type: "Request failed", code: "ECONNRESET" });
    expect(await api.flush(database)).toBe(2);
    expect(await worker.flush(database)).toBe(1);
    api.record({ type: "Request failed", code: "ECONNRESET" });
    await api.flush(database);

    const recent = await recentErrorTypes(database, { since: new Date("2026-10-21T00:00:00Z"), limit: 10 });
    expect(recent).toEqual([
      {
        type: "Request failed",
        code: "ECONNRESET",
        services: ["api", "worker"],
        count: 4,
        lastAt: new Date("2026-10-21T08:20:00Z"),
      },
      {
        type: "Request failed",
        code: null,
        services: ["api"],
        count: 1,
        lastAt: new Date("2026-10-21T08:10:00Z"),
      },
    ]);
  });

  it("keeps counts that could not be stored for the next flush", async () => {
    const events = new ErrorEvents({ service: "api", now: at("2026-10-21T08:10:00Z") });
    events.record({ type: "Job queue error", code: null });
    const broken = {
      execute: async () => {
        throw new Error("down");
      },
    } as unknown as Database;
    await expect(events.flush(broken)).rejects.toThrow("down");
    events.record({ type: "Job queue error", code: null });
    await events.flush(database);
    const [entry] = await recentErrorTypes(database, { since: new Date("2026-10-21T00:00:00Z"), limit: 10 });
    expect(entry?.count).toBe(2);
  });

  it("holds a bounded number of types between flushes but still notifies listeners", async () => {
    const events = new ErrorEvents({ service: "api", now: at("2026-10-21T08:10:00Z") });
    let notified = 0;
    events.onRecord(() => {
      notified += 1;
    });
    for (let index = 0; index <= MAX_ERROR_TYPES_PER_FLUSH; index += 1) {
      events.record({ type: "Request failed", code: `CODE_${index}` });
    }
    expect(await events.flush(database)).toBe(MAX_ERROR_TYPES_PER_FLUSH);
    expect(notified).toBe(MAX_ERROR_TYPES_PER_FLUSH + 1);
  });

  it("lists only events since the given time and removes counts older than seven days", async () => {
    const old = new ErrorEvents({ service: "api", now: at("2026-10-10T08:00:00Z") });
    old.record({ type: "Request failed", code: null });
    await old.flush(database);
    const recent = new ErrorEvents({ service: "api", now: at("2026-10-21T07:00:00Z") });
    recent.record({ type: "Copy failed", code: null });
    await recent.flush(database);

    const since = await recentErrorTypes(database, { since: new Date("2026-10-20T08:00:00Z"), limit: 10 });
    expect(since.map((entry) => entry.type)).toEqual(["Copy failed"]);
    expect(await removeOldErrorEvents(database, new Date("2026-10-21T08:00:00Z"))).toBe(1);
    const all = await recentErrorTypes(database, { since: new Date("2026-01-01T00:00:00Z"), limit: 10 });
    expect(all.map((entry) => entry.type)).toEqual(["Copy failed"]);
  });
});
