import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** A token defined as "r g b" in src/index.css, so it follows light and dark. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/**
 * Every colour is a token: dark mode swaps the values in index.css, so no
 * screen needs a `dark:` variant. `surface` is a card or input, `canvas-50`
 * the page behind it.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [
    resolve(here, "index.html"),
    resolve(here, "src/**/*.{ts,tsx}"),
  ],
  theme: {
    extend: {
      colors: {
        surface: v("surface"),
        canvas: {
          50: v("canvas-50"),
          100: v("canvas-100"),
          200: v("canvas-200"),
        },
        ink: {
          DEFAULT: v("ink"),
          muted: v("ink-muted"),
          soft: v("ink-soft"),
        },
        brand: {
          400: v("brand-400"),
          500: v("brand-500"),
          600: v("brand-600"),
        },
      },
    },
  },
  plugins: [],
};
