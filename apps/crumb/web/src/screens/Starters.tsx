import { useState } from "react";
import { feedRatio, ratioLabel } from "../../../src/fermentation/index.js";
import { type FeedingRow, type StarterRow, api } from "../api";
import { StarterCard } from "../components/StarterCard";
import { Empty, ErrorNote, Field, Loading, PageTitle, Section, Segmented, useAction, useNow } from "../components/ui";
import { duration, fromLocalInput, grams, toLocalInput, when } from "../format";
import { go, href } from "../router";
import { formatTemp, usePrefs } from "../settings";
import { useApi } from "../useApi";

export function Starters() {
  const now = useNow();
  const { data, error, reload } = useApi("starters", api.listStarters);
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div>
      <PageTitle
        action={
          <a href={href({ name: "starter-new" })} className="btn">
            Add
          </a>
        }
      >
        Starters
      </PageTitle>
      <div className="flex flex-col gap-3">
        {data.length === 0 ? (
          <Empty
            title="No starters yet"
            action={
              <a href={href({ name: "starter-new" })} className="btn-primary">
                Add a starter
              </a>
            }
          >
            Most bakers keep one. Some keep a rye and a white.
          </Empty>
        ) : (
          data.map((s) => <StarterCard key={s.id} starter={s} now={now} actions />)
        )}
      </div>
    </div>
  );
}

/** Speed in words: how this starter compares with the model's typical one. */
function speedText(s: StarterRow): string {
  if (s.speed.samples === 0) return "Log when it peaks a few times and Crumb will learn how fast it is.";
  const f = s.speed.factor;
  const from = `from ${s.speed.samples} logged peak${s.speed.samples === 1 ? "" : "s"}`;
  if (Math.abs(f - 1) < 0.1) return `About as fast as a typical starter, ${from}.`;
  return f > 1
    ? `${f.toFixed(1)}× slower than a typical starter, ${from}.`
    : `${(1 / f).toFixed(1)}× faster than a typical starter, ${from}.`;
}

export function StarterDetail({ id }: { id: string }) {
  const now = useNow();
  const { tempUnit } = usePrefs();
  const data = useApi(`starter:${id}`, () => Promise.all([api.getStarter(id), api.listFeedings(id, 30)]));
  const action = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (data.error) return <ErrorNote error={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const [starter, feedings] = data.data;

  const move = (location: "counter" | "fridge") =>
    action.run(async () => {
      await api.updateStarter(id, { location });
      data.reload();
    });

  return (
    <div>
      <PageTitle
        sub={[starter.flour, `${starter.hydration}% hydration`].filter(Boolean).join(" · ")}
        action={
          <a href={href({ name: "starter-edit", id })} className="btn">
            Edit
          </a>
        }
      >
        {starter.name}
      </PageTitle>

      <div className="mb-7 flex flex-col gap-3">
        <StarterCard starter={starter} now={now} />
        <Segmented
          label="Where it lives"
          value={starter.location}
          options={[
            { value: "counter", label: "On the counter" },
            { value: "fridge", label: "In the fridge" },
          ]}
          onChange={(v) => void move(v)}
        />
        <a href={href({ name: "feed", id })} className="btn-primary">
          Feed {starter.name}
        </a>
        {action.error && <ErrorNote error={action.error} />}
      </div>

      {starter.last_fed && !starter.last_fed.peak_at && starter.location === "counter" && (
        <LogPeak feeding={starter.last_fed} onDone={data.reload} />
      )}

      <Section title="Speed">
        <p className="text-muted">{speedText(starter)}</p>
      </Section>

      <Section title="Feeds">
        {feedings.length === 0 ? (
          <p className="text-muted">No feeds logged yet.</p>
        ) : (
          <ul className="card divide-y divide-line">
            {feedings.map((f) => (
              <FeedingLine key={f.id} feeding={f} tempUnit={tempUnit} now={now} onChange={data.reload} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Remove">
        {confirmDelete ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.deleteStarter(id);
                  go({ name: "starters" });
                })
              }
            >
              Delete {starter.name} and its feeds
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" className="btn-danger self-start" onClick={() => setConfirmDelete(true)}>
            Delete starter
          </button>
        )}
      </Section>
    </div>
  );
}

function LogPeak({ feeding, onDone }: { feeding: FeedingRow; onDone: () => void }) {
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const [rise, setRise] = useState("");
  const action = useAction();
  const save = () =>
    action.run(async () => {
      const d = fromLocalInput(at);
      if (!d) throw new Error("Pick when it peaked.");
      await api.updateFeeding(feeding.id, { peakAt: d.toISOString(), risePct: rise ? Number(rise) : null });
      onDone();
    });

  return (
    <Section title="Did it peak?">
      <div className="card flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          At its peak the top is domed and just starting to flatten. Logging it teaches Crumb how fast your starter is.
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <Field label="Peaked at">
            <input id="peak-at" type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="Rise %">
            <input
              id="peak-rise"
              type="number"
              inputMode="numeric"
              placeholder="100"
              className="input"
              value={rise}
              onChange={(e) => setRise(e.target.value)}
            />
          </Field>
        </div>
        <button type="button" className="btn-primary" disabled={action.busy} onClick={() => void save()}>
          Log peak
        </button>
        {action.error && <ErrorNote error={action.error} />}
      </div>
    </Section>
  );
}

function FeedingLine({
  feeding: f,
  tempUnit,
  now,
  onChange,
}: {
  feeding: FeedingRow;
  tempUnit: "F" | "C";
  now: Date;
  onChange: () => void;
}) {
  const action = useAction();
  const hydration = f.flour_g > 0 ? (f.water_g / f.flour_g) * 100 : 100;
  const toPeak = f.peak_at ? (Date.parse(f.peak_at) - Date.parse(f.fed_at)) / 60_000 : null;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="font-bold">
          <span className="num">{ratioLabel(feedRatio(f.starter_g, f.flour_g), hydration)}</span>
          <span className="ml-2 font-normal text-muted">{when(f.fed_at, now)}</span>
        </div>
        <div className="text-sm text-muted">
          {grams(f.starter_g)} + {grams(f.flour_g)} + {grams(f.water_g)}
          {f.temp_f !== null && ` · ${formatTemp(f.temp_f, tempUnit)}`}
          {toPeak !== null && ` · peaked after ${duration(toPeak)}`}
          {f.rise_pct !== null && `, +${f.rise_pct}%`}
        </div>
      </div>
      <button
        type="button"
        aria-label="Delete this feed"
        className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:text-warn"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await api.deleteFeeding(f.id);
            onChange();
          })
        }
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      </button>
    </li>
  );
}

/** New starter, or edit an existing one when `id` is given. */
export function StarterForm({ id }: { id?: string }) {
  const existing = useApi(`starter-form:${id ?? "new"}`, () => (id ? api.getStarter(id) : Promise.resolve(null)));
  if (existing.error) return <ErrorNote error={existing.error} retry={existing.reload} />;
  if (existing.loading && id) return <Loading />;
  return <StarterFormBody key={existing.data?.id ?? "new"} starter={existing.data ?? null} />;
}

function StarterFormBody({ starter }: { starter: StarterRow | null }) {
  const [name, setName] = useState(starter?.name ?? "");
  const [flour, setFlour] = useState(starter?.flour ?? "");
  const [hydration, setHydration] = useState(String(starter?.hydration ?? 100));
  const [reserve, setReserve] = useState(String(starter?.reserve_grams ?? 20));
  const [location, setLocation] = useState<"counter" | "fridge">(starter?.location ?? "counter");
  const [notes, setNotes] = useState(starter?.notes ?? "");
  const action = useAction();

  const save = () =>
    action.run(async () => {
      const body = {
        name,
        flour,
        hydration: Number(hydration),
        reserveGrams: Number(reserve),
        location,
        notes,
      };
      const saved = starter ? await api.updateStarter(starter.id, body) : await api.createStarter(body);
      go({ name: "starter", id: saved.id });
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageTitle>{starter ? `Edit ${starter.name}` : "New starter"}</PageTitle>
      <Field label="Name">
        <input id="starter-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bertha" required />
      </Field>
      <Field label="Flour" hint="What you feed it.">
        <input id="starter-flour" className="input" value={flour} onChange={(e) => setFlour(e.target.value)} placeholder="50/50 rye and all-purpose" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hydration %" hint="100 = equal flour and water">
          <input id="starter-hydration" type="number" inputMode="numeric" className="input" value={hydration} onChange={(e) => setHydration(e.target.value)} />
        </Field>
        <Field label="Keep in the jar, g" hint="Left after taking what a bake needs">
          <input id="starter-reserve" type="number" inputMode="numeric" className="input" value={reserve} onChange={(e) => setReserve(e.target.value)} />
        </Field>
      </div>
      <Field label="Where it lives">
        <Segmented
          label="Where it lives"
          value={location}
          options={[
            { value: "counter", label: "On the counter" },
            { value: "fridge", label: "In the fridge" },
          ]}
          onChange={setLocation}
        />
      </Field>
      <Field label="Notes">
        <textarea id="starter-notes" className="input min-h-[88px] py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {action.error && <ErrorNote error={action.error} />}
      <button type="submit" className="btn-primary" disabled={action.busy || !name.trim()}>
        {starter ? "Save" : "Add starter"}
      </button>
    </form>
  );
}
