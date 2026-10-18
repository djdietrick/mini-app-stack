import { useState } from "react";
import { type Board, type BoardRow, api } from "../api";
import { GiftSheet } from "../components/GiftSheet";
import { ErrorNote, PageTitle } from "../components/ui";
import { chips, signed } from "../format";
import { usePlayer } from "../player";
import { href } from "../router";
import { useApi } from "../useApi";

const BOARDS: { id: Board; label: string; what: string }[] = [
  { id: "net", label: "Net", what: "Chips won minus chips staked this week." },
  { id: "biggest_win", label: "Biggest win", what: "The most won on a single hand this week." },
  { id: "level", label: "Level", what: "All-time XP. Every hand you play counts." },
];

const valueOf = (board: Board, v: number) => (board === "net" ? signed(v) : board === "level" ? `${chips(v)} XP` : chips(v));

/**
 * #/leaderboards: three boards, the top 50 of each plus your own row pinned
 * at the bottom, however far down (or hidden) you are. Weeks are ISO weeks in
 * UTC, so everyone shares one board; last week is one tap away. Tapping
 * someone else's row opens the gift sheet for them.
 */
export function Leaderboards() {
  const { player } = usePlayer();
  const [board, setBoard] = useState<Board>("net");
  const [lastWeek, setLastWeek] = useState<string | null>(null);
  const weekly = board !== "level";
  const week = weekly ? (lastWeek ?? undefined) : undefined;
  const res = useApi(`board:${board}:${week ?? "now"}`, () => api.leaderboard(board, week));
  const [gifting, setGifting] = useState<BoardRow | null>(null);
  const data = res.data?.board === board ? res.data : undefined;
  const me = data?.me ?? null;
  const meInRows = !!me && !!data?.rows.some((r) => r.user_id === me.user_id);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub={BOARDS.find((b) => b.id === board)!.what}>Leaderboards</PageTitle>

      <div role="radiogroup" aria-label="Board" className="grid grid-cols-3 rounded-xl border border-line bg-ground p-0.5">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={board === b.id}
            onClick={() => setBoard(b.id)}
            className={
              "focus-ring min-h-[44px] rounded-[10px] px-2 text-[14px] " +
              (board === b.id ? "bg-raised font-semibold text-gold-light" : "text-muted")
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      {weekly && (
        <div className="flex items-center justify-between gap-3 text-[14px]">
          <span className="text-muted">{data?.week ? `Week ${data.week.split("-W")[1]}, ${data.week.slice(0, 4)}` : " "}</span>
          {lastWeek ? (
            <button type="button" className="btn min-h-[40px] px-3" onClick={() => setLastWeek(null)}>
              This week
            </button>
          ) : (
            <button
              type="button"
              className="btn min-h-[40px] px-3"
              disabled={!data?.previous_week}
              onClick={() => setLastWeek(data?.previous_week ?? null)}
            >
              Last week
            </button>
          )}
        </div>
      )}

      {res.error && <ErrorNote error={res.error} onRetry={res.reload} />}

      <ol className={"card divide-y divide-line transition-opacity " + (res.loading ? "opacity-60" : "")}>
        {data?.rows.map((r) => (
          <li key={r.user_id}>
            <Row
              row={r}
              board={board}
              mine={r.user_id === me?.user_id}
              onGift={r.user_id === player?.user_id ? undefined : () => setGifting(r)}
            />
          </li>
        ))}
        {data && !data.rows.length && (
          <li className="px-4 py-6 text-center text-muted">{lastWeek ? "Nobody played that week." : "Nobody on the board yet."}</li>
        )}
        {!data && !res.error && <li className="px-4 py-6 text-center text-muted">Loading…</li>}
      </ol>

      {data && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 lg:bottom-4">
          {me && !meInRows && (
            <div className="card border-gold/50 shadow-lg shadow-black/40">
              <Row row={me} board={board} mine />
            </div>
          )}
          {!me && !lastWeek && (
            <p className="card px-4 py-3 text-center text-[14px] text-muted shadow-lg shadow-black/40">
              Play a hand this week to get on the board.
            </p>
          )}
          {me && !me.listed && (
            <p className="mt-2 text-center text-[13px] text-muted">
              You're hidden from the boards; only you see your rank.{" "}
              <a href={href({ name: "settings" })} className="text-gold-light underline">
                Settings
              </a>
            </p>
          )}
        </div>
      )}

      {gifting && <GiftSheet to={{ userId: gifting.user_id, name: gifting.display_name }} onClose={() => setGifting(null)} />}
    </div>
  );
}

function Row({ row, board, mine, onGift }: { row: BoardRow; board: Board; mine: boolean; onGift?: () => void }) {
  const body = (
    <>
      <span className={"w-9 shrink-0 text-center font-mono text-[15px] font-bold " + (row.rank <= 3 ? "text-gold-light" : "text-muted")}>
        {row.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className={"block truncate text-[15px] " + (mine ? "font-semibold text-gold-light" : "font-medium")}>
          {mine ? `${row.display_name} (you)` : row.display_name}
        </span>
        <span className="block text-[12px] text-faint">Level {row.level}</span>
      </span>
      <span className={"tabular font-mono text-[15px] font-bold " + (board === "net" ? (row.value >= 0 ? "text-win" : "text-loss") : "")}>
        {valueOf(board, row.value)}
      </span>
    </>
  );
  const cls = "flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left";
  if (!onGift) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls + " focus-ring rounded-2xl hover:bg-raised/50"} onClick={onGift} aria-label={`${row.display_name}, rank ${row.rank}. Gift chips`}>
      {body}
    </button>
  );
}
