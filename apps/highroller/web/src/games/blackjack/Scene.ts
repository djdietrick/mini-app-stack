import { Container, Graphics, Sprite, type Text } from "pixi.js";
import type { BlackjackView, HandOutcome } from "../../../../src/games/blackjack/engine.js";
import { totalLabel } from "../../../../src/games/blackjack/engine.js";
import type { Card } from "../../../../src/games/index.js";
import { chipsShort } from "../../format";
import type { Point } from "../../table/anim";
import { type CardSprite, Cards, ChipStack, GOLD, INK, Labels, betCircle, placeFelt } from "../../table/kit";
import { DESIGN, type Layout, type Scene, type SceneContext } from "../../table/scene";

/**
 * The blackjack table, portrait: the shoe top right, the dealer's cards
 * across the top, your hands along the bottom (split hands side by side, the
 * one in play outlined) and a bet circle under each.
 *
 * It animates the difference between two views: new cards come off the
 * shoe, the hole card turns, a split slides the second card to a new hand,
 * and at the end each hand's chips are paid to the balance or swept.
 */
export interface BlackjackSceneView {
  /** The hand's id, "" while betting: a new id sweeps the last hand away. */
  id: string;
  /** Null while the next hand's bet is being placed. */
  hand: BlackjackView | null;
  /** The bet on the circle while betting. */
  bet: number;
}

// Below the frame's top bar (back, title, info), which sits over the canvas.
const SHOE: Point = { x: 350, y: 104 };
const DISCARD: Point = { x: 36, y: 104 };
const DEALER_Y = 118;
const PLAYER_Y = 344;
const SPOT_Y = 474;
const SPOT_R = 32;
const DEALER_W = 62;

const OUTCOME_TEXT: Record<HandOutcome, string> = {
  blackjack: "BLACKJACK",
  win: "WIN",
  push: "PUSH",
  loss: "LOSE",
  bust: "BUST",
  surrender: "SURRENDER",
};

/** Card width and centre x of hand `i` of `n`. */
function handSlot(i: number, n: number) {
  const slot = DESIGN.width / n;
  return { w: n <= 2 ? 62 : 48, cx: slot * (i + 0.5), slot };
}

function handCardPos(i: number, n: number, j: number, len: number): Point {
  const { w, cx, slot } = handSlot(i, n);
  const dx = Math.min(w * 0.36, (slot - w - 10) / Math.max(1, len - 1));
  const dy = w * 0.2;
  return { x: cx - ((len - 1) * dx) / 2 + j * dx, y: PLAYER_Y - j * dy + ((len - 1) * dy) / 2 };
}

function dealerCardPos(j: number, len: number): Point {
  const dx = DEALER_W * 0.66;
  return { x: DESIGN.width / 2 - ((len - 1) * dx) / 2 + j * dx, y: DEALER_Y };
}

export function createBlackjackScene(opts: { onSpotTap: () => void }): Scene<BlackjackSceneView> {
  let ctx: SceneContext;
  let cards: Cards;
  let labels: Labels;
  let felt: Sprite;
  let shoe: Sprite;
  let layer: Container;
  let cardLayer: Container;
  let dealer: CardSprite[] = [];
  let hands: CardSprite[][] = [];
  let stacks: ChipStack[] = [];
  let insurance: ChipStack;
  let spot: Graphics;
  let spotText: Text[] = [];
  let dealerLabel: Text;
  let handLabels: Text[] = [];
  let highlight: Graphics;
  let shownId = "";

  const allCards = () => [...dealer, ...hands.flat()];

  function newCard(w: number): CardSprite {
    const s = cards.make(cardLayer, null, w);
    s.position.set(SHOE.x, SHOE.y);
    return s;
  }

  async function dealTo(s: CardSprite, to: Point, face: Card | null) {
    await ctx.anim.deal(s, SHOE, to, { rotation: (Math.random() - 0.5) * 0.05 });
    if (face) await cards.show(s, face);
  }

  function clearText(list: Text[]) {
    for (const t of list) t.destroy();
    return [];
  }

  /** Sweeps the last hand's cards to the discard and resets the table for betting. */
  async function sweep() {
    const all = allCards();
    dealer = [];
    hands = [];
    handLabels = clearText(handLabels);
    dealerLabel.text = "";
    highlight.clear();
    for (const st of stacks.slice(1)) st.clear();
    stacks = stacks.slice(0, 1);
    stacks[0].at = { x: DESIGN.width / 2, y: SPOT_Y };
    if (all.length) {
      await ctx.anim.collect(all, DISCARD);
      for (const s of all) s.destroy();
    }
    spot.visible = true;
    for (const t of spotText) t.visible = true;
  }

  function relabel(h: BlackjackView) {
    const visible = h.dealer.filter((c): c is Card => c !== null);
    dealerLabel.text = totalLabel(visible, !h.dealer.includes(null)).toUpperCase();

    while (handLabels.length < h.hands.length) {
      const t = labels.make("", 13, { x: 0, y: 0 });
      layer.addChild(t);
      handLabels.push(t);
    }
    h.hands.forEach((hv, i) => {
      const t = handLabels[i];
      const { cx } = handSlot(i, h.hands.length);
      t.text = totalLabel(hv.cards, !hv.split).toUpperCase();
      t.style.fill = INK;
      t.style.fontSize = 13;
      t.position.set(cx, PLAYER_Y + 70);
    });

    highlight.clear();
    if (h.active !== null && h.hands.length > 1) {
      const { cx, slot } = handSlot(h.active, h.hands.length);
      const w = Math.min(slot - 6, 150);
      highlight.roundRect(cx - w / 2, PLAYER_Y - 78, w, 160, 12).stroke({ color: GOLD, width: 2.5, alpha: 0.9 });
    }
  }

  /** Makes room for every hand. On a split the split hand's second card becomes the next hand's first. */
  function restructure(prev: BlackjackView | null, h: BlackjackView) {
    const n = h.hands.length;
    if (prev && n === prev.hands.length + 1 && prev.active !== null && hands[prev.active]?.length >= 2) {
      const i = prev.active;
      hands.splice(i + 1, 0, hands[i].splice(1));
      stacks.splice(i + 1, 0, new ChipStack(ctx, layer, stacks[i].at));
    }
    while (hands.length < n) hands.push([]);
    while (stacks.length < n) stacks.push(new ChipStack(ctx, layer, { x: DESIGN.width / 2, y: SPOT_Y }));
  }

  async function syncCards(h: BlackjackView) {
    const n = h.hands.length;

    // Everything already down slides to where the new layout wants it.
    const moves: Promise<void>[] = [];
    hands.forEach((list, i) =>
      list.forEach((s, j) => {
        cards.resizeTo(s, handSlot(i, n).w);
        moves.push(ctx.anim.slide(s, handCardPos(i, n, j, h.hands[i].cards.length), { duration: 220 }));
      }),
    );
    dealer.forEach((s, j) => moves.push(ctx.anim.slide(s, dealerCardPos(j, h.dealer.length), { duration: 220 })));
    stacks.forEach((st, i) => moves.push(st.moveTo({ x: handSlot(i, n).cx, y: SPOT_Y })));
    await Promise.all(moves);

    // New cards, in table order: the opening deal alternates player and dealer.
    const opening = hands.every((l) => l.length === 0) && dealer.length === 0;
    if (opening) {
      for (let j = 0; j < 2; j++) {
        const p = newCard(handSlot(0, n).w);
        hands[0].push(p);
        await dealTo(p, handCardPos(0, n, j, h.hands[0].cards.length), h.hands[0].cards[j]);
        const d = newCard(DEALER_W);
        dealer.push(d);
        await dealTo(d, dealerCardPos(j, h.dealer.length), h.dealer[j]);
      }
    }
    for (let i = 0; i < n; i++) {
      const want = h.hands[i].cards;
      for (let j = hands[i].length; j < want.length; j++) {
        const s = newCard(handSlot(i, n).w);
        hands[i].push(s);
        await dealTo(s, handCardPos(i, n, j, want.length), want[j]);
      }
    }
    // The dealer's turn: the hole card turns, then any hits.
    for (let j = 0; j < dealer.length; j++) if (h.dealer[j] && dealer[j].code !== h.dealer[j]) await cards.show(dealer[j], h.dealer[j]);
    for (let j = dealer.length; j < h.dealer.length; j++) {
      const s = newCard(DEALER_W);
      dealer.push(s);
      await ctx.anim.wait(220);
      await Promise.all(dealer.map((d, k) => (k < j ? ctx.anim.slide(d, dealerCardPos(k, h.dealer.length), { duration: 160 }) : undefined)));
      await dealTo(s, dealerCardPos(j, h.dealer.length), h.dealer[j]);
    }
  }

  async function syncChips(h: BlackjackView) {
    await Promise.all(h.hands.map((hv, i) => stacks[i].set(hv.bet * (hv.doubled ? 2 : 1))));
    await insurance.set(h.insurance);
  }

  async function settle(h: BlackjackView) {
    await ctx.anim.wait(250);
    const n = h.hands.length;
    // Each hand's label gains its result: "18 · WIN", "BUST", "BLACKJACK +150".
    h.hands.forEach((hv, i) => {
      const r = hv.result;
      const t = handLabels[i];
      if (!r || !t) return;
      const won = r.outcome === "win" || r.outcome === "blackjack";
      const net = r.returned - hv.bet * (hv.doubled ? 2 : 1);
      const total = totalLabel(hv.cards, !hv.split).toUpperCase();
      const word = OUTCOME_TEXT[r.outcome];
      t.text = (total === word ? word : `${total} · ${word}`) + (won && n === 1 ? ` +${chipsShort(net)}` : "");
      t.style.fill = won ? 0x6ee7a8 : r.outcome === "push" ? INK : 0xf87171;
      t.style.fontSize = n > 2 ? 12 : 15;
    });
    await ctx.anim.wait(150);
    const sweepTo = { x: DESIGN.width / 2, y: 20 };
    await Promise.all([
      ...h.hands.map((hv, i) => stacks[i].settle(hv.result?.returned ?? 0, sweepTo)),
      insurance.amount ? insurance.settle(h.insuranceReturned ?? 0, sweepTo) : undefined,
    ]);
  }

  return {
    mount(c, layout) {
      ctx = c;
      cards = new Cards(ctx);
      labels = new Labels(ctx);
      dealer = [];
      hands = [];
      handLabels = [];
      shownId = "";

      felt = new Sprite();
      ctx.root.addChild(felt);
      placeFelt(felt, ctx, layout);
      layer = new Container();
      ctx.root.addChild(layer);

      const markings = new Graphics()
        .arc(DESIGN.width / 2, -160, 420, Math.PI * 0.3, Math.PI * 0.7)
        .stroke({ color: INK, alpha: 0.3, width: 2 });
      layer.addChild(markings);
      layer.addChild(labels.make("BLACKJACK PAYS 3 TO 2", 13, { x: DESIGN.width / 2, y: 228 }, { alpha: 0.55, letterSpacing: 2.5 }));
      layer.addChild(labels.make("Dealer stands on soft 17 · Insurance pays 2 to 1", 10.5, { x: DESIGN.width / 2, y: 248 }, { alpha: 0.45, fontWeight: "600" }));

      shoe = new Sprite(cards.texture(null, 54));
      shoe.anchor.set(0.5);
      shoe.position.set(SHOE.x + 4, SHOE.y - 4);
      shoe.rotation = -0.5;
      layer.addChild(shoe);

      spot = betCircle({ x: DESIGN.width / 2, y: SPOT_Y }, SPOT_R, opts.onSpotTap);
      layer.addChild(spot);
      spotText = [labels.make("BET", 11, { x: DESIGN.width / 2, y: SPOT_Y }, { alpha: 0.5, letterSpacing: 2 }), labels.make("10 – 5,000", 10, { x: DESIGN.width / 2, y: SPOT_Y + SPOT_R + 12 }, { alpha: 0.45 })];
      for (const t of spotText) layer.addChild(t);

      dealerLabel = labels.make("", 13, { x: DESIGN.width / 2, y: DEALER_Y + 60 });
      layer.addChild(dealerLabel);
      highlight = new Graphics();
      layer.addChild(highlight);

      cardLayer = new Container();
      layer.addChild(cardLayer);
      stacks = [new ChipStack(ctx, layer, { x: DESIGN.width / 2, y: SPOT_Y })];
      insurance = new ChipStack(ctx, layer, { x: 64, y: 236 }, 30, 2.5);
    },

    async update(prev, next) {
      const h = next.hand;
      if (!h) {
        if (shownId) await sweep();
        shownId = "";
        await stacks[0].set(next.bet);
        return;
      }
      if (next.id !== shownId) {
        if (shownId) await sweep();
        shownId = next.id;
        if (!prev || prev.id !== "") stacks[0].place(h.hands[0].bet);
      }
      spot.visible = false;
      for (const t of spotText) t.visible = false;
      const before = prev && prev.id === next.id ? prev.hand : null;
      restructure(before, h);
      await syncChips(h);
      await syncCards(h);
      relabel(h);
      if (h.phase === "done" && before?.phase !== "done") await settle(h);
    },

    resize(layout) {
      placeFelt(felt, ctx, layout);
      cards.retexture(allCards());
      shoe.texture = cards.texture(null, 54);
      for (const st of [...stacks, insurance]) st.retexture();
      labels.retexture();
    },

    destroy() {
      ctx.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    },
  };
}
