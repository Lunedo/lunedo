import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./testing/create-test-app.js";

let app: NestFastifyApplication;
let webRoot: string;

beforeAll(async () => {
  webRoot = mkdtempSync(path.join(tmpdir(), "pagehall-web-"));
  mkdirSync(path.join(webRoot, "assets"));
  writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>Pagehall</title>");
  writeFileSync(path.join(webRoot, "assets", "app-1234.js"), "console.log(1)");
  writeFileSync(path.join(webRoot, "preview.html"), "<!doctype html><title>Preview</title>");
  writeFileSync(path.join(webRoot, "print.html"), "<!doctype html><title>Print</title>");
  writeFileSync(path.join(webRoot, "diagram.html"), "<!doctype html><title>Diagram</title>");
  mkdirSync(path.join(webRoot, "drawio", "31.4.6", "js"), { recursive: true });
  writeFileSync(
    path.join(webRoot, "drawio", "31.4.6", "index.html"),
    "<!doctype html><title>draw.io</title>",
  );
  writeFileSync(path.join(webRoot, "drawio", "31.4.6", "js", "app.min.js"), "var App = {};");
  app = await createTestApp({ webRoot });
});

afterAll(async () => {
  await app.close();
  rmSync(webRoot, { recursive: true, force: true });
});

describe("web client", () => {
  it("serves the application for client-side routes", async () => {
    const response = await app.inject({ method: "GET", url: "/spaces/docs?view=tree" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("<title>Pagehall</title>");
  });

  it("serves hashed assets with long caching", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/app-1234.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("does not answer unknown API or health paths with the application", async () => {
    for (const url of ["/api/unknown", "/api", "/health/unknown"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.body).not.toContain("<title>");
    }
  });

  it("serves the preview frame in a sandbox without same-origin access", async () => {
    const response = await app.inject({ method: "GET", url: "/preview.html" });
    expect(response.statusCode).toBe(200);
    const policy = String(response.headers["content-security-policy"]);
    expect(policy).toMatch(/^sandbox allow-scripts;/);
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain("worker-src");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const asset = await app.inject({ method: "GET", url: "/assets/app-1234.js" });
    expect(asset.headers["access-control-allow-origin"]).toBe("*");
  });

  it("serves the print viewer only to its own origin and runs only its own scripts", async () => {
    const response = await app.inject({ method: "GET", url: "/print.html" });
    expect(response.statusCode).toBe(200);
    const policy = String(response.headers["content-security-policy"]);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves draw.io in a sandbox that may only reach the instance", async () => {
    const page = await app.inject({ method: "GET", url: "/drawio/31.4.6/index.html?embed=1&proto=json" });
    expect(page.statusCode).toBe(200);
    const policy = String(page.headers["content-security-policy"]);
    expect(policy).toMatch(/^sandbox allow-scripts allow-downloads;/);
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toMatch(/https?:|\*/);
    const script = await app.inject({ method: "GET", url: "/drawio/31.4.6/js/app.min.js" });
    expect(script.headers["access-control-allow-origin"]).toBe("*");
    expect(script.headers["x-content-type-options"]).toBe("nosniff");
    const missing = await app.inject({ method: "GET", url: "/drawio/31.4.6/js/missing.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain("<title>Pagehall</title>");
  });

  it("renders text diagrams in a sandbox without any network access", async () => {
    const response = await app.inject({ method: "GET", url: "/diagram.html" });
    const policy = String(response.headers["content-security-policy"]);
    expect(policy).toMatch(/^sandbox allow-scripts;/);
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("img-src data: blob:");
    expect(policy).not.toContain("allow-same-origin");
  });

  it("keeps the health endpoints", async () => {
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
  });
});
