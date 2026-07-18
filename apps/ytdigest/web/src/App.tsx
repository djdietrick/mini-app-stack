import { useState } from "react";
import { Subscriptions } from "./screens/Subscriptions";
import { Rules } from "./screens/Rules";
import { Digests } from "./screens/Digests";

type Tab = "subscriptions" | "rules" | "digests";

const TABS: { id: Tab; label: string }[] = [
  { id: "subscriptions", label: "Channels" },
  { id: "rules", label: "Rules" },
  { id: "digests", label: "Digests" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("subscriptions");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">YouTube Digest</h1>
      <nav className="mt-4 flex gap-1 border-b border-canvas-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.id ? "border-b-2 border-brand-500 text-brand-600" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mt-4">
        {tab === "subscriptions" && <Subscriptions />}
        {tab === "rules" && <Rules />}
        {tab === "digests" && <Digests />}
      </div>
    </div>
  );
}
