import { CanvasSource, Texture } from "pixi.js";
import { type Card, type Suit, parseCard } from "../../../src/games/index.js";
import { type CardBackStyle, type ChipSet, type FeltStyle, chipColors } from "./cosmetics";

/**
 * Every table texture, drawn in code with Canvas 2D and rasterised once per
 * size and pixel density, then cached. No binary art: cards stay sharp on any
 * screen, the bundle stays small, and a cosmetic is just a parameter set.
 *
 * Sizes are in design units (the scene's portrait design space). `density`
 * is device pixels per design unit (the renderer's resolution × the layout's
 * scale), so a sprite showing one of these textures at its natural size is
 * pixel-exact on screen and needs no scaling. When the layout's scale changes
 * (a resize, a rotation), `setDensity` starts a fresh cache; the scene re-takes
 * its textures in `resize`, and `flushStale` then frees the old ones.
 *
 * One kit per TableCanvas: its textures live on that canvas's renderer and
 * are destroyed with it.
 */
export interface TextureKit {
  readonly density: number;
  /** Returns true when the density changed and textures must be re-taken. */
  setDensity(density: number): boolean;
  /** Frees textures from before the last density change. */
  flushStale(): void;
  /** A face-up card `w` wide (and 1.4 × w tall). */
  card(code: Card, w: number): Texture;
  back(style: CardBackStyle, w: number): Texture;
  /** A chip `d` across, showing `value`. */
  chip(set: ChipSet, value: number, d: number): Texture;
  felt(style: FeltStyle, w: number, h: number): Texture;
  destroy(): void;
}

export const CARD_RATIO = 1.4;

const RED = "#c62828";
const BLACK = "#1c1c1c";
const FACE = "#fbfaf6";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = 'Fraunces, Georgia, "Times New Roman", serif';

/** Quantised so tiny layout jitter doesn't throw the cache away. */
const quantise = (d: number) => Math.max(0.5, Math.round(d * 8) / 8);

export function createTextureKit(initialDensity: number): TextureKit {
  let density = quantise(initialDensity);
  let cache = new Map<string, Texture>();
  let stale: Texture[] = [];

  function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
    const hit = cache.get(key);
    if (hit) return hit;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w * density));
    canvas.height = Math.max(1, Math.ceil(h * density));
    const ctx = canvas.getContext("2d")!;
    ctx.scale(density, density);
    draw(ctx);
    const texture = new Texture({ source: new CanvasSource({ resource: canvas, resolution: density }) });
    cache.set(key, texture);
    return texture;
  }

  return {
    get density() {
      return density;
    },

    setDensity(next) {
      const q = quantise(next);
      if (q === density) return false;
      stale.push(...cache.values());
      cache = new Map();
      density = q;
      return true;
    },

    flushStale() {
      for (const t of stale) t.destroy(true);
      stale = [];
    },

    card(code, w) {
      const h = w * CARD_RATIO;
      return make(`card:${code}:${w}`, w, h, (ctx) => drawCard(ctx, code, w, h));
    },

    back(style, w) {
      const h = w * CARD_RATIO;
      return make(`back:${style.id}:${w}`, w, h, (ctx) => drawBack(ctx, style, w, h));
    },

    chip(set, value, d) {
      return make(`chip:${set.id}:${value}:${d}`, d, d, (ctx) => drawChip(ctx, set, value, d));
    },

    felt(style, w, h) {
      return make(`felt:${style.id}:${w}x${h}`, w, h, (ctx) => drawFelt(ctx, style, w, h));
    },

    destroy() {
      for (const t of [...cache.values(), ...stale]) t.destroy(true);
      cache = new Map();
      stale = [];
    },
  };
}

// ---------- drawing ----------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A suit symbol `s` tall centred on (cx, cy), as paths so no font can turn it into an emoji. */
export function drawSuit(ctx: CanvasRenderingContext2D, suit: Suit, cx: number, cy: number, s: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (suit) {
    case "h":
      ctx.moveTo(0, 0.46);
      ctx.bezierCurveTo(-0.62, 0.02, -0.46, -0.52, 0, -0.2);
      ctx.bezierCurveTo(0.46, -0.52, 0.62, 0.02, 0, 0.46);
      break;
    case "d":
      ctx.moveTo(0, -0.5);
      ctx.quadraticCurveTo(0.16, -0.18, 0.38, 0);
      ctx.quadraticCurveTo(0.16, 0.18, 0, 0.5);
      ctx.quadraticCurveTo(-0.16, 0.18, -0.38, 0);
      ctx.quadraticCurveTo(-0.16, -0.18, 0, -0.5);
      break;
    case "s":
      ctx.moveTo(0, -0.5);
      ctx.bezierCurveTo(0.62, -0.06, 0.46, 0.42, 0.04, 0.16);
      ctx.lineTo(0.16, 0.5);
      ctx.lineTo(-0.16, 0.5);
      ctx.lineTo(-0.04, 0.16);
      ctx.bezierCurveTo(-0.46, 0.42, -0.62, -0.06, 0, -0.5);
      break;
    case "c":
      ctx.arc(0, -0.22, 0.21, 0, Math.PI * 2);
      ctx.moveTo(-0.02, 0.08);
      ctx.arc(-0.23, 0.08, 0.21, 0, Math.PI * 2);
      ctx.moveTo(0.44, 0.08);
      ctx.arc(0.23, 0.08, 0.21, 0, Math.PI * 2);
      ctx.moveTo(-0.06, 0.05);
      ctx.lineTo(0.06, 0.05);
      ctx.lineTo(0.16, 0.5);
      ctx.lineTo(-0.16, 0.5);
      ctx.closePath();
      break;
  }
  ctx.fill();
  ctx.restore();
}

/** Pip positions for 2–10 as (x, y) fractions of the pip area; y > 0.5 is drawn upside down. */
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

function drawCard(ctx: CanvasRenderingContext2D, code: Card, w: number, h: number) {
  const { rank, suit, value } = parseCard(code);
  const color = suit === "h" || suit === "d" ? RED : BLACK;
  const r = w * 0.08;

  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.fillStyle = FACE;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, w * 0.012);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.stroke();

  // Corner indices, big enough to read at phone size: the rank and suit are
  // what matter when cards overlap in a hand.
  const label = rank === "T" ? "10" : rank;
  const corner = (flip: boolean) => {
    ctx.save();
    if (flip) {
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const size = w * (label.length > 1 ? 0.2 : 0.24);
    ctx.font = `700 ${size}px ${FONT}`;
    const cx = w * 0.15;
    if (label.length > 1) {
      ctx.save();
      ctx.translate(cx, h * 0.045);
      ctx.scale(0.82, 1);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, cx, h * 0.045);
    }
    drawSuit(ctx, suit, cx, h * 0.045 + w * 0.36, w * 0.16, color);
    ctx.restore();
  };
  corner(false);
  corner(true);

  // The centre: pips for 2–10, a framed letter for court cards, one big pip for an ace.
  const area = { x: w * 0.3, y: h * 0.17, w: w * 0.4, h: h * 0.66 };
  if (value >= 2 && value <= 10) {
    const s = w * 0.2;
    for (const [fx, fy] of PIPS[value]) {
      const x = area.x + fx * area.w;
      const y = area.y + fy * area.h;
      ctx.save();
      ctx.translate(x, y);
      if (fy > 0.5) ctx.rotate(Math.PI);
      drawSuit(ctx, suit, 0, 0, s, color);
      ctx.restore();
    }
  } else if (rank === "A") {
    drawSuit(ctx, suit, w / 2, h / 2, w * 0.46, color);
  } else {
    const fx = w * 0.27;
    const fy = h * 0.15;
    const fw = w - 2 * fx;
    const fh = h - 2 * fy;
    roundRect(ctx, fx, fy, fw, fh, w * 0.04);
    ctx.fillStyle = suit === "h" || suit === "d" ? "rgba(198,40,40,0.08)" : "rgba(28,28,28,0.07)";
    ctx.fill();
    ctx.lineWidth = w * 0.018;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${w * 0.4}px ${SERIF}`;
    ctx.fillText(rank, w / 2, h / 2 + w * 0.02);
    drawSuit(ctx, suit, fx + w * 0.1, fy + w * 0.1, w * 0.12, color);
    ctx.save();
    ctx.translate(fx + fw - w * 0.1, fy + fh - w * 0.1);
    ctx.rotate(Math.PI);
    drawSuit(ctx, suit, 0, 0, w * 0.12, color);
    ctx.restore();
  }
}

function drawBack(ctx: CanvasRenderingContext2D, style: CardBackStyle, w: number, h: number) {
  const r = w * 0.08;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.fillStyle = style.margin ? FACE : style.base;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, w * 0.012);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();

  const m = style.margin ? w * 0.07 : w * 0.04;
  const iw = w - 2 * m;
  const ih = h - 2 * m;
  ctx.save();
  roundRect(ctx, m, m, iw, ih, r * 0.6);
  ctx.fillStyle = style.base;
  ctx.fill();
  ctx.clip();

  ctx.strokeStyle = style.accent;
  ctx.fillStyle = style.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = w * 0.012;
  const step = w * 0.11;
  if (style.pattern === "lattice") {
    for (let i = -h; i < w + h; i += step) {
      ctx.beginPath();
      ctx.moveTo(m + i, m);
      ctx.lineTo(m + i + ih, m + ih);
      ctx.moveTo(m + i, m + ih);
      ctx.lineTo(m + i + ih, m);
      ctx.stroke();
    }
  } else if (style.pattern === "dots") {
    for (let y = m + step / 2; y < m + ih; y += step) {
      for (let x = m + step / 2; x < m + iw; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, w * 0.018, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    for (let x = m; x < m + iw; x += step) ctx.fillRect(x, m, step / 3, ih);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  roundRect(ctx, m, m, iw, ih, r * 0.6);
  ctx.lineWidth = w * 0.02;
  ctx.strokeStyle = style.accent;
  ctx.stroke();
}

function drawChip(ctx: CanvasRenderingContext2D, set: ChipSet, value: number, d: number) {
  const c = chipColors(set, value);
  const cx = d / 2;
  const r = d / 2 - 0.5;

  // A soft shadow under the rim, inside the texture's bounds.
  ctx.beginPath();
  ctx.arc(cx, cx + d * 0.02, r * 0.98, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cx, r * 0.97, 0, Math.PI * 2);
  ctx.fillStyle = c.base;
  ctx.fill();

  ctx.fillStyle = c.stripe;
  if (set.edge === "inserts") {
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate((i * Math.PI) / 3);
      ctx.fillRect(-r * 0.13, -r * 0.97, r * 0.26, r * 0.24);
      ctx.restore();
    }
  } else if (set.edge === "dashes") {
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate((i * Math.PI) / 6);
      ctx.fillRect(-r * 0.04, -r * 0.97, r * 0.08, r * 0.2);
      ctx.restore();
    }
  }

  ctx.beginPath();
  ctx.arc(cx, cx, r * 0.66, 0, Math.PI * 2);
  ctx.setLineDash([r * 0.12, r * 0.08]);
  ctx.lineWidth = Math.max(0.6, r * 0.06);
  ctx.strokeStyle = c.stripe;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = c.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = value >= 1000 ? `${value / 1000}K` : String(value);
  ctx.font = `800 ${r * (label.length > 3 ? 0.42 : 0.52)}px ${FONT}`;
  ctx.fillText(label, cx, cx + r * 0.03);
}

function drawFelt(ctx: CanvasRenderingContext2D, style: FeltStyle, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.max(w, h) * 0.8);
  g.addColorStop(0, style.light);
  g.addColorStop(1, style.dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (style.weave) {
    // A faint cross-hatch reads as cloth without costing anything at runtime.
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
