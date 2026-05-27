import { useEffect, useMemo, useState } from "react";
import { api, type Item } from "../api";
import { StatusPill } from "../components/StatusToggle";
import { navigate } from "../App";

interface Extra {
  name: string;
  quantity: number;
}

export function ListBuilder() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<Extra[]>([]);
  const [query, setQuery] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const is = await api.items();
        setItems(is);
        setSelected(new Set(is.filter((i) => i.status !== "stocked").map((i) => i.id)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  const sections = useMemo(() => {
    const out: Item[] = [];
    const low: Item[] = [];
    const other: Item[] = [];
    for (const i of filtered) {
      if (i.status === "out") out.push(i);
      else if (i.status === "low") low.push(i);
      else other.push(i);
    }
    return { out, low, other };
  }, [filtered]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addExtra = () => {
    const n = extraInput.trim();
    if (!n) return;
    setExtras((cur) => [...cur, { name: n, quantity: 1 }]);
    setExtraInput("");
  };

  const removeExtra = (i: number) => setExtras((cur) => cur.filter((_, x) => x !== i));

  const submit = async () => {
    if (selected.size === 0 && extras.length === 0) {
      setError("Pick at least one item");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createList({
        name: name.trim() || undefined,
        itemIds: Array.from(selected),
        extras,
      });
      navigate(`#/shopping/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const totalSelected = selected.size + extras.length;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">New list</h1>
        <a href="#/lists" className="text-sm text-ink-muted hover:text-ink">
          Cancel
        </a>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="List name (optional)"
        className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
      />

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search items…"
        className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
      />

      <div className="flex gap-2">
        <input
          value={extraInput}
          onChange={(e) => setExtraInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addExtra()}
          placeholder="Add untracked item…"
          className="flex-1 px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
        />
        <button
          type="button"
          onClick={addExtra}
          className="px-3 py-2 text-sm rounded-md bg-cream-200 text-ink hover:bg-cream-300 transition"
        >
          Add
        </button>
      </div>

      {extras.length > 0 && (
        <div className="border border-cream-300 rounded-md overflow-hidden bg-white">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-ink-soft border-b border-cream-300 bg-cream-50">
            Untracked
          </div>
          <ul className="divide-y divide-cream-300">
            {extras.map((e, idx) => (
              <li key={idx} className="px-3 py-2 flex items-center justify-between">
                <span className="text-sm text-ink">{e.name}</span>
                <button
                  type="button"
                  onClick={() => removeExtra(idx)}
                  className="text-xs text-ink-soft hover:text-apple-700 px-2 py-1"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="text-sm text-apple-700">{error}</div>}

      <Section title="Out" items={sections.out} selected={selected} onToggle={toggle} />
      <Section title="Low" items={sections.low} selected={selected} onToggle={toggle} />
      <Section title="Other" items={sections.other} selected={selected} onToggle={toggle} />

      <div className="fixed bottom-0 left-0 right-0 bg-cream-50/95 backdrop-blur border-t border-cream-300 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">
            {totalSelected} item{totalSelected === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-4 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 disabled:opacity-50 transition"
          >
            Create list
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: Item[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="border border-cream-300 rounded-md overflow-hidden bg-white">
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-ink-soft border-b border-cream-300 bg-cream-50 font-sans">
        {title} ({items.length})
      </div>
      <ul className="divide-y divide-cream-300">
        {items.map((i) => {
          const on = selected.has(i.id);
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onToggle(i.id)}
                className={
                  "w-full px-3 py-3 flex items-center gap-3 text-left transition " +
                  (on ? "bg-apple-50" : "bg-white hover:bg-cream-50")
                }
              >
                <span
                  className={
                    "w-5 h-5 rounded border flex items-center justify-center text-xs transition " +
                    (on
                      ? "bg-apple-500 border-apple-500 text-white"
                      : "border-cream-300 bg-white")
                  }
                  aria-hidden
                >
                  {on ? "✓" : ""}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate text-ink">{i.name}</span>
                  <span className="block text-xs text-ink-soft truncate">
                    {i.quantity} {i.size ? `· ${i.size}` : ""}
                  </span>
                </span>
                <StatusPill status={i.status} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
