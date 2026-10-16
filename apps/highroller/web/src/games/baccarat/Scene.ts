import { Container, Graphics, Sprite, type Text } from "pixi.js";
import { type BaccaratView, type Spot, totalOf } from "../../../../src/games/baccarat/engine.js";
import type { Card } from "../../../../src/games/index.js";
import { type Point, ease } from "../../table/anim";
import { type CardSprite, Cards, ChipStack, GOLD, INK, Labels, placeFelt } from "../../table/kit";
import { DESIGN, type Scene, type SceneContext } from "../../table/scene";
import { getSettings, motionScale } from "../../settings";

/**
 * The baccarat table, portrait: the Player and Banker boxes side by side at
 * the top, each with its two cards and a third laid sideways when drawn, and
 * the Player, Tie and Banker bet spots below.
 *
 * Cards are dealt face down, Player, Banker, Player, Banker. The first card
 * of each hand turns at once; the second and any third card are squeezed
 * (peeled up slowly) one at a time for the drama, each side's total counting
 * up as its cards turn. The "fast" speed setting skips the squeeze and just
 * turns them; reduced motion snaps everything.
 */
export interface BaccaratSceneView {
  /** The coup's id, "" while betting. */
  id: string;
  hand: BaccaratView | null;
  /** Chips on each spot while betting. */
  bets: Partial<Record<Spot, number>>;
}

const SHOE: Point = { x: 362, y: 334 };
const DISCARD: Point = { x: 28, y: 334 };
const BOX_Y = 74;
const BOX_H = 196;
const CARD_W = 58;
const CARD_Y = 150;
const THIRD_Y = 236;
const SIDES = { player: { x: 102, color: 0x2563eb }, banker: { x: 288, color: 0xdc2626 } } as const;
const SPOT_Y = 430;
const SPOTS: Record<Spot, Point> = { player: { x: 72, y: SPOT_Y }, tie: { x: 195, y: SPOT_Y }, banker: { x: 318, y: SPOT_Y } };
const SPOT_R = 40;

const cardPos = (side: "player" | "banker", j: number): Point =>
  j < 2 ? { x: SIDES[side].x + (j - 0.5) * (CARD_W + 8), y: CARD_Y } : { x: SIDES[side].x, y: THIRD_Y };

export function createBaccaratScene(opts: { onSpotTap: (spot: Spot) => void }): Scene<BaccaratSceneView> {
  let ctx: SceneContext;
  let cards: Cards;
  let labels: Labels;
  let felt: Sprite;
  let layer: Container;
  let cardLayer: Container;
  let deck: Sprite;
  let hands: Record<"player" | "banker", CardSprite[]> = { player: [], banker: [] };
  let totals: Record<"player" | "banker", Text>;
  let glow: Graphics;
  let badge: Text;
  let stacks: Record<Spot, ChipStack>;
  let shownId = "";

  const all = () => [...hands.player, ...hands.banker];

  async function dealDown(side: "player" | "banker", j: number, delay = 0) {
    const s = cards.make(cardLayer, null, CARD_W);
    s.position.set(SHOE.x, SHOE.y);
    hands[side].push(s);
    const to = cardPos(side, j);
    await ctx.anim.deal(s, SHOE, to, { delay, rotation: j === 2 ? Math.PI / 2 : (Math.random() - 0.5) * 0.04 });
  }

  /** Peels a face-down card up slowly, then turns it. Skipped at "fast". */
  async function squeeze(s: CardSprite, face: Card) {
    if (getSettings().speed !== "fast" && motionScale() > 0) {
      const base = { y: s.y, r: s.rotation };
      await ctx.anim.tween(s, { "scale.y": 0.86, y: base.y + 5, rotation: base.r + 0.06 }, { duration: 260, ease: ease.inOut });
      await ctx.anim.wait(90);
      await ctx.anim.tween(s, { "scale.y": 1, y: base.y, rotation: base.r }, { duration: 110, ease: ease.out });
    }
    await cards.show(s, face);
  }

  function setTotal(side: "player" | "banker", shown: Card[]) {
    totals[side].text = `${side.toUpperCase()} ${shown.length ? totalOf(shown) : ""}`.trim();
  }

  async function sweep() {
    const old = all();
    hands = { player: [], banker: [] };
    setTotal("player", []);
    setTotal("banker", []);
    badge.text = "";
    glow.clear();
    if (old.length) {
      await ctx.anim.collect(old, DISCARD);
      for (const s of old) s.destroy();
    }
  }

  async function play(h: BaccaratView) {
    // Two each, face down, in the deal's order (a sprite per hand is pushed in that order too).
    await Promise.all([
      dealDown("player", 0, 0),
      dealDown("banker", 0, 110),
      dealDown("player", 1, 220),
      dealDown("banker", 1, 330),
    ]);
    const shown: Record<"player" | "banker", Card[]> = { player: [], banker: [] };
    const turn = async (side: "player" | "banker", j: number, slow: boolean) => {
      if (slow) await squeeze(hands[side][j], h[side][j]);
      else await cards.show(hands[side][j], h[side][j]);
      shown[side].push(h[side][j]);
      setTotal(side, shown[side]);
    };
    // The first card of each hand turns at once; the second, which decides it, is squeezed.
    await Promise.all([turn("player", 0, false), turn("banker", 0, false)]);
    await turn("player", 1, true);
    await turn("banker", 1, true);
    if (h.natural) {
      badge.text = "NATURAL";
      badge.style.fill = GOLD;
      await ctx.anim.wait(300);
    }
    for (const side of ["player", "banker"] as const) {
      if (h[side].length < 3) continue;
      await dealDown(side, 2);
      await turn(side, 2, true);
    }
  }

  async function settle(h: BaccaratView) {
    const w = h.winner;
    glow.clear();
    if (w === "tie") {
      for (const side of ["player", "banker"] as const) drawBox(glow, side, GOLD, 4);
    } else {
      drawBox(glow, w, GOLD, 4);
    }
    badge.text = w === "tie" ? `TIE ${h.playerTotal}` : `${w.toUpperCase()} WINS ${w === "player" ? h.playerTotal : h.bankerTotal}–${w === "player" ? h.bankerTotal : h.playerTotal}`;
    badge.style.fill = w === "tie" ? 0x6ee7a8 : INK;
    badge.alpha = 0;
    await ctx.anim.tween(badge, { alpha: 1 }, { duration: 160 });
    await ctx.anim.wait(300);
    const sweepTo = { x: SHOE.x, y: SHOE.y };
    await Promise.all((Object.keys(stacks) as Spot[]).map((s) => (stacks[s].amount ? stacks[s].settle(h.returned[s], sweepTo) : undefined)));
  }

  function drawBox(g: Graphics, side: "player" | "banker", color: number, width: number, alpha = 1) {
    g.roundRect(SIDES[side].x - 88, BOX_Y, 176, BOX_H, 14).stroke({ color, width, alpha });
  }

  return {
    mount(c, layout) {
      ctx = c;
      cards = new Cards(ctx);
      labels = new Labels(ctx);
      hands = { player: [], banker: [] };
      shownId = "";

      felt = new Sprite();
      ctx.root.addChild(felt);
      placeFelt(felt, ctx, layout);
      layer = new Container();
      ctx.root.addChild(layer);

      const boxes = new Graphics();
      for (const side of ["player", "banker"] as const) {
        boxes.roundRect(SIDES[side].x - 88, BOX_Y, 176, BOX_H, 14).fill({ color: SIDES[side].color, alpha: 0.14 });
        drawBox(boxes, side, INK, 1.5, 0.45);
      }
      layer.addChild(boxes);
      glow = new Graphics();
      layer.addChild(glow);

      totals = {
        player: labels.make("PLAYER", 15, { x: SIDES.player.x, y: BOX_Y + 20 }, { letterSpacing: 2, fontWeight: "800" }),
        banker: labels.make("BANKER", 15, { x: SIDES.banker.x, y: BOX_Y + 20 }, { letterSpacing: 2, fontWeight: "800" }),
      };
      layer.addChild(totals.player, totals.banker);

      deck = new Sprite(cards.texture(null, 46));
      deck.anchor.set(0.5);
      deck.position.set(SHOE.x + 4, SHOE.y - 4);
      deck.rotation = -0.5;
      layer.addChild(deck);

      badge = labels.make("", 16, { x: DESIGN.width / 2, y: 300 }, { fontWeight: "800", letterSpacing: 2 });
      layer.addChild(badge);

      const spots = new Graphics();
      const names: Record<Spot, [string, string, number]> = {
        player: ["PLAYER", "PAYS 1 TO 1", SIDES.player.color],
        tie: ["TIE", "PAYS 8 TO 1", 0x15803d],
        banker: ["BANKER", "1 TO 1 LESS 5%", SIDES.banker.color],
      };
      for (const spot of Object.keys(SPOTS) as Spot[]) {
        const at = SPOTS[spot];
        spots.circle(at.x, at.y, SPOT_R).fill({ color: names[spot][2], alpha: 0.18 }).stroke({ color: INK, alpha: 0.6, width: 2 });
        const hit = new Graphics().circle(at.x, at.y, SPOT_R + 10).fill({ color: 0, alpha: 0.001 });
        hit.eventMode = "static";
        hit.cursor = "pointer";
        hit.on("pointertap", () => opts.onSpotTap(spot));
        layer.addChild(hit);
        layer.addChild(labels.make(names[spot][0], 12, { x: at.x, y: at.y + SPOT_R + 16 }, { alpha: 0.8, letterSpacing: 2 }));
        layer.addChild(labels.make(names[spot][1], 9, { x: at.x, y: at.y + SPOT_R + 31 }, { alpha: 0.5, letterSpacing: 1 }));
      }
      layer.addChildAt(spots, layer.getChildIndex(badge));

      cardLayer = new Container();
      layer.addChild(cardLayer);
      stacks = {
        player: new ChipStack(ctx, layer, SPOTS.player, 40),
        tie: new ChipStack(ctx, layer, SPOTS.tie, 40),
        banker: new ChipStack(ctx, layer, SPOTS.banker, 40),
      };
    },

    async update(prev, next) {
      const h = next.hand;
      if (!h) {
        if (shownId) await sweep();
        shownId = "";
        await Promise.all((Object.keys(stacks) as Spot[]).map((s) => stacks[s].set(next.bets[s] ?? 0)));
        return;
      }
      if (next.id === shownId) return;
      if (shownId) await sweep();
      shownId = next.id;
      await Promise.all((Object.keys(stacks) as Spot[]).map((s) => stacks[s].set(h.bets[s])));
      // A resumed coup (the page reloaded on it) is laid out at once.
      if (prev === null) {
        for (const side of ["player", "banker"] as const) {
          h[side].forEach((card, j) => {
            const s = cards.make(cardLayer, card, CARD_W, true);
            const at = cardPos(side, j);
            s.position.set(at.x, at.y);
            if (j === 2) s.rotation = Math.PI / 2;
            hands[side].push(s);
          });
          setTotal(side, h[side]);
        }
      } else {
        await play(h);
      }
      await settle(h);
    },

    resize(layout) {
      placeFelt(felt, ctx, layout);
      cards.retexture(all());
      deck.texture = cards.texture(null, 46);
      for (const st of Object.values(stacks)) st.retexture();
      labels.retexture();
    },

    destroy() {
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}

/** For the bead plate and the result toast: "Player 7", "Banker natural 9". */
export function coupText(v: BaccaratView): string {
  if (v.winner === "tie") return `Tie on ${v.playerTotal}`;
  const t = v.winner === "player" ? v.playerTotal : v.bankerTotal;
  // Both stand on a natural, so the winner holds one.
  return `${v.winner === "player" ? "Player" : "Banker"}${v.natural ? " natural" : ""} ${t}`;
}
