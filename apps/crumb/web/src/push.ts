import { api } from "./api";

/**
 * Turning notifications on and off for this device.
 *
 * Web Push needs the service worker, so it only works in a production build
 * (main.tsx registers sw.js there). On iPhone and iPad it also needs the app
 * opened from the Home Screen: Safari in a tab has no PushManager at all.
 */

export type PushState =
  | { kind: "unsupported"; reason: string }
  | { kind: "needs-install" }
  | { kind: "blocked" }
  | { kind: "off" }
  | { kind: "on"; endpoint: string };

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return { kind: "needs-install" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { kind: "unsupported", reason: "This browser can't receive notifications." };
  }
  const reg = await registration();
  if (!reg) {
    return {
      kind: "unsupported",
      reason: import.meta.env.PROD ? "The app is still installing. Reload and try again." : "Notifications need a production build.",
    };
  }
  if (Notification.permission === "denied") return { kind: "blocked" };
  const sub = await reg.pushManager.getSubscription();
  return sub ? { kind: "on", endpoint: sub.endpoint } : { kind: "off" };
}

/** Asks for permission (call from a tap), subscribes and tells the server. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? { kind: "blocked" } : { kind: "off" };

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  if (!publicKey) return { kind: "unsupported", reason: "Notifications are turned off on the server." };

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
  await api.subscribe(toWire(sub));
  return { kind: "on", endpoint: sub.endpoint };
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return { kind: "off" };
}

function toWire(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
