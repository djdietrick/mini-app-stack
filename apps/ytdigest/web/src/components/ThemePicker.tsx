import type { ReactNode } from "react";
import { setTheme, type Theme, useTheme } from "../theme";

const OPTIONS: { value: Theme; label: string; icon: ReactNode }[] = [
  {
    value: "system",
    label: "Match device",
    icon: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  },
];

/** Three icon buttons: follow the device, or force light or dark. */
export function ThemePicker() {
  const theme = useTheme();
  return (
    <div role="group" aria-label="Theme" className="flex shrink-0 rounded-full border border-canvas-200 bg-surface p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setTheme(o.value)}
          aria-pressed={theme === o.value}
          aria-label={o.label}
          title={o.label}
          className={`flex h-8 w-8 items-center justify-center rounded-full ${
            theme === o.value ? "bg-canvas-100 text-ink" : "text-ink-soft hover:text-ink"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {o.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
