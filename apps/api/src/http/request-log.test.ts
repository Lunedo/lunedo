import { Writable } from "node:stream";
import { createLogger } from "@lunedo/server";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "../testing/create-test-app.js";

describe("the request log", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("records the route instead of link and file tokens", async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = await createTestApp({ logger: createLogger({ service: "api", level: "info", destination }) });
    close = () => app.close();
    const secret = "Yk3mR0vQx8LfJ2aB7cT9wE4nU6pH1sD5gK0zV3iM8oA2qX7r";
    await app.inject({ method: "GET", url: `/api/v1/share-links/${secret}/page` });
    await app.inject({ method: "GET", url: `/api/v1/files/${secret}` });
    await app.inject({ method: "GET", url: `/s/${secret}` });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = lines.join("");
    expect(log).toContain("Request completed");
    expect(log).not.toContain(secret);
  });
});
