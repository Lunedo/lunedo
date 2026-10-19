import { describe, expect, it, vi } from "vitest";

const closed = new Error("Target page, context or browser has been closed");

vi.mock("playwright-core", () => {
  const context = {
    routeWebSocket: () => new Promise(() => {}),
    close: () => Promise.reject(closed),
  };
  const browser = {
    version: () => "test",
    on: () => undefined,
    newContext: async () => context,
    close: async () => undefined,
  };
  return { chromium: { launch: async () => browser } };
});

const { ChromiumRenderer } = await import("./chromium.js");

describe("the Chromium renderer", () => {
  it("stops an aborted job with its reason, also when closing the page context fails", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const renderer = new ChromiumRenderer({
        executablePath: undefined,
        viewerDirectory: ".",
        sandbox: false,
      });
      const controller = new AbortController();
      const job = renderer.pdf({ html: "<p>x</p>", baseUrl: null, assets: new Map() }, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const timeout = new Error("timed out");
      controller.abort(timeout);
      await expect(job).rejects.toBe(timeout);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
