import type { Container, FederatedPointerEvent } from "pixi.js";
import { type Animator, ease } from "./anim";

/**
 * Pan and zoom for tables built for wide screens (the roulette layout). The
 * content container is laid out at zoom 1 to fit the design width; the player
 * pinches to zoom, drags to pan while zoomed, or a scene calls `zoomTo` when a
 * zone is tapped. Bets are always placed by tapping, never by dragging, so a
 * drag here only ever moves the view.
 *
 * Coordinates are design units within `viewport` (the visible rect the
 * content may scroll under). Content is clamped so it always covers it.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanZoomOptions {
  /** The part of the design space the content shows through. */
  viewport: Rect;
  /** The content's own size at zoom 1. */
  content: { width: number; height: number };
  maxZoom?: number;
}

/** Movement under this many design units still counts as a tap. */
const TAP_SLOP = 8;

export class PanZoom {
  private zoom = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number; mid: { x: number; y: number } } | null = null;
  private dragFrom: { x: number; y: number; cx: number; cy: number } | null = null;
  private moved = 0;
  private readonly maxZoom: number;

  constructor(
    private readonly content: Container,
    /** The container pointer events arrive on; its local space is design units. */
    private readonly surface: Container,
    private readonly anim: Animator,
    private opts: PanZoomOptions,
  ) {
    this.maxZoom = opts.maxZoom ?? 3;
    surface.eventMode = "static";
    surface.on("pointerdown", this.down);
    surface.on("globalpointermove", this.move);
    surface.on("pointerup", this.up);
    surface.on("pointerupoutside", this.up);
    this.apply(1, opts.viewport.x, opts.viewport.y);
  }

  get scale() {
    return this.zoom;
  }

  /** True while the last pointer sequence was a drag or pinch, so a scene can ignore it as a tap. */
  get wasGesture() {
    return this.moved > TAP_SLOP;
  }

  setViewport(viewport: Rect) {
    this.opts = { ...this.opts, viewport };
    this.apply(this.zoom, this.content.x, this.content.y);
  }

  /** Animates so `rect` (in content units at zoom 1) fills the viewport. */
  zoomTo(rect: Rect): Promise<void> {
    const v = this.opts.viewport;
    const z = this.clampZoom(Math.min(v.width / rect.width, v.height / rect.height));
    const x = v.x + v.width / 2 - (rect.x + rect.width / 2) * z;
    const y = v.y + v.height / 2 - (rect.y + rect.height / 2) * z;
    return this.animateTo(z, x, y);
  }

  reset(): Promise<void> {
    return this.animateTo(1, this.opts.viewport.x, this.opts.viewport.y);
  }

  destroy() {
    this.surface.off("pointerdown", this.down);
    this.surface.off("globalpointermove", this.move);
    this.surface.off("pointerup", this.up);
    this.surface.off("pointerupoutside", this.up);
  }

  private async animateTo(z: number, x: number, y: number) {
    const target = this.clamp(z, x, y);
    this.zoom = target.z;
    await this.anim.tween(this.content, { x: target.x, y: target.y, "scale.x": target.z, "scale.y": target.z }, { duration: 280, ease: ease.inOut });
  }

  private clampZoom(z: number) {
    return Math.min(this.maxZoom, Math.max(1, z));
  }

  /** Keeps the content covering the viewport (or centred in it, when smaller). */
  private clamp(z: number, x: number, y: number) {
    const v = this.opts.viewport;
    const w = this.opts.content.width * z;
    const h = this.opts.content.height * z;
    const cx = w <= v.width ? v.x + (v.width - w) / 2 : Math.min(v.x, Math.max(v.x + v.width - w, x));
    const cy = h <= v.height ? v.y + (v.height - h) / 2 : Math.min(v.y, Math.max(v.y + v.height - h, y));
    return { z, x: cx, y: cy };
  }

  private apply(z: number, x: number, y: number) {
    const c = this.clamp(this.clampZoom(z), x, y);
    this.zoom = c.z;
    this.content.scale.set(c.z);
    this.content.position.set(c.x, c.y);
  }

  private local(e: FederatedPointerEvent) {
    return this.surface.toLocal(e.global);
  }

  private readonly down = (e: FederatedPointerEvent) => {
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y });
    if (this.pointers.size === 1) {
      this.moved = 0;
      this.dragFrom = { x: p.x, y: p.y, cx: this.content.x, cy: this.content.y };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: this.zoom,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      this.dragFrom = null;
    }
  };

  private readonly move = (e: FederatedPointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y });

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const z = this.clampZoom((this.pinch.zoom * dist) / this.pinch.dist);
      // Zoom about the pinch's midpoint: that content point stays under the fingers.
      const mid = this.pinch.mid;
      const k = z / this.zoom;
      this.moved = TAP_SLOP + 1;
      this.apply(z, mid.x - (mid.x - this.content.x) * k, mid.y - (mid.y - this.content.y) * k);
    } else if (this.dragFrom) {
      const dx = p.x - this.dragFrom.x;
      const dy = p.y - this.dragFrom.y;
      this.moved = Math.max(this.moved, Math.hypot(dx, dy));
      if (this.zoom > 1 && this.moved > TAP_SLOP) this.apply(this.zoom, this.dragFrom.cx + dx, this.dragFrom.cy + dy);
    }
  };

  private readonly up = (e: FederatedPointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 1) {
      const [p] = [...this.pointers.values()];
      this.dragFrom = { x: p.x, y: p.y, cx: this.content.x, cy: this.content.y };
    }
    if (this.pointers.size === 0) this.dragFrom = null;
  };
}
