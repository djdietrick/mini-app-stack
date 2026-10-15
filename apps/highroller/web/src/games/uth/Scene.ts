import { Container, Sprite, type Text } from "pixi.js";
import type { Card } from "../../../../src/games/index.js";
import { describeHand, evaluate } from "../../../../src/games/poker/eval.js";
import type { UthView } from "../../../../src/games/uth/engine.js";
import type { Point } from "../../table/anim";
import { type CardSprite, Cards, ChipStack, INK, Labels, betCircle, placeFelt } from "../../table/kit";
import { DESIGN, type Layout, type Scene, type SceneContext } from "../../table/scene";

/**
 * The UTH table, portrait: the dealer's two cards at the top, the five-card
 * board across the middle (dealt face down, turned street by street), yours
 * at the bottom with the made hand under them, and the Ante, Blind and Play
 * circles along the bottom edge. At the showdown the cards outside your best
 * five dim, and each spot is paid or swept.
 */
export interface UthSceneView {
  /** The hand's id, "" while betting. */
  id: string;
  hand: UthView | null;
  /** The ante while betting; the Blind matches it. */
  ante: number;
}

// Below the frame's top bar (back, title, info), which sits over the canvas.
const SHOE: Point = { x: 350, y: 104 };
const DISCARD: Point = { x: 36, y: 104 };
const DEALER_Y = 104;
const BOARD_Y = 240;
const PLAYER_Y = 372;
const SPOT_Y = 494;
const DEALER_W = 58;
const BOARD_W = 58;
const PLAYER_W = 66;
const SPOTS = { ante: { x: 90, y: SPOT_Y }, blind: { x: 195, y: SPOT_Y }, play: { x: 300, y: SPOT_Y } } as const;

const dealerPos = (j: number): Point => ({ x: DESIGN.width / 2 + (j - 0.5) * (DEALER_W + 8), y: DEALER_Y });
const boardPos = (k: number): Point => ({ x: DESIGN.width / 2 + (k - 2) * (BOARD_W + 8), y: BOARD_Y });
const playerPos = (j: number): Point => ({ x: DESIGN.width / 2 + (j - 0.5) * (PLAYER_W + 10), y: PLAYER_Y });

export function createUthScene(opts: { onAnteTap: () => void }): Scene<UthSceneView> {
  let ctx: SceneContext;
  let cards: Cards;
  let labels: Labels;
  let felt: Sprite;
  let layer: Container;
  let cardLayer: Container;
  let deck: Sprite;
  let dealer: CardSprite[] = [];
  let board: CardSprite[] = [];
  let player: CardSprite[] = [];
  let stacks: Record<"ante" | "blind" | "play", ChipStack>;
  let youLabel: Text;
  let dealerLabel: Text;
  let badge: Text;
  let shownId = "";

  const all = () => [...dealer, ...board, ...player];

  async function deal(list: CardSprite[], to: Point, w: number, face: Card | null) {
    const s = cards.make(cardLayer, null, w);
    s.position.set(SHOE.x, SHOE.y);
    list.push(s);
    await ctx.anim.deal(s, SHOE, to, { rotation: (Math.random() - 0.5) * 0.04 });
    if (face) await cards.show(s, face);
  }

  async function sweep() {
    const old = all();
    dealer = [];
    board = [];
    player = [];
    youLabel.text = "";
    dealerLabel.text = "";
    badge.text = "";
    if (old.length) {
      await ctx.anim.collect(old, DISCARD);
      for (const s of old) s.destroy();
    }
  }

  async function syncCards(h: UthView) {
    if (all().length === 0) {
      // The deal: you, the dealer, you, the dealer, then the board face down.
      for (let j = 0; j < 2; j++) {
        await deal(player, playerPos(j), PLAYER_W, h.player[j]);
        await deal(dealer, dealerPos(j), DEALER_W, h.dealer[j]);
      }
      await Promise.all([0, 1, 2, 3, 4].map((k) => ctx.anim.wait(k * 90).then(() => deal(board, boardPos(k), BOARD_W, null))));
    }
    for (let k = 0; k < h.board.length; k++) {
      if (board[k].code !== h.board[k]) await cards.show(board[k], h.board[k]);
    }
    for (let j = 0; j < 2; j++) if (h.dealer[j] && dealer[j].code !== h.dealer[j]) await cards.show(dealer[j], h.dealer[j]);
  }

  function relabel(h: UthView) {
    youLabel.text = describeHand(evaluate([...h.player, ...h.board]));
    const sd = h.showdown;
    dealerLabel.text = sd ? `${sd.dealer.label}${sd.dealerQualifies ? "" : " · doesn't qualify"}` : "";
    // At the showdown, your best five stand out.
    const used = new Set(sd && !h.folded ? sd.player.cards : []);
    for (const s of [...player, ...board]) s.alpha = used.size && s.code && !used.has(s.code) ? 0.45 : 1;
  }

  async function settle(h: UthView) {
    const r = h.returned!;
    const sd = h.showdown!;
    const [text, fill] = h.folded
      ? ["FOLD", 0xf87171]
      : sd.winner === "player"
        ? ["WIN", 0x6ee7a8]
        : sd.winner === "tie"
          ? ["PUSH", INK]
          : ["DEALER WINS", 0xf87171];
    badge.text = text;
    badge.style.fill = fill;
    badge.alpha = 0;
    await ctx.anim.tween(badge, { alpha: 1 }, { duration: 160 });
    await ctx.anim.wait(250);
    const sweepTo = { x: DESIGN.width / 2, y: 20 };
    await Promise.all([stacks.ante.settle(r.ante, sweepTo), stacks.blind.settle(r.blind, sweepTo), stacks.play.amount ? stacks.play.settle(r.play, sweepTo) : undefined]);
  }

  return {
    mount(c, layout) {
      ctx = c;
      cards = new Cards(ctx);
      labels = new Labels(ctx);
      dealer = [];
      board = [];
      player = [];
      shownId = "";

      felt = new Sprite();
      ctx.root.addChild(felt);
      placeFelt(felt, ctx, layout);
      layer = new Container();
      ctx.root.addChild(layer);

      deck = new Sprite(cards.texture(null, 50));
      deck.anchor.set(0.5);
      deck.position.set(SHOE.x + 4, SHOE.y - 4);
      deck.rotation = -0.5;
      layer.addChild(deck);

      layer.addChild(labels.make("DEALER QUALIFIES WITH A PAIR OR BETTER", 10, { x: DESIGN.width / 2, y: 300 }, { alpha: 0.45, letterSpacing: 1.5 }));
      layer.addChild(labels.make("BLIND PAYS ON A STRAIGHT OR BETTER", 10, { x: DESIGN.width / 2, y: 316 }, { alpha: 0.35, letterSpacing: 1.5 }));

      for (const [name, at] of Object.entries(SPOTS)) {
        layer.addChild(betCircle(at, 28, name === "ante" ? opts.onAnteTap : undefined, name === "play" ? 0.35 : 0.6));
        layer.addChild(labels.make(name.toUpperCase(), 10.5, { x: at.x, y: at.y + 42 }, { alpha: 0.55, letterSpacing: 2 }));
      }
      layer.addChild(labels.make("=", 18, { x: (SPOTS.ante.x + SPOTS.blind.x) / 2, y: SPOT_Y }, { alpha: 0.4 }));

      youLabel = labels.make("", 14, { x: DESIGN.width / 2, y: PLAYER_Y + 62 });
      dealerLabel = labels.make("", 13, { x: DESIGN.width / 2, y: DEALER_Y + 56 }, { alpha: 0.9 });
      badge = labels.make("", 16, { x: DESIGN.width / 2, y: BOARD_Y - 58 }, { fontWeight: "800", letterSpacing: 2 });
      layer.addChild(youLabel, dealerLabel, badge);

      cardLayer = new Container();
      layer.addChild(cardLayer);
      stacks = {
        ante: new ChipStack(ctx, layer, SPOTS.ante, 38),
        blind: new ChipStack(ctx, layer, SPOTS.blind, 38),
        play: new ChipStack(ctx, layer, SPOTS.play, 38),
      };
    },

    async update(prev, next) {
      const h = next.hand;
      if (!h) {
        if (shownId) await sweep();
        shownId = "";
        await Promise.all([stacks.ante.set(next.ante), stacks.blind.set(next.ante)]);
        return;
      }
      if (next.id !== shownId) {
        if (shownId) await sweep();
        shownId = next.id;
      }
      const before = prev && prev.id === next.id ? prev.hand : null;
      await Promise.all([stacks.ante.set(h.ante), stacks.blind.set(h.blind), stacks.play.set(h.play)]);
      await syncCards(h);
      relabel(h);
      if (h.street === "done" && before?.street !== "done") await settle(h);
    },

    resize(layout) {
      placeFelt(felt, ctx, layout);
      cards.retexture(all());
      deck.texture = cards.texture(null, 50);
      for (const st of Object.values(stacks)) st.retexture();
      labels.retexture();
    },

    destroy() {
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}
