import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../observability/request-context.js";
import { createLogger } from "./logger.js";

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
});
