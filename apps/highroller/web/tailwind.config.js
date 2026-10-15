import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TAILWIND_SCREENS } from "./src/breakpoints.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * A card room at night: a near-black green ground so the felt and the chips
 * are the brightest things on screen, brass-gold for money and anything you
 * can press, and win/loss colours that differ in lightness as well as hue.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [resolve(here, "index.html"), resolve(here, "src/**/*.{ts,tsx}")],
  theme: {
    // The breakpoints live in src/breakpoints.ts, shared with runtime checks.
    screens: TAILWIND_SCREENS,
    extend: {
      colors: {
        ground: "#0b1410",
        surface: "#121e18",
        raised: "#1a2a22",
        line: "#2a3d33",
        ink: "#f3efe2",
        muted: "#a9b5ac",
        faint: "#7f8f85",
        felt: { DEFAULT: "#14532d", light: "#1d7a43", dark: "#0f3d24" },
        gold: { DEFAULT: "#d4af37", light: "#ecd27a", ink: "#1b1405" },
        win: { DEFAULT: "#6ee7a8", ink: "#05210f" },
        loss: { DEFAULT: "#f87171", ink: "#2a0808" },
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
