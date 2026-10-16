import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { type BalancePoint, type BalanceRange, type GameStatsRow, api } from "../api";
import { ErrorNote, PageTitle } from "../components/ui";
import { chips, chipsShort, signed } from "../format";
import { GAME_TILES } from "../games/catalog";
import { usePlayer } from "../player";
import { useApi } from "../useApi";

/**
 * #/stats: what you've played and how luck has treated you. Per-game and
 * total figures come from GET /stats (folded at settlement); the balance
 * chart from GET /stats/balance, one end-of-day point per day.
 */
export function Stats() {
  const { player } = usePlayer();
  const stats = useApi("stats", api.stats);
  const [range, setRange] = useState<BalanceRange>("30d");
  const series = useApi(`balance:${range}`, () => api.balanceSeries(range));
  // Refetching keeps the last chart on screen, faded, rather than flashing empty.
  const [points, setPoints] = useState<BalancePoint[] | null>(null);
  useEffect(() => {
    if (series.data) setPoints(series.data.points);
  }, [series.data]);

  const total = stats.data?.total;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub={player ? `Level ${player.level} · ${chips(player.xp)} XP` : undefined}>Stats</PageTitle>
      {stats.error && <ErrorNote error={stats.error} onRetry={stats.reload} />}

      {total && total.hands === 0 && (
        <div className="card p-6 text-center text-[15px] text-muted">
          No hands yet. Play a few and your figures show up here.{" "}
          <a href="#/" className="text-gold-light underline">
            To the tables
          </a>
        </div>
      )}

      {total && total.hands > 0 && (
        <>
          <Figures row={total} />
          <Luck row={total} />
        </>
      )}

      <section className="card p-4" aria-labelledby="balance-title">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="balance-title" className="label-caps">
            Balance, end of each day
          </h2>
          <div role="radiogroup" aria-label="Range" className="flex rounded-xl border border-line bg-ground p-0.5">
            {(["7d", "30d", "90d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => setRange(r)}
                className={
                  "focus-ring min-h-[40px] min-w-[44px] rounded-[10px] px-2 font-mono text-[13px] " +
                  (range === r ? "bg-raised font-semibold text-gold-light" : "text-muted")
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {series.error && <ErrorNote error={series.error} onRetry={series.reload} />}
        {points && (
          <div className={series.loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <BalanceChart points={points} />
          </div>
        )}
        {!points && !series.error && <div className="h-[180px]" />}
      </section>

      {stats.data && stats.data.games.length > 0 && (
        <section aria-labelledby="per-game">
          <h2 id="per-game" className="label-caps mb-3">
            By game
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {stats.data.games.map((g) => (
              <li key={g.game} className="card p-4">
                <h3 className="mb-3 font-display text-[18px] font-bold">{gameName(g.game)}</h3>
                <Figures row={g} compact />
                <p className="mt-3 text-[13px] text-muted">
                  Average luck would have returned {chips(g.expected_return)}; you got back {chips(g.returned)}.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const gameName = (id: string) => GAME_TILES.find((t) => t.id === id)?.name ?? id;

const winRate = (r: GameStatsRow) => {
  const decided = r.wins + r.losses;
  return decided ? `${Math.round((100 * r.wins) / decided)}%` : "—";
};

function Figures({ row, compact = false }: { row: GameStatsRow; compact?: boolean }) {
  const items: [string, string, string?][] = [
    ["Hands", chips(row.hands)],
    ["Wagered", chips(row.wagered)],
    ["Net", signed(row.net), row.net > 0 ? "text-win" : row.net < 0 ? "text-loss" : undefined],
    ["Win rate", winRate(row)],
    ["Biggest win", row.biggest_win > 0 ? `+${chips(row.biggest_win)}` : "—"],
  ];
  return (
    <dl className={compact ? "grid grid-cols-3 gap-x-3 gap-y-2" : "card grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-5"}>
      {items.map(([label, value, tone]) => (
        <div key={label}>
          <dt className="label-caps">{label}</dt>
          <dd className={"tabular mt-0.5 font-mono font-bold " + (compact ? "text-[15px] " : "text-[19px] ") + (tone ?? "text-ink")}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Actual against expected return, and what the gap means. */
function Luck({ row }: { row: GameStatsRow }) {
  const diff = row.returned - row.expected_return;
  const edge = row.wagered - row.expected_return;
  return (
    <section className="card p-4" aria-labelledby="luck">
      <h2 id="luck" className="label-caps mb-2">
        Luck so far
      </h2>
      <p className="text-[15px]">
        You got back <span className="font-mono font-bold">{chips(row.returned)}</span>. Average luck would have returned{" "}
        <span className="font-mono font-bold">{chips(row.expected_return)}</span>, so you're{" "}
        <span className={"font-mono font-bold " + (diff >= 0 ? "text-win" : "text-loss")}>
          {diff >= 0 ? `${chips(diff)} ahead of` : `${chips(-diff)} behind`}
        </span>{" "}
        it.
      </p>
      <p className="mt-2 text-[13px] text-muted">
        That gap is variance: over a few hundred hands luck swings far more than the house edge ({chips(Math.max(0, edge))} so far), and the
        more you play, the closer you drift to the expected line.
      </p>
    </section>
  );
}

const fmtDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (day: string) => fmtDay.format(new Date(`${day}T12:00:00Z`));

/** Three round values spanning [lo, hi]. A flat series gets a span of 10% around it (at least 100 chips). */
function ticks(lo: number, hi: number): number[] {
  const min = Math.max(100, Math.abs(hi) * 0.1);
  if (hi - lo < min) {
    const mid = (lo + hi) / 2;
    lo = mid - min / 2;
    hi = mid + min / 2;
  }
  // Balances never go below zero, so neither does the axis.
  if (lo < 0) {
    hi -= lo;
    lo = 0;
  }
  // The smallest round step whose three ticks cover [lo, hi].
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / 2));
  for (const m of [1, 2, 2.5, 5, 10, 20, 25, 50]) {
    const step = m * mag;
    const start = Math.floor(lo / step) * step;
    if (start + 2 * step >= hi) return [start, start + step, start + 2 * step];
  }
  return [lo, (lo + hi) / 2, hi];
}

/**
 * One series, so no legend: the section title names it. A 2 px line in the
 * money colour, a recessive grid, and a crosshair that snaps to the nearest
 * day under the pointer (or the arrow keys) with the value in a readout.
 * The same numbers are in a table for screen readers.
 */
function BalanceChart({ points }: { points: BalancePoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!points.length) return <div className="h-[180px]" />;

  const H = 180;
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const values = points.map((p) => p.balance);
  const yTicks = ticks(Math.min(...values), Math.max(...values));
  const lo = Math.min(yTicks[0], ...values);
  const hi = Math.max(yTicks[2], ...values);
  const x = (i: number) => pad.l + (points.length === 1 ? (width - pad.l - pad.r) / 2 : (i * (width - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join("");
  const at = hover ?? points.length - 1;
  const shown = points[at];

  const nearest = (e: PointerEvent<SVGSVGElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left;
    const fx = (e.clientX - left - pad.l) / Math.max(1, width - pad.l - pad.r);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(fx * (points.length - 1)))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? points.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    <div ref={box}>
      <p className="mb-1 text-[13px] text-muted" aria-live="polite">
        <span className="tabular font-mono text-[17px] font-bold text-ink">{chips(shown.balance)}</span> {dayLabel(shown.day)}
      </p>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Balance over ${points.length} days, from ${chips(points[0].balance)} to ${chips(points.at(-1)!.balance)}. Arrow keys step through days.`}
        tabIndex={0}
        className="focus-ring block touch-pan-y rounded"
        onPointerMove={nearest}
        onPointerDown={nearest}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="#2a3d33" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-faint font-mono text-[11px]">
              {chipsShort(t)}
            </text>
          </g>
        ))}
        {[0, points.length - 1].filter((i, k, a) => a.indexOf(i) === k).map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 && points.length > 1 ? "start" : "end"} className="fill-faint font-mono text-[11px]">
            {dayLabel(points[i].day)}
          </text>
        ))}
        <path d={path} fill="none" stroke="#d4af37" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(at)} x2={x(at)} y1={pad.t} y2={H - pad.b} stroke="#a9b5ac" strokeWidth={1} strokeDasharray="3 3" />}
        <circle cx={x(at)} cy={y(shown.balance)} r={4.5} fill="#d4af37" stroke="#121e18" strokeWidth={2} />
      </svg>
      <table className="sr-only">
        <caption>Balance at the end of each day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{chips(p.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
