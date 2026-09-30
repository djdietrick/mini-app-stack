import { useEffect, useState } from "react";
import { api, ApiError, type VideoDetail } from "../api";
import { formatViews, timeAgo } from "../format";
import { YouTubePlayer } from "../player/YouTubePlayer";
import { ChannelAvatar } from "./Feed";

/**
 * The video and what it is, nothing else: no comments, no up-next, no
 * suggestions. The description stays folded until asked for.
 */
export function Watch({ id, onBack }: { id: string; onBack: () => void }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [ruleName, setRuleName] = useState<string | null>(null);

  useEffect(() => {
    setVideo(null);
    setError(null);
    setShowDescription(false);
    api
      .video(id)
      .then(setVideo)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? "This video isn't from one of your channels."
            : err instanceof Error
              ? err.message
              : "failed to load the video",
        ),
      );
  }, [id]);

  // Some conditions (duration) give no reason of their own; the rule's name
  // says why instead.
  useEffect(() => {
    setRuleName(null);
    const ruleId = video?.matched_rule_id;
    if (!ruleId) return;
    api
      .rules()
      .then((rules) => setRuleName(rules.find((r) => r.id === ruleId)?.name ?? null))
      .catch(() => undefined);
  }, [video]);

  useEffect(() => {
    if (video) document.title = `${video.title} · YouTube Digest`;
    return () => {
      document.title = "YouTube Digest";
    };
  }, [video]);

  return (
    <div>
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <span aria-hidden>←</span> Feed
      </button>

      {error ? (
        <p className="rounded-xl border border-canvas-200 bg-white p-6 text-sm text-ink-muted">{error}</p>
      ) : (
        <div className="-mx-4 sm:mx-0">
          <YouTubePlayer videoId={id} onDone={onBack} />
        </div>
      )}

      {video && (
        <div className="mt-4">
          <h1 className="text-xl font-semibold leading-snug">{video.title}</h1>
          <div className="mt-3 flex items-center gap-3">
            <ChannelAvatar src={video.channel_thumbnail_url} title={video.channel_title} />
            <div>
              <p className="font-medium">{video.channel_title}</p>
              <p className="text-sm text-ink-muted">
                {formatViews(video.view_count)} · {timeAgo(video.published_at)}
              </p>
            </div>
          </div>

          {video.matched && (ruleName || video.reasons.length > 0) && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-soft">In your feed because</span>
              {ruleName && (
                <span className="rounded-full bg-brand-500/10 px-2.5 py-0.5 font-medium text-brand-600">{ruleName}</span>
              )}
              {video.reasons.map((r) => (
                <span key={r} className="rounded-full bg-canvas-100 px-2.5 py-0.5 text-ink-muted">
                  {r}
                </span>
              ))}
            </div>
          )}
          {!video.matched && (
            <p className="mt-4 text-sm text-ink-soft">Your current rules would leave this one out of the feed.</p>
          )}

          {video.description && (
            <div className="mt-4 rounded-xl bg-canvas-100 p-3 text-sm">
              {showDescription ? (
                <>
                  <p className="whitespace-pre-line break-words text-ink">{video.description}</p>
                  <button className="mt-2 font-medium text-ink-muted" onClick={() => setShowDescription(false)}>
                    Show less
                  </button>
                </>
              ) : (
                <button className="w-full text-left" onClick={() => setShowDescription(true)}>
                  <span className="line-clamp-2 text-ink-muted">{video.description}</span>
                  <span className="mt-1 block font-medium text-ink">Show description</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
