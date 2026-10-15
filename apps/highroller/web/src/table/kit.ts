import { type Container, Graphics, Sprite, Text, type TextStyleOptions } from "pixi.js";
import type { Card } from "../../../src/games/index.js";
import type { Point } from "./anim";
import { chipBreakdown } from "./cosmetics";
import { DESIGN, type Layout, type SceneContext } from "./scene";

/**
 * Building blocks the game scenes share: the felt, felt lettering, cards
 * and chip stacks. Each keeps what it needs to re-take its textures when the
 * layout's density changes (`retexture`), so a scene's `resize` is a loop.
 */

export const INK = 0xf3efe2;
export const GOLD = 0xd4af37;
export const FONT = "Inter, system-ui, sans-serif";

/** The felt, filling the whole canvas beyond the design space's letterbox. */
export function placeFelt(felt: Sprite, ctx: SceneContext, layout: Layout) {
  const w = Math.ceil(layout.width / layout.scale);
  const h = Math.ceil(layout.height / layout.scale);
  felt.texture = ctx.textures.felt(ctx.equipped.felt, w, h);
  felt.position.set(-layout.offsetX / layout.scale, -layout.offsetY / layout.scale);
}

/** Text drawn at the canvas's density, centred on its position. */
export class Labels {
  private all: Text[] = [];

  constructor(private readonly ctx: SceneContext) {}

  make(text: string, size: number, at: Point, style: Partial<TextStyleOptions> & { alpha?: number } = {}): Text {
    const { alpha = 1, ...rest } = style;
    const t = new Text({
      text,
      style: { fontFamily: FONT, fontSize: size, fontWeight: "700", fill: INK, letterSpacing: 0.5, ...rest },
      resolution: this.ctx.textures.density,
    });
    t.anchor.set(0.5);
    t.position.set(at.x, at.y);
    t.alpha = alpha;
    this.all.push(t);
    return t;
  }

  retexture() {
    this.all = this.all.filter((t) => !t.destroyed);
    for (const t of this.all) t.resolution = this.ctx.textures.density;
  }
}

/** A table marking: a ring with lettering, optionally tappable. */
export function betCircle(at: Point, r: number, onTap?: () => void, alpha = 0.6): Graphics {
  const g = new Graphics().circle(at.x, at.y, r).stroke({ color: INK, alpha, width: 2 });
  if (onTap) {
    g.eventMode = "static";
    g.cursor = "pointer";
    // A little bigger than drawn: a thumb is not a cursor.
    g.hitArea = { contains: (x: number, y: number) => Math.hypot(x - at.x, y - at.y) <= r + 10 };
    g.on("pointertap", onTap);
  }
  return g;
}

export type CardSprite = Sprite & { code: Card | null; w: number };

/** Cards: face up when `code` is set, else the equipped back. */
export class Cards {
  constructor(private readonly ctx: SceneContext) {}

  texture(code: Card | null, w: number) {
    return code ? this.ctx.textures.card(code, w) : this.ctx.textures.back(this.ctx.equipped.back, w);
  }

  make(parent: Container, code: Card | null, w: number, faceUp = false): CardSprite {
    const s = new Sprite(this.texture(faceUp ? code : null, w)) as CardSprite;
    s.anchor.set(0.5);
    s.code = faceUp ? code : null;
    s.w = w;
    parent.addChild(s);
    return s;
  }

  /** Turns a card to `code` (or face down for null), animated. */
  async show(s: CardSprite, code: Card | null) {
    if (s.code === code) return;
    s.code = code;
    await this.ctx.anim.flip(s, this.texture(code, s.w));
  }

  /** Changes a card's size; its texture is re-taken at the new width. */
  resizeTo(s: CardSprite, w: number) {
    if (s.w === w) return;
    s.w = w;
    s.texture = this.texture(s.code, w);
  }

  retexture(sprites: Iterable<CardSprite>) {
    for (const s of sprites) if (!s.destroyed) s.texture = this.texture(s.code, s.w);
  }
}

/**
 * Chips on one bet spot. `set` grows or shrinks the stack (new chips slide
 * in from the player's side); `settle` pays it: winnings appear beside it
 * and everything flies to the balance pill, or the dealer sweeps it.
 */
export class ChipStack {
  private sprites: Sprite[] = [];
  amount = 0;

  constructor(
    private readonly ctx: SceneContext,
    private readonly parent: Container,
    public at: Point,
    private readonly d = 40,
    private readonly lift = 3,
  ) {}

  private tex(v: number) {
    return this.ctx.textures.chip(this.ctx.equipped.chips, v, this.d);
  }

  private values(amount: number) {
    return chipBreakdown(amount, 8).reverse();
  }

  async set(amount: number, from: Point = { x: this.at.x, y: DESIGN.height + 40 }) {
    if (amount === this.amount) return;
    const values = this.values(amount);
    const keep = Math.min(this.sprites.length, values.length);
    for (const s of this.sprites.slice(keep)) s.destroy();
    this.sprites = this.sprites.slice(0, keep);
    const fresh: Sprite[] = [];
    for (let i = keep; i < values.length; i++) {
      const s = new Sprite(this.tex(values[i]));
      s.anchor.set(0.5);
      s.position.set(from.x, from.y);
      this.parent.addChild(s);
      this.sprites.push(s);
      fresh.push(s);
    }
    this.sprites.forEach((s, i) => (s.texture = this.tex(values[i])));
    this.amount = amount;
    await Promise.all(fresh.map((s, i) => this.ctx.anim.pushStack([s], { x: this.at.x, y: this.at.y - (keep + i) * this.lift }, 0)));
  }

  /** Places the stack at once, no animation (a resumed hand). */
  place(amount: number) {
    this.clear();
    const values = this.values(amount);
    this.sprites = values.map((v, i) => {
      const s = new Sprite(this.tex(v));
      s.anchor.set(0.5);
      s.position.set(this.at.x, this.at.y - i * this.lift);
      this.parent.addChild(s);
      return s;
    });
    this.amount = amount;
  }

  async moveTo(p: Point) {
    this.at = p;
    await Promise.all(this.sprites.map((s, i) => this.ctx.anim.slide(s, { x: p.x, y: p.y - i * this.lift }, { duration: 220 })));
  }

  /**
   * Pays the spot: `returned` chips come back (the stake included). Above
   * the stake, winnings appear beside it first; nothing back, and the dealer
   * sweeps it to `sweepTo`.
   */
  async settle(returned: number, sweepTo: Point) {
    const target = this.ctx.balanceTarget() ?? { x: DESIGN.width / 2, y: -40 };
    const stake = this.amount;
    // Chips inside a zoomed container (roulette's felt) fly in the root's space.
    const root = this.ctx.root;
    const stack = this.sprites.map((s) => {
      const p = root.toLocal(s.getGlobalPosition());
      const scale = s.worldTransform.a / root.worldTransform.a;
      root.addChild(s);
      s.position.set(p.x, p.y);
      s.scale.set(scale);
      return s;
    });
    const base = stack[0] ? { x: stack[0].x, y: stack[0].y, scale: stack[0].scale.x } : { ...root.toLocal(this.parent.toGlobal(this.at)), scale: 1 };
    this.sprites = [];
    this.amount = 0;

    if (returned <= 0) {
      await this.ctx.anim.collect(stack, sweepTo);
    } else {
      const won = returned > stake ? this.values(returned - stake) : [];
      const extra = won.map((v, i) => {
        const s = new Sprite(this.tex(v));
        s.anchor.set(0.5);
        s.scale.set(base.scale);
        s.position.set(base.x + this.d * 0.95 * base.scale, base.y - i * this.lift * base.scale);
        s.alpha = 0;
        root.addChild(s);
        return s;
      });
      await Promise.all(extra.map((s, i) => this.ctx.anim.tween(s, { alpha: 1 }, { duration: 120, delay: i * 30 })));
      await this.ctx.anim.payout([...stack, ...extra], target);
      for (const s of extra) s.destroy();
    }
    for (const s of stack) s.destroy();
  }

  retexture() {
    const values = this.values(this.amount);
    this.sprites.forEach((s, i) => (s.texture = this.tex(values[i])));
  }

  clear() {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    this.amount = 0;
  }
}
