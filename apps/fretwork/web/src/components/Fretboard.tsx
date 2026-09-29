import { useId } from "react";
import {
  type FretWindow,
  INLAY_FRETS,
  STRING_NAMES,
  fretDistance,
  midiAt,
  midiName,
} from "../../../src/theory/index.js";

/**
 * The neck, horizontal, high E on top (the way tab reads).
 *
 * Drawn as SVG with a viewBox, so it scales to whatever width its container
 * gives it: a phone column now, a landscape tablet or desktop later. The
 * logical width grows with the number of frets shown, so a 5-fret window on a
 * phone renders with thumb-sized cells while a full neck on a wide screen
 * still keeps its proportions. Fret spacing follows equal temperament
 * (fretDistance), so positions look where the hand expects them.
 */

export type DotTone = "root" | "note" | "target" | "correct" | "miss" | "hint" | "ghost";

export interface Dot {
  string: number;
  fret: number;
  label?: string;
  tone: DotTone;
}

export interface FretboardProps {
  /** Frets to draw. Fret 0 adds the nut and an open-string column. */
  frets: FretWindow;
  dots?: Dot[];
  /** Shades a region, e.g. the exercise's fret window inside a wider view. */
  highlight?: FretWindow;
  /** Makes every position a button — the engines use this as a practice-mode fallback and in tests. */
  onPress?: (string: number, fret: number) => void;
  className?: string;
  /** Accessible name for the whole diagram. */
  title?: string;
}

const CELL_W = 64;
const NUT_ZONE = 34;
const GAP = 30;
const PAD_Y = 20;
const NUMBERS_H = 20;
const THICKNESS = [1.4, 1.7, 2.1, 2.6, 3.1, 3.6];

const TONES: Record<DotTone, { fill: string; stroke: string; text: string; dashed?: boolean; r?: number }> = {
  root: { fill: "#e5a54b", stroke: "#e5a54b", text: "#1a140c" },
  note: { fill: "#2a231b", stroke: "#cdbd9f", text: "#f4ecdc" },
  target: { fill: "#2a231b", stroke: "#fff4dd", text: "#f4ecdc" },
  correct: { fill: "#7fd1b9", stroke: "#7fd1b9", text: "#10231d" },
  miss: { fill: "#f0785a", stroke: "#f0785a", text: "#2a0f07" },
  hint: { fill: "#241b13", stroke: "#e5a54b", text: "#f2c27c", dashed: true },
  ghost: { fill: "#5a4636", stroke: "#5a4636", text: "transparent", r: 5 },
};

export function Fretboard({ frets, dots = [], highlight, onPress, className, title }: FretboardProps) {
  const titleId = useId();
  const { lo, hi } = frets;
  const hasNut = lo === 0;
  // The left edge is the nut, or the wire just below the first fret shown.
  const edge = hasNut ? 0 : lo - 1;
  const fretCount = hi - edge;
  const boardLeft = hasNut ? NUT_ZONE : 0;
  const boardW = Math.max(fretCount, 1) * CELL_W;
  const W = boardLeft + boardW;
  const boardH = PAD_Y * 2 + GAP * 5;
  const H = boardH + NUMBERS_H;
  const span = fretDistance(hi) - fretDistance(edge);

  const wireX = (n: number) => boardLeft + ((fretDistance(n) - fretDistance(edge)) / span) * boardW;
  const cellX = (f: number) => (f === 0 ? NUT_ZONE / 2 : (wireX(f - 1) + wireX(f)) / 2);
  const cellLeft = (f: number) => (f === 0 ? 0 : wireX(f - 1));
  const stringY = (s: number) => PAD_Y + (s - 1) * GAP;

  const shown: number[] = [];
  for (let f = hasNut ? 0 : lo; f <= hi; f++) shown.push(f);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      width="100%"
      role={onPress ? "group" : "img"}
      aria-labelledby={title ? titleId : undefined}
    >
      {title && <title id={titleId}>{title}</title>}

      {hasNut && <rect x={0} y={0} width={NUT_ZONE - 4} height={boardH} rx={8} fill="#1f1a14" />}
      <rect x={boardLeft} y={0} width={boardW} height={boardH} rx={hasNut ? 0 : 8} fill="#3a281c" />

      {highlight && (
        <rect
          x={highlight.lo === 0 ? 0 : wireX(Math.max(highlight.lo - 1, edge))}
          y={0}
          width={wireX(Math.min(highlight.hi, hi)) - (highlight.lo === 0 ? 0 : wireX(Math.max(highlight.lo - 1, edge)))}
          height={boardH}
          fill="rgba(244,236,220,0.08)"
          stroke="#e5a54b"
          strokeDasharray="4 4"
        />
      )}

      {shown
        .filter((f) => INLAY_FRETS.includes(f))
        .map((f) =>
          f % 12 === 0 ? (
            [stringY(2.5), stringY(4.5)].map((y) => (
              <circle key={`${f}-${y}`} cx={cellX(f)} cy={y} r={6} fill="#6d5540" />
            ))
          ) : (
            <circle key={f} cx={cellX(f)} cy={stringY(3.5)} r={6} fill="#6d5540" />
          ),
        )}

      {hasNut && <rect x={NUT_ZONE - 4} y={0} width={5} height={boardH} fill="#eadfc9" />}
      {shown
        .filter((f) => f > 0)
        .map((f) => (
          <rect key={f} x={wireX(f) - 1.5} y={0} width={3} height={boardH} fill="#bfae90" />
        ))}

      {[1, 2, 3, 4, 5, 6].map((s) => (
        <rect
          key={s}
          x={0}
          y={stringY(s) - THICKNESS[s - 1] / 2}
          width={W}
          height={THICKNESS[s - 1]}
          fill={s <= 3 ? "#e2d9ca" : "#c9ad7f"}
        />
      ))}

      {dots.map((d) => {
        const t = TONES[d.tone];
        const r = t.r ?? 11;
        return (
          <g key={`${d.string}-${d.fret}`}>
            <circle
              cx={cellX(d.fret)}
              cy={stringY(d.string)}
              r={r}
              fill={t.fill}
              stroke={t.stroke}
              strokeWidth={d.tone === "target" ? 3 : 2}
              strokeDasharray={t.dashed ? "3 3" : undefined}
            />
            {d.label && r > 6 && (
              <text
                x={cellX(d.fret)}
                y={stringY(d.string)}
                dy="0.35em"
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fontFamily="IBM Plex Sans, system-ui, sans-serif"
                fill={t.text}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}

      {onPress &&
        [1, 2, 3, 4, 5, 6].flatMap((s) =>
          shown.map((f) => (
            <rect
              key={`hit-${s}-${f}`}
              x={cellLeft(f)}
              y={stringY(s) - GAP / 2}
              width={(f === 0 ? NUT_ZONE : wireX(f) - wireX(f - 1))}
              height={GAP}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={`${STRING_NAMES[s - 1]} string, fret ${f}, ${midiName(midiAt(s, f))}`}
              className="cursor-pointer focus-ring"
              onClick={() => onPress(s, f)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPress(s, f);
                }
              }}
            />
          )),
        )}

      {shown.map((f) => (
        <text
          key={`n-${f}`}
          x={cellX(f)}
          y={boardH + 14}
          textAnchor="middle"
          fontSize={11}
          fontFamily="IBM Plex Mono, ui-monospace, monospace"
          fill={INLAY_FRETS.includes(f) ? "#f4ecdc" : "#9a8c76"}
        >
          {f}
        </text>
      ))}
    </svg>
  );
}
