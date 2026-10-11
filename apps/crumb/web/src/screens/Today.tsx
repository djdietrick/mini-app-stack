import { currentStep } from "../../../src/fermentation/index.js";
import { api } from "../api";
import { StarterCard } from "../components/StarterCard";
import { Timeline } from "../components/Timeline";
import { Empty, ErrorNote, Loading, PageTitle, Section, useNow } from "../components/ui";
import { relative, when } from "../format";
import { href } from "../router";
import { updatePrefs, usePrefs } from "../settings";
import { useApi } from "../useApi";

/** The home screen: every starter's state, active bakes' next steps, and what's coming up. */
export function Today() {
  const now = useNow();
  const prefs = usePrefs();
  const data = useApi("today", () => Promise.all([api.listStarters(), api.listBakes(), api.listReminders()]));

  if (data.error) return <ErrorNote error={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const [starters, bakes, reminders] = data.data;
  const active = bakes.filter((b) => b.status === "active");

  return (
    <div>
      <PageTitle sub={new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now)}>
        Today
      </PageTitle>

      {!prefs.introHidden && <Intro />}

      <Section title={starters.length > 1 ? "Starters" : "Starter"}>
        {starters.length === 0 ? (
          <Empty
            title="Add your starter"
            action={
              <a href={href({ name: "starter-new" })} className="btn-primary">
                Add a starter
              </a>
            }
          >
            Tell Crumb about your starter and it will track its feeds, predict when it peaks, and remind you to feed it.
          </Empty>
        ) : (
          starters.map((s) => <StarterCard key={s.id} starter={s} now={now} actions />)
        )}
      </Section>

      <Section
        title="Bakes in progress"
        action={
          <a href={href({ name: "plan" })} className="focus-ring rounded text-sm font-bold text-crust">
            Plan a bake
          </a>
        }
      >
        {active.length === 0 ? (
          <Empty
            title="Nothing in the oven"
            action={
              <a href={href({ name: "plan" })} className="btn-primary">
                Plan a bake
              </a>
            }
          >
            Pick a recipe and when you want it out of the oven; Crumb works backward and reminds you at every step.
          </Empty>
        ) : (
          active.map((b) => {
            const cur = currentStep(b.steps);
            const upcoming = b.steps.filter((s) => s.done_at === null).slice(0, 3);
            return (
              <a key={b.id} href={href({ name: "bake", id: b.id })} className="card focus-ring block p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold">
                    {b.recipe_name} × {b.pieces}
                  </span>
                  <span className="text-sm text-muted">Out {when(b.ready_at, now)}</span>
                </div>
                {cur && (
                  <div className="mt-1 font-display text-xl font-bold">
                    {Date.parse(cur.start_at) > now.getTime() ? `Next: ${cur.label}` : cur.label}
                  </div>
                )}
                <div className="mt-3">
                  <Timeline steps={upcoming} currentId={cur?.id} compact />
                </div>
              </a>
            );
          })
        )}
      </Section>

      {reminders.length > 0 && (
        <Section title="Coming up">
          <ul className="card divide-y divide-line">
            {reminders.slice(0, 6).map((r) => (
              <li key={r.id}>
                <a href={r.url} className="focus-ring flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="shrink-0 text-right text-sm text-muted">
                    <span className="num">{when(r.due_at, now)}</span>
                    <span className="block text-xs">{relative(r.due_at, now)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** For a first-time baker: where to start. Hidden for good once dismissed. */
function Intro() {
  return (
    <div className="card mb-7 flex flex-col gap-3 border-crust/40 bg-crust-soft p-4">
      <h2 className="font-display text-xl font-bold">New to sourdough?</h2>
      <p className="leading-relaxed">
        The guide covers what a starter is, how to feed it, what the feeding ratios do, and how to tell when it's ready. Throughout the app,
        tap <span aria-hidden="true">ⓘ</span>
        <span className="sr-only">the info buttons</span> next to a field to see what it means.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={href({ name: "guide" })} className="btn-primary">
          Read the guide
        </a>
        <a href={href({ name: "guide", section: "feeding" })} className="btn">
          How to feed
        </a>
        <button type="button" className="btn" onClick={() => updatePrefs({ introHidden: true })}>
          Hide this
        </button>
      </div>
    </div>
  );
}
