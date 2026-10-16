import { Container, Sprite, type Text } from "pixi.js";
import type { Card } from "../../../../src/games/index.js";
import type { ThreeCardView } from "../../../../src/games/threecard/engine.js";
import type { Point } from "../../table/anim";
import { type CardSprite, Cards, ChipStack, INK, Labels, betCircle, placeFelt } from "../../table/kit";
import { DESIGN, type Scene, type SceneContext } from "../../table/scene";

/**
 * The Three Card Poker table, portrait: the dealer's three cards at the top
 * (face down until you play or fold), yours below with the hand's name, and
 * the Pair Plus, Ante and Play circles along the bottom. At the end each
 * spot is paid or swept; the Ante's winnings include its bonus.
 */
export interface ThreeCardSceneView {
  /** The hand's id, "" while betting. */
  id: string;
  hand: ThreeCardView | null;
  /** The bets while betting. */
  ante: number;
  pairPlus: number;
}

const SHOE: Point = { x: 350, y: 110 };
const DISCARD: Point = { x: 36, y: 110 };
const DEALER_Y = 120;
const PLAYER_Y = 330;
const SPOT_Y = 482;
const DEALER_W = 62;
const PLAYER_W = 72;
const SPOTS = { pairPlus: { x: 80, y: SPOT_Y }, ante: { x: 195, y: SPOT_Y }, play: { x: 310, y: SPOT_Y } } as const;
type SpotName = keyof typeof SPOTS;

const dealerPos = (j: number): Point => ({ x: DESIGN.width / 2 + (j - 1) * (DEALER_W + 10), y: DEALER_Y });
const playerPos = (j: number): Point => ({ x: DESIGN.width / 2 + (j - 1) * (PLAYER_W + 12), y: PLAYER_Y });

export function createThreeCardScene(opts: { onSpotTap: (spot: "ante" | "pairPlus") => void }): Scene<ThreeCardSceneView> {
  let ctx: SceneContext;
  let cards: Cards;
  let labels: Labels;
  let felt: Sprite;
  let layer: Container;
  let cardLayer: Container;
  let deck: Sprite;
  let dealer: CardSprite[] = [];
  let player: CardSprite[] = [];
  let stacks: Record<SpotName, ChipStack>;
  let youLabel: Text;
  let dealerLabel: Text;
  let badge: Text;
  let shownId = "";

  const all = () => [...dealer, ...player];

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
    player = [];
    youLabel.text = "";
    dealerLabel.text = "";
    badge.text = "";
    if (old.length) {
      await ctx.anim.collect(old, DISCARD);
      for (const s of old) s.destroy();
    }
  }

  async function syncCards(h: ThreeCardView) {
    if (all().length === 0) {
      for (let j = 0; j < 3; j++) {
        await deal(player, playerPos(j), PLAYER_W, h.player[j]);
        await deal(dealer, dealerPos(j), DEALER_W, null);
      }
    }
    for (let j = 0; j < 3; j++) {
      const c = h.dealer[j];
      if (c && dealer[j].code !== c) await cards.show(dealer[j], c);
    }
  }

  async function settle(h: ThreeCardView) {
    const r = h.returned!;
    const sd = h.showdown!;
    dealerLabel.text = `${sd.dealer.label}${sd.dealerQualifies ? "" : " · doesn't qualify"}`;
    const [text, fill] = h.folded
      ? ["FOLD", 0xf87171]
      : !sd.dealerQualifies
        ? ["DEALER DOESN'T QUALIFY", 0x6ee7a8]
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
    await Promise.all([
      stacks.ante.settle(r.ante, sweepTo),
      stacks.play.amount ? stacks.play.settle(r.play, sweepTo) : undefined,
      stacks.pairPlus.amount ? stacks.pairPlus.settle(r.pairPlus, sweepTo) : undefined,
    ]);
  }

  return {
    mount(c, layout) {
      ctx = c;
      cards = new Cards(ctx);
      labels = new Labels(ctx);
      dealer = [];
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

      layer.addChild(labels.make("DEALER QUALIFIES WITH QUEEN HIGH", 10, { x: DESIGN.width / 2, y: 208 }, { alpha: 0.45, letterSpacing: 1.5 }));
      layer.addChild(labels.make("ANTE BONUS ON A STRAIGHT OR BETTER", 10, { x: DESIGN.width / 2, y: 224 }, { alpha: 0.35, letterSpacing: 1.5 }));

      const names: Record<SpotName, string> = { pairPlus: "PAIR PLUS", ante: "ANTE", play: "PLAY" };
      for (const [name, at] of Object.entries(SPOTS) as [SpotName, Point][]) {
        const tap = name === "play" ? undefined : () => opts.onSpotTap(name);
        layer.addChild(betCircle(at, name === "pairPlus" ? 24 : 28, tap, name === "play" ? 0.35 : 0.6));
        layer.addChild(labels.make(names[name], 10.5, { x: at.x, y: at.y + 42 }, { alpha: 0.55, letterSpacing: 2 }));
      }
      layer.addChild(labels.make("5 – 500", 9, { x: SPOTS.pairPlus.x, y: SPOT_Y + 56 }, { alpha: 0.4 }));

      youLabel = labels.make("", 14, { x: DESIGN.width / 2, y: PLAYER_Y + 68 });
      dealerLabel = labels.make("", 13, { x: DESIGN.width / 2, y: DEALER_Y + 60 }, { alpha: 0.9 });
      badge = labels.make("", 16, { x: DESIGN.width / 2, y: 254 }, { fontWeight: "800", letterSpacing: 2 });
      layer.addChild(youLabel, dealerLabel, badge);

      cardLayer = new Container();
      layer.addChild(cardLayer);
      stacks = {
        ante: new ChipStack(ctx, layer, SPOTS.ante, 38),
        play: new ChipStack(ctx, layer, SPOTS.play, 38),
        pairPlus: new ChipStack(ctx, layer, SPOTS.pairPlus, 32, 2.5),
      };
    },

    async update(prev, next) {
      const h = next.hand;
      if (!h) {
        if (shownId) await sweep();
        shownId = "";
        await Promise.all([stacks.ante.set(next.ante), stacks.pairPlus.set(next.pairPlus), stacks.play.set(0)]);
        return;
      }
      if (next.id !== shownId) {
        if (shownId) await sweep();
        shownId = next.id;
      }
      const before = prev && prev.id === next.id ? prev.hand : null;
      await Promise.all([stacks.ante.set(h.ante), stacks.pairPlus.set(h.pairPlus), stacks.play.set(h.play)]);
      await syncCards(h);
      youLabel.text = h.label;
      if (h.done && !before?.done) await settle(h);
      else if (h.done && h.showdown) dealerLabel.text = h.showdown.dealer.label;
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
