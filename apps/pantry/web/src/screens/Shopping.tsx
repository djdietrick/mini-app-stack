import { useEffect, useMemo, useState } from "react";
import { api, type ListDetail, type ListItem } from "../api";
import { navigate } from "../App";

export function Shopping({ listId }: { listId: string }) {
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const load = async () => {
    try {
      const l = await api.getList(listId);
      setList(l);
      const init: Record<string, number> = {};
      for (const i of l.items) init[i.id] = i.quantity || 1;
      setQuantities(init);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, [listId]);

  const grouped = useMemo(() => {
    if (!list) return [];
    const map = new Map<string, ListItem[]>();
    for (const it of list.items) {
      const section = it.sections[0] ?? "Other";
      const arr = map.get(section) ?? [];
      arr.push(it);
      map.set(section, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }, [list]);

  const toggle = async (it: ListItem) => {
    const next = !it.checked_off;
    setList((l) =>
      l ? { ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, checked_off: next } : x)) } : l,
    );
    try {
      await api.patchListItem(listId, it.id, { checkedOff: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load();
    }
  };

  const finish = async () => {
    if (!list) return;
    const updates = list.items
      .filter((i) => i.checked_off)
      .map((i) => ({ listItemId: i.id, quantity: quantities[i.id] ?? 1 }));
    setError(null);
    try {
      await api.finishList(listId, updates);
      navigate("#/lists");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!list) {
    return <div className="text-ink-muted text-sm">{error ?? "Loading…"}</div>;
  }

  const checked = list.items.filter((i) => i.checked_off);

  if (list.status === "completed") {
    return (
      <div className="space-y-4">
        <a href="#/lists" className="text-sm text-ink-muted hover:text-ink">
          ← Lists
        </a>
        <h1 className="font-display text-2xl font-semibold text-ink">{list.name}</h1>
        <div className="text-sm text-ink-soft">
          Completed{" "}
          {list.completed_at && new Date(list.completed_at).toLocaleString()}
        </div>
        <ul className="divide-y divide-cream-300 border border-cream-300 rounded-md overflow-hidden bg-white">
          {list.items.map((i) => (
            <li key={i.id} className="px-3 py-2 flex items-center justify-between text-sm">
              <span className={i.checked_off ? "text-ink" : "text-ink-soft line-through"}>
                {i.name_snapshot}
              </span>
              <span className="text-xs text-ink-soft">×{i.quantity}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (finishing) {
    return (
      <div className="space-y-4 pb-24">
        <button
          type="button"
          onClick={() => setFinishing(false)}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Back to shopping
        </button>
        <h1 className="font-display text-2xl font-semibold text-ink">Finish shopping</h1>
        <p className="text-sm text-ink-muted">
          Set how many of each you bought. We default to 1 and mark items as stocked.
        </p>
        {checked.length === 0 ? (
          <div className="text-sm text-ink-muted">Nothing checked off.</div>
        ) : (
          <ul className="divide-y divide-cream-300 border border-cream-300 rounded-md overflow-hidden bg-white">
            {checked.map((i) => (
              <li key={i.id} className="px-3 py-3 flex items-center gap-3">
                <span className="flex-1 min-w-0 truncate text-sm text-ink">{i.name_snapshot}</span>
                <input
                  type="number"
                  min={0}
                  value={quantities[i.id] ?? 1}
                  onChange={(e) =>
                    setQuantities((q) => ({
                      ...q,
                      [i.id]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-20 px-2 py-1.5 text-sm bg-white border border-cream-300 rounded text-right focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100"
                />
              </li>
            ))}
          </ul>
        )}
        {error && <div className="text-sm text-apple-700">{error}</div>}
        <div className="fixed bottom-0 left-0 right-0 bg-cream-50/95 backdrop-blur border-t border-cream-300 px-4 py-3 z-10">
          <div className="max-w-4xl mx-auto flex items-center justify-end">
            <button
              type="button"
              onClick={finish}
              className="px-4 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <a href="#/lists" className="text-sm text-ink-muted hover:text-ink">
        ← Lists
      </a>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">{list.name}</h1>
        <span className="text-xs text-ink-soft">
          {checked.length}/{list.items.length}
        </span>
      </div>
      {error && <div className="text-sm text-apple-700">{error}</div>}

      {grouped.map(([section, group]) => (
        <section key={section} className="border border-cream-300 rounded-md overflow-hidden bg-white">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-ink-soft border-b border-cream-300 bg-cream-50 font-sans">
            {section}
          </div>
          <ul className="divide-y divide-cream-300">
            {group.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => void toggle(it)}
                  className="w-full px-3 py-4 flex items-center gap-3 text-left hover:bg-cream-50 transition"
                >
                  <span
                    className={
                      "w-6 h-6 rounded border flex items-center justify-center text-sm transition " +
                      (it.checked_off
                        ? "bg-sage-500 border-sage-500 text-white"
                        : "border-cream-300 bg-white")
                    }
                    aria-hidden
                  >
                    {it.checked_off ? "✓" : ""}
                  </span>
                  <span
                    className={
                      "flex-1 min-w-0 truncate " +
                      (it.checked_off ? "text-ink-soft line-through" : "text-ink")
                    }
                  >
                    {it.name_snapshot}
                  </span>
                  {it.stores.length > 0 && (
                    <span className="text-xs text-ink-soft">{it.stores.join(", ")}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="fixed bottom-0 left-0 right-0 bg-cream-50/95 backdrop-blur border-t border-cream-300 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-end">
          <button
            type="button"
            onClick={() => setFinishing(true)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 transition"
          >
            Finish shopping
          </button>
        </div>
      </div>
    </div>
  );
}
