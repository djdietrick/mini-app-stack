/**
 * Thin client for /api. The wire types come straight from the server's domain
 * module, type-only, so zod and the server stay out of the bundle and the SPA
 * and both backends share one definition.
 */
import type {
  ClaimResponse,
  HandPage,
  HandResponse,
  HandRow,
  LedgerKind,
  LedgerPage,
  LedgerRow,
  PlayerRow,
} from "../../src/domain/types.js";

export type { ClaimResponse, HandPage, HandResponse, HandRow, LedgerKind, LedgerPage, LedgerRow, PlayerRow };

export class ApiError extends Error {
  /** The error code: a string body, or `error.code` when the body carries details. */
  readonly code: string;

  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const err = (body as { error?: unknown } | null)?.error;
    const code =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : `HTTP ${status}`;
    super(code);
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

/** The device's time zone: "today" for the daily bonus is the player's day. */
export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const api = {
  me: () => call<PlayerRow>("GET", `/me?timeZone=${encodeURIComponent(timeZone())}`),
  claimDaily: () => call<ClaimResponse>("POST", "/daily-bonus", { timeZone: timeZone() }),
  claimBailout: () => call<ClaimResponse>("POST", "/bailout", { timeZone: timeZone() }),
  ledger: (cursor?: string) => call<LedgerPage>("GET", `/ledger${cursor ? `?cursor=${cursor}` : ""}`),

  startHand: (input: { id: string; game: string; variant?: string; bets: unknown }) =>
    call<HandResponse>("POST", "/hands", { ...input, timeZone: timeZone() }),
  act: (id: string, action: unknown, version: number) =>
    call<HandResponse>("POST", `/hands/${id}/actions`, { action, version }),
  activeHands: () => call<{ hands: HandRow[] }>("GET", "/hands/active"),
  hand: (id: string) => call<HandRow>("GET", `/hands/${id}`),
  hands: (opts: { game?: string; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.game) q.set("game", opts.game);
    if (opts.cursor) q.set("cursor", opts.cursor);
    const s = q.toString();
    return call<HandPage>("GET", `/hands${s ? `?${s}` : ""}`);
  },
};
