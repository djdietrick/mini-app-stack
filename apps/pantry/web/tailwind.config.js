import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(here, "index.html"),
    resolve(here, "src/**/*.{ts,tsx}"),
  ],
  theme: { extend: {} },
  plugins: [],
};
