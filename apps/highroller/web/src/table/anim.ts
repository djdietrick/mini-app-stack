import type { Container, Texture, Ticker } from "pixi.js";
import { play } from "../audio/sfx";
import { motionScale } from "../settings";

/**
 * Promise-based tweens on the Pixi ticker, plus the table's stock moves:
 * deal, flip, slide, collect, a chip-stack push and payout chips flying to
 * the balance pill.
 *
 * Every duration is multiplied by `motionScale()`: 0.5 with the "fast"
 * setting, 0 with reduced motion (the setting or prefers-reduced-motion), in
 * which case a tween sets its end values at once and resolves. Tweens run on
 * the ticker, so they pause with it while the tab is hidden.
 *
 * The stock moves make their sounds (audio/sfx.ts) as they start, scheduled
 * on the audio clock by the same scaled delay; with Sound off that is nothing.
 */
export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
} satisfies Record<string, Ease>;

export interface TweenOptions {
  /** Milliseconds at normal speed. */
  duration: number;
  delay?: number;
  ease?: Ease;
}

/** Numeric properties by path: "x", "alpha", "scale.x", "rotation". */
type Props = Record<string, number>;

interface Running {
  target: object;
  from: Props;
  to: Props;
  elapsed: number;
  duration: number;
  delay: number;
  ease: Ease;
  resolve: () => void;
}

function get(target: object, path: string): number {
  return path.split(".").reduce<any>((o, k) => o[k], target) as number;
}

function set(target: object, path: string, value: number): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const owner = keys.reduce<any>((o, k) => o[k], target);
  owner[last] = value;
}

export interface Point {
  x: number;
  y: number;
}

export class Animator {
  private running = new Set<Running>();
  private readonly tick = (t: Ticker) => this.step(t.deltaMS);

  constructor(private readonly ticker: Ticker) {
    ticker.add(this.tick);
  }

  tween(target: object, to: Props, opts: TweenOptions): Promise<void> {
    const scale = motionScale();
    if (scale === 0) {
      for (const [k, v] of Object.entries(to)) set(target, k, v);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.running.add({
        target,
        from: {},
        to,
        elapsed: 0,
        duration: Math.max(1, opts.duration * scale),
        delay: (opts.delay ?? 0) * scale,
        ease: opts.ease ?? ease.out,
        resolve,
      });
    });
  }

  /** Waits on the ticker, so a pause (hidden tab) pauses this too. */
  wait(ms: number): Promise<void> {
    return this.tween({ t: 0 }, { t: 1 }, { duration: ms, ease: ease.linear });
  }

  private step(dt: number) {
    for (const r of this.running) {
      if ((r.target as { destroyed?: boolean }).destroyed) {
        this.running.delete(r);
        r.resolve();
        continue;
      }
      let d = dt;
      if (r.delay > 0) {
        r.delay -= d;
        if (r.delay > 0) continue;
        d = -r.delay;
      }
      if (r.elapsed === 0) for (const k of Object.keys(r.to)) r.from[k] = get(r.target, k);
      r.elapsed = Math.min(r.duration, r.elapsed + d);
      const t = r.ease(r.elapsed / r.duration);
      for (const [k, v] of Object.entries(r.to)) set(r.target, k, r.from[k] + (v - r.from[k]) * t);
      if (r.elapsed >= r.duration) {
        this.running.delete(r);
        r.resolve();
      }
    }
  }

  /** Finishes nothing and resolves everything: for unmounting mid-animation. */
  cancelAll() {
    for (const r of this.running) r.resolve();
    this.running.clear();
  }

  destroy() {
    this.cancelAll();
    this.ticker.remove(this.tick);
  }

  // ---------- the table's moves ----------

  /** A card leaves the shoe and lands at `to`, face down until `flip` turns it. */
  async deal(card: Container, from: Point, to: Point, opts: { delay?: number; rotation?: number } = {}) {
    card.position.set(from.x, from.y);
    card.rotation = -0.5;
    card.alpha = 1;
    play("card", (opts.delay ?? 0) * motionScale());
    await this.tween(card, { x: to.x, y: to.y, rotation: opts.rotation ?? 0 }, { duration: 320, delay: opts.delay, ease: ease.out });
  }

  /**
   * Turns a card over to `face` by squashing it to an edge and back. Pass a
   * function to take the texture at the moment it shows: a resize during the
   * first half re-densities the kit and frees a texture taken earlier.
   */
  async flip(card: Container & { texture: Texture }, face: Texture | (() => Texture)) {
    const sx = Math.abs(card.scale.x) || 1;
    play("flip");
    await this.tween(card, { "scale.x": 0 }, { duration: 110, ease: ease.in });
    card.texture = typeof face === "function" ? face() : face;
    await this.tween(card, { "scale.x": sx }, { duration: 130, ease: ease.out });
  }

  slide(obj: Container, to: Point, opts: { duration?: number; delay?: number } = {}) {
    return this.tween(obj, { x: to.x, y: to.y }, { duration: opts.duration ?? 260, delay: opts.delay, ease: ease.inOut });
  }

  /** Sweeps things to one point and fades them, e.g. the dealer collecting cards. */
  async collect(objs: Container[], to: Point) {
    if (objs.length) play("card");
    await Promise.all(
      objs.map((o, i) =>
        this.tween(o, { x: to.x, y: to.y, alpha: 0, rotation: 0.3 }, { duration: 360, delay: i * 40, ease: ease.in }),
      ),
    );
  }

  /** Chips slide one after another onto a stack at `to`, each a little higher. */
  async pushStack(chips: Container[], to: Point, lift = 3) {
    const scale = motionScale();
    chips.slice(0, 6).forEach((_, i) => play("chip", (i * 45 + 200) * scale));
    await Promise.all(
      chips.map((c, i) => this.tween(c, { x: to.x, y: to.y - i * lift }, { duration: 240, delay: i * 45, ease: ease.back })),
    );
  }

  /** Chips fly to the balance pill (or `to`) and fade as they arrive. */
  async payout(chips: Container[], to: Point) {
    const scale = motionScale();
    chips.slice(0, 6).forEach((_, i) => play("chip", (i * 55 + 480) * scale));
    await Promise.all(
      chips.map((c, i) =>
        this.tween(c, { x: to.x, y: to.y, alpha: 0.2, "scale.x": 0.6, "scale.y": 0.6 }, { duration: 520, delay: i * 55, ease: ease.inOut }),
      ),
    );
  }
}
