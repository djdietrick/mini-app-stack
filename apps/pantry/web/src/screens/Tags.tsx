import { useEffect, useState } from "react";
import { api, type Tag, type TagKind } from "../api";

const KINDS: { kind: TagKind; label: string; hint: string }[] = [
  { kind: "store", label: "Stores", hint: "e.g. Trader Joe's, Costco" },
  { kind: "section", label: "Sections", hint: "e.g. Produce, Dairy, Frozen" },
  { kind: "general", label: "General", hint: "anything else" },
];

export function Tags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<Record<TagKind, string>>({
    store: "",
    section: "",
    general: "",
  });

  const load = async () => {
    try {
      setTags(await api.tags());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async (kind: TagKind) => {
    const name = newName[kind].trim();
    if (!name) return;
    try {
      await api.createTag({ name, kind });
      setNewName((n) => ({ ...n, [kind]: "" }));
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete tag "${name}"? Items keep their data but lose this tag.`)) return;
    try {
      await api.deleteTag(id);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rename = async (t: Tag) => {
    const name = window.prompt(`Rename "${t.name}":`, t.name);
    if (!name || name.trim() === t.name) return;
    try {
      await api.updateTag(t.id, { name: name.trim() });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-ink">Tags</h1>
      {error && <div className="text-sm text-apple-700">{error}</div>}
      {KINDS.map(({ kind, label, hint }) => {
        const ofKind = tags.filter((t) => t.kind === kind);
        return (
          <section key={kind} className="border border-cream-300 rounded-md overflow-hidden bg-white">
            <div className="px-3 py-2 border-b border-cream-300 flex items-baseline justify-between bg-cream-50">
              <h2 className="font-display font-semibold text-ink text-base">{label}</h2>
              <span className="text-xs text-ink-soft font-sans">{hint}</span>
            </div>
            <ul className="divide-y divide-cream-300">
              {ofKind.length === 0 && (
                <li className="px-3 py-3 text-sm text-ink-muted">No {label.toLowerCase()} yet.</li>
              )}
              {ofKind.map((t) => (
                <li key={t.id} className="px-3 py-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => void rename(t)}
                    className="text-sm text-ink hover:text-apple-600 transition"
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(t.id, t.name)}
                    className="text-xs text-ink-soft hover:text-apple-700 transition px-2 py-1"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-3 py-2 border-t border-cream-300 flex gap-2 bg-cream-50">
              <input
                value={newName[kind]}
                onChange={(e) => setNewName((n) => ({ ...n, [kind]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && add(kind)}
                placeholder={`Add ${label.slice(0, -1).toLowerCase()}…`}
                className="flex-1 px-2 py-1.5 text-sm bg-white border border-cream-300 rounded focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
              />
              <button
                type="button"
                onClick={() => add(kind)}
                className="px-3 py-1.5 text-sm font-medium rounded bg-apple-500 text-white hover:bg-apple-600 transition"
              >
                Add
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
