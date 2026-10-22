import { ChromiumRenderer } from "./chromium.js";
import { loadRenderConfig, RenderConfigError, sandboxWarning } from "./config.js";
import { createRenderServer } from "./server.js";

function log(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadRenderConfig>;
  try {
    config = loadRenderConfig(process.env);
  } catch (error) {
    if (error instanceof RenderConfigError) {
      log("error", error.message);
      process.exit(1);
    }
    throw error;
  }
  const warning = sandboxWarning(config);
  if (warning) log("warn", warning);
  const renderer = new ChromiumRenderer({
    executablePath: config.executablePath,
    viewerDirectory: config.viewerDirectory,
    sandbox: config.sandbox,
    onBlocked: (url) => log("warn", "Blocked a request of a document", { url }),
  });
  try {
    await renderer.start();
  } catch (error) {
    log("error", "Chromium did not start", {
      error: error instanceof Error ? error.message : String(error),
      hint: config.sandbox
        ? "Its sandbox needs user namespaces; see the rendering documentation, or set RENDER_CHROMIUM_SANDBOX=false to run without it."
        : undefined,
    });
    process.exit(1);
  }
  const server = createRenderServer({
    token: config.token,
    version: process.env.LUNEDO_VERSION ?? "dev",
    renderer,
    concurrency: config.concurrency,
    maxWaiting: config.maxWaiting,
    maxBytes: config.maxBytes,
    timeoutSeconds: config.timeoutSeconds,
    log: (message, fields) => log("info", message, fields),
  });
  server.listen(config.port, config.host, () => {
    log("info", "The render service is listening", {
      port: config.port,
      browser: renderer.browser,
      concurrency: config.concurrency,
    });
  });
  const stop = () => {
    server.close();
    void renderer.close().finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

void main();
