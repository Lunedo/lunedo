import { describe, expect, it } from "vitest";
import { Secret } from "../config/secret.js";
import { createLogger } from "../logging/logger.js";
import { RenderError, RenderService } from "./rendering.js";

const logger = createLogger({ service: "test", level: "silent" });
const TOKEN = "s".repeat(40);
const INFO = {
  version: "1.0.0",
  browser: "Chromium 140",
  concurrency: 2,
  running: 1,
  waiting: 0,
  maxBytes: 1000,
  timeoutSeconds: 30,
};

function service(handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response) {
  const requests: { url: string; authorization: string | null }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return handler(String(input), init);
  }) as typeof fetch;
  return {
    requests,
    render: new RenderService({
      connection: { url: "http://render:3000", token: new Secret(TOKEN) },
      logger,
      fetch: fetcher,
    }),
  };
}

describe("render service client", () => {
  it("is not configured without a connection", async () => {
    const render = new RenderService({ connection: undefined, logger });
    expect(render.configured).toBe(false);
    expect(await render.status()).toEqual({ state: "notConfigured" });
    await expect(render.pdf("<p>x</p>", [], "https://wiki.example.org")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("reports a healthy container with its version and jobs", async () => {
    const { render, requests } = service(() => Response.json(INFO));
    const status = await render.status();
    expect(status).toMatchObject({ state: "healthy", url: "http://render:3000", ...INFO });
    expect(requests[0]).toEqual({ url: "http://render:3000/v1/info", authorization: `Bearer ${TOKEN}` });
  });

  it("tells a wrong token, an unreachable container and a wrong answer apart", async () => {
    expect(await service(() => new Response(null, { status: 401 })).render.status()).toMatchObject({
      state: "unreachable",
      reason: "token",
    });
    expect(
      await service(() => {
        throw new TypeError("fetch failed");
      }).render.status(),
    ).toMatchObject({ state: "unreachable", reason: "connection" });
    expect(await service(() => Response.json({ hello: "world" })).render.status()).toMatchObject({
      state: "unreachable",
      reason: "response",
    });
  });

  it("sends the document with its assets and base address and returns the PDF", async () => {
    let sent: { html: string; baseUrl: string | null; assets: unknown[] } | null = null;
    const { render } = service((url, init) => {
      if (url.endsWith("/v1/info")) return Response.json(INFO);
      sent = JSON.parse(String(init?.body));
      return new Response("%PDF-1.7 ok");
    });
    const pdf = await render.pdf(
      "<p>Hi</p>",
      [{ path: "/api/v1/attachments/a/content", contentType: "image/png", data: Buffer.from("png") }],
      "https://wiki.example.org/some/path",
    );
    expect(pdf.toString("latin1")).toBe("%PDF-1.7 ok");
    expect(sent).toEqual({
      html: "<p>Hi</p>",
      baseUrl: "https://wiki.example.org",
      assets: [{ path: "/api/v1/attachments/a/content", contentType: "image/png", data: "cG5n" }],
    });
  });

  it("refuses a document above the container's limit before sending it", async () => {
    const { render, requests } = service(() => Response.json(INFO));
    await expect(render.pdf("x".repeat(2000), [], "")).rejects.toMatchObject({ reason: "tooLarge" });
    expect(requests.map((request) => request.url)).toEqual(["http://render:3000/v1/info"]);
  });

  it("maps the answers of the container to reasons", async () => {
    for (const [status, reason] of [
      [413, "tooLarge"],
      [503, "busy"],
      [504, "timeout"],
      [401, "unavailable"],
      [500, "failed"],
    ] as const) {
      const { render } = service((url) =>
        url.endsWith("/v1/info") ? Response.json(INFO) : new Response(null, { status }),
      );
      const error = await render.pdf("<p>x</p>", [], "").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RenderError);
      expect(error).toMatchObject({ reason });
    }
    const { render } = service((url) =>
      url.endsWith("/v1/info") ? Response.json(INFO) : new Response("<html>"),
    );
    await expect(render.pdf("<p>x</p>", [], "")).rejects.toMatchObject({ reason: "failed" });
  });
});
