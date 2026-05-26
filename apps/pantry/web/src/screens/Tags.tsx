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
      <h1 className="text-xl font-semibold">Tags</h1>
      {error && <div className="text-sm text-rose-400">{error}</div>}
      {KINDS.map(({ kind, label, hint }) => {
        const ofKind = tags.filter((t) => t.kind === kind);
        return (
          <section key={kind} className="border border-neutral-800 rounded-md overflow-hidden">
            <div className="px-3 py-2 border-b border-neutral-800 flex items-baseline justify-between">
              <h2 className="font-medium">{label}</h2>
              <span className="text-xs text-neutral-500">{hint}</span>
            </div>
            <ul className="divide-y divide-neutral-800">
              {ofKind.length === 0 && (
                <li className="px-3 py-3 text-sm text-neutral-500">No {label.toLowerCase()} yet.</li>
              )}
              {ofKind.map((t) => (
                <li key={t.id} className="px-3 py-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => void rename(t)}
                    className="text-sm hover:text-neutral-300 transition"
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(t.id, t.name)}
                    className="text-xs text-neutral-500 hover:text-rose-400 transition px-2 py-1"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-3 py-2 border-t border-neutral-800 flex gap-2">
              <input
                value={newName[kind]}
                onChange={(e) => setNewName((n) => ({ ...n, [kind]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && add(kind)}
                placeholder={`Add ${label.slice(0, -1).toLowerCase()}…`}
                className="flex-1 px-2 py-1.5 text-sm bg-neutral-900 border border-neutral-800 rounded focus:outline-none focus:border-neutral-600"
              />
              <button
                type="button"
                onClick={() => add(kind)}
                className="px-3 py-1.5 text-sm rounded bg-neutral-100 text-neutral-900 hover:bg-white"
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
