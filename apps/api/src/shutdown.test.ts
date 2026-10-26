import { describe, expect, it } from "vitest";
import { createTestApp } from "./testing/create-test-app.js";

describe("shutdown of the API", () => {
  it("leaves SIGTERM and SIGINT to the process shutdown, so a restart ends with exit code 0", async () => {
    const before = { term: process.listenerCount("SIGTERM"), int: process.listenerCount("SIGINT") };
    const app = await createTestApp();
    try {
      expect(process.listenerCount("SIGTERM")).toBe(before.term);
      expect(process.listenerCount("SIGINT")).toBe(before.int);
    } finally {
      await app.close();
    }
  });
});
