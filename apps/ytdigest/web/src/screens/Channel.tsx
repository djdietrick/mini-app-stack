import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ChannelVideo, type NotifyMode, type Subscription } from "../api";
import { hrefFor } from "../route";
import { ChannelAvatar, SkeletonGrid, VideoCard } from "./Feed";

/**
 * One channel's videos, newest first: all of them, not just what your filters
 * let into the feed. The ones the feed leaves out say so. Pages on scroll,
 * like the feed.
 */
export function Channel({ id }: { id: string }) {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [items, setItems] = useState<ChannelVideo[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState<"first" | "more" | null>("first");
  const [error, setError] = useState<{ message: string; before: string | null } | null>(null);
  const [ruleNames, setRuleNames] = useState<Map<string, string>>(new Map());
  const busy = useRef(false);

  const load = useCallback(
    async (before: string | null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(before ? "more" : "first");
      setError(null);
      try {
        const page = await api.channelVideos(id, before);
        setItems((prev) => (before ? [...prev, ...page.items] : page.items));
        setNext(page.next);
      } catch (err) {
        setError({
          message:
            err instanceof ApiError && err.status === 404
              ? "You don't follow this channel any more."
              : err instanceof Error
                ? err.message
                : "failed to load the channel",
          before,
        });
      } finally {
        busy.current = false;
        setLoading(null);
      }
    },
    [id],
  );

  const loadSub = useCallback(
    () =>
      api
        .subscriptions()
        .then((subs) => setSub(subs.find((s) => s.id === id) ?? null))
        .catch(() => undefined),
    [id],
  );

  useEffect(() => {
    setItems([]);
    setNext(null);
    load(null);
    loadSub();
    api
      .rules()
      .then((rules) => setRuleNames(new Map(rules.map((r) => [r.id, r.name]))))
      .catch(() => undefined);
  }, [load, loadSub]);

  useEffect(() => {
    if (!sub) return;
    document.title = `${sub.channel_title} · YouTube Digest`;
    return () => {
      document.title = "YouTube Digest";
    };
  }, [sub]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) load(next);
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [next, load]);

  const setNotifyMode = async (notifyMode: NotifyMode) => {
    await api.updateSubscription(id, { notifyMode });
    await loadSub();
    load(null);
  };

  return (
    <div className="space-y-6" aria-busy={loading !== null}>
      <a href={hrefFor({ name: "channels" })} className="flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <span aria-hidden>←</span> Channels
      </a>

      {sub && (
        <div className="flex flex-wrap items-center gap-3">
          <ChannelAvatar src={sub.thumbnail_url} title={sub.channel_title} />
          <h2 className="min-w-0 flex-1 truncate text-xl font-semibold">{sub.channel_title}</h2>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Show in feed
            <select
              className="rounded border border-canvas-200 bg-surface px-2 py-1"
              value={sub.notify_mode}
              onChange={(e) => setNotifyMode(e.target.value as NotifyMode)}
            >
              <option value="rules">matches only</option>
              <option value="all">every upload</option>
            </select>
          </label>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <VideoCard
              key={item.video_id}
              item={item}
              hideChannel
              outOfFeed={!item.matched}
              ruleName={item.matched_rule_id ? ruleNames.get(item.matched_rule_id) : undefined}
            />
          ))}
        </div>
      )}

      {loading === "first" && items.length === 0 && <SkeletonGrid />}
      {!loading && !error && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-canvas-200 bg-surface p-8 text-center text-sm text-ink-muted">
          No videos yet. They fill in after the next poll.
        </p>
      )}
      {error && (
        <p className="text-sm text-brand-600">
          {error.message}{" "}
          <button className="underline" onClick={() => load(error.before)}>
            Retry
          </button>
        </p>
      )}
      <div ref={sentinel} />
      {loading === "more" && <p className="text-center text-sm text-ink-muted">Loading…</p>}
    </div>
  );
}
