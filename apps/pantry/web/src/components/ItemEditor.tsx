import { useEffect, useState } from "react";
import { api, type Item, type ItemStatus, type Tag, type TagKind } from "../api";
import { StatusToggle } from "./StatusToggle";

interface Props {
  item: Item | null; // null = create
  tags: Tag[];
  onClose: () => void;
  onSaved: () => void;
  onTagsChanged?: () => void;
}

export function ItemEditor({ item, tags: tagsProp, onClose, onSaved, onTagsChanged }: Props) {
  const [name, setName] = useState(item?.name ?? "");
  const [quantity, setQuantity] = useState<number>(item?.quantity ?? 1);
  const [size, setSize] = useState(item?.size ?? "");
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? "stocked");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [tagIds, setTagIds] = useState<string[]>(item?.tag_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>(tagsProp);
  const [newTagKind, setNewTagKind] = useState<TagKind | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  useEffect(() => {
    setTags(tagsProp);
  }, [tagsProp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped: Record<string, Tag[]> = { store: [], section: [], general: [] };
  for (const t of tags) grouped[t.kind].push(t);

  const toggleTag = (id: string) =>
    setTagIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const createTag = async (kind: TagKind) => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    setCreatingTag(true);
    setError(null);
    try {
      const { id } = await api.createTag({ name: trimmed, kind });
      const created: Tag = { id, name: trimmed, kind, color: null };
      setTags((cur) => [...cur, created]);
      setTagIds((cur) => [...cur, id]);
      setNewTagName("");
      setNewTagKind(null);
      onTagsChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingTag(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        quantity,
        size: size.trim() || null,
        status,
        notes: notes.trim() || null,
        tagIds,
      };
      if (item) await api.updateItem(item.id, body);
      else await api.createItem(body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    setBusy(true);
    try {
      await api.deleteItem(item.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-cream-50 border border-cream-300 sm:rounded-lg shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-cream-50 border-b border-cream-300 px-4 py-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">
            {item ? "Edit item" : "New item"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink px-2 py-1 rounded transition"
          >
            Close
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wide text-ink-soft mb-1 font-sans">
              Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-ink-soft mb-1 font-sans">
              Status
            </label>
            <StatusToggle value={status} onChange={setStatus} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-ink-soft mb-1 font-sans">
                Quantity
              </label>
              <input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-ink-soft mb-1 font-sans">
                Size
              </label>
              <input
                placeholder="e.g. 16oz"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 placeholder:text-ink-soft"
              />
            </div>
          </div>
          {(["store", "section", "general"] as const).map((kind) => (
            <div key={kind}>
              <div className="text-xs uppercase tracking-wide text-ink-soft mb-1 font-sans">{kind}</div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {grouped[kind].length === 0 && newTagKind !== kind && (
                  <span className="text-xs text-ink-soft">no tags yet</span>
                )}
                {grouped[kind].map((t) => {
                  const on = tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className={
                        "px-2 py-1 rounded text-xs border transition " +
                        (on
                          ? "bg-ink text-cream-50 border-ink"
                          : "bg-white text-ink border-cream-300 hover:border-apple-400")
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
                {newTagKind === kind ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void createTag(kind);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setNewTagKind(null);
                          setNewTagName("");
                        }
                      }}
                      placeholder={`new ${kind} tag`}
                      className="px-2 py-1 text-xs bg-white border border-cream-300 rounded focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100 w-32"
                    />
                    <button
                      type="button"
                      disabled={creatingTag || !newTagName.trim()}
                      onClick={() => void createTag(kind)}
                      className="px-2 py-1 text-xs rounded bg-apple-500 text-white hover:bg-apple-600 disabled:opacity-50 font-medium"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewTagKind(null);
                        setNewTagName("");
                      }}
                      className="px-1 py-1 text-xs text-ink-muted hover:text-ink"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNewTagKind(kind);
                      setNewTagName("");
                    }}
                    className="px-2 py-1 rounded text-xs border border-dashed border-cream-300 text-ink-muted hover:border-apple-400 hover:text-ink transition"
                  >
                    + new
                  </button>
                )}
              </div>
            </div>
          ))}
          <div>
            <label className="block text-xs uppercase tracking-wide text-ink-soft mb-1 font-sans">
              Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md focus:outline-none focus:border-apple-400 focus:ring-2 focus:ring-apple-100"
            />
          </div>
          {error && <div className="text-sm text-apple-700">{error}</div>}
        </div>
        <div className="sticky bottom-0 bg-cream-50 border-t border-cream-300 px-4 py-3 flex items-center justify-between gap-2">
          {item ? (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="px-3 py-2 text-sm rounded-md text-apple-700 hover:bg-apple-50 disabled:opacity-50 transition"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-4 py-2 text-sm font-medium rounded-md bg-apple-500 text-white hover:bg-apple-600 disabled:opacity-50 transition"
          >
            {item ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
