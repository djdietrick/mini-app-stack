import { useEffect, useMemo, useState } from "react";
import { api, type Item, type ItemStatus, type Tag } from "../api";
import { StatusToggle } from "../components/StatusToggle";
import { ItemEditor } from "../components/ItemEditor";

type Filter = "all" | ItemStatus;

export function Pantry() {
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [editing, setEditing] = useState<Item | null | "new">(null);

  const load = async () => {
    setError(null);
    try {
      const [is, ts] = await Promise.all([api.items(), api.tags()]);
      setItems(is);
      setTags(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter !== "all" && i.status !== filter) return false;
      if (tagFilter && !i.tag_ids.includes(tagFilter)) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, filter, tagFilter, query]);

  const setStatus = async (id: string, status: ItemStatus) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      await api.setStatus(id, status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load();
    }
  };

  const counts = useMemo(
    () => ({
      all: items.length,
      out: items.filter((i) => i.status === "out").length,
      low: items.filter((i) => i.status === "low").length,
      stocked: items.filter((i) => i.status === "stocked").length,
    }),
    [items],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pantry…"
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
          />
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="px-3 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 transition"
        >
          + Add
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([
          ["all", `All (${counts.all})`],
          ["out", `Out (${counts.out})`],
          ["low", `Low (${counts.low})`],
          ["stocked", `Stocked (${counts.stocked})`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={
              "px-2.5 py-1 rounded text-xs font-medium transition " +
              (filter === k
                ? "bg-ink text-cream-50"
                : "bg-cream-50 text-ink-muted hover:text-ink hover:bg-cream-200 border border-cream-300")
            }
          >
            {label}
          </button>
        ))}
        {tags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="ml-auto px-2 py-1 text-xs bg-white border border-cream-300 rounded"
          >
            <option value="">all tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.kind}: {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="text-sm text-apple-700">{error}</div>}
      {loading ? (
        <div className="text-ink-muted text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-ink-muted text-sm py-8 text-center">
          {items.length === 0 ? "No items yet. Tap + Add to start." : "No matches."}
        </div>
      ) : (
        <ul className="divide-y divide-cream-300 border border-cream-300 rounded-md overflow-hidden bg-white">
          {filtered.map((i) => (
            <li key={i.id} className="bg-white hover:bg-cream-50 transition">
              <div className="px-3 py-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(i)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="font-medium truncate text-ink">{i.name}</div>
                  <div className="text-xs text-ink-soft truncate">
                    {i.quantity} {i.size ? `· ${i.size}` : ""}
                    {i.tag_ids.length > 0 && (
                      <span className="ml-1">
                        ·{" "}
                        {i.tag_ids
                          .map((tid) => tagById.get(tid)?.name)
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
                  </div>
                </button>
                <StatusToggle value={i.status} onChange={(s) => void setStatus(i.id, s)} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          tags={tags}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onTagsChanged={() => {
            void api.tags().then(setTags);
          }}
        />
      )}
    </div>
  );
}
