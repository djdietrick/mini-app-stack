import { useMemo, useState } from "react";
import {
  DEFAULT_TEMP_F,
  feedAmounts,
  planFeed,
  predictPeak,
  ratioLabel,
} from "../../../src/fermentation/index.js";
import { type StarterRow, api } from "../api";
import { TipLine, useTip } from "../components/Help";
import { ErrorNote, Field, Loading, PageTitle, Segmented, useAction, useNow } from "../components/ui";
import { fromLocalInput, grams, relative, toLocalInput, when } from "../format";
import { go } from "../router";
import { fromUnit, toUnit, updatePrefs, usePrefs } from "../settings";
import { useApi } from "../useApi";

const HOUR = 3_600_000;
const QUICK_RATIOS = [1, 2, 5, 10] as const;

export function Feed({ id }: { id: string }) {
  const { data, error, reload } = useApi(`starter:${id}`, () => api.getStarter(id));
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  return <FeedBody starter={data} />;
}

/**
 * The feed calculator. "Ready by" picks the ratio that peaks half an hour
 * before you need it, from the starter's learned speed and the kitchen
 * temperature; "Just feeding" is a plain feed at a chosen ratio. Either way
 * the result is grams to keep, flour and water to add, and a predicted peak.
 */
function FeedBody({ starter }: { starter: StarterRow }) {
  const now = useNow(60_000);
  const prefs = usePrefs();
  const [mode, setMode] = useState<"ready-by" | "maintain">("ready-by");
  const [need, setNeed] = useState("100");
  const [readyAt, setReadyAt] = useState(() => toLocalInput(new Date(Date.now() + 10 * HOUR)));
  const [temp, setTemp] = useState(() => String(toUnit(prefs.kitchenF, prefs.tempUnit)));
  const [chosen, setChosen] = useState<number | null>(null);
  const [plainRatio, setPlainRatio] = useState<number>(starter.location === "fridge" ? 5 : 2);
  const [jar, setJar] = useState("");
  const [remind, setRemind] = useState(starter.location === "counter");
  const [manual, setManual] = useState<{ s: string; f: string; w: string } | null>(null);
  const action = useAction();

  const tempF = Number.isFinite(Number(temp)) && temp !== "" ? fromUnit(Number(temp), prefs.tempUnit) : DEFAULT_TEMP_F;
  const speed = starter.speed.factor;
  const hydration = starter.hydration;
  const reserve = starter.reserve_grams;

  const calc = useMemo(() => {
    if (mode === "maintain") {
      const a = feedAmounts(0, reserve, plainRatio, hydration);
      return { status: "ok" as const, ratio: plainRatio, peakAt: predictPeak(now, plainRatio, tempF, speed), amounts: a, feedAt: now };
    }
    const target = fromLocalInput(readyAt) ?? new Date(now.getTime() + 10 * HOUR);
    const plan = planFeed({ now, readyAt: target, tempF, speed, need: Number(need) || 0, reserve, hydrationPct: hydration });
    if (chosen === null) return plan;
    return {
      ...plan,
      status: "ok" as const,
      ratio: chosen,
      feedAt: now,
      peakAt: predictPeak(now, chosen, tempF, speed),
      amounts: feedAmounts(Number(need) || 0, reserve, chosen, hydration),
    };
  }, [mode, plainRatio, readyAt, need, tempF, speed, hydration, reserve, chosen, now]);

  const amounts = manual
    ? { starter: Number(manual.s) || 0, flour: Number(manual.f) || 0, water: Number(manual.w) || 0 }
    : calc.amounts;
  const discard = jar ? Math.max(0, Number(jar) - amounts.starter) : null;
  const ratioOptions = [...new Set([...QUICK_RATIOS, calc.ratio])].sort((a, b) => a - b);

  const log = () =>
    action.run(async () => {
      if (!(amounts.starter > 0)) throw new Error("Enter how much starter you kept.");
      updatePrefs({ kitchenF: tempF });
      await api.logFeeding(starter.id, {
        starterG: amounts.starter,
        flourG: amounts.flour,
        waterG: amounts.water,
        tempF,
        remindAtPeak: remind && starter.location === "counter",
      });
      go({ name: "starter", id: starter.id });
    });

  return (
    <div className="flex flex-col gap-5">
      <PageTitle sub={`${starter.flour || "Starter"} · ${hydration}% hydration`}>Feed {starter.name}</PageTitle>

      <TipLine tip="feedMode" label="What for" />
      <Segmented
        label="What for"
        value={mode}
        options={[
          { value: "ready-by", label: "Ready by a time" },
          { value: "maintain", label: "Just feeding" },
        ]}
        onChange={(m) => {
          setMode(m);
          setManual(null);
        }}
      />

      <div className="card grid grid-cols-2 gap-3 p-4">
        {mode === "ready-by" ? (
          <>
            <Field label="I need, g" hint="ripe starter" help="need">
              <input id="feed-need" type="number" inputMode="numeric" className="input" value={need} onChange={(e) => setNeed(e.target.value)} />
            </Field>
            <Field label={`Kitchen, °${prefs.tempUnit}`} help="kitchenTemp">
              <input id="feed-temp" type="number" inputMode="decimal" className="input" value={temp} onChange={(e) => setTemp(e.target.value)} />
            </Field>
            <div className="col-span-2">
              <Field label="Ready at" help="readyAt">
                <input
                  id="feed-ready-at"
                  type="datetime-local"
                  className="input"
                  value={readyAt}
                  onChange={(e) => {
                    setReadyAt(e.target.value);
                    setChosen(null);
                  }}
                />
              </Field>
            </div>
          </>
        ) : (
          <>
            <div className="col-span-2">
              <Field label="Ratio" help="ratio" group>
                <Segmented
                  label="Ratio"
                  value={plainRatio}
                  options={QUICK_RATIOS.map((r) => ({ value: r, label: ratioLabel(r) }))}
                  onChange={setPlainRatio}
                />
              </Field>
            </div>
            <Field label={`Kitchen, °${prefs.tempUnit}`} help="kitchenTemp">
              <input id="feed-temp" type="number" inputMode="decimal" className="input" value={temp} onChange={(e) => setTemp(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Jar has now, g" hint="optional, for the discard" help="jar">
          <input id="feed-jar" type="number" inputMode="numeric" className="input" value={jar} onChange={(e) => setJar(e.target.value)} placeholder="—" />
        </Field>
      </div>

      {mode === "ready-by" && (
        <div className="flex flex-col gap-2">
          <TipLine tip="ratio" label="Suggested ratio" />
          <Segmented
            label="Ratio"
            value={calc.ratio}
            options={ratioOptions.map((r) => ({ value: r, label: ratioLabel(r) }))}
            onChange={(r) => {
              setChosen(r);
              setManual(null);
            }}
          />
          {calc.status === "too-soon" && (
            <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
              Even 1:1:1 won't peak in time at this temperature. Feed it now somewhere warmer, or use it a little before its peak.
            </p>
          )}
          {calc.status === "feed-later" && (
            <p className="rounded-xl bg-crust-soft p-3 text-sm text-crust">
              That's a long way off. Feed it {ratioLabel(calc.ratio)} at <strong>{when(calc.feedAt, now)}</strong> instead, or keep it in the
              fridge until then.
            </p>
          )}
        </div>
      )}

      <div className="card p-4">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-[15px]">
          <dt>Keep starter</dt>
          <dd className="num text-right font-semibold">{grams(amounts.starter)}</dd>
          <dt>Add flour</dt>
          <dd className="num text-right font-semibold">{grams(amounts.flour)}</dd>
          <dt>Add water</dt>
          <dd className="num text-right font-semibold">{grams(amounts.water)}</dd>
          {discard !== null && (
            <>
              <dt className="text-muted">Discard</dt>
              <dd className="num text-right text-muted">{grams(discard)}</dd>
            </>
          )}
        </dl>
        <FeedSteps amounts={amounts} discard={discard} fridge={starter.location === "fridge"} open={!starter.last_fed} />
        <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
          {starter.location === "fridge"
            ? "Let it rise for an hour or two before it goes back in the fridge."
            : `Peaks around ${when(calc.peakAt, now)} (${relative(calc.peakAt, now)}) at ${toUnit(tempF, prefs.tempUnit)}°${prefs.tempUnit}${
                starter.speed.samples ? ", from how fast it has been" : ""
              }.`}
        </p>
        <button
          type="button"
          className="focus-ring mt-2 rounded text-sm font-bold text-crust"
          onClick={() =>
            setManual(manual ? null : { s: String(amounts.starter), f: String(amounts.flour), w: String(amounts.water) })
          }
        >
          {manual ? "Use the suggestion" : "Fed different amounts?"}
        </button>
        {manual && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Starter, g">
              <input id="manual-starter" type="number" inputMode="decimal" className="input" value={manual.s} onChange={(e) => setManual({ ...manual, s: e.target.value })} />
            </Field>
            <Field label="Flour, g">
              <input id="manual-flour" type="number" inputMode="decimal" className="input" value={manual.f} onChange={(e) => setManual({ ...manual, f: e.target.value })} />
            </Field>
            <Field label="Water, g">
              <input id="manual-water" type="number" inputMode="decimal" className="input" value={manual.w} onChange={(e) => setManual({ ...manual, w: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      {starter.location === "counter" && <RemindAtPeak checked={remind} onChange={setRemind} />}

      {action.error && <ErrorNote error={action.error} />}
      <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void log()}>
        Log this feed
      </button>
    </div>
  );
}

/** The feed, as steps to follow. Open by default on a starter's first feed. */
function FeedSteps({
  amounts,
  discard,
  fridge,
  open,
}: {
  amounts: { starter: number; flour: number; water: number };
  discard: number | null;
  fridge: boolean;
  open: boolean;
}) {
  return (
    <details open={open} className="group mt-3 border-t border-line pt-3 text-sm">
      <summary className="focus-ring cursor-pointer list-none rounded font-bold text-crust">
        <span className="group-open:hidden">Show me how, step by step</span>
        <span className="hidden group-open:inline">Step by step</span>
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 leading-relaxed">
        <li>Stir the starter down. Put a clean jar on the scale and zero it.</li>
        <li>
          Spoon in <strong>{grams(amounts.starter)}</strong> of starter.{" "}
          {discard !== null && discard > 0
            ? `The other ${grams(discard)} is discard: bin it, or save it in the fridge for pancakes or crackers.`
            : "Whatever is left over is discard: bin it, or save it in the fridge for pancakes or crackers."}
        </li>
        <li>
          Add <strong>{grams(amounts.flour)}</strong> flour and <strong>{grams(amounts.water)}</strong> water. Lukewarm water helps in a cold
          kitchen.
        </li>
        <li>Mix until no dry flour is left, then scrape down the sides.</li>
        <li>Mark the level with a rubber band or a strip of tape, so you can see the rise.</li>
        <li>
          {fridge
            ? "Cover it loosely, leave it out for an hour or two until it starts to bubble, then back in the fridge."
            : "Cover it loosely (don't screw the lid down) and leave it on the counter. It has peaked when it has about doubled and the top is domed."}
        </li>
      </ol>
    </details>
  );
}

function RemindAtPeak({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const tip = useTip("remindPeak", "Remind me when it should be peaking");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label className="flex min-h-[44px] items-center gap-3">
          <input id="feed-remind" type="checkbox" className="h-5 w-5 accent-[rgb(var(--crust))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <span>Remind me when it should be peaking</span>
        </label>
        {tip.button}
      </div>
      {tip.panel}
    </div>
  );
}
