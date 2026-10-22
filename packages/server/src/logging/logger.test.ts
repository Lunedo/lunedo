import { Writable } from "node:stream";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../observability/request-context.js";
import { createLogger, loggedErrorOf, OTHER_ERROR_TYPE } from "./logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, destination };
}

describe("createLogger", () => {
  it("writes one JSON object per line with service, level and ISO timestamp", () => {
    const { lines, destination } = capture();
    createLogger({ service: "api", level: "info", destination }).info({ port: 3000 }, "Listening");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ service: "api", level: "info", message: "Listening", port: 3000 });
    expect(String(lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts credentials", () => {
    const { lines, destination } = capture();
    const logger = createLogger({ service: "api", level: "info", destination });
    logger.info({
      password: "hunter2",
      user: { token: "abc", secret: "s3cr3t" },
      req: { headers: { authorization: "Bearer xyz", cookie: "session=1" } },
    });
    const output = JSON.stringify(lines);
    for (const secret of ["hunter2", "abc", "s3cr3t", "Bearer xyz", "session=1"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("respects the log level", () => {
    const { lines, destination } = capture();
    createLogger({ service: "api", level: "warn", destination }).info("hidden");
    expect(lines).toHaveLength(0);
  });
});

describe("request IDs", () => {
  it("are added to lines written inside a request context", () => {
    const { lines, destination } = capture();
    const logger = createLogger({ service: "worker", level: "info", destination });
    runWithRequestContext({ requestId: "req-1" }, () => logger.info("inside"));
    logger.info("outside");
    expect(lines[0]).toMatchObject({ message: "inside", requestId: "req-1" });
    expect(lines[1]).not.toHaveProperty("requestId");
  });

  it("are not duplicated when a child logger already binds one", () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({ service: "api", level: "info", destination }).child({ requestId: "req-2" });
    runWithRequestContext({ requestId: "req-2" }, () => logger.info("child"));
    expect(chunks[0]?.match(/"requestId"/g)).toHaveLength(1);
  });

  it("keeps query text and parameters of failed database queries out of the log", () => {
    const { lines, destination } = capture();
    const logger = createLogger({ service: "api", level: "info", destination });
    const cause = Object.assign(new Error("deadlock detected"), {
      code: "40P01",
      detail: "Process 12 waits for ShareLock on transaction 34",
    });
    const failed = new DrizzleQueryError(
      "insert into portal_searches (term) values ($1)",
      ["kündigung huber"],
      cause,
    );
    logger.warn({ err: failed }, "A portal search was not counted");
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain("kündigung huber");
    expect(line).not.toContain("portal_searches");
    expect(line).not.toContain("ShareLock");
    expect(lines[0]).toMatchObject({ err: { message: "Failed query", cause: { code: "40P01" } } });
  });
});

describe("error events", () => {
  it("reports error and fatal events with their fixed text and code", () => {
    const { destination } = capture();
    const events: unknown[] = [];
    const logger = createLogger({
      service: "api",
      level: "info",
      destination,
      onError: (event) => events.push(event),
    });
    logger.warn("Not counted");
    logger.error({ err: Object.assign(new Error("boom"), { code: "ECONNRESET" }) }, "Request failed");
    logger.child({ module: "jobs" }).fatal("Shutdown failed");
    expect(events).toEqual([
      { type: "Request failed", code: "ECONNRESET" },
      { type: "Shutdown failed", code: null },
    ]);
  });

  it("counts texts that could contain data as other errors", () => {
    expect(loggedErrorOf(["Import 0192f3 failed"])).toEqual({ type: OTHER_ERROR_TYPE, code: null });
    expect(loggedErrorOf([{}, "Mail to anna@example.org failed"])).toEqual({
      type: OTHER_ERROR_TYPE,
      code: null,
    });
    expect(loggedErrorOf([{}, "Cannot read /var/lib/lunedo"])).toEqual({
      type: OTHER_ERROR_TYPE,
      code: null,
    });
    expect(loggedErrorOf([{}, 'Page "Salaries" failed'])).toEqual({ type: OTHER_ERROR_TYPE, code: null });
    expect(loggedErrorOf([{ err: { code: "a b@c", name: "TypeError" } }, "Request failed"])).toEqual({
      type: "Request failed",
      code: "TypeError",
    });
    expect(loggedErrorOf([{ err: new Error("x") }])).toEqual({ type: OTHER_ERROR_TYPE, code: "Error" });
  });
});
