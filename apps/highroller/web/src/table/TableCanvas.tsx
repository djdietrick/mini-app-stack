import { Application, Container } from "pixi.js";
import { useEffect, useRef } from "react";
import { useSettings } from "../settings";
import { Animator } from "./anim";
import { DEFAULT_EQUIPPED, type Equipped } from "./cosmetics";
import { type Layout, type Scene, type SceneContext, fit } from "./scene";
import { createTextureKit } from "./textures";

/** Renders at most 2 device pixels per CSS pixel: past that, the fill cost buys nothing visible. */
const MAX_RESOLUTION = 2;
/** The battery saver's frame cap. Tweens run on elapsed time, so they only get choppier, never slower. */
const SAVER_FPS = 30;

/**
 * One Pixi Application per table screen, in a container that sizes it.
 *
 * - Resizes with the container (ResizeObserver), so rotating the phone or
 *   resizing the window re-lays out without a reload.
 * - Caps the resolution at a device pixel ratio of 2; with the battery saver
 *   setting, renders at 1, without antialiasing, at most 30 frames a second
 *   (changing it remounts the canvas).
 * - Stops the ticker while the tab is hidden.
 * - Prefers WebGL and falls back to the canvas renderer.
 * - Destroys everything on unmount — scene, textures, renderer — and loses
 *   the WebGL context, so switching games never leaks GPU memory.
 *
 * `scene` must be stable for the canvas's lifetime (create it with useState).
 * Each new `view` is handed to `scene.update(prev, next)`; updates queue so
 * one animation finishes before the next starts. `onShown(view)` fires once a
 * view's animation has finished, which is when a screen should move the
 * balance or announce a result: never before the cards have landed.
 */
export function TableCanvas<View>({
  scene,
  view,
  equipped = DEFAULT_EQUIPPED,
  className = "",
  onError,
  onShown,
}: {
  scene: Scene<View>;
  view: View | null;
  equipped?: Equipped;
  className?: string;
  onError?: (e: unknown) => void;
  onShown?: (view: View) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const applied = useRef<View | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(view);
  latest.current = view;
  const shown = useRef(onShown);
  shown.current = onShown;
  const saver = useSettings().batterySaver;

  const enqueue = (next: View) => {
    queue.current = queue.current
      .then(async () => {
        if (!ready.current || next === applied.current) return;
        const prev = applied.current;
        applied.current = next;
        await scene.update(prev, next);
        shown.current?.(next);
      })
      .catch((e) => onError?.(e));
  };

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    let teardown = () => {};

    (async () => {
      const resolution = saver ? 1 : Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION);
      const app = new Application();
      await app.init({
        preference: ["webgl", "canvas"],
        backgroundAlpha: 0,
        antialias: !saver,
        resolution,
        autoDensity: true,
        width: Math.max(1, el.clientWidth),
        height: Math.max(1, el.clientHeight),
      });
      // Canvas text in the textures uses the page's fonts when they've loaded.
      await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

      if (disposed) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }

      if (saver) app.ticker.maxFPS = SAVER_FPS;
      app.canvas.classList.add("table-canvas");
      app.canvas.style.display = "block";
      el.appendChild(app.canvas);

      const root = new Container();
      app.stage.addChild(root);
      let layout: Layout = fit(el.clientWidth, el.clientHeight, resolution);
      const textures = createTextureKit(layout.scale * resolution);
      const anim = new Animator(app.ticker);
      const place = () => {
        root.position.set(layout.offsetX, layout.offsetY);
        root.scale.set(layout.scale);
      };
      place();

      const ctx: SceneContext = {
        app,
        root,
        textures,
        anim,
        equipped,
        balanceTarget() {
          const pill = document.querySelector("[data-balance-pill]");
          if (!pill) return null;
          const p = pill.getBoundingClientRect();
          const c = app.canvas.getBoundingClientRect();
          return {
            x: (p.left + p.width / 2 - c.left - layout.offsetX) / layout.scale,
            y: (p.top + p.height / 2 - c.top - layout.offsetY) / layout.scale,
          };
        },
      };

      scene.mount(ctx, layout);
      ready.current = true;
      applied.current = null;
      if (latest.current !== null) enqueue(latest.current);

      const ro = new ResizeObserver(() => {
        const w = Math.max(1, el.clientWidth);
        const h = Math.max(1, el.clientHeight);
        if (w === layout.width && h === layout.height) return;
        app.renderer.resize(w, h);
        layout = fit(w, h, resolution);
        place();
        textures.setDensity(layout.scale * resolution);
        scene.resize(layout);
        textures.flushStale(app.stage);
      });
      ro.observe(el);

      const onVisibility = () => (document.hidden ? app.ticker.stop() : app.ticker.start());
      document.addEventListener("visibilitychange", onVisibility);

      teardown = () => {
        ready.current = false;
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        anim.destroy();
        scene.destroy();
        // The kit owns every texture; the renderer only has to drop its tree.
        textures.destroy();
        app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
      };
    })().catch((e) => onError?.(e));

    return () => {
      disposed = true;
      teardown();
    };
    // The scene is fixed for the canvas's life; equipped and the battery saver remount it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, equipped, saver]);

  useEffect(() => {
    if (view !== null) enqueue(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return <div ref={host} className={"relative h-full w-full overflow-hidden " + className} />;
}
