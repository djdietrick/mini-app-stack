/**
 * Slot symbols painted in Canvas 2D: no binary art, like the cards and
 * chips. The reels rasterise them into Pixi textures (sharp and blurred, for
 * a spinning reel) and the paytable sheet paints them onto plain canvases,
 * so it needs no Pixi. No Pixi imports here.
 *
 * A symbol is painted by its id. A machine with symbols not drawn here gets a
 * lettered disc, so a new machine (machines.ts) works before it has art.
 */
import { roundRect } from "../../table/paint";

type Paint = (ctx: CanvasRenderingContext2D, s: number) => void;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function shine(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.6, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#2f9e44";
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.13, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, stroke?: string) {
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

const PAINTERS: Record<string, Paint> = {
  cherry(ctx, s) {
    ctx.strokeStyle = "#2f9e44";
    ctx.lineWidth = s * 0.05;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s * 0.32, s * 0.62);
    ctx.quadraticCurveTo(s * 0.42, s * 0.3, s * 0.62, s * 0.18);
    ctx.moveTo(s * 0.68, s * 0.66);
    ctx.quadraticCurveTo(s * 0.64, s * 0.36, s * 0.62, s * 0.18);
    ctx.stroke();
    leaf(ctx, s * 0.7, s * 0.2, s, 0.5);
    for (const [x, y] of [[0.32, 0.68], [0.68, 0.72]]) {
      ctx.fillStyle = "#d6336c";
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * 0.17, 0, Math.PI * 2);
      ctx.fill();
      shine(ctx, s * (x - 0.06), s * (y - 0.06), s * 0.05);
    }
  },
  lemon(ctx, s) {
    ctx.fillStyle = "#fcc419";
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.36, s * 0.27, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.18, s * 0.6, s * 0.05, s * 0.04, -0.3, 0, Math.PI * 2);
    ctx.ellipse(s * 0.82, s * 0.4, s * 0.05, s * 0.04, -0.3, 0, Math.PI * 2);
    ctx.fill();
    shine(ctx, s * 0.4, s * 0.4, s * 0.08);
  },
  orange(ctx, s) {
    ctx.fillStyle = "#fd7e14";
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.54, s * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (const [x, y] of [[0.4, 0.62], [0.6, 0.5], [0.52, 0.72], [0.66, 0.66]]) {
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
    leaf(ctx, s * 0.58, s * 0.2, s, -0.4);
    shine(ctx, s * 0.38, s * 0.42, s * 0.08);
  },
  plum(ctx, s) {
    ctx.fillStyle = "#7048e8";
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.55, s * 0.3, s * 0.33, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = s * 0.02;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.24);
    ctx.quadraticCurveTo(s * 0.62, s * 0.55, s * 0.52, s * 0.86);
    ctx.stroke();
    leaf(ctx, s * 0.58, s * 0.18, s, -0.5);
    shine(ctx, s * 0.38, s * 0.42, s * 0.07);
  },
  bell(ctx, s) {
    ctx.fillStyle = "#fab005";
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.14);
    ctx.bezierCurveTo(s * 0.74, s * 0.14, s * 0.74, s * 0.46, s * 0.78, s * 0.62);
    ctx.quadraticCurveTo(s * 0.84, s * 0.72, s * 0.9, s * 0.74);
    ctx.lineTo(s * 0.1, s * 0.74);
    ctx.quadraticCurveTo(s * 0.16, s * 0.72, s * 0.22, s * 0.62);
    ctx.bezierCurveTo(s * 0.26, s * 0.46, s * 0.26, s * 0.14, s * 0.5, s * 0.14);
    ctx.fill();
    ctx.fillStyle = "#e67700";
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.8, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
    shine(ctx, s * 0.4, s * 0.34, s * 0.06);
  },
  bar(ctx, s) {
    ctx.fillStyle = "#212529";
    roundRect(ctx, s * 0.1, s * 0.32, s * 0.8, s * 0.36, s * 0.06);
    ctx.fill();
    ctx.strokeStyle = "#f8f9fa";
    ctx.lineWidth = s * 0.025;
    ctx.stroke();
    label(ctx, "BAR", s / 2, s / 2 + s * 0.01, s * 0.26, "#f8f9fa");
  },
  seven(ctx, s) {
    label(ctx, "7", s / 2, s / 2 + s * 0.04, s * 0.8, "#e03131", "#fff5f5");
  },
  wild(ctx, s) {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "#f783ac");
    g.addColorStop(0.5, "#9775fa");
    g.addColorStop(1, "#4dabf7");
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? s * 0.2 : s * 0.44;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    label(ctx, "WILD", s / 2, s * 0.56, s * 0.2, "#ffffff", "#5f3dc4");
  },
  jackpot(ctx, s) {
    ctx.fillStyle = "#ffd43b";
    ctx.strokeStyle = "#e67700";
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(s * 0.16, s * 0.62);
    ctx.lineTo(s * 0.12, s * 0.26);
    ctx.lineTo(s * 0.32, s * 0.44);
    ctx.lineTo(s * 0.5, s * 0.18);
    ctx.lineTo(s * 0.68, s * 0.44);
    ctx.lineTo(s * 0.88, s * 0.26);
    ctx.lineTo(s * 0.84, s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const x of [0.12, 0.5, 0.88]) {
      ctx.fillStyle = "#e03131";
      ctx.beginPath();
      ctx.arc(s * x, s * (x === 0.5 ? 0.17 : 0.25), s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    label(ctx, "JACKPOT", s / 2, s * 0.76, s * 0.17, "#ffd43b", "#5c2d00");
  },
  scatter(ctx, s) {
    const g = ctx.createLinearGradient(s * 0.2, s * 0.15, s * 0.8, s * 0.85);
    g.addColorStop(0, "#c5f6fa");
    g.addColorStop(1, "#1098ad");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.2);
    ctx.lineTo(s * 0.7, s * 0.2);
    ctx.lineTo(s * 0.88, s * 0.4);
    ctx.lineTo(s * 0.5, s * 0.86);
    ctx.lineTo(s * 0.12, s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = s * 0.02;
    ctx.beginPath();
    ctx.moveTo(s * 0.12, s * 0.4);
    ctx.lineTo(s * 0.88, s * 0.4);
    ctx.moveTo(s * 0.3, s * 0.2);
    ctx.lineTo(s * 0.4, s * 0.4);
    ctx.lineTo(s * 0.5, s * 0.86);
    ctx.lineTo(s * 0.6, s * 0.4);
    ctx.lineTo(s * 0.7, s * 0.2);
    ctx.stroke();
  },
};

function fallback(id: string): Paint {
  return (ctx, s) => {
    ctx.fillStyle = "#495057";
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, id.slice(0, 3).toUpperCase(), s / 2, s / 2, s * 0.24, "#f8f9fa");
  };
}

/** One symbol in an `s`-square. `blur` smears it down the reel, for a spinning reel. */
export function drawSymbol(ctx: CanvasRenderingContext2D, id: string, s: number, blur = false) {
  const paint = PAINTERS[id] ?? fallback(id);
  if (!blur) return paint(ctx, s);
  const steps = 5;
  for (let k = 0; k < steps; k++) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.translate(0, ((k - (steps - 1) / 2) * s) / 9);
    paint(ctx, s);
    ctx.restore();
  }
}
