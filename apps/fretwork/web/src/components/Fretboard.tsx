import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  type FretWindow,
  INLAY_FRETS,
  STRING_NAMES,
  fretDistance,
  midiAt,
  midiName,
} from "../../../src/theory/index.js";
import { type LabelMode, useSettings } from "../settings";

/**
 * The neck. Presentational only: engines pass dots and a press handler in;
 * nothing here knows about audio or grading.
 *
 * It lays itself out in real pixels for the width it is given (a
 * ResizeObserver re-lays it out on rotation or resize), in one of two
 * orientations:
 *
 * - **horizontal**: nut on the left, high E on top, the way tab reads.
 * - **vertical**: nut at the top, strings as columns, low E on the left, the
 *   way chord charts read. A phone in portrait gets this whenever the frets
 *   asked for would be narrower than a thumb laid out horizontally, which
 *   keeps a full 0–12 neck on screen at 360 px with 44 px+ targets. Pan and
 *   zoom was the alternative, but the player's hands are on the guitar: a
 *   neck that needs a gesture to see is no use mid-exercise.
 *
 * `orientation="auto"` (the default) picks between them. Left-handed players
 * get the mirror image of either. Fret spacing follows equal temperament
 * (fretDistance), so positions sit where the hand expects them; vertical
 * layouts clamp the smallest frets to a minimum height.
 *
 * Feedback: `target` dots pulse; `correct` and `miss` flash once when they
 * appear (and whenever a dot's tone changes). Both honour
 * prefers-reduced-motion (index.css). Correct and miss never rely on colour:
 * one is a light filled dot with a tick, the other a dark ring with a cross.
 */

export type DotTone = "root" | "note" | "target" | "correct" | "miss" | "hint" | "ghost";

export interface Dot {
  string: number;
  fret: number;
  tone: DotTone;
  /** Note name, shown in "names" label mode. */
  name?: string;
  /** Scale or chord degree ("R", "♭3"), shown in "degrees" label mode. */
  degree?: string;
}

export type Orientation = "auto" | "horizontal" | "vertical";

export interface FretboardProps {
  /** Frets to draw. Fret 0 adds the nut and an open-string column. */
  frets: FretWindow;
  dots?: Dot[];
  /** Shades a region, e.g. the exercise's fret window inside a wider view. */
  highlight?: FretWindow;
  /** Shades one string, e.g. note hunt walking string by string. */
  activeString?: number;
  /** Makes every position a button: the tap fallback when there is no mic, and for tests. */
  onPress?: (string: number, fret: number) => void;
  orientation?: Orientation;
  /** Defaults to the player's setting. */
  leftHanded?: boolean;
  /** Defaults to the player's setting. */
  labels?: LabelMode;
  className?: string;
  /** Accessible name for the whole diagram. */
  title?: string;
}

const STRINGS = [1, 2, 3, 4, 5, 6];
const THICKNESS = [1.4, 1.7, 2.1, 2.6, 3.1, 3.6];
/** Minimum target size for a press, px (WCAG 2.5.5 asks 44). */
const TAP = 48;
const NUMBERS = 22;
/** Before the first measurement: a phone's content column. */
const FALLBACK_WIDTH = 350;

const TONES: Record<DotTone, { fill: string; stroke: string; text: string; dashed?: boolean; ghost?: boolean }> = {
  root: { fill: "#e5a54b", stroke: "#e5a54b", text: "#1a140c" },
  note: { fill: "#2a231b", stroke: "#cdbd9f", text: "#f4ecdc" },
  target: { fill: "#2a231b", stroke: "#fff4dd", text: "#f4ecdc" },
  correct: { fill: "#7fd1b9", stroke: "#b8f0de", text: "#10231d" },
  miss: { fill: "#241410", stroke: "#f0785a", text: "#f0785a" },
  hint: { fill: "#241b13", stroke: "#e5a54b", text: "#f2c27c", dashed: true },
  ghost: { fill: "#5a4636", stroke: "#5a4636", text: "transparent", ghost: true },
};

interface Layout {
  vertical: boolean;
  W: number;
  H: number;
  /** Centre of a string, across the neck. */
  across: (s: number) => number;
  /** Position along the neck of fret wire n (the nut is wire 0). */
  wire: (n: number) => number;
  /** Start and end of fret f's cell along the neck; fret 0 is the open-string zone. */
  cell: (f: number) => [number, number];
  /** Along-neck extent of the whole board. */
  length: number;
  /** Across-neck extent of the board, and where it starts. */
  boardStart: number;
  boardSize: number;
  gap: number;
  nutZone: number;
  radius: number;
  /** Turns along/across into x/y, mirroring for left-handers. */
  xy: (along: number, across: number) => [number, number];
}

function layout(
  width: number,
  frets: FretWindow,
  orientation: Orientation,
  interactive: boolean,
  leftHanded: boolean,
  landscape: boolean,
): Layout {
  const { lo, hi } = frets;
  const hasNut = lo === 0;
  const edge = hasNut ? 0 : lo - 1;
  const count = Math.max(hi - edge, 1);
  const span = fretDistance(hi) - fretDistance(edge);
  const fraction = (f: number) => (fretDistance(f) - fretDistance(f - 1)) / span;
  const smallest = fraction(hi);

  // Horizontal: fill the width, up to a comfortable maximum cell.
  const hNut = hasNut ? (interactive ? TAP : 34) : 0;
  const hLength = Math.min(width - hNut, count * 110);
  const hMinCell = hLength * smallest;
  // A neck to tap needs thumb-sized cells. One only to look at can go smaller,
  // and smaller still in landscape, where a vertical neck would not fit the height.
  const minCell = interactive ? TAP : landscape ? 18 : 28;
  const vertical = orientation === "vertical" || (orientation === "auto" && hMinCell < minCell);

  let sizes: number[];
  let nutZone: number;
  let gap: number;
  if (vertical) {
    nutZone = hasNut ? (interactive ? TAP : 36) : 0;
    gap = Math.max(24, Math.min(64, (width - NUMBERS) / 6));
    const base = count * (interactive ? 52 : 40);
    const min = interactive ? TAP : 26;
    sizes = Array.from({ length: count }, (_, i) => Math.max(min, base * fraction(edge + i + 1)));
  } else {
    nutZone = hNut;
    gap = interactive ? TAP : 30;
    sizes = Array.from({ length: count }, (_, i) => hLength * fraction(edge + i + 1));
  }

  const wires = new Map<number, number>([[edge, nutZone]]);
  let pos = nutZone;
  sizes.forEach((s, i) => {
    pos += s;
    wires.set(edge + i + 1, pos);
  });
  const length = pos;
  const wire = (n: number) => wires.get(Math.min(Math.max(n, edge), hi)) ?? nutZone;
  const cell = (f: number): [number, number] => (f === 0 ? [0, nutZone] : [wire(f - 1), wire(f)]);

  const boardSize = gap * 6;
  const boardStart = vertical ? NUMBERS : 0;
  // Horizontal: high E on top for both hands. Vertical: low E on the left for right-handers.
  const across = (s: number) =>
    boardStart + (vertical && !leftHanded ? 6 - s + 0.5 : s - 0.5) * gap;
  const W = vertical ? boardStart + boardSize : length;
  const H = vertical ? length : boardSize + NUMBERS;
  const xy = (along: number, acr: number): [number, number] => {
    if (vertical) return [acr, along];
    return [leftHanded ? length - along : along, acr];
  };
  const smallestCell = Math.min(...sizes, hasNut ? nutZone : Infinity);
  const radius = Math.max(8, Math.min(15, 0.38 * Math.min(gap, smallestCell)));
  return { vertical, W, H, across, wire, cell, length, boardStart, boardSize, gap, nutZone, radius, xy };
}

/** A rectangle given along/across extents, in x/y. */
function rect(L: Layout, a0: number, a1: number, c0: number, c1: number) {
  const [x0, y0] = L.xy(a0, c0);
  const [x1, y1] = L.xy(a1, c1);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

const isLandscape = () => typeof window !== "undefined" && window.innerWidth > window.innerHeight;

/** The container's width, and whether the screen is landscape; both change on rotation. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: FALLBACK_WIDTH, landscape: isLandscape() });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0) setSize({ width, landscape: isLandscape() });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

function labelFor(dot: Dot, mode: LabelMode): string | undefined {
  if (mode === "none") return undefined;
  return mode === "degrees" ? (dot.degree ?? dot.name) : (dot.name ?? dot.degree);
}

/** ✓ or ✕ as a path, centred on 0,0 and sized to `r`. */
function Glyph({ kind, r, color, width }: { kind: "correct" | "miss"; r: number; color: string; width: number }) {
  const d =
    kind === "correct"
      ? `M ${-0.5 * r} ${0.02 * r} L ${-0.12 * r} ${0.4 * r} L ${0.52 * r} ${-0.38 * r}`
      : `M ${-0.4 * r} ${-0.4 * r} L ${0.4 * r} ${0.4 * r} M ${0.4 * r} ${-0.4 * r} L ${-0.4 * r} ${0.4 * r}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
}

export function Fretboard({
  frets,
  dots = [],
  highlight,
  activeString,
  onPress,
  orientation = "auto",
  leftHanded,
  labels,
  className,
  title,
}: FretboardProps) {
  const settings = useSettings();
  const lefty = leftHanded ?? settings.leftHanded;
  const labelMode = labels ?? settings.labels;
  const titleId = useId();
  const { ref, width, landscape } = useWidth();
  const L = layout(width, frets, orientation, !!onPress, lefty, landscape);

  const { lo, hi } = frets;
  const hasNut = lo === 0;
  const shown: number[] = [];
  for (let f = hasNut ? 0 : lo; f <= hi; f++) shown.push(f);
  const cellMid = (f: number) => {
    const [a, b] = L.cell(f);
    return (a + b) / 2;
  };
  const at = (s: number, f: number) => L.xy(cellMid(f), L.across(s));

  // Roving focus: one tab stop for the whole neck, arrow keys move within it.
  const [cursor, setCursor] = useState({ string: 6, fret: shown[0] });
  const [focused, setFocused] = useState(false);
  const targets = useRef(new Map<string, SVGRectElement>());
  const cur = {
    string: Math.min(6, Math.max(1, cursor.string)),
    fret: Math.min(hi, Math.max(shown[0], cursor.fret)),
  };

  const move = (e: KeyboardEvent, s: number, f: number) => {
    // Arrow keys follow the picture: along the neck toward the body, across toward the high E.
    const towardBody = L.vertical ? "ArrowDown" : lefty ? "ArrowLeft" : "ArrowRight";
    const towardNut = L.vertical ? "ArrowUp" : lefty ? "ArrowRight" : "ArrowLeft";
    const towardHighE = L.vertical ? (lefty ? "ArrowLeft" : "ArrowRight") : "ArrowUp";
    const towardLowE = L.vertical ? (lefty ? "ArrowRight" : "ArrowLeft") : "ArrowDown";
    const next = { string: s, fret: f };
    switch (e.key) {
      case towardBody: next.fret = Math.min(hi, f + 1); break;
      case towardNut: next.fret = Math.max(shown[0], f - 1); break;
      case towardHighE: next.string = Math.max(1, s - 1); break;
      case towardLowE: next.string = Math.min(6, s + 1); break;
      case "Home": next.fret = shown[0]; break;
      case "End": next.fret = hi; break;
      case "Enter":
      case " ":
        e.preventDefault();
        onPress?.(s, f);
        return;
      default:
        return;
    }
    e.preventDefault();
    setCursor(next);
    targets.current.get(`${next.string}-${next.fret}`)?.focus();
  };

  const band = (c: number, size: number) => [c - size / 2, c + size / 2] as const;

  return (
    <div ref={ref} className={className}>
      <svg
        viewBox={`0 0 ${L.W} ${L.H}`}
        width={L.W}
        height={L.H}
        className="mx-auto block max-w-full"
        role={onPress ? "group" : "img"}
        aria-labelledby={title ? titleId : undefined}
        data-orientation={L.vertical ? "vertical" : "horizontal"}
      >
        {title && <title id={titleId}>{title}</title>}

        {hasNut && <rect {...rect(L, 0, L.nutZone - 3, L.boardStart, L.boardStart + L.boardSize)} rx={8} fill="#1f1a14" />}
        <rect {...rect(L, L.nutZone, L.length, L.boardStart, L.boardStart + L.boardSize)} rx={hasNut ? 0 : 8} fill="#3a281c" />

        {highlight && highlight.hi >= lo && highlight.lo <= hi && (
          <rect
            {...rect(
              L,
              highlight.lo === 0 ? 0 : L.wire(Math.max(highlight.lo - 1, hasNut ? 0 : lo - 1)),
              L.wire(Math.min(highlight.hi, hi)),
              L.boardStart,
              L.boardStart + L.boardSize,
            )}
            fill="rgba(244,236,220,0.08)"
            stroke="#e5a54b"
            strokeDasharray="4 4"
          />
        )}

        {activeString && (
          <rect
            {...rect(L, 0, L.length, ...band(L.across(activeString), L.gap * 0.9))}
            rx={L.gap * 0.45}
            fill="rgba(229,165,75,0.16)"
            stroke="rgba(229,165,75,0.55)"
          />
        )}

        {shown
          .filter((f) => INLAY_FRETS.includes(f))
          .flatMap((f) =>
            (f % 12 === 0 ? [2.5, 4.5] : [3.5]).map((s) => {
              const [cx, cy] = L.xy(cellMid(f), L.across(s));
              return <circle key={`${f}-${s}`} cx={cx} cy={cy} r={Math.min(6, L.radius * 0.5)} fill="#6d5540" />;
            }),
          )}

        {hasNut && <rect {...rect(L, L.nutZone - 3, L.nutZone + 2, L.boardStart, L.boardStart + L.boardSize)} fill="#eadfc9" />}
        {shown
          .filter((f) => f > 0)
          .map((f) => (
            <rect key={f} {...rect(L, L.wire(f) - 1.5, L.wire(f) + 1.5, L.boardStart, L.boardStart + L.boardSize)} fill="#bfae90" />
          ))}

        {STRINGS.map((s) => (
          <rect
            key={s}
            {...rect(L, 0, L.length, ...band(L.across(s), THICKNESS[s - 1]))}
            fill={s <= 3 ? "#e2d9ca" : "#c9ad7f"}
          />
        ))}

        {dots.map((d) => {
          const t = TONES[d.tone];
          const r = t.ghost ? Math.min(5, L.radius * 0.4) : L.radius;
          const [cx, cy] = at(d.string, d.fret);
          const label = t.ghost ? undefined : labelFor(d, labelMode);
          const graded = d.tone === "correct" || d.tone === "miss" ? d.tone : null;
          return (
            // The tone is in the key, so a dot changing tone remounts and replays its flash.
            <g key={`${d.string}-${d.fret}-${d.tone}`} transform={`translate(${cx} ${cy})`}>
              {d.tone === "target" && (
                <circle className="fb-pulse" r={r} fill="none" stroke="#fff4dd" strokeWidth={2} />
              )}
              {graded && (
                <circle className="fb-halo" r={r} fill="none" stroke={t.stroke} strokeWidth={3} />
              )}
              <g className={graded ? "fb-flash" : undefined}>
                <circle
                  r={r}
                  fill={t.fill}
                  stroke={t.stroke}
                  strokeWidth={d.tone === "target" || d.tone === "miss" ? 3 : 2}
                  strokeDasharray={t.dashed ? "3 3" : undefined}
                />
                {label ? (
                  <text
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={Math.max(9, Math.min(13, r * 0.85))}
                    fontWeight={600}
                    fontFamily="IBM Plex Sans, system-ui, sans-serif"
                    fill={t.text}
                  >
                    {label}
                  </text>
                ) : (
                  graded && <Glyph kind={graded} r={r} color={t.text} width={2.5} />
                )}
                {label && graded && (
                  <g transform={`translate(${r * 0.78} ${-r * 0.78})`}>
                    <circle r={r * 0.5} fill={t.stroke} stroke="#14110d" strokeWidth={1.5} />
                    <Glyph kind={graded} r={r * 0.5} color="#14110d" width={1.8} />
                  </g>
                )}
              </g>
            </g>
          );
        })}

        {onPress &&
          STRINGS.flatMap((s) =>
            shown.map((f) => {
              const [a0, a1] = L.cell(f);
              const key = `${s}-${f}`;
              const dot = dots.find((d) => d.string === s && d.fret === f);
              const isCursor = cur.string === s && cur.fret === f;
              return (
                <rect
                  key={`hit-${key}`}
                  ref={(el) => {
                    if (el) targets.current.set(key, el);
                    else targets.current.delete(key);
                  }}
                  {...rect(L, a0, a1, ...band(L.across(s), L.gap))}
                  fill="transparent"
                  role="button"
                  tabIndex={isCursor ? 0 : -1}
                  aria-label={`${STRING_NAMES[s - 1]} string, fret ${f}, ${midiName(midiAt(s, f))}${dot ? `, ${dot.tone}` : ""}`}
                  className="cursor-pointer outline-none"
                  onClick={() => {
                    setCursor({ string: s, fret: f });
                    onPress(s, f);
                  }}
                  onKeyDown={(e) => move(e, s, f)}
                  onFocus={() => {
                    setCursor({ string: s, fret: f });
                    setFocused(true);
                  }}
                  onBlur={() => setFocused(false)}
                />
              );
            }),
          )}

        {onPress && focused && (
          <rect
            {...(() => {
              const [a0, a1] = L.cell(cur.fret);
              return rect(L, a0 + 2, a1 - 2, ...band(L.across(cur.string), L.gap - 4));
            })()}
            rx={8}
            fill="none"
            stroke="#e5a54b"
            strokeWidth={2.5}
            pointerEvents="none"
          />
        )}

        {shown.map((f) => {
          const [x, y] = L.vertical ? [NUMBERS / 2, cellMid(f)] : L.xy(cellMid(f), L.boardSize + 15);
          return (
            <text
              key={`n-${f}`}
              x={x}
              y={y}
              dy={L.vertical ? "0.35em" : undefined}
              textAnchor="middle"
              fontSize={11}
              fontFamily="IBM Plex Mono, ui-monospace, monospace"
              fill={INLAY_FRETS.includes(f) ? "#f4ecdc" : "#9a8c76"}
            >
              {f}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
