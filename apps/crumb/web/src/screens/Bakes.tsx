import { currentStep } from "../../../src/fermentation/index.js";
import { type BakeRow, api } from "../api";
import { Empty, ErrorNote, Loading, PageTitle, Pill, Section, useNow } from "../components/ui";
import { when } from "../format";
import { href } from "../router";
import { useApi } from "../useApi";

export function Bakes() {
  const now = useNow();
  const { data, error, reload } = useApi("bakes", api.listBakes);
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  const active = data.filter((b) => b.status === "active");
  const past = data.filter((b) => b.status !== "active");

  return (
    <div>
      <PageTitle
        action={
          <a href={href({ name: "plan" })} className="btn-primary">
            Plan a bake
          </a>
        }
      >
        Bakes
      </PageTitle>

      <Section title="In progress">
        {active.length === 0 ? (
          <Empty title="Nothing planned">Plan a bake and Crumb will schedule every step from the starter onward.</Empty>
        ) : (
          active.map((b) => <BakeLine key={b.id} bake={b} now={now} />)
        )}
      </Section>

      {past.length > 0 && (
        <Section title="Journal">
          {past.map((b) => (
            <BakeLine key={b.id} bake={b} now={now} />
          ))}
        </Section>
      )}
    </div>
  );
}

function BakeLine({ bake, now }: { bake: BakeRow; now: Date }) {
  const cur = currentStep(bake.steps);
  return (
    <a href={href({ name: "bake", id: bake.id })} className="card focus-ring flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="truncate font-bold">
          {bake.recipe_name} × {bake.pieces}
        </div>
        <div className="text-sm text-muted">
          {bake.status === "active" && cur ? `${cur.label} · ` : ""}
          Out {when(bake.ready_at, now)}
        </div>
        {bake.status === "done" && bake.notes && <div className="mt-1 line-clamp-2 text-sm">{bake.notes}</div>}
      </div>
      {bake.status === "done" ? (
        <span className="shrink-0 text-crust" aria-label={bake.rating ? `${bake.rating} of 5` : "Not rated"}>
          {bake.rating ? "★".repeat(bake.rating) : <Pill tone="live">Done</Pill>}
        </span>
      ) : bake.status === "cancelled" ? (
        <Pill tone="muted">Cancelled</Pill>
      ) : (
        <Pill tone="live">Active</Pill>
      )}
    </a>
  );
}
