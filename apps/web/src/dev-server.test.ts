import { describe, expect, it } from "vitest";
import config from "../vite.config.js";

describe("the development server", () => {
  it("forwards API requests with the browser's host so the origin check matches", () => {
    expect(config.server?.proxy?.["/api"]).toMatchObject({ changeOrigin: false });
  });
});
