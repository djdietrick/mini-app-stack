import { Container, Graphics, Sprite, type Text } from "pixi.js";
import type { Card } from "../../../../src/games/index.js";
import { HAND_NAMES, MAX_COINS, VP_HANDS, type VpHand, payFor } from "../../../../src/games/videopoker/engine.js";
import { type CardSprite, Cards, GOLD, INK, Labels, placeFelt } from "../../table/kit";
import { DESIGN, type Scene, type SceneContext } from "../../table/scene";

/**
 * The video poker machine, portrait: the paytable across the top with the
 * column for the coins bet lit, five big cards in the middle, and a HELD tag
 * under each card you keep. Tap a card to hold it (each is 68 × 95 design
 * units, well over a thumb). The deal turns the cards one by one; the draw
 * turns over only the ones you didn't hold.
 */
export interface VideoPokerSceneView {
  /** The hand's id, "" before the first deal. */
  id: string;
  phase: "idle" | "hold" | "done";
  /** Null shows a card back. */
  cards: (Card | null)[];
  held: boolean[];
  coins: number;
  /** What the cards make once drawn (lit in the paytable), else null. */
  hand: VpHand | null;
  /** Chips paid once drawn. */
  returned: number | null;
}

const PAY_Y = 70;
const ROW_H = 15.5;
const NAME_X = 16;
const COL_X = 168;
const COL_W = 43;
const CARD_W = 68;
const CARD_Y = 340;
const HELD_Y = 404;
/** The paytable shows every line that pays, best first. */
const LINES = VP_HANDS.filter((h) => h !== "nothing");

const cardX = (i: number) => DESIGN.width / 2 + (i - 2) * (CARD_W + 7);

export function createVideoPokerScene(opts: { onToggle: (i: number) => void }): Scene<VideoPokerSceneView> {
  let ctx: SceneContext;
  let cards: Cards;
  let labels: Labels;
  let felt: Sprite;
  let layer: Container;
  let lit: Graphics;
  let row: Graphics;
  let sprites: CardSprite[] = [];
  let heldTags: Text[] = [];
  let banner: Text;
  let shownId = "";
  let shownPhase: VideoPokerSceneView["phase"] = "idle";

  function light(coins: number, hand: VpHand | null) {
    lit.clear();
    lit.roundRect(COL_X + (coins - 1) * COL_W - COL_W / 2 + 2, PAY_Y - 10, COL_W - 4, LINES.length * ROW_H + 6, 6).fill({ color: 0xb91c1c, alpha: 0.55 });
    row.clear();
    const at = hand ? LINES.indexOf(hand as (typeof LINES)[number]) : -1;
    if (at >= 0) row.roundRect(8, PAY_Y + at * ROW_H - ROW_H / 2, DESIGN.width - 16, ROW_H, 4).fill({ color: GOLD, alpha: 0.35 });
  }

  /** Turns every card down then up to its face, one after another. */
  async function turnAll(faces: (Card | null)[], which: number[]) {
    await Promise.all(which.map((i) => cards.show(sprites[i], null)));
    for (const i of which) await cards.show(sprites[i], faces[i]);
  }

  return {
    mount(c, layout) {
      ctx = c;
      cards = new Cards(ctx);
      labels = new Labels(ctx);
      shownId = "";
      shownPhase = "idle";

      felt = new Sprite();
      ctx.root.addChild(felt);
      placeFelt(felt, ctx, layout);
      layer = new Container();
      ctx.root.addChild(layer);

      const panel = new Graphics()
        .roundRect(6, PAY_Y - 16, DESIGN.width - 12, LINES.length * ROW_H + 18, 10)
        .fill({ color: 0x0b1f4d, alpha: 0.85 })
        .stroke({ color: GOLD, alpha: 0.7, width: 1.5 });
      layer.addChild(panel);
      lit = new Graphics();
      row = new Graphics();
      layer.addChild(lit, row);
      LINES.forEach((h, k) => {
        const y = PAY_Y + k * ROW_H;
        const name = labels.make(HAND_NAMES[h].toUpperCase(), 10.5, { x: NAME_X, y }, { fill: 0xfde68a, letterSpacing: 0.5 });
        name.anchor.set(0, 0.5);
        layer.addChild(name);
        for (let coins = 1; coins <= MAX_COINS; coins++) {
          layer.addChild(labels.make(String(payFor(h, coins) * coins), 10.5, { x: COL_X + (coins - 1) * COL_W, y }, { fill: 0xfde68a, fontFamily: "ui-monospace, monospace" }));
        }
      });

      banner = labels.make("", 19, { x: DESIGN.width / 2, y: 248 }, { fontWeight: "800", letterSpacing: 2, fill: GOLD });
      layer.addChild(banner);

      sprites = [];
      heldTags = [];
      for (let i = 0; i < 5; i++) {
        const s = cards.make(layer, null, CARD_W);
        s.position.set(cardX(i), CARD_Y);
        s.eventMode = "static";
        s.cursor = "pointer";
        s.on("pointertap", () => opts.onToggle(i));
        sprites.push(s);
        const tag = labels.make("HELD", 13, { x: cardX(i), y: HELD_Y }, { fill: GOLD, fontWeight: "800", letterSpacing: 2 });
        tag.visible = false;
        heldTags.push(tag);
        layer.addChild(tag);
      }
      layer.addChild(labels.make("TAP A CARD TO HOLD IT", 10, { x: DESIGN.width / 2, y: 436 }, { alpha: 0.45, letterSpacing: 1.5 }));
      light(1, null);
    },

    async update(_prev, next) {
      light(next.coins, next.phase === "done" ? next.hand : null);
      heldTags.forEach((t, i) => (t.visible = next.phase !== "idle" && next.held[i]));
      // Held cards sit a little higher, like a machine's.
      sprites.forEach((s, i) => (s.y = CARD_Y - (next.phase === "hold" && next.held[i] ? 6 : 0)));

      if (next.id !== shownId) {
        banner.text = "";
        shownId = next.id;
        shownPhase = next.phase;
        if (next.phase === "idle") return;
        if (next.phase === "hold") {
          await turnAll(next.cards, [0, 1, 2, 3, 4]);
          return;
        }
        // A finished hand shown afresh (resumed): just lay it out.
        await Promise.all(next.cards.map((c, i) => cards.show(sprites[i], c)));
      } else if (shownPhase === "hold" && next.phase === "done") {
        shownPhase = "done";
        await turnAll(
          next.cards,
          [0, 1, 2, 3, 4].filter((i) => !next.held[i]),
        );
      } else {
        return;
      }

      if (next.phase === "done") {
        const won = (next.returned ?? 0) > 0;
        banner.text = won && next.hand ? `${HAND_NAMES[next.hand].toUpperCase()} · ${next.returned!.toLocaleString("en-US")}` : "NO WIN";
        banner.style.fill = won ? GOLD : INK;
        banner.alpha = 0;
        await ctx.anim.tween(banner, { alpha: 1 }, { duration: 180 });
        if (won) await ctx.anim.tween(banner, { "scale.x": 1.12, "scale.y": 1.12 }, { duration: 140 }).then(() => ctx.anim.tween(banner, { "scale.x": 1, "scale.y": 1 }, { duration: 160 }));
      }
    },

    resize(layout) {
      placeFelt(felt, ctx, layout);
      cards.retexture(sprites);
      labels.retexture();
    },

    destroy() {
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}
