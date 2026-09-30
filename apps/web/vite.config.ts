import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

const polling = process.env.PAGEHALL_DEV_POLLING === "true";

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
    proxy: {
      "/api": process.env.PAGEHALL_DEV_API_URL ?? "http://localhost:3000",
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
