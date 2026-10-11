import type { ScaledFormula } from "../../../src/fermentation/index.js";
import { grams } from "../format";

/** A scaled formula: the levain, then what to weigh at mixing, with baker's percentages. */
export function Formula({ scaled }: { scaled: Pick<ScaledFormula, "levain" | "mix"> & { totalDough?: number } }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[15px]">
        <thead>
          <tr className="text-left">
            <th className="label-caps px-4 py-2">Ingredient</th>
            <th className="label-caps px-4 py-2 text-right">Grams</th>
            <th className="label-caps px-4 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          <tr>
            <td className="px-4 py-2">
              Ripe levain
              <span className="block text-xs text-muted">
                {grams(scaled.levain.flour)} flour + {grams(scaled.levain.water)} water
              </span>
            </td>
            <td className="num px-4 py-2 text-right font-semibold">{grams(scaled.levain.grams)}</td>
            <td className="num px-4 py-2 text-right text-muted" />
          </tr>
          {scaled.mix.map((l) => (
            <tr key={l.name}>
              <td className="px-4 py-2">{l.name}</td>
              <td className="num px-4 py-2 text-right font-semibold">{grams(l.grams)}</td>
              <td className="num px-4 py-2 text-right text-muted">{Math.round(l.pct * 10) / 10}</td>
            </tr>
          ))}
          {scaled.totalDough !== undefined && (
            <tr>
              <td className="px-4 py-2 font-bold">Dough</td>
              <td className="num px-4 py-2 text-right font-bold">{grams(scaled.totalDough)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
