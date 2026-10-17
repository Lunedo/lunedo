import { createReadStream } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import { fontPath, isExcalidrawChunk, withoutFontFallback } from "./src/dev/excalidraw-assets.js";
import { isPreviewFrameAsset } from "./src/dev/preview-frame-assets.js";
import { publicAddress } from "./src/dev/public-address.js";

function previewFrameAssets(): Plugin {
  return {
    name: "pagehall-preview-frame-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (isPreviewFrameAsset(request.method, request.url, request.headers.origin)) {
          response.setHeader("access-control-allow-origin", "null");
          response.setHeader("vary", "origin");
        }
        next();
      });
    },
  };
}

function excalidrawAssets(): Plugin {
  let fonts = "";
  return {
    name: "pagehall-excalidraw-assets",
    configResolved(config) {
      fonts = path.join(config.root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
    },
    transform(code, id) {
      if (!isExcalidrawChunk(id)) return null;
      const changed = withoutFontFallback(code);
      return changed === null ? null : { code: changed, map: null };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const font = fontPath(request.url);
        if (!font) {
          next();
          return;
        }
        response.setHeader("content-type", "font/woff2");
        createReadStream(path.join(fonts, font.slice("fonts/".length)))
          .on("error", () => {
            response.statusCode = 404;
            response.end();
          })
          .pipe(response);
      });
    },
    async writeBundle(options) {
      if (options.dir) await cp(fonts, path.join(options.dir, "excalidraw", "fonts"), { recursive: true });
    },
  };
}

const polling = process.env.PAGEHALL_DEV_POLLING === "true";
const instance = publicAddress(process.env.PAGEHALL_INSTANCE_URL);

export default defineConfig({
  plugins: [react(), tailwindcss(), previewFrameAssets(), excalidrawAssets()],
  resolve: {
    conditions: ["@pagehall/source", ...defaultClientConditions],
  },
  server: {
    host: process.env.PAGEHALL_DEV_HOST ?? "localhost",
    port: 5173,
    strictPort: true,
    cors: { origin: [/^https?:\/\/(?:[^:]+\.)?localhost(?::\d+)?$/] },
    watch: polling ? { usePolling: true, interval: 300 } : undefined,
    allowedHosts: instance ? [instance.hostname] : [],
    hmr: instance
      ? { protocol: instance.socketProtocol, host: instance.hostname, clientPort: instance.port }
      : undefined,
    proxy: {
      ...Object.fromEntries(
        ["/api", "/scim"].map((path) => [
          path,
          {
            target: process.env.PAGEHALL_DEV_API_URL ?? "http://localhost:3000",
            changeOrigin: false,
            xfwd: true,
            ...(instance ? { headers: instance.forwardedHeaders } : {}),
          },
        ]),
      ),
      "/collab": {
        target: process.env.PAGEHALL_DEV_COLLAB_URL ?? "ws://localhost:3001",
        ws: true,
        changeOrigin: false,
        xfwd: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: { main: "index.html", preview: "preview.html", print: "print.html" },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
