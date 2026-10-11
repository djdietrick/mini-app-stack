import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** A token defined as "r g b" in src/index.css, so it follows light and dark. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/**
 * Flour and crust: an off-white ground with a baked-crust accent, and a
 * fermentation green for anything alive and rising. Dark mode (the kitchen at
 * 6am) swaps the tokens in index.css; nothing here names a literal colour.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [resolve(here, "index.html"), resolve(here, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        ground: v("ground"),
        surface: v("surface"),
        raised: v("raised"),
        line: v("line"),
        ink: v("ink"),
        muted: v("muted"),
        crust: { DEFAULT: v("crust"), soft: v("crust-soft"), ink: v("crust-ink") },
        live: { DEFAULT: v("live"), soft: v("live-soft") },
        warn: { DEFAULT: v("warn"), soft: v("warn-soft") },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "Avenir Next", "system-ui", "sans-serif"],
        sans: ['"Atkinson Hyperlegible"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
