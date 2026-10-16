import { useEffect, useState } from "react";
import { type AchievementRow, ApiError, type QuestRow, type RewardRow, api } from "../api";
import { useToast } from "../components/Toast";
import { ErrorNote, PageTitle } from "../components/ui";
import { chips } from "../format";
import { usePlayer } from "../player";
import { buzz } from "../settings";
import { useApi } from "../useApi";

/**
 * #/quests: today's three quests, this week's three, and the achievements.
 * Progress moves as hands settle; rewards wait here until you claim them.
 */
export function Quests() {
  const { setBalance, setClaimable } = usePlayer();
  const toast = useToast();
  const quests = useApi("quests", api.quests);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (quests.data) setClaimable(quests.data.claimable);
  }, [quests.data, setClaimable]);

  async function claim(id: string) {
    setBusy(id);
    try {
      const res = await api.claimQuest(id);
      setBalance(res.balance, { xp: res.xp, level: res.level, level_xp: res.level_xp, level_xp_needed: res.level_xp_needed });
      buzz([10, 40, 10]);
      toast(`+${chips(res.reward.chips)} chips, +${chips(res.reward.xp)} XP`, "win");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      toast(code === "ALREADY_CLAIMED" ? "Already claimed" : code === "NOT_COMPLETE" ? "Not done yet" : "Couldn't claim it", "loss");
    } finally {
      setBusy(null);
      quests.reload();
    }
  }

  const d = quests.data;
  return (
    <div className="flex flex-col gap-5">
      <PageTitle sub="Rewards wait here until you claim them.">Quests</PageTitle>
      {quests.error && <ErrorNote error={quests.error} onRetry={quests.reload} />}
      {d && (
        <>
          <QuestList title="Today" resetsAt={d.daily.resets_at} quests={d.daily.quests} busy={busy} onClaim={claim} />
          <QuestList title="This week" resetsAt={d.weekly.resets_at} quests={d.weekly.quests} busy={busy} onClaim={claim} />
          <section aria-labelledby="achievements">
            <h2 id="achievements" className="label-caps mb-2">
              Achievements
            </h2>
            <ul className="card divide-y divide-line">
              {d.achievements.map((a) => (
                <Achievement key={a.id} a={a} busy={busy === a.id} onClaim={() => void claim(a.id)} />
              ))}
            </ul>
          </section>
        </>
      )}
      {!d && !quests.error && <p className="text-center text-muted">Loading…</p>}
    </div>
  );
}

function resetsIn(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "soon";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `in ${Math.floor(h / 24)} days`;
  if (h >= 1) return `in ${h} h`;
  return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
}

const rewardText = (r: RewardRow) => `+${chips(r.chips)} · ${chips(r.xp)} XP`;

function QuestList({
  title,
  resetsAt,
  quests,
  busy,
  onClaim,
}: {
  title: string;
  resetsAt: string;
  quests: QuestRow[];
  busy: string | null;
  onClaim: (id: string) => void;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="label-caps">{title}</h2>
        <span className="text-[13px] text-faint">New quests {resetsIn(resetsAt)}</span>
      </div>
      <ul className="card divide-y divide-line">
        {quests.map((q) => (
          <li key={q.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className={"text-[15px] font-medium " + (q.claimed ? "text-muted line-through decoration-faint" : "")}>{q.text}</p>
              <Bar value={q.progress} max={q.target} label={q.text} />
              <p className="mt-1 flex justify-between font-mono text-[12px] text-muted">
                <span className="tabular">
                  {chips(q.progress)} / {chips(q.target)}
                </span>
                <span className="text-gold-light/80">{rewardText(q.reward)}</span>
              </p>
            </div>
            <ClaimButton complete={q.complete} claimed={q.claimed} busy={busy === q.id} onClaim={() => onClaim(q.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Achievement({ a, busy, onClaim }: { a: AchievementRow; busy: boolean; onClaim: () => void }) {
  // The tier to show: the next to claim, else the next to reach, else the last.
  const next = a.tiers.findIndex((t) => !t.claimed);
  const i = next === -1 ? a.tiers.length - 1 : next;
  const tier = a.tiers[i];
  const allDone = next === -1;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{a.name}</span>
          <span aria-label={`${a.tiers.filter((t) => t.claimed).length} of ${a.tiers.length} tiers`} className="flex gap-1">
            {a.tiers.map((t, k) => (
              <span
                key={k}
                aria-hidden="true"
                className={"h-2 w-2 rounded-full " + (t.claimed ? "bg-gold" : t.complete ? "border border-gold bg-gold/30" : "bg-line")}
              />
            ))}
          </span>
        </p>
        <p className="text-[13px] text-muted">{tier.text}</p>
        <Bar value={Math.min(a.progress, tier.target)} max={tier.target} label={tier.text} />
        <p className="mt-1 flex justify-between font-mono text-[12px] text-muted">
          <span className="tabular">
            {chips(Math.min(a.progress, tier.target))} / {chips(tier.target)}
          </span>
          {!allDone && <span className="text-gold-light/80">{rewardText(tier.reward)}</span>}
        </p>
      </div>
      <ClaimButton complete={tier.complete} claimed={allDone} busy={busy} onClaim={onClaim} />
    </li>
  );
}

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="mt-1.5 h-2 overflow-hidden rounded-full bg-line"
    >
      <div className={"h-full rounded-full transition-[width] duration-500 " + (pct >= 100 ? "bg-win" : "bg-gold")} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ClaimButton({ complete, claimed, busy, onClaim }: { complete: boolean; claimed: boolean; busy: boolean; onClaim: () => void }) {
  if (claimed) {
    return (
      <span className="w-[76px] shrink-0 text-center text-[13px] text-win" aria-label="Claimed">
        ✓ Claimed
      </span>
    );
  }
  if (!complete) return <span className="w-[76px] shrink-0" />;
  return (
    <button type="button" className="btn-primary w-[76px] shrink-0 px-0" disabled={busy} onClick={onClaim}>
      Claim
    </button>
  );
}
