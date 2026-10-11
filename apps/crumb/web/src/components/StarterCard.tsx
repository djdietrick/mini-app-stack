import { useId } from "react";
import type { StarterRow } from "../api";
import { relative, time } from "../format";
import { href } from "../router";
import { Pill, type Tone } from "./ui";

const HOUR = 3_600_000;

export interface StarterStatus {
  label: string;
  tone: Tone;
  /** Headline: what to know at a glance. */
  headline: string;
  detail: string;
  /** How full the jar looks, 0–1. */
  fill: number;
}

/** What a starter is doing right now, from its last feed and the model's prediction. */
export function starterStatus(s: StarterRow, now: Date): StarterStatus {
  const fed = s.last_fed ? Date.parse(s.last_fed.fed_at) : null;
  const sinceFed = fed === null ? null : now.getTime() - fed;
  const fedText = s.last_fed ? `Fed ${relative(s.last_fed.fed_at, now)}` : "Not fed yet";

  if (s.location === "fridge") {
    const hungry = sinceFed !== null && sinceFed > 7 * 24 * HOUR;
    return {
      label: hungry ? "Hungry" : "Fridge",
      tone: hungry ? "warn" : "muted",
      headline: "In the fridge",
      detail: hungry ? `${fedText}. Time for its weekly feed.` : `${fedText}.`,
      fill: 0.35,
    };
  }
  if (fed === null || sinceFed === null) {
    return { label: "Not fed", tone: "muted", headline: "Ready for a first feed", detail: "Log a feed to start tracking it.", fill: 0.3 };
  }
  if (sinceFed > 24 * HOUR) {
    return { label: "Hungry", tone: "warn", headline: "Needs a feed", detail: `${fedText}.`, fill: 0.45 };
  }

  const peak = s.last_fed?.peak_at ?? s.predicted_peak_at;
  if (!peak) return { label: "Fed", tone: "live", headline: fedText, detail: "", fill: 0.5 };
  const peakAt = Date.parse(peak);
  const logged = s.last_fed?.peak_at !== null;

  if (now.getTime() < peakAt - HOUR) {
    const progress = Math.min(1, Math.max(0, (now.getTime() - fed) / (peakAt - fed)));
    return {
      label: "Rising",
      tone: "live",
      headline: `Peak ~${time(peak)}`,
      detail: `${fedText} · peaks ${relative(peak, now)}`,
      fill: 0.3 + 0.6 * progress,
    };
  }
  if (now.getTime() <= peakAt + 2 * HOUR) {
    return {
      label: logged ? "Peaked" : "Peaking",
      tone: "crust",
      headline: logged ? `Peaked at ${time(peak)}` : "At its peak about now",
      detail: `${fedText}. Use it for a levain now.`,
      fill: 0.95,
    };
  }
  return {
    label: "Past peak",
    tone: "muted",
    headline: `Peaked ~${time(peak)}`,
    detail: `${fedText}. It's falling; feed it before using it.`,
    fill: 0.7,
  };
}

/** A jar, filled to how far the starter has risen, with the doubled line. */
export function Jar({ fill, tone }: { fill: number; tone: Tone }) {
  const clip = useId();
  const height = 64;
  const level = Math.round(height * Math.min(1, Math.max(0, fill)));
  const color = tone === "live" ? "text-live" : tone === "crust" ? "text-crust" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <svg viewBox="0 0 48 80" className={`h-20 w-12 shrink-0 ${color}`} aria-hidden="true">
      <rect x="10" y="2" width="28" height="7" rx="2" className="fill-line" />
      <rect x="6" y="12" width="36" height="66" rx="9" className="fill-surface stroke-muted" strokeWidth="2" />
      <clipPath id={clip}>
        <rect x="7" y="13" width="34" height="64" rx="8" />
      </clipPath>
      <g clipPath={`url(#${CSS.escape(clip)})`}>
        <rect x="7" y={13 + height - level} width="34" height={level} fill="currentColor" opacity="0.22" />
        <rect x="7" y={13 + height - level} width="34" height="2.5" fill="currentColor" />
      </g>
      {/* Doubled: twice the fresh-fed level. */}
      <line x1="2" x2="46" y1={13 + height * 0.1} y2={13 + height * 0.1} className="stroke-muted" strokeDasharray="3 3" strokeWidth="1" />
    </svg>
  );
}

export function StarterCard({ starter, now, actions }: { starter: StarterRow; now: Date; actions?: boolean }) {
  const status = starterStatus(starter, now);
  return (
    <div className="card flex flex-col gap-3 p-4">
      <a href={href({ name: "starter", id: starter.id })} className="focus-ring -m-1 flex items-center gap-4 rounded-xl p-1">
        <Jar fill={status.fill} tone={status.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-bold">{starter.name}</span>
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>
          <div className="mt-1 font-display text-2xl font-bold leading-tight">{status.headline}</div>
          {status.detail && <div className="mt-0.5 text-sm text-muted">{status.detail}</div>}
        </div>
      </a>
      {actions && (
        <div className="flex gap-2">
          <a href={href({ name: "feed", id: starter.id })} className="btn-primary flex-1">
            Feed
          </a>
          <a href={href({ name: "starter", id: starter.id })} className="btn flex-1">
            {starter.predicted_peak_at ? "Log peak" : "Details"}
          </a>
        </div>
      )}
    </div>
  );
}
