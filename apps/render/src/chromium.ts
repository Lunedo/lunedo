import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, type BrowserContext, chromium } from "playwright-core";
import type { Renderer, RenderJob } from "./server.js";

export const RENDER_ORIGIN = "https://render.invalid";

export function viewerContentSecurityPolicy(assetOrigin: string | null): string {
  const images = assetOrigin ? ` ${assetOrigin}` : "";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${images}`,
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const BROWSER_ARGUMENTS = [
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-sync",
  "--no-pings",
  "--disable-features=Translate,MediaRouter,OptimizationHints",
];

export interface ChromiumOptions {
  executablePath: string | undefined;
  viewerDirectory: string;
  sandbox: boolean;
  onBlocked?: (url: string) => void;
}

interface PrintWindow {
  lunedoPrint?: { render(html: string, options?: { baseUrl?: string }): Promise<{ pages: number }> };
}

export class ChromiumRenderer implements Renderer {
  readonly #options: ChromiumOptions;
  #browser: Promise<Browser> | null = null;
  browser = "Chromium";

  constructor(options: ChromiumOptions) {
    this.#options = options;
  }

  async #launch(): Promise<Browser> {
    if (!this.#browser) {
      this.#browser = chromium
        .launch({
          executablePath: this.#options.executablePath,
          args: BROWSER_ARGUMENTS,
          chromiumSandbox: this.#options.sandbox,
        })
        .then((browser) => {
          this.browser = `Chromium ${browser.version()}`;
          browser.on("disconnected", () => {
            this.#browser = null;
          });
          return browser;
        });
      this.#browser.catch(() => {
        this.#browser = null;
      });
    }
    return this.#browser;
  }

  async start(): Promise<void> {
    await this.#launch();
  }

  async close(): Promise<void> {
    const browser = await this.#browser?.catch(() => null);
    await browser?.close();
  }

  async #viewerFile(pathname: string): Promise<{ body: Buffer; contentType: string } | null> {
    const relative = pathname === "/print.html" ? "print.html" : pathname.slice(1);
    if (!/^(print\.html|assets\/[\w.-]+)$/.test(relative)) return null;
    const file = path.join(this.#options.viewerDirectory, relative);
    try {
      return {
        body: await readFile(file),
        contentType: TYPES[path.extname(file)] ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  async pdf(job: RenderJob, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    const browser = await this.#launch();
    signal.throwIfAborted();
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      javaScriptEnabled: true,
      bypassCSP: false,
      viewport: { width: 1200, height: 1600 },
    });
    let abort = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        context.close().catch(() => {});
        reject(signal.reason);
      };
    });
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await Promise.race([this.#print(context, job), stopped]);
    } finally {
      signal.removeEventListener("abort", abort);
      await context.close().catch(() => {});
    }
  }

  async #print(context: BrowserContext, job: RenderJob): Promise<Buffer> {
    await context.routeWebSocket(/.*/, (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const asset = url.origin === (job.baseUrl ?? RENDER_ORIGIN) ? job.assets.get(url.pathname) : undefined;
      if (asset) {
        await route.fulfill({ status: 200, contentType: asset.contentType, body: asset.data });
        return;
      }
      if (url.origin === RENDER_ORIGIN) {
        const file = await this.#viewerFile(url.pathname);
        if (file) {
          await route.fulfill({
            status: 200,
            contentType: file.contentType,
            body: file.body,
            headers:
              url.pathname === "/print.html"
                ? { "content-security-policy": viewerContentSecurityPolicy(job.baseUrl) }
                : {},
          });
          return;
        }
      }
      if (url.protocol === "data:" || url.protocol === "blob:") {
        await route.continue();
        return;
      }
      this.#options.onBlocked?.(`${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(`${RENDER_ORIGIN}/print.html`, { waitUntil: "load" });
    await page.waitForFunction(() => (globalThis as PrintWindow).lunedoPrint !== undefined);
    await page.evaluate(
      async ({ html, baseUrl }) => {
        const viewer = (globalThis as PrintWindow).lunedoPrint;
        if (!viewer) throw new Error("The print viewer did not start");
        await viewer.render(html, baseUrl ? { baseUrl } : {});
      },
      { html: job.html, baseUrl: job.baseUrl },
    );
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  }
}
