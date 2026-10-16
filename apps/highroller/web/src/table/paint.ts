import { type CardBackStyle, type ChipSet, type FeltStyle, chipColors } from "./cosmetics";

/**
 * The Canvas 2D painters for cosmetics: card backs, chips and felts, drawn
 * from a style's parameters. textures.ts rasterises them into Pixi textures
 * for the tables; the shop paints its previews with them straight onto
 * plain canvases, so it needs neither Pixi nor a WebGL context per item.
 * No Pixi imports here.
 */

/** A card is 1.4 × its width tall. */
export const CARD_RATIO = 1.4;
export const FACE = "#fbfaf6";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawBack(ctx: CanvasRenderingContext2D, style: CardBackStyle, w: number, h: number) {
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
  } else if (style.pattern === "diamonds") {
    const dw = step * 1.1;
    const dh = step * 1.6;
    for (let row = 0, y = m; y < m + ih + dh; y += dh / 2, row++) {
      for (let x = m + (row % 2 ? dw / 2 : 0); x < m + iw + dw; x += dw) {
        ctx.beginPath();
        ctx.moveTo(x, y - dh / 2);
        ctx.lineTo(x + dw / 2, y);
        ctx.lineTo(x, y + dh / 2);
        ctx.lineTo(x - dw / 2, y);
        ctx.closePath();
        ctx.stroke();
      }
    }
  } else if (style.pattern === "rings") {
    // Concentric rings from the centre, like an engraved medallion.
    const cx = w / 2;
    const cy = h / 2;
    for (let r = step * 0.6; r < Math.hypot(iw, ih) / 2; r += step * 0.7) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
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

export function drawChip(ctx: CanvasRenderingContext2D, set: ChipSet, value: number, d: number) {
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

export function drawFelt(ctx: CanvasRenderingContext2D, style: FeltStyle, w: number, h: number) {
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
