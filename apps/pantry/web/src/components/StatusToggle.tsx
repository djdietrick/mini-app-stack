import type { ItemStatus } from "../api";

const opts: { value: ItemStatus; label: string; cls: string }[] = [
  { value: "stocked", label: "Stocked", cls: "bg-emerald-500 text-emerald-950" },
  { value: "low", label: "Low", cls: "bg-amber-500 text-amber-950" },
  { value: "out", label: "Out", cls: "bg-rose-500 text-rose-950" },
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
    <div className="inline-flex rounded-md overflow-hidden border border-neutral-800">
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
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800")
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
