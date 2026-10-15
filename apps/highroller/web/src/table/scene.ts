import type { Application, Container } from "pixi.js";
import type { Animator, Point } from "./anim";
import type { Equipped } from "./cosmetics";
import type { TextureKit } from "./textures";

/**
 * A scene draws one game's table. Scenes lay out in a portrait design space
 * (DESIGN) that TableCanvas scales to fit the screen, so a scene never thinks
 * about pixels or device pixel ratios.
 *
 * A scene receives the hand's public view and animates the difference from
 * the previous one. It decides nothing: every outcome comes from the server,
 * and the React chrome around the canvas (bet bar, action bar) sends the
 * player's choices.
 *
 * The design space is 390 wide (a typical phone in CSS pixels) by 560 tall: what is left of a
 * portrait phone under the header, above the bet bar and the tab bar. Taller
 * screens letterbox it, and the felt fills the rest.
 */
export const DESIGN = { width: 390, height: 560 } as const;

export interface Layout {
  /** The canvas in CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per design unit. */
  scale: number;
  /** Where the design space's origin sits in the canvas, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** The renderer's resolution (device pixel ratio, capped at 2). */
  resolution: number;
}

/** Fits the design space inside the canvas, centred, keeping its aspect ratio. */
export function fit(width: number, height: number, resolution: number, design: { width: number; height: number } = DESIGN): Layout {
  const scale = Math.max(0.01, Math.min(width / design.width, height / design.height));
  return {
    width,
    height,
    scale,
    offsetX: (width - design.width * scale) / 2,
    offsetY: (height - design.height * scale) / 2,
    resolution,
  };
}

export interface SceneContext {
  app: Application;
  /** Positioned and scaled to the design space; scenes add their children here. */
  root: Container;
  textures: TextureKit;
  anim: Animator;
  equipped: Equipped;
  /** Where the balance pill is, in design units, for payout animations; null if it's off screen. */
  balanceTarget(): Point | null;
}

export interface Scene<View> {
  mount(ctx: SceneContext, layout: Layout): void;
  /** Animates from `prev` (null on first show) to `next`. Updates are queued, never overlapped. */
  update(prev: View | null, next: View): void | Promise<void>;
  /** The layout changed. If `ctx.textures.density` changed too, re-take every texture. */
  resize(layout: Layout): void;
  /** Removes what mount added. A scene may be mounted again afterwards. */
  destroy(): void;
}
