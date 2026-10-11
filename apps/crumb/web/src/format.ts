/** Times and durations as a baker reads them, in the device's time zone. */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "2:40 PM" */
export function time(iso: string | Date): string {
  return timeFmt.format(new Date(iso));
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Tomorrow", "Yesterday", "Sat" within the week, else "Oct 18". */
export function day(iso: string | Date, now = new Date()): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return weekdayFmt.format(d);
  return dateFmt.format(d);
}

/** "Today 2:40 PM", "Sat 8:00 AM" */
export function when(iso: string | Date, now = new Date()): string {
  return `${day(iso, now)} ${time(iso)}`;
}

/** "45 min", "5 h", "5 h 30 min", "2 d 3 h" */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.round((m % (24 * 60)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** "in 2 h 10 min", "3 h ago", "now" */
export function relative(iso: string | Date, now = new Date()): string {
  const minutes = (new Date(iso).getTime() - now.getTime()) / MINUTE;
  if (Math.abs(minutes) < 1) return "now";
  return minutes > 0 ? `in ${duration(minutes)}` : `${duration(-minutes)} ago`;
}

/** A Date as the value of an <input type="datetime-local">, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An <input type="datetime-local"> value back to a Date; null when empty or invalid. */
export function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 g", "1.2 kg" */
export function grams(g: number): string {
  return g >= 2000 ? `${Math.round(g / 100) / 10} kg` : `${Math.round(g)} g`;
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
