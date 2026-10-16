import { useEffect, useRef, useState } from "react";
import { ApiError, type CosmeticKind, type ShopItemRow, api } from "../api";
import { useToast } from "../components/Toast";
import { ErrorNote, PageTitle } from "../components/ui";
import { chips } from "../format";
import { Sheet } from "../games/TableFrame";
import { useEquipped, usePlayer } from "../player";
import { buzz } from "../settings";
import { DENOMINATIONS, type Equipped, cardBackStyle, chipSetStyle, feltStyle } from "../table/cosmetics";
import { CARD_RATIO, drawBack, drawChip, drawFelt } from "../table/paint";
import { useApi } from "../useApi";

/**
 * #/shop: card backs, felts and chip sets, bought with chips. Each item is
 * previewed with the same painters the tables use, combined with what you
 * have equipped (a new felt under your card back, a new back on your felt).
 * Buying asks first; equipping is one tap, and the next table you open uses it.
 */
const KINDS: { kind: CosmeticKind; label: string }[] = [
  { kind: "card_back", label: "Card backs" },
  { kind: "felt", label: "Felts" },
  { kind: "chip_set", label: "Chips" },
];

export function Shop() {
  const { player, setBalance, setEquippedIds, setClaimable } = usePlayer();
  const toast = useToast();
  const shop = useApi("shop", api.shop);
  const [kind, setKind] = useState<CosmeticKind>("card_back");
  const [buying, setBuying] = useState<ShopItemRow | null>(null);
  const [busy, setBusy] = useState(false);
  const balance = player?.balance ?? 0;
  const items = (shop.data?.items ?? []).filter((i) => i.kind === kind);

  async function buy(item: ShopItemRow) {
    setBusy(true);
    try {
      const res = await api.buy(item.id);
      setBalance(res.balance);
      buzz([10, 40, 10]);
      toast(`Bought ${item.name}`, "win");
      for (const c of res.completed) toast(`Achievement done: ${c.text}`, "win");
      if (res.completed.length) setClaimable((n) => n + res.completed.length);
      setBuying({ ...item, owned: true });
      shop.reload();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      toast(code === "INSUFFICIENT_FUNDS" ? "Not enough chips" : code === "ALREADY_OWNED" ? "You already own that" : "Couldn't buy it", "loss");
      setBuying(null);
      shop.reload();
    } finally {
      setBusy(false);
    }
  }

  async function equip(item: ShopItemRow) {
    setBusy(true);
    try {
      const res = await api.equip(item.kind, item.id);
      setEquippedIds(res.equipped);
      toast(`${item.name} equipped`, "info");
      setBuying(null);
      shop.reload();
    } catch {
      toast("Couldn't equip it", "loss");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle sub="Cosmetics only: they change how the tables look, never the odds.">Shop</PageTitle>

      <div role="tablist" aria-label="Item kind" className="mb-4 grid grid-cols-3 rounded-xl border border-line bg-surface p-1">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={
              "focus-ring min-h-[44px] rounded-[10px] text-[15px] " + (kind === k.kind ? "bg-raised font-semibold text-gold-light" : "text-muted")
            }
          >
            {k.label}
          </button>
        ))}
      </div>

      {shop.error && <ErrorNote error={shop.error} onRetry={shop.reload} />}

      <ul role="tabpanel" className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className={"card flex flex-col overflow-hidden " + (item.equipped ? "border-gold/60" : "")}>
            <Preview item={item} />
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div>
                <p className="text-[15px] font-semibold leading-tight">{item.name}</p>
                <p className="tabular mt-0.5 font-mono text-[13px] text-muted">
                  {item.is_default ? "Free" : item.owned ? "Owned" : `${chips(item.price)} chips`}
                </p>
              </div>
              <div className="mt-auto">
                {item.equipped ? (
                  <span className="btn w-full cursor-default border-gold/40 text-gold-light">Equipped</span>
                ) : item.owned ? (
                  <button type="button" className="btn w-full" disabled={busy} onClick={() => void equip(item)}>
                    Equip
                  </button>
                ) : (
                  <button type="button" className="btn-primary w-full px-2" disabled={busy} onClick={() => setBuying(item)}>
                    {balance >= item.price ? "Buy" : `Need ${chips(item.price - balance)}`}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
        {!items.length && !shop.error && <li className="col-span-full py-8 text-center text-muted">{shop.loading ? "Loading…" : "Nothing here."}</li>}
      </ul>

      {buying && (
        <Sheet title={buying.owned ? "Yours now" : `Buy ${buying.name}?`} onClose={() => setBuying(null)}>
          <div className="overflow-hidden rounded-2xl border border-line">
            <Preview item={buying} height={160} />
          </div>
          {buying.owned ? (
            <>
              <p>{buying.name} is in your collection. Equip it now?</p>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void equip(buying)}>
                Equip
              </button>
            </>
          ) : (
            <>
              <p>
                {buying.name} costs <span className="font-mono font-bold text-gold-light">{chips(buying.price)}</span> chips. You have{" "}
                <span className="font-mono font-bold">{chips(balance)}</span>.
              </p>
              <button type="button" className="btn-primary" disabled={busy || balance < buying.price} onClick={() => void buy(buying)}>
                {balance < buying.price ? `You need ${chips(buying.price - balance)} more` : `Buy for ${chips(buying.price)}`}
              </button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

/**
 * The item on a little table, painted onto a plain canvas at the device's
 * pixel ratio: a card back on your felt, a felt under your card back and
 * chips, or a chip set's six denominations.
 */
function Preview({ item, height = 112 }: { item: ShopItemRow; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mine = useEquipped();
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = canvas.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintPreview(ctx, item, mine, width, height);
  }, [item, mine, width, height]);

  return <canvas ref={canvas} aria-hidden="true" className="block w-full" style={{ height }} />;
}

function paintPreview(ctx: CanvasRenderingContext2D, item: ShopItemRow, mine: Equipped, w: number, h: number) {
  const felt = item.kind === "felt" ? feltStyle(item.id) : mine.felt;
  const back = item.kind === "card_back" ? cardBackStyle(item.id) : mine.back;
  const set = item.kind === "chip_set" ? chipSetStyle(item.id) : mine.chips;
  drawFelt(ctx, felt, w, h);

  const card = (cx: number, cy: number, cw: number, angle: number) => {
    const ch = cw * CARD_RATIO;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cw / 2, -ch / 2);
    drawBack(ctx, back, cw, ch);
    ctx.restore();
  };
  const chip = (cx: number, cy: number, d: number, value: number) => {
    ctx.save();
    ctx.translate(cx - d / 2, cy - d / 2);
    drawChip(ctx, set, value, d);
    ctx.restore();
  };

  if (item.kind === "chip_set") {
    const d = Math.min(h * 0.4, w / 3.6);
    DENOMINATIONS.forEach((v, i) => chip(w / 2 + ((i % 3) - 1) * d * 1.1, h / 2 + (i < 3 ? -0.55 : 0.55) * d, d, v));
    return;
  }
  const cw = Math.min(h * 0.5, w * 0.24);
  const cards = item.kind === "card_back" ? w / 2 : w * 0.38;
  card(cards - cw * 0.3, h / 2, cw, -0.12);
  card(cards + cw * 0.3, h / 2, cw, 0.1);
  if (item.kind === "felt") {
    const d = cw * 0.62;
    [100, 25, 5].forEach((v, i) => chip(w * 0.72, h / 2 + d * 0.35 - i * d * 0.16, d, v));
  }
}
