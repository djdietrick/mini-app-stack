import { CanvasSource, type Container, Sprite, Texture } from "pixi.js";
import { type Card, type Suit, parseCard } from "../../../src/games/index.js";
import type { CardBackStyle, ChipSet, FeltStyle } from "./cosmetics";
import { CARD_RATIO, FACE, drawBack, drawChip, drawFelt, roundRect } from "./paint";

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
 * its textures in `resize`, and `flushStale` then frees the old ones that
 * nothing on stage still shows. A chip flying to the balance or a card being
 * swept has left the scene's bookkeeping, so `resize` can't re-take its
 * texture; freeing that texture under it crashes the renderer. Such a
 * texture stays stale until a later flush, or the kit's destroy.
 *
 * One kit per TableCanvas: its textures live on that canvas's renderer and
 * are destroyed with it.
 */
export interface TextureKit {
  readonly density: number;
  /** Returns true when the density changed and textures must be re-taken. */
  setDensity(density: number): boolean;
  /** Frees textures from before the last density change that no sprite under `stage` still uses. */
  flushStale(stage: Container): void;
  /** A face-up card `w` wide (and 1.4 × w tall). */
  card(code: Card, w: number): Texture;
  back(style: CardBackStyle, w: number): Texture;
  /** A chip `d` across, showing `value`. */
  chip(set: ChipSet, value: number, d: number): Texture;
  felt(style: FeltStyle, w: number, h: number): Texture;
  destroy(): void;
}

export { CARD_RATIO } from "./paint";

const RED = "#c62828";
const BLACK = "#1c1c1c";
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
    // Pixi works the source's pixel size out as (pixels ÷ resolution) × resolution,
    // which can land a hair off a whole pixel (124 → 124.00000000000001 at
    // 1.875) and then writes it back to the canvas, which clears it. So the
    // source is made first, its size rounded back by resize, and only then drawn.
    const source = new CanvasSource({ resource: canvas, resolution: density });
    source.resize(canvas.width / density, canvas.height / density);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(density, density);
    draw(ctx);
    source.update();
    const texture = new Texture({ source });
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

    flushStale(stage) {
      const inUse = new Set<Texture>();
      const walk = (c: Container) => {
        if (c instanceof Sprite) inUse.add(c.texture);
        for (const k of c.children) walk(k);
      };
      walk(stage);
      const keep: Texture[] = [];
      for (const t of stale) {
        if (inUse.has(t)) keep.push(t);
        else t.destroy(true);
      }
      stale = keep;
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
// Card backs, chips and felts are painted by paint.ts, which the shop's
// previews share without loading Pixi.

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
