import { Container, Graphics, Sprite, type Text } from "pixi.js";
import {
  BAND,
  COLBET_H,
  COL_W,
  EVEN_MONEY,
  FELT,
  GRID_BOTTOM,
  GRID_X,
  GRID_Y,
  ROW_H,
  ZERO_H,
  anchorOf,
  hitTest,
} from "../../../../src/games/roulette/felt.js";
import {
  DOUBLE_ZERO,
  type RouletteBet,
  type Variant,
  betFromKey,
  pocketColor,
  pocketLabel,
  spotKey,
} from "../../../../src/games/roulette/engine.js";
import { wheel as wheelSound } from "../../audio/sfx";
import { WIDE_TABLE, matches } from "../../breakpoints";
import { motionScale } from "../../settings";
import { type Point, ease } from "../../table/anim";
import { ChipStack, GOLD, INK, Labels, placeFelt } from "../../table/kit";
import { PanZoom } from "../../table/panZoom";
import { DESIGN, type Layout, type Scene, type SceneContext } from "../../table/scene";

/**
 * The roulette table. The felt fills the screen, laid out top to bottom for
 * a phone (src/games/roulette/felt.ts). At full view, outside bets take a
 * chip with one tap; a tap on the numbers zooms in there, and at 2× every
 * cell, line and corner is big enough for a thumb. Pinch and drag work too.
 * On the wide layout (WIDE_TABLE) the whole felt is drawn large enough to
 * bet on directly, so a tap on the numbers bets instead of zooming.
 *
 * A spin brings the wheel up over the felt. The wheel and the ball are
 * animated backwards from the server's number: the final angles are picked
 * first so the ball comes to rest in that pocket, then everything eases
 * there. Losing chips are swept, winners paid to the balance.
 */
export interface RouletteSceneView {
  variant: Variant;
  /** Chips by spot key while betting. */
  bets: Record<string, number>;
  /** The spin to show, once; null while betting. */
  spin: { id: string; pocket: number; bets: (RouletteBet & { spot: string; returned: number })[] } | null;
}

/** The felt sits at the bottom of the design space, clear of the frame's top bar. */
const VIEWPORT = { x: (DESIGN.width - FELT.width) / 2, y: DESIGN.height - FELT.height - 2, width: FELT.width, height: FELT.height };
const CHIP_D = 24;
const ZOOM = 2;

const WHEEL_ORDER: Record<Variant, number[]> = {
  european: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],
  american: [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, DOUBLE_ZERO, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2],
};

const COLORS = { red: 0xb91c1c, black: 0x161616, green: 0x15803d };

export interface RouletteScene extends Scene<RouletteSceneView> {
  /** Back to the whole felt. */
  zoomOut(): void;
}

export function createRouletteScene(opts: {
  variant: Variant;
  onBet: (key: string, bet: { kind: RouletteBet["kind"]; numbers: number[] }) => void;
  onZoom?: (zoomed: boolean) => void;
}): RouletteScene {
  const variant = opts.variant;
  let ctx: SceneContext;
  let labels: Labels;
  let felt: Sprite;
  let surface: Container;
  let content: Container;
  let panZoom: PanZoom | null = null;
  let stacks = new Map<string, ChipStack>();
  let marker: Graphics;
  let wheel: Container | null = null;
  let shownSpin = "";

  function cell(g: Graphics, x: number, y: number, w: number, h: number, fill: number | null) {
    if (fill !== null) g.rect(x, y, w, h).fill({ color: fill, alpha: 0.92 });
    g.rect(x, y, w, h).stroke({ color: INK, alpha: 0.55, width: 1 });
  }

  function drawFelt() {
    const g = new Graphics();
    const text: Text[] = [];
    const t = (s: string, size: number, x: number, y: number, rotate = false) => {
      const l = labels.make(s, size, { x, y }, { fontWeight: "700" });
      if (rotate) l.rotation = -Math.PI / 2;
      text.push(l);
    };

    // Zero row.
    if (variant === "american") {
      cell(g, GRID_X, 0, 1.5 * COL_W, ZERO_H, COLORS.green);
      cell(g, GRID_X + 1.5 * COL_W, 0, 1.5 * COL_W, ZERO_H, COLORS.green);
      t("0", 17, GRID_X + 0.75 * COL_W, ZERO_H / 2);
      t("00", 17, GRID_X + 2.25 * COL_W, ZERO_H / 2);
    } else {
      cell(g, GRID_X, 0, 3 * COL_W, ZERO_H, COLORS.green);
      t("0", 17, GRID_X + 1.5 * COL_W, ZERO_H / 2);
    }
    // Numbers.
    for (let n = 1; n <= 36; n++) {
      const r = Math.floor((n - 1) / 3);
      const c = (n - 1) % 3;
      const x = GRID_X + c * COL_W;
      const y = GRID_Y + r * ROW_H;
      cell(g, x, y, COL_W, ROW_H, null);
      // Colour is never the only signal: red numbers sit on a disc, black ones on a square.
      if (pocketColor(n) === "red") g.circle(x + COL_W / 2, y + ROW_H / 2, 13).fill({ color: COLORS.red, alpha: 0.95 });
      else g.roundRect(x + COL_W / 2 - 11.5, y + ROW_H / 2 - 11.5, 23, 23, 3).fill({ color: COLORS.black, alpha: 0.95 });
      t(String(n), 13, x + COL_W / 2, y + ROW_H / 2);
    }
    // Dozens and even-money bets, lettering turned to fit the narrow columns.
    for (let d = 0; d < 3; d++) {
      cell(g, 46, GRID_Y + d * 4 * ROW_H, 46, 4 * ROW_H, null);
      t(["1st 12", "2nd 12", "3rd 12"][d], 13, 69, GRID_Y + (d + 0.5) * 4 * ROW_H, true);
    }
    EVEN_MONEY.forEach((e, i) => {
      const y = GRID_Y + i * 2 * ROW_H;
      cell(g, 0, y, 46, 2 * ROW_H, null);
      if (e.kind === "red" || e.kind === "black") {
        // The diamond, and its name under it, so the spot doesn't rely on colour.
        const cx = 23;
        const cy = y + ROW_H - 7;
        const diamond = [cx, cy - 15, cx + 9, cy, cx, cy + 15, cx - 9, cy];
        g.poly(diamond).fill({ color: e.kind === "red" ? COLORS.red : COLORS.black });
        g.poly(diamond).stroke({ color: INK, alpha: 0.6, width: 1 });
        t(e.label, 9, cx, cy + 25);
      } else {
        t(e.label, 12, 23, y + ROW_H, true);
      }
    });
    // Column bets.
    for (let c = 0; c < 3; c++) {
      cell(g, GRID_X + c * COL_W, GRID_BOTTOM, COL_W, COLBET_H, null);
      t("2 to 1", 12, GRID_X + (c + 0.5) * COL_W, GRID_BOTTOM + COLBET_H / 2);
    }
    content.addChild(g, ...text);
  }

  function stackFor(key: string, b: { kind: RouletteBet["kind"]; numbers: number[] }) {
    let st = stacks.get(key);
    if (!st) {
      st = new ChipStack(ctx, content, anchorOf(variant, b), CHIP_D, 2);
      stacks.set(key, st);
    }
    return st;
  }

  /** Where a chip placed from outside the felt comes from: the bottom edge, in content units. */
  const fromBelow = (): Point => content.toLocal(ctx.root.toGlobal({ x: DESIGN.width / 2, y: DESIGN.height + 30 }));

  async function syncBets(bets: Record<string, number>, known: Map<string, { kind: RouletteBet["kind"]; numbers: number[] }>) {
    const jobs: Promise<void>[] = [];
    for (const [key, st] of stacks) if (!(key in bets)) jobs.push(st.set(0));
    for (const [key, amount] of Object.entries(bets)) {
      const b = known.get(key);
      if (b) jobs.push(stackFor(key, b).set(amount, fromBelow()));
    }
    await Promise.all(jobs);
  }

  // ---------- the wheel ----------

  function buildWheel(): { root: Container; wheel: Container; ball: Graphics; result: Text; radius: number } {
    const R = 150;
    const centre = { x: DESIGN.width / 2, y: DESIGN.height / 2 - 30 };
    const root = new Container();
    const backdrop = new Graphics().rect(-200, -200, DESIGN.width + 400, DESIGN.height + 400).fill({ color: 0x000000, alpha: 0.55 });
    root.addChild(backdrop);
    const w = new Container();
    w.position.set(centre.x, centre.y);
    const order = WHEEL_ORDER[variant];
    const step = (Math.PI * 2) / order.length;
    const g = new Graphics();
    g.circle(0, 0, R + 10).fill({ color: 0x5b3a1a });
    g.circle(0, 0, R + 4).fill({ color: 0x2b1a0b });
    order.forEach((n, i) => {
      const a0 = i * step - Math.PI / 2 - step / 2;
      const a1 = a0 + step;
      g.moveTo(Math.cos(a0) * (R * 0.62), Math.sin(a0) * (R * 0.62))
        .arc(0, 0, R, a0, a1)
        .lineTo(Math.cos(a1) * (R * 0.62), Math.sin(a1) * (R * 0.62))
        .arc(0, 0, R * 0.62, a1, a0, true)
        .fill({ color: COLORS[pocketColor(n)] })
        .stroke({ color: GOLD, alpha: 0.5, width: 0.8 });
    });
    g.circle(0, 0, R * 0.62).fill({ color: 0x3b2410 }).stroke({ color: GOLD, alpha: 0.7, width: 2 });
    g.circle(0, 0, R * 0.2).fill({ color: GOLD, alpha: 0.85 });
    w.addChild(g);
    order.forEach((n, i) => {
      const a = i * step - Math.PI / 2;
      const l = labels.make(pocketLabel(n), 10, { x: Math.cos(a) * R * 0.86, y: Math.sin(a) * R * 0.86 }, { fontWeight: "800" });
      l.rotation = a + Math.PI / 2;
      w.addChild(l);
    });
    root.addChild(w);
    const ball = new Graphics().circle(0, 0, 5.5).fill({ color: 0xffffff }).stroke({ color: 0x999999, width: 1 });
    root.addChild(ball);
    const result = labels.make("", 40, { x: centre.x, y: centre.y + R + 56 }, { fontWeight: "800" });
    root.addChild(result);
    ctx.root.addChild(root);
    return { root, wheel: w, ball, result, radius: R };
  }

  async function spin(pocket: number) {
    const { root, wheel: w, ball, result, radius } = buildWheel();
    wheel = root;
    const order = WHEEL_ORDER[variant];
    const step = (Math.PI * 2) / order.length;
    const pocketAngle = order.indexOf(pocket) * step - Math.PI / 2;
    const w0 = Math.random() * Math.PI * 2;
    const w1 = w0 + Math.PI * 2 * 1.5;
    // The ball runs the other way and ends in the pocket's angle on the wheel's final turn.
    const b1 = w1 + pocketAngle;
    const b0 = b1 + Math.PI * 2 * 5;
    const c = { x: w.x, y: w.y };
    const place = (t: number) => {
      const tw = ease.out(t);
      const tb = 1 - (1 - t) ** 2.4;
      w.rotation = w0 + (w1 - w0) * tw;
      const a = b0 + (b1 - b0) * tb;
      // The ball drops from the rim into the pockets over the last stretch.
      const drop = t < 0.65 ? 0 : Math.min(1, (t - 0.65) / 0.3);
      const r = radius * (1.0 - 0.27 * ease.inOut(drop)) + (drop > 0 && drop < 1 ? Math.sin(drop * Math.PI * 3) * 4 * (1 - drop) : 0);
      ball.position.set(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    };
    const driver = {
      _t: 0,
      get t() {
        return this._t;
      },
      set t(v: number) {
        this._t = v;
        place(v);
      },
    };
    place(0);
    root.alpha = 0;
    await ctx.anim.tween(root, { alpha: 1 }, { duration: 200 });
    wheelSound(4200 * motionScale());
    await ctx.anim.tween(driver, { t: 1 }, { duration: 4200, ease: ease.linear });
    // The colour in words too, never colour alone.
    result.text = `${pocketLabel(pocket)} ${pocketColor(pocket).toUpperCase()}`;
    result.style.fill = pocketColor(pocket) === "red" ? 0xf87171 : pocketColor(pocket) === "green" ? 0x6ee7a8 : INK;
    await ctx.anim.wait(900);
    await ctx.anim.tween(root, { alpha: 0 }, { duration: 260 });
    root.destroy({ children: true });
    wheel = null;
  }

  function mark(pocket: number) {
    marker.clear();
    const a = anchorOf(variant, { kind: "straight", numbers: [pocket] });
    marker.circle(a.x, a.y, 15.5).stroke({ color: GOLD, width: 3 });
  }

  async function settle(s: NonNullable<RouletteSceneView["spin"]>) {
    await spin(s.pocket);
    mark(s.pocket);
    const sweepTo = { x: DESIGN.width / 2, y: -20 };
    await Promise.all(
      s.bets.map((b) => {
        const st = stacks.get(b.spot);
        return st ? st.settle(b.returned, sweepTo) : undefined;
      }),
    );
    for (const st of stacks.values()) st.clear();
    stacks = new Map();
  }

  // ---------- taps ----------

  function onTap(global: Point) {
    if (!panZoom || panZoom.wasGesture || wheel) return;
    const p = content.toLocal(global);
    const zoomed = panZoom.scale > 1.05;
    const onNumbers = p.x >= GRID_X - BAND && p.y < GRID_BOTTOM;
    if (!zoomed && onNumbers && !matches(WIDE_TABLE)) {
      // Zoom in 2× around the tap: about a third of the numbers, every line and corner thumb-sized.
      const w = FELT.width / ZOOM;
      const h = FELT.height / ZOOM;
      void panZoom.zoomTo({ x: p.x - w / 2, y: p.y - h / 2, width: w, height: h });
      opts.onZoom?.(true);
      return;
    }
    const hit = hitTest(variant, p.x, p.y);
    if (hit) opts.onBet(spotKey(hit.kind, hit.numbers), hit);
  }

  return {
    mount(c, layout) {
      ctx = c;
      labels = new Labels(ctx);
      stacks = new Map();
      shownSpin = "";
      felt = new Sprite();
      ctx.root.addChild(felt);
      placeFelt(felt, ctx, layout);

      surface = new Container();
      surface.hitArea = { contains: (x: number, y: number) => x >= VIEWPORT.x && x <= VIEWPORT.x + VIEWPORT.width && y >= VIEWPORT.y && y <= VIEWPORT.y + VIEWPORT.height };
      content = new Container();
      const mask = new Graphics().rect(VIEWPORT.x - 4, VIEWPORT.y - 4, VIEWPORT.width + 8, VIEWPORT.height + 8).fill(0xffffff);
      surface.addChild(content, mask);
      content.mask = mask;
      ctx.root.addChild(surface);

      drawFelt();
      marker = new Graphics();
      content.addChild(marker);

      panZoom = new PanZoom(content, surface, ctx.anim, { viewport: VIEWPORT, content: FELT, maxZoom: 2.5 });
      surface.on("pointertap", (e) => onTap(e.global));
    },

    async update(prev, next) {
      const known = new Map<string, { kind: RouletteBet["kind"]; numbers: number[] }>();
      for (const b of next.spin?.bets ?? []) known.set(b.spot, b);
      for (const key of Object.keys(next.bets)) if (!known.has(key)) known.set(key, betFromKey(key));
      if (next.spin && next.spin.id !== shownSpin) {
        shownSpin = next.spin.id;
        if (panZoom && panZoom.scale > 1.05) {
          await panZoom.reset();
          opts.onZoom?.(false);
        }
        // The bets as they were sent; then the wheel.
        await syncBets(Object.fromEntries(next.spin.bets.map((b) => [b.spot, b.amount])), known);
        await settle(next.spin);
        return;
      }
      // The last number stays marked until chips go down for the next spin.
      if (Object.keys(next.bets).length) marker.clear();
      await syncBets(next.bets, known);
    },

    zoomOut() {
      if (!panZoom || wheel) return;
      void panZoom.reset();
      opts.onZoom?.(false);
    },

    resize(layout) {
      placeFelt(felt, ctx, layout);
      for (const st of stacks.values()) st.retexture();
      labels.retexture();
    },

    destroy() {
      panZoom?.destroy();
      panZoom = null;
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}
