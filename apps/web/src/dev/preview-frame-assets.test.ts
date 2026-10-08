import { describe, expect, it } from "vitest";
import { isPreviewFrameAsset } from "./preview-frame-assets.js";

describe("scripts for the sandboxed preview frame on the development server", () => {
  it("lets the frame load client modules", () => {
    expect(isPreviewFrameAsset("GET", "/src/preview/main.ts", "null")).toBe(true);
    expect(isPreviewFrameAsset("GET", "/node_modules/.vite/deps/pdfjs-dist.js?v=1", "null")).toBe(true);
    expect(isPreviewFrameAsset("HEAD", "/@vite/client", "null")).toBe(true);
  });

  it("never opens the proxied server paths or other methods and origins", () => {
    for (const url of [
      "/api/v1/auth/session",
      "/API/v1/people",
      "/src/../api/v1/people",
      "/scim/v2/Users",
      "/collab",
      "/health/live",
    ]) {
      expect(isPreviewFrameAsset("GET", url, "null")).toBe(false);
    }
    expect(isPreviewFrameAsset("POST", "/src/preview/main.ts", "null")).toBe(false);
    expect(isPreviewFrameAsset("GET", "/src/preview/main.ts", "https://attacker.example")).toBe(false);
    expect(isPreviewFrameAsset("GET", "/src/preview/main.ts", undefined)).toBe(false);
  });
});
