import { defineConfig, loadEnv } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { catalog } from "./src/catalog";
import { resolveAppUrls, type FirebaseRc } from "./src/urls";

const root = dirname(fileURLToPath(import.meta.url));
const firebasercPath = resolve(root, "../../.firebaserc");

export default defineConfig(({ mode }) => {
  // process.env too, so CI's exported variables count without a .env file.
  const env = { ...loadEnv(mode, root, "VITE_"), ...pickVite(process.env) };
  const firebaserc = existsSync(firebasercPath)
    ? (JSON.parse(readFileSync(firebasercPath, "utf8")) as FirebaseRc)
    : null;

  return {
    root,
    define: {
      __APP_URLS__: JSON.stringify(resolveAppUrls(catalog, env, firebaserc)),
    },
    build: {
      outDir: resolve(root, "dist"),
      emptyOutDir: true,
    },
    server: { port: 5170 },
  };
});

function pickVite(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith("VITE_")));
}
