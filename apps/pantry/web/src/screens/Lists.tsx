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
        <h1 className="text-xl font-semibold">Grocery lists</h1>
        <a
          href="#/builder"
          className="px-3 py-2 text-sm font-medium rounded-md bg-neutral-100 text-neutral-900 hover:bg-white"
        >
          + New list
        </a>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Active</h2>
        {active.length === 0 ? (
          <div className="text-sm text-neutral-500">No active lists.</div>
        ) : (
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-md overflow-hidden">
            {active.map((l) => (
              <ListRow key={l.id} list={l} onDelete={() => void remove(l.id, l.name)} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Completed</h2>
        {completed.length === 0 ? (
          <div className="text-sm text-neutral-500">No past lists yet.</div>
        ) : (
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-md overflow-hidden">
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
    <li className="bg-neutral-950 hover:bg-neutral-900/50 transition">
      <div className="px-3 py-3 flex items-center gap-3">
        <a href={`#/shopping/${list.id}`} className="flex-1 min-w-0">
          <div className="font-medium truncate">{list.name}</div>
          <div className="text-xs text-neutral-500">
            {dateStr} · {list.checked_count}/{list.item_count} checked
            {list.status === "completed" && " · completed"}
          </div>
        </a>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-neutral-500 hover:text-rose-400 transition px-2 py-1"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
