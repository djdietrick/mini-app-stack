import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FeedItem } from "../api";
import { feedSection, formatDuration, formatViews, thumbnailFor, timeAgo } from "../format";
import { hrefFor } from "../route";

/**
 * Only the uploads that pass your filters, newest first, grouped by day like
 * YouTube's subscriptions page. No recommendations, no Shorts shelf, nothing
 * but the grid. The server filters; this screen pages through the result.
 */
export function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleNames, setRuleNames] = useState<Map<string, string>>(new Map());
  const busy = useRef(false);

  const load = useCallback(async (before: string | null) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await api.feed(before);
      setItems((prev) => (before ? [...prev, ...page.items] : page.items));
      setNext(page.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load the feed");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
    api
      .rules()
      .then((rules) => setRuleNames(new Map(rules.map((r) => [r.id, r.name]))))
      .catch(() => undefined);
  }, [load]);

  // Infinite scroll: fetch the next page when the sentinel comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load(next);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, load]);

  if (!loading && !error && items.length === 0 && !next) return <Empty />;

  const sections: { title: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const title = feedSection(item.published_at);
    if (sections.at(-1)?.title !== title) sections.push({ title, items: [] });
    sections.at(-1)!.items.push(item);
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-3 text-lg font-semibold">{section.title}</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <VideoCard
                key={item.video_id}
                item={item}
                ruleName={item.matched_rule_id ? ruleNames.get(item.matched_rule_id) : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      {loading && items.length === 0 && <SkeletonGrid />}
      {error && (
        <p className="text-sm text-brand-600">
          {error}{" "}
          <button className="underline" onClick={() => load(items.length ? next : null)}>
            Retry
          </button>
        </p>
      )}
      <div ref={sentinel} />
      {loading && items.length > 0 && <p className="text-center text-sm text-ink-muted">Loading…</p>}
      {!next && items.length > 0 && (
        <p className="pb-4 text-center text-sm text-ink-soft">You're all caught up.</p>
      )}
    </div>
  );
}

function VideoCard({ item, ruleName }: { item: FeedItem; ruleName?: string }) {
  return (
    <a href={hrefFor({ name: "watch", id: item.youtube_video_id })} className="group block">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-canvas-200">
        <img
          src={thumbnailFor(item)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
        {item.duration_seconds != null && item.duration_seconds > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 text-xs font-medium text-white">
            {formatDuration(item.duration_seconds)}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-3">
        <ChannelAvatar src={item.channel_thumbnail_url} title={item.channel_title} />
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-medium leading-snug text-ink">{item.title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{item.channel_title}</p>
          <p className="text-sm text-ink-muted">
            {formatViews(item.view_count)} · {timeAgo(item.published_at)}
          </p>
          {ruleName && (
            <span className="mt-1.5 inline-block rounded-full bg-canvas-100 px-2 py-0.5 text-xs text-ink-muted">
              {ruleName}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

export function ChannelAvatar({ src, title }: { src: string | null; title: string }) {
  return src ? (
    <img src={src} alt="" className="h-9 w-9 shrink-0 rounded-full bg-canvas-200" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-200 text-sm font-medium text-ink-muted">
      {title.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-video rounded-xl bg-canvas-200" />
          <div className="mt-3 flex gap-3">
            <div className="h-9 w-9 rounded-full bg-canvas-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 rounded bg-canvas-200" />
              <div className="h-3 w-2/3 rounded bg-canvas-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-canvas-200 bg-white p-8 text-center">
      <p className="font-medium">Nothing here yet.</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        The feed shows uploads from your <a className="text-brand-600 underline" href={hrefFor({ name: "channels" })}>channels</a>{" "}
        that pass your <a className="text-brand-600 underline" href={hrefFor({ name: "rules" })}>rules</a>. New channels
        fill in after the next poll.
      </p>
    </div>
  );
}
