import { useEffect } from "react";
import { peakHours, ratioLabel } from "../../../src/fermentation/index.js";
import { PageTitle } from "../components/ui";
import { duration } from "../format";
import { GUIDE, type GuideSection } from "../help";
import { href } from "../router";
import { formatTemp, usePrefs } from "../settings";

const RATIO_USES: { ratio: number; use: string }[] = [
  { ratio: 1, use: "Waking up a sluggish starter, or a bake later today" },
  { ratio: 2, use: "A levain for the same day" },
  { ratio: 5, use: "Overnight, or ready by tomorrow morning" },
  { ratio: 10, use: "Once a day on the counter" },
];

/**
 * The beginner's guide: the background the field tips link to. The ratio
 * table comes from the same model as the feed calculator, at the baker's own
 * kitchen temperature, so the guide and the predictions agree.
 */
export function Guide({ section }: { section?: GuideSection }) {
  const prefs = usePrefs();

  useEffect(() => {
    if (!section) return;
    document.getElementById(`guide-${section}`)?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <div>
      <PageTitle sub="Everything Crumb assumes you know, in the order you'll need it.">Sourdough guide</PageTitle>

      <nav aria-label="Guide sections" className="mb-8 flex flex-wrap gap-2">
        {GUIDE.map((g) => (
          <a
            key={g.id}
            href={href({ name: "guide", section: g.id })}
            className={
              "focus-ring rounded-full border px-3 py-1.5 text-sm font-bold " +
              (g.id === section ? "border-crust bg-crust-soft text-crust" : "border-line bg-surface text-muted hover:text-ink")
            }
          >
            {g.title}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-9">
        {GUIDE.map((g) => (
          <section key={g.id} id={`guide-${g.id}`} className="scroll-mt-4" aria-labelledby={`guide-${g.id}-h`}>
            <h2 id={`guide-${g.id}-h`} className="mb-3 text-balance font-display text-2xl font-bold">
              {g.title}
            </h2>
            <div className="flex max-w-prose flex-col gap-3 leading-relaxed">
              {g.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            {g.id === "ratios" && (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead>
                    <tr className="text-left">
                      <th className="label-caps px-4 py-2">Feed</th>
                      <th className="label-caps px-4 py-2">Peaks in</th>
                      <th className="label-caps px-4 py-2">Good for</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line border-t border-line">
                    {RATIO_USES.map(({ ratio, use }) => (
                      <tr key={ratio}>
                        <td className="num whitespace-nowrap px-4 py-2 font-semibold">{ratioLabel(ratio)}</td>
                        <td className="num whitespace-nowrap px-4 py-2">~{duration(Math.round((peakHours(ratio, prefs.kitchenF) * 60) / 15) * 15)}</td>
                        <td className="px-4 py-2 text-muted">{use}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-4 py-2 text-sm text-muted">
                  At {formatTemp(prefs.kitchenF, prefs.tempUnit)}, your last kitchen temperature, for a typical starter.
                </p>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
