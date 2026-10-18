import { Container, Graphics, Sprite, type Text, type Ticker } from "pixi.js";
import { type SpinResult, machineOf, symbolOf } from "../../../../src/games/slots/evaluate.js";
import type { Machine } from "../../../../src/games/slots/machines.js";
import { play as sound } from "../../audio/sfx";
import { motionScale } from "../../settings";
import { chipBreakdown } from "../../table/cosmetics";
import { GOLD, Labels, placeFelt } from "../../table/kit";
import { DESIGN, type Scene, type SceneContext } from "../../table/scene";
import { drawSymbol } from "./symbols";

/**
 * The slot machine, portrait: five reels across the full width with three
 * rows each, the win readout above and below.
 *
 * A reel is drawn "virtually": four sprites showing whichever strip symbols
 * are under the window at the reel's current position, which is a float
 * (the strip index in the top row). A spin runs each reel's position down
 * the real strip to the server's stop, so the symbols that land are the ones
 * the strip has there; reels stop left to right with a small bounce, blurred
 * while they're fast. A tap on the reels slams them to a stop and hurries
 * the line display along.
 *
 * Then each winning line is traced in turn with its pay, the scatters are
 * ringed, and free spins (already decided, in the view) play out one after
 * another at the multiplier before the total flies to the balance.
 */
export interface SlotsSceneView {
  /** The hand's id, "" while idle. */
  id: string;
  machine: string;
  /** Where the reels rest while idle. */
  stops: number[];
  /** The hand's spins, paid spin first; null while idle. */
  spins: SpinResult[] | null;
  returned: number;
  jackpot: boolean;
  /** Auto-spin: shorter spins and win displays. */
  quick?: boolean;
}

export interface SlotsScene extends Scene<SlotsSceneView> {
  /** Stops the reels now and hurries the rest of the show. */
  slam(): void;
}

const REELS = 5;
const ROWS = 3;
const CELL_W = 74;
const CELL_H = 80;
const SYMBOL = 64;
const X0 = (DESIGN.width - REELS * CELL_W) / 2;
const Y0 = 132;
const BOUNCE = 0.28;
const LINE_COLORS = [0xffd43b, 0xff6b6b, 0x4dabf7, 0x69db7c, 0xda77f2, 0xffa94d, 0x3bc9db, 0xf783ac, 0xa9e34b, 0x9775fa];

const cellCenter = (reel: number, row: number) => ({ x: X0 + reel * CELL_W + CELL_W / 2, y: Y0 + row * CELL_H + CELL_H / 2 });
const mod = (a: number, n: number) => ((a % n) + n) % n;

interface ReelView {
  sprites: Sprite[];
  pos: number;
}

export function createSlotsScene(): SlotsScene {
  let ctx: SceneContext;
  let labels: Labels;
  let felt: Sprite;
  let layer: Container;
  let reelBox: Container;
  let lineGfx: Graphics;
  let glowGfx: Graphics;
  let reels: ReelView[] = [];
  let machine: Machine;
  let banner: Text;
  let winLabel: Text;
  let detail: Text;
  let shownId = "";
  /** Set by a tap: finish what's moving now and skip the pauses. */
  let hurry = false;
  /** Set on destroy: a spin still settling must not touch the freed sprites. */
  let dead = false;
  /** Running ticker steps, so destroy can stop them and settle their promises. */
  const tickers = new Map<(t: Ticker) => void, () => void>();

  const tex = (id: string, blur: boolean) =>
    ctx.textures.custom(`slot:${id}:${blur ? "b" : "s"}`, SYMBOL, SYMBOL, (c) => drawSymbol(c, id, SYMBOL, blur));

  function render(i: number, blur = false) {
    if (dead) return;
    const r = reels[i];
    const strip = machine.reels[i].strip;
    const base = Math.floor(r.pos);
    const frac = r.pos - base;
    r.sprites.forEach((s, k) => {
      s.texture = tex(strip[mod(base + k, strip.length)], blur);
      s.position.set(X0 + i * CELL_W + CELL_W / 2, Y0 + (k - frac) * CELL_H + CELL_H / 2);
    });
  }

  /** Runs `step(elapsed ms)` on the ticker until it returns true. */
  function onTicker(step: (elapsed: number) => boolean): Promise<void> {
    return new Promise((resolve) => {
      let elapsed = 0;
      const fn = (t: Ticker) => {
        elapsed += t.deltaMS;
        if (step(elapsed)) {
          ctx.app.ticker.remove(fn);
          tickers.delete(fn);
          resolve();
        }
      };
      tickers.set(fn, resolve);
      ctx.app.ticker.add(fn);
    });
  }

  /** A pause that a slam cuts short. */
  function pause(ms: number): Promise<void> {
    const d = ms * motionScale();
    if (d <= 0 || hurry) return Promise.resolve();
    return onTicker((e) => hurry || e >= d);
  }

  async function spinTo(stops: number[], quick: boolean) {
    const scale = motionScale();
    if (scale === 0) {
      stops.forEach((s, i) => {
        reels[i].pos = s;
        render(i);
      });
      return;
    }
    const plan = stops.map((to, i) => {
      const n = machine.reels[i].strip.length;
      const from = reels[i].pos;
      // Down the strip at least once round, further for the later reels.
      const steps = mod(from - to, n) + n * (quick ? 1 : 1 + Math.floor(i / 2));
      return { from, to, steps, duration: ((quick ? 520 : 780) + i * (quick ? 130 : 240)) * scale, done: false, slamAt: -1, slamT: 0 };
    });
    await onTicker((elapsed) => {
      let all = true;
      plan.forEach((p, i) => {
        if (p.done) return;
        let t = Math.min(1, elapsed / p.duration);
        if (hurry && p.slamAt < 0) {
          p.slamAt = elapsed;
          p.slamT = t;
        }
        if (p.slamAt >= 0) t = Math.min(1, p.slamT + (1 - p.slamT) * ((elapsed - p.slamAt) / (110 * scale)));
        // Decelerate to a little past the stop, then settle back onto it.
        const SPLIT = 0.86;
        let d: number;
        if (t < SPLIT) {
          const u = t / SPLIT;
          d = (p.steps + BOUNCE) * (1 - (1 - u) ** 2);
        } else {
          const u = (t - SPLIT) / (1 - SPLIT);
          d = p.steps + BOUNCE - BOUNCE * (1 - (1 - u) ** 3);
        }
        reels[i].pos = p.from - d;
        if (t >= 1) {
          p.done = true;
          reels[i].pos = p.to;
          sound("reel");
        }
        render(i, !p.done && t < SPLIT * 0.7);
        all &&= p.done;
      });
      return all;
    });
  }

  function clearWins() {
    if (dead) return;
    lineGfx.clear();
    glowGfx.clear();
    detail.text = "";
  }

  function ring(reel: number, row: number, color: number) {
    if (dead) return;
    const c = cellCenter(reel, row);
    glowGfx.roundRect(c.x - CELL_W / 2 + 3, c.y - CELL_H / 2 + 3, CELL_W - 6, CELL_H - 6, 10).stroke({ color, width: 3 });
  }

  function traceLine(line: number, count: number, color: number) {
    if (dead) return;
    const rows = machine.lines[line];
    const pts = rows.map((row, reel) => cellCenter(reel, row));
    lineGfx.moveTo(X0 - 4, pts[0].y);
    for (const p of pts) lineGfx.lineTo(p.x, p.y);
    lineGfx.lineTo(X0 + REELS * CELL_W + 4, pts[REELS - 1].y);
    lineGfx.stroke({ color, width: 4, alpha: 0.9, cap: "round", join: "round" });
    for (let reel = 0; reel < count; reel++) ring(reel, rows[reel], color);
  }

  /** Each win of one spin, one after another, then all together. */
  async function showWins(r: SpinResult, quick: boolean) {
    const each = quick ? 480 : 720;
    for (const w of r.lineWins) {
      if (dead) return;
      clearWins();
      traceLine(w.line, w.count, LINE_COLORS[w.line % LINE_COLORS.length]);
      detail.text = `LINE ${w.line + 1} · ${w.count} × ${symbolOf(machine, w.symbol).name.toUpperCase()} · ${w.pay.toLocaleString("en-US")}`;
      await pause(each);
    }
    if (dead) return;
    if (r.scatterPay > 0) {
      clearWins();
      const scatter = machine.symbols.find((s) => s.kind === "scatter")!;
      r.grid.forEach((col, reel) => col.forEach((s, row) => s === scatter.id && ring(reel, row, 0x3bc9db)));
      detail.text = `${r.scatters} × ${scatter.name.toUpperCase()} · ${r.scatterPay.toLocaleString("en-US")}`;
      await pause(each);
    }
    if (r.lineWins.length > 1) {
      clearWins();
      for (const w of r.lineWins) traceLine(w.line, w.count, LINE_COLORS[w.line % LINE_COLORS.length]);
      await pause(each);
    }
  }

  async function pop(t: Text, text: string, fill: number) {
    if (dead) return;
    t.text = text;
    t.style.fill = fill;
    t.alpha = 0;
    t.scale.set(0.8);
    await ctx.anim.tween(t, { alpha: 1, "scale.x": 1, "scale.y": 1 }, { duration: 200 });
  }

  /** Chips from the win readout to the balance pill. */
  async function payout(amount: number) {
    if (dead) return;
    const target = ctx.balanceTarget() ?? { x: DESIGN.width / 2, y: -40 };
    const chips = chipBreakdown(amount, 6).map((v, i) => {
      const s = new Sprite(ctx.textures.chip(ctx.equipped.chips, v, 30));
      s.anchor.set(0.5);
      s.position.set(winLabel.x - 40 + i * 16, winLabel.y);
      layer.addChild(s);
      return s;
    });
    await ctx.anim.payout(chips, target);
    for (const s of chips) s.destroy();
  }

  async function play(v: SlotsSceneView) {
    const [paid, ...free] = v.spins!;
    const quick = !!v.quick;
    await spinTo(paid.stops, quick);
    if (paid.total > 0) await pop(winLabel, `WIN ${paid.total.toLocaleString("en-US")}`, GOLD);
    await showWins(paid, quick);
    if (free.length) {
      clearWins();
      await pop(banner, `${free.length} FREE SPINS AT ${machine.freeSpins.multiplier}×`, 0x3bc9db);
      hurry = false;
      await pause(1100);
      let won = paid.total;
      for (const [k, r] of free.entries()) {
        if (dead) return;
        clearWins();
        banner.text = `FREE SPIN ${k + 1} OF ${free.length}`;
        await spinTo(r.stops, true);
        won += r.total;
        if (r.total > 0) {
          winLabel.text = `WIN ${won.toLocaleString("en-US")}`;
          await showWins(r, true);
        }
        await pause(180);
      }
      if (dead) return;
      clearWins();
      banner.text = "";
    }
    if (dead) return;
    if (v.jackpot) await pop(banner, "JACKPOT LINE!", GOLD);
    if (v.returned > 0) {
      await pop(winLabel, `WIN ${v.returned.toLocaleString("en-US")}`, GOLD);
      await payout(v.returned);
    }
  }

  return {
    mount(c, layout) {
      ctx = c;
      labels = new Labels(ctx);
      shownId = "";
      hurry = false;
      dead = false;
      machine = machineOf(null);

      felt = new Sprite();
      ctx.root.addChild(felt);
      placeFelt(felt, ctx, layout);
      layer = new Container();
      ctx.root.addChild(layer);

      const cabinet = new Graphics()
        .roundRect(X0 - 8, Y0 - 10, REELS * CELL_W + 16, ROWS * CELL_H + 20, 16)
        .fill({ color: 0x1a0f05, alpha: 0.92 })
        .stroke({ color: GOLD, width: 3 });
      for (let i = 0; i < REELS; i++) cabinet.rect(X0 + i * CELL_W + 2, Y0, CELL_W - 4, ROWS * CELL_H).fill({ color: 0xfbf4e2 });
      layer.addChild(cabinet);

      reelBox = new Container();
      const mask = new Graphics().rect(X0, Y0, REELS * CELL_W, ROWS * CELL_H).fill({ color: 0xffffff });
      layer.addChild(reelBox, mask);
      reelBox.mask = mask;
      reels = Array.from({ length: REELS }, () => {
        const sprites = Array.from({ length: ROWS + 1 }, () => {
          const s = new Sprite();
          s.anchor.set(0.5);
          reelBox.addChild(s);
          return s;
        });
        return { sprites, pos: 0 };
      });

      // Shade the rows above and below the window's edge so the reels read as drums.
      const shade = new Graphics()
        .rect(X0, Y0, REELS * CELL_W, 10)
        .fill({ color: 0x000000, alpha: 0.18 })
        .rect(X0, Y0 + ROWS * CELL_H - 10, REELS * CELL_W, 10)
        .fill({ color: 0x000000, alpha: 0.18 });
      layer.addChild(shade);

      glowGfx = new Graphics();
      lineGfx = new Graphics();
      layer.addChild(lineGfx, glowGfx);

      // A tap anywhere on the reels slams them.
      const hit = new Graphics().rect(X0, Y0, REELS * CELL_W, ROWS * CELL_H).fill({ color: 0, alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointertap", () => (hurry = true));
      layer.addChild(hit);

      banner = labels.make("", 15, { x: DESIGN.width / 2, y: 98 }, { fontWeight: "800", letterSpacing: 1.5 });
      winLabel = labels.make("", 26, { x: DESIGN.width / 2, y: Y0 + ROWS * CELL_H + 46 }, { fontWeight: "800", letterSpacing: 1.5, fill: GOLD });
      detail = labels.make("", 12, { x: DESIGN.width / 2, y: Y0 + ROWS * CELL_H + 82 }, { alpha: 0.9 });
      layer.addChild(banner, winLabel, detail);
      layer.addChild(labels.make("TAP THE REELS TO STOP", 10, { x: DESIGN.width / 2, y: Y0 + ROWS * CELL_H + 112 }, { alpha: 0.4, letterSpacing: 1.5 }));
      for (let i = 0; i < REELS; i++) render(i);
    },

    async update(_prev, next) {
      const m = machineOf(next.machine);
      if (m !== machine) machine = m;
      if (!next.spins) {
        shownId = "";
        clearWins();
        next.stops.forEach((s, i) => {
          reels[i].pos = s;
          render(i);
        });
        return;
      }
      if (next.id === shownId) return;
      shownId = next.id;
      hurry = false;
      clearWins();
      banner.text = "";
      winLabel.text = "";
      await play(next);
    },

    slam() {
      hurry = true;
    },

    resize(layout) {
      placeFelt(felt, ctx, layout);
      for (let i = 0; i < reels.length; i++) render(i);
      labels.retexture();
    },

    destroy() {
      dead = true;
      for (const [fn, resolve] of tickers) {
        ctx.app.ticker.remove(fn);
        resolve();
      }
      tickers.clear();
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}
