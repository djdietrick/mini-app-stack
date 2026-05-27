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
        sunset: {
          amber: "#fbbf24",
          coral: "#fb7185",
          mauve: "#c084fc",
        },
      },
      keyframes: {
        pickIn: {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        pickIn: "pickIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
