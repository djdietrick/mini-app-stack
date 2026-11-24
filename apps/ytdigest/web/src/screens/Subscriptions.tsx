import { useEffect, useState } from "react";
import { api, type ChannelSearchResult, type NotifyMode, type Subscription } from "../api";
import { formatCount } from "../format";
import { hrefFor } from "../route";
import { ChannelAvatar } from "./Feed";

/**
 * Your channels, and finding more: type a name (or an @handle or channel
 * link) and pick from what YouTube finds. A name search runs on submit, not
 * per keystroke, since each one spends YouTube API quota.
 */
export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [query, setQuery] = useState("");
  const [notifyMode, setNotifyMode] = useState<NotifyMode>("rules");
  const [results, setResults] = useState<ChannelSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  /** The channel being added, by YouTube id. */
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.subscriptions().then(setSubs);
  useEffect(() => {
    load();
  }, []);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await api.searchChannels(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "search failed");
    } finally {
      setSearching(false);
    }
  };

  const add = async (channel: ChannelSearchResult) => {
    setAdding(channel.youtubeChannelId);
    setError(null);
    try {
      const { id } = await api.createSubscription({ query: channel.youtubeChannelId, notifyMode });
      setResults(
        (prev) =>
          prev?.map((r) => (r.youtubeChannelId === channel.youtubeChannelId ? { ...r, subscriptionId: id } : r)) ??
          null,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to subscribe");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded border border-canvas-200 bg-surface p-4">
        <form onSubmit={search} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <label htmlFor="channel-search" className="block text-xs text-ink-muted">
              Find a channel by name, @handle or link
            </label>
            <input
              id="channel-search"
              type="search"
              enterKeyHint="search"
              className="mt-1 w-full rounded border border-canvas-200 bg-surface px-2 py-1.5"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Veritasium"
            />
          </div>
          <div>
            <label htmlFor="notify-mode" className="block text-xs text-ink-muted">
              Show in feed
            </label>
            <select
              id="notify-mode"
              className="mt-1 rounded border border-canvas-200 bg-surface px-2 py-1.5"
              value={notifyMode}
              onChange={(e) => setNotifyMode(e.target.value as NotifyMode)}
            >
              <option value="rules">matches only</option>
              <option value="all">every upload</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="rounded bg-brand-500 px-4 py-1.5 text-white hover:brightness-90 disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {results && results.length === 0 && (
          <p className="text-sm text-ink-muted">No channels found. Try another spelling, or paste the channel's link.</p>
        )}
        {results && results.length > 0 && (
          <ul className="divide-y divide-canvas-200">
            {results.map((r) => (
              <SearchResult
                key={r.youtubeChannelId}
                channel={r}
                busy={adding === r.youtubeChannelId}
                disabled={adding !== null}
                onAdd={() => add(r)}
              />
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-sm text-brand-600">{error}</p>}

      <div className="space-y-2">
        {subs.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-canvas-200 bg-surface p-3">
            <a href={hrefFor({ name: "channel", id: s.id })} className="flex min-w-40 flex-1 items-center gap-3">
              <ChannelAvatar src={s.thumbnail_url} title={s.channel_title} />
              <span className="font-medium hover:underline">{s.channel_title}</span>
            </a>

            <select
              className="rounded border border-canvas-200 bg-surface px-2 py-1 text-sm"
              aria-label={`Show in feed from ${s.channel_title}`}
              value={s.notify_mode}
              onChange={async (e) => {
                await api.updateSubscription(s.id, { notifyMode: e.target.value as NotifyMode });
                load();
              }}
            >
              <option value="rules">matches only</option>
              <option value="all">every upload</option>
            </select>

            <button
              className="text-sm text-brand-500 hover:underline"
              onClick={async () => {
                await api.deleteSubscription(s.id);
                setResults((prev) => prev?.map((r) => (r.subscriptionId === s.id ? { ...r, subscriptionId: null } : r)) ?? null);
                load();
              }}
            >
              unsubscribe
            </button>
          </div>
        ))}
        {subs.length === 0 && <p className="text-sm text-ink-muted">No subscriptions yet.</p>}
      </div>
    </div>
  );
}

function SearchResult({
  channel,
  busy,
  disabled,
  onAdd,
}: {
  channel: ChannelSearchResult;
  busy: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const facts = [
    channel.handle,
    channel.subscriberCount != null ? formatCount(channel.subscriberCount, "subscriber") : null,
    channel.videoCount != null ? formatCount(channel.videoCount, "video") : null,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 py-3">
      <ChannelAvatar src={channel.thumbnailUrl} title={channel.title} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{channel.title}</p>
        {facts.length > 0 && <p className="truncate text-sm text-ink-muted">{facts.join(" · ")}</p>}
        {channel.description && <p className="line-clamp-1 text-sm text-ink-soft">{channel.description}</p>}
      </div>
      {channel.subscriptionId ? (
        <a
          href={hrefFor({ name: "channel", id: channel.subscriptionId })}
          className="shrink-0 rounded-full border border-canvas-200 px-3 py-1 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Following
        </a>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="shrink-0 rounded-full bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:brightness-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Subscribe"}
        </button>
      )}
    </li>
  );
}
