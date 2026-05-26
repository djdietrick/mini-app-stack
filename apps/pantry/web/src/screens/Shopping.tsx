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
    return <div className="text-neutral-500 text-sm">{error ?? "Loading…"}</div>;
  }

  const checked = list.items.filter((i) => i.checked_off);

  if (list.status === "completed") {
    return (
      <div className="space-y-4">
        <a href="#/lists" className="text-sm text-neutral-400 hover:text-neutral-100">
          ← Lists
        </a>
        <h1 className="text-xl font-semibold">{list.name}</h1>
        <div className="text-sm text-neutral-500">
          Completed{" "}
          {list.completed_at && new Date(list.completed_at).toLocaleString()}
        </div>
        <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-md overflow-hidden">
          {list.items.map((i) => (
            <li key={i.id} className="px-3 py-2 flex items-center justify-between text-sm">
              <span className={i.checked_off ? "" : "text-neutral-600 line-through"}>
                {i.name_snapshot}
              </span>
              <span className="text-xs text-neutral-500">×{i.quantity}</span>
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
          className="text-sm text-neutral-400 hover:text-neutral-100"
        >
          ← Back to shopping
        </button>
        <h1 className="text-xl font-semibold">Finish shopping</h1>
        <p className="text-sm text-neutral-400">
          Set how many of each you bought. We default to 1 and mark items as stocked.
        </p>
        {checked.length === 0 ? (
          <div className="text-sm text-neutral-500">Nothing checked off.</div>
        ) : (
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-md overflow-hidden">
            {checked.map((i) => (
              <li key={i.id} className="px-3 py-3 flex items-center gap-3">
                <span className="flex-1 min-w-0 truncate text-sm">{i.name_snapshot}</span>
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
                  className="w-20 px-2 py-1.5 text-sm bg-neutral-900 border border-neutral-800 rounded text-right focus:outline-none focus:border-neutral-600"
                />
              </li>
            ))}
          </ul>
        )}
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <div className="fixed bottom-0 left-0 right-0 bg-neutral-950 border-t border-neutral-800 px-4 py-3 z-10">
          <div className="max-w-4xl mx-auto flex items-center justify-end">
            <button
              type="button"
              onClick={finish}
              className="px-4 py-2 text-sm font-medium rounded-md bg-neutral-100 text-neutral-900 hover:bg-white"
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
      <a href="#/lists" className="text-sm text-neutral-400 hover:text-neutral-100">
        ← Lists
      </a>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{list.name}</h1>
        <span className="text-xs text-neutral-500">
          {checked.length}/{list.items.length}
        </span>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      {grouped.map(([section, group]) => (
        <section key={section} className="border border-neutral-800 rounded-md overflow-hidden">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-800">
            {section}
          </div>
          <ul className="divide-y divide-neutral-800">
            {group.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => void toggle(it)}
                  className="w-full px-3 py-4 flex items-center gap-3 text-left hover:bg-neutral-900/50 transition"
                >
                  <span
                    className={
                      "w-6 h-6 rounded border flex items-center justify-center text-sm transition " +
                      (it.checked_off
                        ? "bg-emerald-500 border-emerald-500 text-emerald-950"
                        : "border-neutral-700")
                    }
                    aria-hidden
                  >
                    {it.checked_off ? "✓" : ""}
                  </span>
                  <span
                    className={
                      "flex-1 min-w-0 truncate " +
                      (it.checked_off ? "text-neutral-500 line-through" : "")
                    }
                  >
                    {it.name_snapshot}
                  </span>
                  {it.stores.length > 0 && (
                    <span className="text-xs text-neutral-500">{it.stores.join(", ")}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="fixed bottom-0 left-0 right-0 bg-neutral-950 border-t border-neutral-800 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-end">
          <button
            type="button"
            onClick={() => setFinishing(true)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-neutral-100 text-neutral-900 hover:bg-white"
          >
            Finish shopping
          </button>
        </div>
      </div>
    </div>
  );
}
