import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TAILWIND_SCREENS } from "./src/breakpoints.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Rosewood and brass: a warm dark ground so the fretboard reads as the
 * brightest thing on screen. `correct` and `miss` differ in lightness as well
 * as hue, so they stay distinguishable without colour vision.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [resolve(here, "index.html"), resolve(here, "src/**/*.{ts,tsx}")],
  theme: {
    // The breakpoints live in src/breakpoints.ts, shared with the runtime checks.
    screens: TAILWIND_SCREENS,
    extend: {
      colors: {
        ground: "#14110d",
        surface: "#1f1a14",
        raised: "#2a231b",
        line: "#3a3027",
        ink: "#f4ecdc",
        muted: "#b3a58f",
        faint: "#9a8c76",
        brass: { DEFAULT: "#e5a54b", light: "#f2c27c", ink: "#1a140c" },
        correct: { DEFAULT: "#7fd1b9", ink: "#10231d" },
        miss: { DEFAULT: "#f0785a", ink: "#2a0f07" },
        wood: "#3a281c",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "Georgia", "serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
