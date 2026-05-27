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
        cream: {
          50: "#FFFCF5",
          100: "#FBF6EC",
          200: "#F4ECD8",
          300: "#E7E1D3",
        },
        ink: {
          DEFAULT: "#1F2A1C",
          muted: "#6F7A64",
          soft: "#8C9482",
        },
        apple: {
          50: "#FDECE8",
          100: "#FAD3CB",
          400: "#EE7864",
          500: "#E85D4A",
          600: "#C94732",
          700: "#A93221",
        },
        honey: {
          100: "#FDEDC8",
          300: "#F8CC78",
          400: "#F6B73C",
          500: "#E59F1F",
        },
        sage: {
          400: "#67A461",
          500: "#3F7D3A",
          600: "#2F6230",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
