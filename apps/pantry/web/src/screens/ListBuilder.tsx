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
        <h1 className="text-xl font-semibold">New list</h1>
        <a href="#/lists" className="text-sm text-neutral-400 hover:text-neutral-100">
          Cancel
        </a>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="List name (optional)"
        className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md focus:outline-none focus:border-neutral-600"
      />

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search items…"
        className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md focus:outline-none focus:border-neutral-600"
      />

      <div className="flex gap-2">
        <input
          value={extraInput}
          onChange={(e) => setExtraInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addExtra()}
          placeholder="Add untracked item…"
          className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md focus:outline-none focus:border-neutral-600"
        />
        <button
          type="button"
          onClick={addExtra}
          className="px-3 py-2 text-sm rounded-md bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
        >
          Add
        </button>
      </div>

      {extras.length > 0 && (
        <div className="border border-neutral-800 rounded-md overflow-hidden">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800">
            Untracked
          </div>
          <ul className="divide-y divide-neutral-800">
            {extras.map((e, idx) => (
              <li key={idx} className="px-3 py-2 flex items-center justify-between">
                <span className="text-sm">{e.name}</span>
                <button
                  type="button"
                  onClick={() => removeExtra(idx)}
                  className="text-xs text-neutral-500 hover:text-rose-400 px-2 py-1"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="text-sm text-rose-400">{error}</div>}

      <Section title="Out" items={sections.out} selected={selected} onToggle={toggle} />
      <Section title="Low" items={sections.low} selected={selected} onToggle={toggle} />
      <Section title="Other" items={sections.other} selected={selected} onToggle={toggle} />

      <div className="fixed bottom-0 left-0 right-0 bg-neutral-950 border-t border-neutral-800 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <span className="text-sm text-neutral-400">
            {totalSelected} item{totalSelected === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-4 py-2 text-sm font-medium rounded-md bg-neutral-100 text-neutral-900 hover:bg-white disabled:opacity-50"
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
    <section className="border border-neutral-800 rounded-md overflow-hidden">
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800">
        {title} ({items.length})
      </div>
      <ul className="divide-y divide-neutral-800">
        {items.map((i) => {
          const on = selected.has(i.id);
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onToggle(i.id)}
                className={
                  "w-full px-3 py-3 flex items-center gap-3 text-left transition " +
                  (on ? "bg-neutral-900" : "bg-neutral-950 hover:bg-neutral-900/50")
                }
              >
                <span
                  className={
                    "w-5 h-5 rounded border flex items-center justify-center text-xs transition " +
                    (on
                      ? "bg-neutral-100 border-neutral-100 text-neutral-900"
                      : "border-neutral-700")
                  }
                  aria-hidden
                >
                  {on ? "✓" : ""}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{i.name}</span>
                  <span className="block text-xs text-neutral-500 truncate">
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
