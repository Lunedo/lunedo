import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { publicAddress } from "./src/dev/public-address.js";

const polling = process.env.PAGEHALL_DEV_POLLING === "true";
const instance = publicAddress(process.env.PAGEHALL_INSTANCE_URL);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ["@pagehall/source", ...defaultClientConditions],
  },
  server: {
    host: process.env.PAGEHALL_DEV_HOST ?? "localhost",
    port: 5173,
    strictPort: true,
    watch: polling ? { usePolling: true, interval: 300 } : undefined,
    allowedHosts: instance ? [instance.hostname] : [],
    hmr: instance
      ? { protocol: instance.socketProtocol, host: instance.hostname, clientPort: instance.port }
      : undefined,
    proxy: {
      "/api": {
        target: process.env.PAGEHALL_DEV_API_URL ?? "http://localhost:3000",
        changeOrigin: false,
        xfwd: true,
        ...(instance ? { headers: instance.forwardedHeaders } : {}),
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
