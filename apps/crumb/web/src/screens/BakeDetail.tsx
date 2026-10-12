import { useState } from "react";
import { type BakeStep, currentStep, foldsDue, nightSteps } from "../../../src/fermentation/index.js";
import { type BakeRow, api } from "../api";
import { Formula } from "../components/Formula";
import { StepHowTo } from "../components/Help";
import { Timeline } from "../components/Timeline";
import { ErrorNote, Field, Loading, PageTitle, Pill, Section, useAction, useNow } from "../components/ui";
import { deviceTimeZone, duration, time, when } from "../format";
import { go, href } from "../router";
import { formatTemp, usePrefs } from "../settings";
import { useApi } from "../useApi";
import { useWakeLock } from "../wakeLock";

export function BakeDetail({ id }: { id: string }) {
  const { data, error, reload } = useApi(`bake:${id}`, () => api.getBake(id));
  const [bake, setBake] = useState<BakeRow | null>(null);
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  // Actions return the updated bake; show it without a refetch.
  const current = bake && bake.id === data.id && bake.updated_at >= data.updated_at ? bake : data;
  return <BakeBody bake={current} onChange={setBake} />;
}

/** "12:48" for the countdown, "1:05:12" past an hour. */
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/**
 * Bake mode: the current step large, with a timer, its folds and a Done
 * button; then the whole plan. Finishing a step early or late moves the rest
 * of the plan (and its reminders) to match.
 */
function BakeBody({ bake, onChange }: { bake: BakeRow; onChange: (b: BakeRow) => void }) {
  const now = useNow(1000);
  const { tempUnit } = usePrefs();
  const action = useAction();
  const active = bake.status === "active";
  useWakeLock(active);

  const cur = currentStep(bake.steps);
  const night = active ? nightSteps(bake.steps, deviceTimeZone()) : [];
  const act = (fn: () => Promise<BakeRow>) =>
    action.run(async () => {
      onChange(await fn());
    });

  return (
    <div>
      <PageTitle
        sub={`${bake.pieces} × ${bake.piece_grams} g · ${formatTemp(bake.temp_f, tempUnit)} · out ${when(bake.ready_at, now)}`}
        action={
          bake.status === "active" ? (
            <Pill tone="live">Active</Pill>
          ) : (
            <Pill tone="muted">{bake.status === "done" ? "Done" : "Cancelled"}</Pill>
          )
        }
      >
        {bake.recipe_name}
      </PageTitle>

      {active && cur && <CurrentStep bake={bake} step={cur} now={now} busy={action.busy} act={act} />}
      {action.error && (
        <div className="mb-5">
          <ErrorNote error={action.error} />
        </div>
      )}

      <Section title="Plan">
        <div className="card p-4 pb-1">
          <Timeline steps={bake.steps} currentId={active ? cur?.id : null} night={night} />
        </div>
      </Section>

      <Section title="Formula" help="formula">
        <Formula scaled={{ ...bake, totalDough: bake.pieces * bake.piece_grams }} />
      </Section>

      {!active || !cur ? <Journal bake={bake} onChange={onChange} /> : null}

      <Section title={active ? "Change of plans" : "Remove"}>
        <div className="flex flex-wrap gap-2">
          {active && (
            <button
              type="button"
              className="btn"
              disabled={action.busy}
              onClick={() => void act(() => api.updateBake(bake.id, { status: "cancelled" }))}
            >
              Cancel this bake
            </button>
          )}
          <DeleteBake id={bake.id} />
        </div>
      </Section>
    </div>
  );
}

function CurrentStep({
  bake,
  step,
  now,
  busy,
  act,
}: {
  bake: BakeRow;
  step: BakeStep;
  now: Date;
  busy: boolean;
  act: (fn: () => Promise<BakeRow>) => Promise<unknown>;
}) {
  const start = Date.parse(step.start_at);
  const end = Date.parse(step.end_at);
  const upcoming = now.getTime() < start;
  const nextFold = foldsDue(step)[0];
  const foldsLeft = step.folds ? step.folds.count - step.fold_times.length : 0;

  let caption: string;
  let target: number;
  if (upcoming) {
    caption = `Starts at ${time(step.start_at)}`;
    target = start;
  } else if (nextFold && foldsLeft > 0) {
    caption = `Fold ${step.fold_times.length + 1} of ${step.folds!.count} in`;
    target = nextFold.getTime();
  } else {
    caption = now.getTime() < end ? `Until ${time(step.end_at)}` : `Due at ${time(step.end_at)}`;
    target = end;
  }
  const late = !upcoming && now.getTime() > target;

  return (
    <div className="card mb-7 flex flex-col gap-4 border-crust/40 p-5">
      <div>
        <div className="label-caps">{upcoming ? "Next step" : "Now"}</div>
        <h2 className="mt-1 text-balance font-display text-3xl font-bold leading-tight">{step.label}</h2>
        {step.detail && <p className="mt-2 text-muted">{step.detail}</p>}
      </div>

      <StepHowTo key={step.id} kind={step.kind} />

      <div className="text-center">
        <div className="label-caps">{late ? (nextFold && foldsLeft > 0 ? "Fold is due" : "Running over") : caption}</div>
        <div className={"num mt-1 text-5xl font-semibold " + (late ? "text-warn" : "")}>{clock(Math.abs(target - now.getTime()))}</div>
        <div className="mt-1 text-sm text-muted">{duration(step.minutes)} step</div>
      </div>

      {step.folds && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2" aria-label={`${step.fold_times.length} of ${step.folds.count} folds done`}>
            {Array.from({ length: step.folds.count }, (_, i) => (
              <span key={i} className={"h-7 w-7 rounded-full border-2 " + (i < step.fold_times.length ? "border-live bg-live" : "border-line")} />
            ))}
          </div>
          {foldsLeft > 0 && !upcoming && (
            <button type="button" className="btn w-full" disabled={busy} onClick={() => void act(() => api.logFold(bake.id, step.id))}>
              Fold done
            </button>
          )}
        </div>
      )}

      <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => api.stepDone(bake.id, step.id))}>
        {upcoming ? `Done early: ${step.label.toLowerCase()}` : "Done, next step"}
      </button>
      <div className="grid grid-cols-3 gap-2">
        {[15, 30, 60].map((m) => (
          <button key={m} type="button" className="btn px-2" disabled={busy} onClick={() => void act(() => api.shiftBake(bake.id, m))}>
            +{m} min
          </button>
        ))}
      </div>
      <p className="-mt-2 text-center text-xs text-muted">Running late? Push the rest of the plan back.</p>
    </div>
  );
}

function Journal({ bake, onChange }: { bake: BakeRow; onChange: (b: BakeRow) => void }) {
  const [notes, setNotes] = useState(bake.notes);
  const [rating, setRating] = useState<number | null>(bake.rating);
  const action = useAction();
  const dirty = notes !== bake.notes || rating !== bake.rating;
  return (
    <Section title="How did it turn out?">
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} of 5`}
              onClick={() => setRating(rating === n ? null : n)}
              className={"focus-ring h-11 w-11 rounded-lg text-2xl " + (rating !== null && n <= rating ? "text-crust" : "text-line")}
            >
              ★
            </button>
          ))}
        </div>
        <Field label="Notes">
          <textarea
            id="bake-notes"
            className="input min-h-[96px] py-2"
            placeholder="Crumb, crust, what you'd change next time"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {action.error && <ErrorNote error={action.error} />}
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || action.busy}
          onClick={() =>
            void action.run(async () => {
              onChange(await api.updateBake(bake.id, { notes, rating }));
            })
          }
        >
          Save notes
        </button>
        <a href={href({ name: "plan", recipeId: bake.recipe_id })} className="btn">
          Bake it again
        </a>
      </div>
    </Section>
  );
}

function DeleteBake({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false);
  const action = useAction();
  if (!confirm) {
    return (
      <button type="button" className="btn-danger" onClick={() => setConfirm(true)}>
        Delete
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn-danger"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await api.deleteBake(id);
            go({ name: "bakes" });
          })
        }
      >
        Delete for good
      </button>
      <button type="button" className="btn" onClick={() => setConfirm(false)}>
        Keep it
      </button>
    </>
  );
}
