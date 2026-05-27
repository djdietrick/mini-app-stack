import type { ItemStatus } from "../api";

const opts: { value: ItemStatus; label: string; cls: string }[] = [
  { value: "stocked", label: "Stocked", cls: "bg-sage-500 text-white" },
  { value: "low", label: "Low", cls: "bg-honey-400 text-ink" },
  { value: "out", label: "Out", cls: "bg-apple-700 text-white" },
];

export function StatusToggle({
  value,
  onChange,
  size = "md",
}: {
  value: ItemStatus;
  onChange: (s: ItemStatus) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="inline-flex rounded-md overflow-hidden border border-cream-300 bg-cream-50">
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              pad +
              " transition font-medium " +
              (active
                ? o.cls
                : "bg-cream-50 text-ink-muted hover:text-ink hover:bg-cream-200")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatusPill({ status }: { status: ItemStatus }) {
  const o = opts.find((x) => x.value === status)!;
  return (
    <span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + o.cls}>
      {o.label}
    </span>
  );
}
