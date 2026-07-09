import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(here, "index.html"),
    resolve(here, "src/**/*.{ts,tsx}"),
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          50: "#FAFAFC",
          100: "#F2F2F7",
          200: "#E5E5EC",
        },
        ink: {
          DEFAULT: "#16161D",
          muted: "#5C5C6E",
          soft: "#8A8AA0",
        },
        brand: {
          400: "#FF5C5C",
          500: "#E63946",
          600: "#C32B3A",
        },
      },
    },
  },
  plugins: [],
};
