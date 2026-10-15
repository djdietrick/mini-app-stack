import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Card } from "../../../src/games/index.js";
import type { Point } from "./anim";
import { chipBreakdown } from "./cosmetics";
import { PanZoom } from "./panZoom";
import { DESIGN, type Layout, type Scene, type SceneContext } from "./scene";

/**
 * The table kit's test bench (#/table-demo, dev builds only): deals cards,
 * flips them, stacks chips, pays out to the balance pill, and has a wide
 * number strip to pinch, pan and tap-to-zoom. Nothing here is a real game;
 * the demo screen makes up its own views. It is also the smallest example of
 * a Scene: draw from the view, animate the difference, decide nothing.
 */
export interface DemoView {
  round: number;
  /** Chips on the bet spot. */
  bet: number;
  /** null is a face-down card. */
  dealer: (Card | null)[];
  player: Card[];
  /** Set when the round is over: what came back (0 on a loss). */
  payout: number | null;
}

const CARD_W = 64;
const CHIP_D = 44;
const SHOE: Point = { x: 340, y: 44 };
const DEALER_Y = 92;
const PLAYER_Y = 262;
const SPOT: Point = { x: 195, y: 368 };
const STRIP = { x: 10, y: 430, width: 370, height: 120 };
const CELL = { w: 56, h: 36 };

type CardSprite = Sprite & { code: Card | null };

export function createDemoScene(opts: { onSpotTap: (spot: string) => void; onZoneTap?: (n: number) => void }): Scene<DemoView> {
  let ctx: SceneContext;
  let felt: Sprite;
  let shoe: Sprite;
  let layer: Container;
  let dealerCards: CardSprite[] = [];
  let playerCards: CardSprite[] = [];
  let stack: Sprite[] = [];
  let stackAmount = 0;
  let labels: Text[] = [];
  let panZoom: PanZoom | null = null;
  let strip: Container;
  let stripContent: Container;

  const back = () => ctx.textures.back(ctx.equipped.back, CARD_W);
  const face = (c: Card | null) => (c ? ctx.textures.card(c, CARD_W) : back());
  const chipTex = (v: number) => ctx.textures.chip(ctx.equipped.chips, v, CHIP_D);

  function label(text: string, size: number, x: number, y: number, alpha = 0.6): Text {
    const t = new Text({
      text,
      style: { fontFamily: "Inter, system-ui, sans-serif", fontSize: size, fontWeight: "700", fill: "#f3efe2", letterSpacing: 1.5 },
      resolution: ctx.textures.density,
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.alpha = alpha;
    labels.push(t);
    return t;
  }

  /** Fans `n` cards around the centre line at `y`. */
  const slot = (i: number, n: number, y: number): Point => ({ x: DESIGN.width / 2 + (i - (n - 1) / 2) * (CARD_W * 0.62), y: y + i * 2 });

  function newCard(code: Card | null): CardSprite {
    const s = new Sprite(back()) as CardSprite;
    s.anchor.set(0.5);
    s.code = code;
    layer.addChild(s);
    return s;
  }

  async function syncHand(cards: CardSprite[], want: (Card | null)[], y: number) {
    const moves: Promise<void>[] = [];
    // Cards already down slide to their place in the wider fan, and turn if revealed.
    cards.forEach((s, i) => {
      moves.push(ctx.anim.slide(s, slot(i, want.length, y), { duration: 200 }));
      if (s.code === null && want[i]) {
        s.code = want[i];
        moves.push(ctx.anim.flip(s, face(want[i])));
      }
    });
    // New cards come off the shoe one after another, then turn face up.
    for (let i = cards.length; i < want.length; i++) {
      const s = newCard(want[i]);
      cards.push(s);
      moves.push(
        ctx.anim.deal(s, SHOE, slot(i, want.length, y), { delay: (i - cards.length + 1) * 140, rotation: (Math.random() - 0.5) * 0.06 }).then(() =>
          want[i] ? ctx.anim.flip(s, face(want[i])) : undefined,
        ),
      );
    }
    await Promise.all(moves);
  }

  async function syncStack(amount: number) {
    if (amount === stackAmount) return;
    const values = chipBreakdown(amount).reverse();
    const keep = Math.min(stack.length, values.length);
    for (const s of stack.slice(keep)) s.destroy();
    stack = stack.slice(0, keep);
    const fresh: Sprite[] = [];
    for (let i = keep; i < values.length; i++) {
      const s = new Sprite(chipTex(values[i]));
      s.anchor.set(0.5);
      s.position.set(SPOT.x, DESIGN.height + 40);
      layer.addChild(s);
      stack.push(s);
      fresh.push(s);
    }
    stack.forEach((s, i) => (s.texture = chipTex(values[i])));
    stackAmount = amount;
    await Promise.all(fresh.map((s, i) => ctx.anim.pushStack([s], { x: SPOT.x, y: SPOT.y - (keep + i) * 4 }, 0)));
  }

  async function settle(payout: number) {
    const target = ctx.balanceTarget() ?? { x: DESIGN.width / 2, y: -40 };
    if (payout > 0) {
      const won = chipBreakdown(payout).map((v, i) => {
        const s = new Sprite(chipTex(v));
        s.anchor.set(0.5);
        s.position.set(SPOT.x + 70, SPOT.y - i * 4);
        s.alpha = 0;
        layer.addChild(s);
        return s;
      });
      await Promise.all(won.map((s, i) => ctx.anim.tween(s, { alpha: 1 }, { duration: 120, delay: i * 30 })));
      await ctx.anim.payout([...stack, ...won], target);
      for (const s of won) s.destroy();
    } else {
      await ctx.anim.collect(stack, { x: DESIGN.width / 2, y: 10 });
    }
    for (const s of stack) s.destroy();
    stack = [];
    stackAmount = 0;
  }

  function placeFelt(layout: Layout) {
    // The felt fills the whole canvas, beyond the design space's letterbox.
    const w = Math.ceil(layout.width / layout.scale);
    const h = Math.ceil(layout.height / layout.scale);
    felt.texture = ctx.textures.felt(ctx.equipped.felt, w, h);
    felt.position.set(-layout.offsetX / layout.scale, -layout.offsetY / layout.scale);
  }

  function buildStrip() {
    strip = new Container();
    const mask = new Graphics().roundRect(STRIP.x, STRIP.y, STRIP.width, STRIP.height, 12).fill(0xffffff);
    const frame = new Graphics().roundRect(STRIP.x, STRIP.y, STRIP.width, STRIP.height, 12).stroke({ color: 0xf3efe2, alpha: 0.35, width: 1.5 });
    stripContent = new Container();
    const cols = 12;
    const rows = 3;
    const ox = 6;
    const oy = (STRIP.height - rows * CELL.h) / 2;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const n = c * 3 + (3 - r);
        const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);
        const g = new Graphics()
          .rect(ox + c * CELL.w, oy + r * CELL.h, CELL.w, CELL.h)
          .fill({ color: red ? 0xb91c1c : 0x161616, alpha: 0.9 })
          .stroke({ color: 0xf3efe2, alpha: 0.5, width: 1 });
        stripContent.addChild(g);
        const t = label(String(n), 16, ox + c * CELL.w + CELL.w / 2, oy + r * CELL.h + CELL.h / 2, 0.95);
        stripContent.addChild(t);
      }
    }
    strip.addChild(stripContent, frame);
    stripContent.mask = mask;
    strip.addChild(mask);
    strip.hitArea = { contains: (x: number, y: number) => x >= STRIP.x && x <= STRIP.x + STRIP.width && y >= STRIP.y && y <= STRIP.y + STRIP.height };
    layer.addChild(strip);

    panZoom = new PanZoom(stripContent, strip, ctx.anim, {
      viewport: STRIP,
      content: { width: cols * CELL.w + ox * 2, height: STRIP.height },
      maxZoom: 2.5,
    });

    // Tap a block of four columns to zoom into it; tap again to zoom back out.
    strip.on("pointertap", (e) => {
      if (!panZoom || panZoom.wasGesture) return;
      if (panZoom.scale > 1.05) {
        void panZoom.reset();
        return;
      }
      const p = stripContent.toLocal(e.global);
      const block = Math.max(0, Math.min(2, Math.floor((p.x - ox) / (CELL.w * 4))));
      opts.onZoneTap?.(block);
      // A rect with the viewport's aspect, so the block fills the strip's width.
      const width = CELL.w * 4;
      const height = (width * STRIP.height) / STRIP.width;
      void panZoom.zoomTo({ x: ox + block * width, y: (STRIP.height - height) / 2, width, height });
    });
  }

  return {
    mount(c, layout) {
      ctx = c;
      dealerCards = [];
      playerCards = [];
      stack = [];
      stackAmount = 0;
      labels = [];

      felt = new Sprite();
      ctx.root.addChild(felt);
      layer = new Container();
      ctx.root.addChild(layer);
      placeFelt(layout);

      const lines = new Graphics()
        .arc(DESIGN.width / 2, -90, 300, Math.PI * 0.28, Math.PI * 0.72)
        .stroke({ color: 0xf3efe2, alpha: 0.35, width: 2 });
      layer.addChild(lines);
      layer.addChild(label("TABLE KIT DEMO", 11, DESIGN.width / 2, 192, 0.45));

      shoe = new Sprite(back());
      shoe.anchor.set(0.5);
      shoe.position.set(SHOE.x + 3, SHOE.y - 3);
      shoe.rotation = -0.5;
      layer.addChild(shoe);

      const spot = new Graphics().circle(SPOT.x, SPOT.y, 36).stroke({ color: 0xf3efe2, alpha: 0.6, width: 2 });
      spot.eventMode = "static";
      spot.cursor = "pointer";
      spot.hitArea = { contains: (x: number, y: number) => Math.hypot(x - SPOT.x, y - SPOT.y) <= 46 };
      spot.on("pointertap", () => opts.onSpotTap("main"));
      layer.addChild(spot);
      layer.addChild(label("BET", 11, SPOT.x, SPOT.y, 0.5));

      buildStrip();
      layer.addChild(label("PINCH, DRAG, OR TAP A BLOCK", 10, DESIGN.width / 2, STRIP.y - 12, 0.45));
    },

    async update(prev, next) {
      if (prev && next.round !== prev.round) {
        // A new round: sweep the old cards off to the discard.
        await ctx.anim.collect([...dealerCards, ...playerCards], { x: 40, y: 40 });
        for (const s of [...dealerCards, ...playerCards]) s.destroy();
        dealerCards = [];
        playerCards = [];
      }
      if (next.payout === null || prev?.payout === null) await syncStack(next.bet);
      await Promise.all([syncHand(playerCards, next.player, PLAYER_Y), syncHand(dealerCards, next.dealer, DEALER_Y)]);
      if (next.payout !== null && (prev === null || prev.payout === null)) await settle(next.payout);
    },

    resize(layout) {
      placeFelt(layout);
      // Re-take every texture: the kit may have started a fresh cache at the new density.
      for (const s of [...dealerCards, ...playerCards]) s.texture = face(s.code);
      const values = chipBreakdown(stackAmount).reverse();
      stack.forEach((s, i) => (s.texture = chipTex(values[i])));
      shoe.texture = back();
      for (const t of labels) t.resolution = ctx.textures.density;
    },

    destroy() {
      panZoom?.destroy();
      panZoom = null;
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}
