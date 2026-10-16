import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
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

const polling = process.env.PAGEHALL_DEV_POLLING === "true";
const instance = publicAddress(process.env.PAGEHALL_INSTANCE_URL);

export default defineConfig({
  plugins: [react(), tailwindcss(), previewFrameAssets()],
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
