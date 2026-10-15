const chipFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** 12,500 */
export const chips = (n: number) => chipFmt.format(n);

/** 12.5K, for chips on the table where space is tight. */
export const chipsShort = (n: number) => (Math.abs(n) < 10_000 ? chipFmt.format(n) : compactFmt.format(n));

/** +1,000 / −250, with a real minus sign. */
export const signed = (n: number) => (n > 0 ? `+${chipFmt.format(n)}` : n < 0 ? `−${chipFmt.format(-n)}` : "0");

export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? timeFmt.format(d) : `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}
