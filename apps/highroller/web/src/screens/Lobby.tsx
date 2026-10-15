import { useState } from "react";
import { ApiError, api } from "../api";
import { useToast } from "../components/Toast";
import { ErrorNote } from "../components/ui";
import { chips } from "../format";
import { GAME_TILES } from "../games/catalog";
import { usePlayer } from "../player";
import { buzz } from "../settings";

/** Matches DAILY_STREAK_CAP in src/domain/economy.ts. */
const STREAK_DAYS = 7;

export function Lobby() {
  const { player, error, reload } = usePlayer();

  return (
    <div className="flex flex-col gap-5">
      {error && !player && <ErrorNote error={error} onRetry={reload} />}
      {player && (
        <div className="grid gap-3 md:grid-cols-2">
          <DailyBonusCard />
          {player.bailout.available && <BailoutCard />}
        </div>
      )}

      <section aria-labelledby="games">
        <h2 id="games" className="label-caps mb-3">
          Tables
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {GAME_TILES.map((g) => (
            <li key={g.id}>
              <div
                aria-disabled={!g.playable}
                className="relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-2xl border border-line p-3"
                style={{ background: `radial-gradient(120% 90% at 30% 20%, ${g.colors[0]}, ${g.colors[1]})` }}
              >
                <span aria-hidden="true" className="absolute -right-3 -top-6 font-display text-[110px] leading-none text-white/10">
                  {g.glyph}
                  {"︎"}
                </span>
                <span className="self-start rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                  Coming soon
                </span>
                <span>
                  <span className="block font-display text-[19px] font-bold leading-tight">{g.name}</span>
                  <span className="mt-1 block text-[12.5px] leading-snug text-ink/70">{g.blurb}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-center text-[13px] text-faint">Chips are for fun only. They can't be bought, cashed out or exchanged.</p>
    </div>
  );
}

function DailyBonusCard() {
  const { player, set } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!player) return null;
  const { daily } = player;
  // The day the next claim counts as: tomorrow's when today's is done.
  const nextDay = daily.available ? daily.streak + 1 : daily.streak;

  async function claim() {
    setBusy(true);
    try {
      const res = await api.claimDaily();
      set(res.player);
      buzz([10, 40, 10]);
      toast(`Daily bonus +${chips(res.amount)}`, "win");
    } catch (e) {
      toast(e instanceof ApiError && e.code === "ALREADY_CLAIMED" ? "Already claimed today" : "Couldn't claim the bonus", "loss");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps">Daily bonus</p>
          <p className="mt-1 font-display text-[24px] font-bold text-gold-light">
            {daily.available ? `+${chips(daily.amount)}` : "Claimed"}
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={!daily.available || busy} onClick={claim}>
          {daily.available ? "Claim" : "Back tomorrow"}
        </button>
      </div>
      <ol aria-label={`Streak: day ${daily.streak}`} className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: STREAK_DAYS }, (_, i) => {
          const day = i + 1;
          const done = day <= Math.min(daily.streak, STREAK_DAYS);
          const next = daily.available && day === Math.min(nextDay, STREAK_DAYS);
          return (
            <li
              key={day}
              className={
                "flex h-9 flex-col items-center justify-center rounded-lg border font-mono text-[11px] " +
                (done ? "border-gold/60 bg-gold/15 text-gold-light" : next ? "border-gold text-ink" : "border-line text-faint")
              }
            >
              <span>{day === STREAK_DAYS ? "7+" : day}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-[13px] text-muted">
        {daily.streak > 0 ? `${daily.streak}-day streak. ` : ""}1,000 × your streak day, up to day 7. Miss a day and it starts again.
      </p>
    </div>
  );
}

function BailoutCard() {
  const { player, set } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!player) return null;

  async function claim() {
    setBusy(true);
    try {
      const res = await api.claimBailout();
      set(res.player);
      toast(`Topped up +${chips(res.amount)}`, "win");
    } catch {
      toast("Couldn't top up", "loss");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex items-center justify-between gap-3 border-gold/40 p-4">
      <div>
        <p className="label-caps">Running low?</p>
        <p className="mt-1 text-[15px]">
          Top up to <span className="font-semibold text-gold-light">{chips(player.bailout.top_up_to)}</span>, once a day.
        </p>
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={claim}>
        Top up
      </button>
    </div>
  );
}
