import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const webDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webDir,
  plugins: [react()],
  build: {
    outDir: resolve(webDir, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:3002" },
      "/auth": { target: "http://localhost:3002" },
    },
  },
});
