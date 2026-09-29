import type { LivePitch } from "../audio/useNoteStream";

/** Within this many cents counts as in tune. */
export const IN_TUNE = 5;

/**
 * A cents needle from −50 to +50, with the in-tune zone shaded. Shared by the
 * tuner and the flashcards, where it shows the pitch being heard.
 */
export function Needle({ live, className = "" }: { live: LivePitch | null; className?: string }) {
  const inTune = !!live && Math.abs(live.cents) <= IN_TUNE;
  const needle = live ? Math.max(-50, Math.min(50, live.cents)) : 0;
  return (
    <div className={"relative h-16 w-full max-w-sm " + className} aria-hidden="true">
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {[-50, -25, 0, 25, 50].map((c) => (
        <div
          key={c}
          className={"absolute top-1/2 w-px -translate-y-1/2 " + (c === 0 ? "h-10 bg-muted" : "h-4 bg-line")}
          style={{ left: `${50 + c}%` }}
        />
      ))}
      <div
        className="absolute top-1/2 h-full -translate-y-1/2 rounded-md bg-correct/15"
        style={{ left: `${50 - IN_TUNE}%`, width: `${IN_TUNE * 2}%` }}
      />
      <div
        className={
          "absolute top-0 h-full w-1 -translate-x-1/2 rounded-full transition-[left] duration-100 motion-reduce:transition-none " +
          (live ? (inTune ? "bg-correct" : "bg-brass") : "bg-transparent")
        }
        style={{ left: `${50 + needle}%` }}
      />
    </div>
  );
}
