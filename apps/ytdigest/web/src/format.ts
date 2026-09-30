/** Display helpers for the feed and the player. */

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function formatViews(n: number): string {
  return `${compact.format(n)} view${n === 1 ? "" : "s"}`;
}

/** 4:13, 1:02:07. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return "just now";
}

/** The headings YouTube's subscriptions page uses, by local calendar day. */
export function feedSection(iso: string, now = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  return "Older";
}

/** The upload's own thumbnail, else the one YouTube serves for any id. */
export function thumbnailFor(v: { youtube_video_id: string; thumbnail_url: string | null }): string {
  return v.thumbnail_url ?? `https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`;
}
