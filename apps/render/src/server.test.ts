import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadRenderConfig, RenderConfigError, sandboxWarning } from "./config.js";
import { createRenderServer, type Renderer, type RenderJob, type RenderServerOptions } from "./server.js";

const TOKEN = "a".repeat(40);
const PDF = Buffer.from("%PDF-1.7 fake");

const servers: { close(): void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function fakeRenderer(
  work: (job: RenderJob, signal: AbortSignal) => Promise<Buffer> = async () => PDF,
): Renderer & {
  jobs: RenderJob[];
} {
  const jobs: RenderJob[] = [];
  return {
    browser: "Fake 1.0",
    jobs,
    pdf: (job, signal) => {
      jobs.push(job);
      return work(job, signal);
    },
  };
}

async function start(renderer: Renderer, options: Partial<RenderServerOptions> = {}): Promise<string> {
  const server = createRenderServer({
    token: TOKEN,
    version: "1.2.3",
    renderer,
    concurrency: 1,
    maxWaiting: 1,
    maxBytes: 1024,
    timeoutSeconds: 5,
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(url: string, body: unknown, token = TOKEN): Promise<Response> {
  return fetch(`${url}/v1/pdf`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const job = { html: "<!doctype html><p>Hello</p>", assets: [] };

describe("render service", () => {
  it("answers the health check without a token", async () => {
    const url = await start(fakeRenderer());
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("refuses requests without the right token", async () => {
    const renderer = fakeRenderer();
    const url = await start(renderer);
    expect((await fetch(`${url}/v1/info`)).status).toBe(401);
    expect((await post(url, job, "b".repeat(40))).status).toBe(401);
    expect((await post(url, job, `${TOKEN}x`)).status).toBe(401);
    expect(renderer.jobs).toHaveLength(0);
  });

  it("describes itself with the token", async () => {
    const url = await start(fakeRenderer(), { concurrency: 2, maxBytes: 2048, timeoutSeconds: 60 });
    const response = await fetch(`${url}/v1/info`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(await response.json()).toEqual({
      version: "1.2.3",
      browser: "Fake 1.0",
      concurrency: 2,
      running: 0,
      waiting: 0,
      maxBytes: 2048,
      timeoutSeconds: 60,
    });
  });

  it("turns the HTML and its assets into a PDF", async () => {
    const renderer = fakeRenderer();
    const url = await start(renderer);
    const response = await post(url, {
      html: job.html,
      assets: [{ path: "/api/v1/attachments/1/content", contentType: "image/png", data: "iVBORw==" }],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF);
    expect(renderer.jobs[0]?.assets.get("/api/v1/attachments/1/content")).toEqual({
      contentType: "image/png",
      data: Buffer.from("iVBORw==", "base64"),
    });
  });

  it("refuses documents above the size limit before rendering", async () => {
    const renderer = fakeRenderer();
    const url = await start(renderer, { maxBytes: 100 });
    const response = await post(url, { html: "x".repeat(200), assets: [] });
    expect(response.status).toBe(413);
    expect(renderer.jobs).toHaveLength(0);
  });

  it("stops a document that takes longer than the time limit", async () => {
    let aborted = false;
    const renderer = fakeRenderer(
      (_job, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("closed"));
          });
        }),
    );
    const url = await start(renderer, { timeoutSeconds: 0.2 });
    const response = await post(url, job);
    expect(response.status).toBe(504);
    expect(aborted).toBe(true);
  });

  it("answers at the time limit even when the renderer does not stop, and keeps its slot until it does", async () => {
    let finish = () => {};
    let calls = 0;
    const renderer = fakeRenderer(() => {
      calls += 1;
      return calls === 1 ? new Promise((resolve) => (finish = () => resolve(PDF))) : Promise.resolve(PDF);
    });
    const url = await start(renderer, { timeoutSeconds: 0.2, concurrency: 1, maxWaiting: 1 });
    const started = Date.now();
    const response = await post(url, job);
    expect(response.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(3_000);
    const next = post(url, job);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(1);
    finish();
    expect((await next).status).toBe(200);
    expect(calls).toBe(2);
  });

  it("runs only the configured number of documents at once and refuses more than may wait", async () => {
    const releases: (() => void)[] = [];
    let running = 0;
    let most = 0;
    const renderer = fakeRenderer(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
      return PDF;
    });
    const url = await start(renderer, { concurrency: 1, maxWaiting: 1 });
    const first = post(url, job);
    await expect.poll(() => releases.length).toBe(1);
    const second = post(url, job);
    const waiting = async () => {
      const info = await fetch(`${url}/v1/info`, { headers: { authorization: `Bearer ${TOKEN}` } });
      return ((await info.json()) as { waiting: number }).waiting;
    };
    await expect.poll(waiting).toBe(1);
    const third = await post(url, job);
    expect(third.status).toBe(503);
    releases.shift()?.();
    expect((await first).status).toBe(200);
    await expect.poll(() => releases.length).toBe(1);
    releases.shift()?.();
    expect((await second).status).toBe(200);
    expect(most).toBe(1);
  });

  it("refuses malformed requests", async () => {
    const url = await start(fakeRenderer());
    expect((await post(url, "{")).status).toBe(400);
    expect((await post(url, { html: "", assets: [] })).status).toBe(400);
    expect(
      (
        await post(url, {
          html: "x",
          assets: [{ path: "https://example.org/x", contentType: "image/png", data: "" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(url, { html: "x", assets: [{ path: "/x", contentType: "text/html; script", data: "" }] }))
        .status,
    ).toBe(400);
  });
});

describe("render configuration", () => {
  it("needs a long token and uses safe defaults", () => {
    expect(() => loadRenderConfig({ RENDER_TOKEN: "short" })).toThrow(RenderConfigError);
    const config = loadRenderConfig({ RENDER_TOKEN: TOKEN });
    expect(config).toMatchObject({
      concurrency: 2,
      maxWaiting: 20,
      timeoutSeconds: 300,
      maxBytes: 200 * 1024 * 1024,
      port: 3000,
      sandbox: true,
    });
    expect(sandboxWarning(config)).toBeNull();
    const unsandboxed = loadRenderConfig({ RENDER_TOKEN: TOKEN, RENDER_CHROMIUM_SANDBOX: "false" });
    expect(unsandboxed.sandbox).toBe(false);
    expect(sandboxWarning(unsandboxed)).toContain("without its sandbox");
    expect(() => loadRenderConfig({ RENDER_TOKEN: TOKEN, RENDER_CHROMIUM_SANDBOX: "no" })).toThrow(
      RenderConfigError,
    );
    expect(loadRenderConfig({ RENDER_TOKEN: TOKEN, RENDER_CONCURRENCY: "4" }).concurrency).toBe(4);
    expect(() => loadRenderConfig({ RENDER_TOKEN: TOKEN, RENDER_CONCURRENCY: "0" })).toThrow(
      RenderConfigError,
    );
  });
});
