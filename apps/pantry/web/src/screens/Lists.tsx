import { useEffect, useState } from "react";
import { api, type ListSummary } from "../api";

export function Lists() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLists(await api.lists());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete list "${name}"?`)) return;
    try {
      await api.deleteList(id);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const active = lists.filter((l) => l.status === "active");
  const completed = lists.filter((l) => l.status === "completed");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Grocery lists</h1>
        <a
          href="#/builder"
          className="px-3 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 transition"
        >
          + New list
        </a>
      </div>
      {error && <div className="text-sm text-apple-700">{error}</div>}

      <section>
        <h2 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-sans">Active</h2>
        {active.length === 0 ? (
          <div className="text-sm text-ink-muted">No active lists.</div>
        ) : (
          <ul className="divide-y divide-cream-300 border border-cream-300 rounded-md overflow-hidden bg-white">
            {active.map((l) => (
              <ListRow key={l.id} list={l} onDelete={() => void remove(l.id, l.name)} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-sans">Completed</h2>
        {completed.length === 0 ? (
          <div className="text-sm text-ink-muted">No past lists yet.</div>
        ) : (
          <ul className="divide-y divide-cream-300 border border-cream-300 rounded-md overflow-hidden bg-white">
            {completed.map((l) => (
              <ListRow key={l.id} list={l} onDelete={() => void remove(l.id, l.name)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ListRow({ list, onDelete }: { list: ListSummary; onDelete: () => void }) {
  const dateStr = new Date(list.created_at).toLocaleDateString();
  return (
    <li className="bg-white hover:bg-cream-50 transition">
      <div className="px-3 py-3 flex items-center gap-3">
        <a href={`#/shopping/${list.id}`} className="flex-1 min-w-0">
          <div className="font-medium truncate text-ink">{list.name}</div>
          <div className="text-xs text-ink-soft">
            {dateStr} · {list.checked_count}/{list.item_count} checked
            {list.status === "completed" && " · completed"}
          </div>
        </a>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-ink-soft hover:text-apple-700 transition px-2 py-1"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
