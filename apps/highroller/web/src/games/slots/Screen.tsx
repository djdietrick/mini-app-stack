import { useEffect, useMemo, useRef, useState } from "react";
import type { SlotsView } from "../../../../src/games/slots/engine.js";
import { machineOf } from "../../../../src/games/slots/evaluate.js";
import { LINE_BETS, type Machine } from "../../../../src/games/slots/machines.js";
import { exactRtp } from "../../../../src/games/slots/rtp.js";
import { type HandRow, api } from "../../api";
import { useToast } from "../../components/Toast";
import { chips, chipsShort } from "../../format";
import { useEquipped, usePlayer } from "../../player";
import { buzz } from "../../settings";
import { TableCanvas } from "../../table/TableCanvas";
import { Sheet, TableFrame } from "../TableFrame";
import { useHand } from "../useHand";
import { type SlotsSceneView, createSlotsScene } from "./Scene";
import { drawSymbol } from "./symbols";

/** A win this many times the bet always stops auto-spin. */
const AUTO_STOP_MULTIPLE = 20;
const AUTO_COUNTS = [10, 25, 50] as const;
const LOSS_LIMITS = [0, 500, 1_000, 5_000, 25_000] as const;
const WIN_LIMITS = [0, 1_000, 5_000, 25_000, 100_000] as const;

interface Auto {
  left: number;
  /** Net chips since auto-spin started. */
  net: number;
  /** Stop once down this much (0: never). */
  maxLoss: number;
  /** Stop once up this much (0: never). */
  winTarget: number;
}

export default function SlotsScreen({ variant }: { variant: string | null }) {
  const machine = machineOf(variant);
  const { player } = usePlayer();
  const equipped = useEquipped();
  const toast = useToast();
  const balance = player?.balance ?? 0;
  const table = useHand("slots");
  const [lineBet, setLineBet] = useState<number>(LINE_BETS[0]);
  const [lines, setLines] = useState(machine.lines.length);
  const [spinning, setSpinning] = useState<HandRow | null>(null);
  const [rest, setRest] = useState<number[]>([0, 0, 0, 0, 0]);
  const [auto, setAuto] = useState<Auto | null>(null);
  const [autoSheet, setAutoSheet] = useState(false);
  const [scene] = useState(createSlotsScene);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const stake = lineBet * lines;

  // Rest the reels where the last spin on this machine stopped.
  useEffect(() => {
    let live = true;
    api
      .hands({ game: "slots", limit: 5 })
      .then((page) => {
        const last = page.hands.find((h) => h.variant === machine.id);
        const spins = last && (last.view as SlotsView).spins;
        if (live && spins?.length) setRest(spins[spins.length - 1].stops);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [machine.id]);

  const view = useMemo<SlotsSceneView>(() => {
    if (spinning) {
      const v = spinning.view as SlotsView;
      return { id: spinning.id, machine: machine.id, stops: rest, spins: v.spins, returned: v.returned, jackpot: v.jackpotEligible, quick: !!autoRef.current };
    }
    return { id: "", machine: machine.id, stops: rest, spins: null, returned: 0, jackpot: false };
  }, [spinning, rest, machine.id]);

  async function spin() {
    if (spinning) {
      scene.slam();
      return;
    }
    if (stake > balance) {
      setAuto(null);
      return toast("Not enough chips", "loss");
    }
    const hand = await table.start({ lineBet, lines }, machine.id);
    if (hand) {
      setSpinning(hand);
      buzz(10);
    } else {
      setAuto(null);
    }
  }

  function shown(s: SlotsSceneView) {
    if (!spinning || s.id !== spinning.id) return;
    const v = spinning.view as SlotsView;
    table.shown(spinning, slotsResult);
    setRest(v.spins[v.spins.length - 1].stops);
    setSpinning(null);
    const a = autoRef.current;
    if (a) {
      const net = a.net + spinning.returned - spinning.wagered;
      const big = spinning.returned >= AUTO_STOP_MULTIPLE * spinning.wagered && spinning.returned > 0;
      const why =
        big ? `Auto-spin stopped on a ${Math.floor(spinning.returned / spinning.wagered)}× win`
        : a.maxLoss && -net >= a.maxLoss ? "Auto-spin stopped: loss limit reached"
        : a.winTarget && net >= a.winTarget ? "Auto-spin stopped: win target reached"
        : a.left <= 1 ? null
        : "";
      if (why === "") setAuto({ ...a, left: a.left - 1, net });
      else {
        setAuto(null);
        if (why) toast(why, "info");
      }
    }
  }

  // Auto-spin: the next spin once the last has been shown.
  useEffect(() => {
    if (!auto || spinning || table.busy) return;
    const t = setTimeout(() => void spin(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, spinning, table.busy]);

  const busy = table.busy || table.resuming;
  const maxLines = machine.lines.length;

  return (
    <TableFrame
      title={machine.name}
      info={<Rules machine={machine} />}
      canvas={<TableCanvas scene={scene} equipped={equipped} view={view} onShown={shown} onError={(e) => toast(`Table error: ${String(e)}`, "loss")} />}
      above={
        auto ? (
          <span>
            Auto-spin: {auto.left} left · <span className="font-mono tabular">{auto.net >= 0 ? "+" : "−"}{chips(Math.abs(auto.net))}</span>
          </span>
        ) : lines < maxLines ? (
          <span className="text-muted">The jackpot needs all {maxLines} lines.</span>
        ) : (
          <span className="font-mono tabular">
            {lines} lines × {lineBet} = {chips(stake)}
          </span>
        )
      }
      bar={
        <div className="flex flex-col gap-2 border-t border-line bg-surface/95 px-3 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <div role="radiogroup" aria-label="Line bet" className="grid flex-1 grid-cols-4 gap-1.5">
              {LINE_BETS.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={lineBet === b}
                  className={(lineBet === b ? "btn-primary" : "btn") + " min-h-[44px] px-0 font-mono"}
                  disabled={busy || !!spinning || !!auto}
                  onClick={() => setLineBet(b)}
                >
                  {b}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1" aria-label="Lines">
              <button type="button" className="btn w-11 px-0" aria-label="Fewer lines" disabled={busy || !!spinning || !!auto || lines <= 1} onClick={() => setLines((n) => n - 1)}>
                −
              </button>
              <span className="w-9 text-center font-mono tabular text-[15px]" aria-live="polite">
                {lines}
              </span>
              <button type="button" className="btn w-11 px-0" aria-label="More lines" disabled={busy || !!spinning || !!auto || lines >= maxLines} onClick={() => setLines((n) => n + 1)}>
                +
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {auto ? (
              <button type="button" className="btn px-4" onClick={() => setAuto(null)}>
                Stop auto
              </button>
            ) : (
              <button type="button" className="btn px-4" disabled={busy || !!spinning || stake > balance} onClick={() => setAutoSheet(true)}>
                Auto
              </button>
            )}
            <button type="button" className="btn-primary min-h-[52px] flex-1" disabled={busy || (!spinning && stake > balance)} onClick={() => void spin()}>
              {spinning ? "Stop" : <>Spin <span className="font-mono tabular">{chipsShort(stake)}</span></>}
            </button>
          </div>
        </div>
      }
      overlay={
        // Here, not in the bar: the bar's backdrop blur would trap the sheet's fixed position.
        autoSheet && (
          <AutoSheet
            onClose={() => setAutoSheet(false)}
            onStart={(a) => {
              setAutoSheet(false);
              setAuto(a);
            }}
          />
        )
      }
    />
  );
}

/** Only a spin that pays more than it cost is announced: auto-spin would otherwise be a stream of toasts. */
function slotsResult(h: HandRow) {
  if (h.returned <= h.wagered) return null;
  const v = h.view as SlotsView;
  return { text: `Win ${chips(h.returned)}${v.freeSpins ? " with free spins" : ""}`, tone: "win" as const };
}

function AutoSheet({ onClose, onStart }: { onClose: () => void; onStart: (a: Auto) => void }) {
  const [count, setCount] = useState<number>(AUTO_COUNTS[0]);
  const [maxLoss, setMaxLoss] = useState<number>(LOSS_LIMITS[2]);
  const [winTarget, setWinTarget] = useState<number>(0);
  const pick = (label: string, options: readonly number[], value: number, set: (n: number) => void, none: string) => (
    <fieldset>
      <legend className="label-caps mb-2">{label}</legend>
      <div role="radiogroup" className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={(value === o ? "btn-primary" : "btn") + " min-h-[44px]"} onClick={() => set(o)}>
            {o === 0 ? none : chipsShort(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <Sheet title="Auto-spin" onClose={onClose}>
      {pick("Spins", AUTO_COUNTS, count, setCount, "")}
      {pick("Stop if I'm down", LOSS_LIMITS, maxLoss, setMaxLoss, "Never")}
      {pick("Stop if I'm up", WIN_LIMITS, winTarget, setWinTarget, "Never")}
      <p className="text-muted">Auto-spin always stops on a win of {AUTO_STOP_MULTIPLE}× the bet or more, or when you run out of chips.</p>
      <button type="button" className="btn-primary min-h-[52px]" onClick={() => onStart({ left: count, net: 0, maxLoss, winTarget })}>
        Start {count} spins
      </button>
    </Sheet>
  );
}

/** A symbol painted onto a plain canvas, no Pixi. */
function SymbolIcon({ id, size = 36 }: { id: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size * d;
    c.height = size * d;
    const ctx = c.getContext("2d")!;
    ctx.scale(d, d);
    drawSymbol(ctx, id, size);
  }, [id, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** One payline on a 5 × 3 grid. */
function LineIcon({ rows, n }: { rows: number[]; n: number }) {
  const w = 60;
  const h = 36;
  const pts = rows.map((r, i) => `${(i + 0.5) * (w / 5)},${(r + 0.5) * (h / 3)}`).join(" ");
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`Line ${n}`} className="rounded bg-black/30">
        {rows.map((_, i) => [0, 1, 2].map((r) => <rect key={`${i}-${r}`} x={i * 12 + 1} y={r * 12 + 1} width={10} height={10} rx={2} fill="rgba(255,255,255,0.08)" />))}
        <polyline points={pts} fill="none" stroke="#d4af37" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="font-mono text-[11px] text-muted">{n}</figcaption>
    </figure>
  );
}

function Rules({ machine }: { machine: Machine }) {
  const r = exactRtp(machine);
  const regular = machine.symbols.filter((s) => !s.kind);
  const wild = machine.symbols.find((s) => s.kind === "wild");
  const scatter = machine.symbols.find((s) => s.kind === "scatter");
  const jackpot = machine.symbols.find((s) => s.kind === "jackpot");
  const row = (id: string, name: string, pays: [number, number, number], unit: string) => (
    <tr key={id} className="border-t border-line">
      <td className="py-1.5">
        <span className="flex items-center gap-2">
          <SymbolIcon id={id} />
          {name}
        </span>
      </td>
      {pays.map((p, i) => (
        <td key={i} className="py-1.5 text-right font-mono tabular text-gold-light">
          {p.toLocaleString("en-US")}
          {unit}
        </td>
      ))}
    </tr>
  );
  return (
    <>
      <p>
        Pick a line bet and how many of the {machine.lines.length} lines to play, then spin. Lines pay left to right from the first reel, times the
        line bet; each line pays its best win.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {wild && <li>The {wild.name} stands in for every symbol except the {scatter?.name ?? "scatter"} and the {jackpot?.name ?? "jackpot"}.</li>}
        {scatter && (
          <li>
            {scatter.name}s pay anywhere on the reels, times the total bet. Three or more start {machine.freeSpins.count} free spins at{" "}
            {machine.freeSpins.multiplier}× (they don't retrigger).
          </li>
        )}
        {jackpot && <li>Five {jackpot.name} symbols on a line, with all {machine.lines.length} lines bet, hit the jackpot line.</li>}
      </ul>
      <table className="w-full text-[15px]">
        <caption className="label-caps mb-2 text-left">Pays, times the line bet</caption>
        <thead>
          <tr className="text-[12px] text-muted">
            <th />
            <th className="text-right font-normal">3</th>
            <th className="text-right font-normal">4</th>
            <th className="text-right font-normal">5</th>
          </tr>
        </thead>
        <tbody>
          {[jackpot, wild, ...[...regular].reverse()].filter((s) => s !== undefined).map((s) => row(s!.id, s!.name, s!.pays, ""))}
          {scatter && row(scatter.id, `${scatter.name} (anywhere)`, scatter.pays, "×")}
        </tbody>
      </table>
      <div>
        <p className="label-caps mb-2">Lines</p>
        <div className="grid grid-cols-5 gap-2">
          {machine.lines.map((l, i) => (
            <LineIcon key={i} rows={l} n={i + 1} />
          ))}
        </div>
      </div>
      <p className="text-muted">
        Returns {(r.rtp * 100).toFixed(2)}% over the long run. Free spins start about 1 spin in {Math.round(1 / r.trigger)}; the jackpot line about 1
        in {(Math.round(1 / r.jackpot / 10_000) / 100).toLocaleString("en-US")} million.
      </p>
    </>
  );
}
