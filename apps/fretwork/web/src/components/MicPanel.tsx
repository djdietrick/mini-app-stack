import type { NoteStream } from "../audio/useNoteStream";
import { useSettings } from "../settings";

/**
 * The mic's permission states, explained before the browser asks and with a
 * way back when access was refused. `fallback` says what works without it
 * (tapping the neck, on practice screens).
 */
export function MicPanel({ mic, fallback }: { mic: NoteStream; fallback?: string }) {
  switch (mic.status) {
    case "listening":
      return (
        <div className="card flex items-center gap-3 p-3">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-correct opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-correct" />
          </span>
          <span className="text-sm">Listening</span>
          <LevelMeter level={mic.level} className="flex-1" />
          <button type="button" onClick={mic.stop} className="focus-ring min-h-[44px] rounded-xl px-3 text-sm text-muted">
            Stop
          </button>
        </div>
      );

    case "asking":
      return (
        <div className="card p-4 text-[15px]" role="status">
          Allow the microphone in your browser's prompt.
        </div>
      );

    case "denied":
      return (
        <div className="card flex flex-col gap-3 p-4" role="alert">
          <h2 className="font-display text-lg font-bold">The microphone is blocked</h2>
          <p className="text-[15px] text-muted">Fretwork can't hear your guitar until you allow it:</p>
          <ol className="list-decimal pl-5 text-[15px] text-muted">
            {recoverySteps().map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button type="button" onClick={() => void mic.start()} className="btn-primary self-start">
            Try again
          </button>
          {fallback && <p className="text-[13px] text-faint">{fallback}</p>}
        </div>
      );

    case "unsupported":
      return (
        <div className="card flex flex-col gap-2 p-4" role="alert">
          <h2 className="font-display text-lg font-bold">No microphone here</h2>
          <p className="text-[15px] text-muted">
            {mic.error ??
              (window.isSecureContext
                ? "This browser can't listen to the microphone. Recent Safari, Chrome and Firefox all can."
                : "The microphone only works over HTTPS (or on localhost).")}
          </p>
          {fallback && <p className="text-[13px] text-faint">{fallback}</p>}
        </div>
      );

    case "idle":
      return (
        <div className="card flex flex-col gap-3 p-4">
          <h2 className="font-display text-lg font-bold">Let Fretwork listen</h2>
          <p className="text-[15px] text-muted">
            The microphone hears which note you play and checks it. Sound is analysed on this device as you play.
            Nothing is recorded or uploaded.
          </p>
          {mic.error && <p className="text-[15px] text-miss">{mic.error}</p>}
          <button type="button" onClick={() => void mic.start()} className="btn-primary self-start">
            Turn on microphone
          </button>
          {fallback && <p className="text-[13px] text-faint">{fallback}</p>}
        </div>
      );
  }
}

function recoverySteps(): string[] {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return [
      "Tap aA (or the page icon) in the address bar, then Website Settings.",
      "Set Microphone to Allow.",
      "Come back here and tap Try again.",
    ];
  }
  if (/Android/.test(ua)) {
    return [
      "Tap the icon to the left of the address bar, then Permissions.",
      "Turn Microphone on.",
      "Reload the page if Try again doesn't work.",
    ];
  }
  return [
    "Click the icon to the left of the address bar.",
    "Allow the microphone for this site.",
    "Click Try again, or reload the page.",
  ];
}

/**
 * Input level on a dB scale from -60 to 0, with the gate marked, so it's
 * obvious whether the guitar is loud enough to count.
 */
export function LevelMeter({ level, className = "" }: { level: number; className?: string }) {
  const { gate } = useSettings();
  const pct = (v: number) => Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(v, 1e-6)) + 60) / 60) * 100));
  const open = level >= gate;
  return (
    <div
      className={"relative h-2.5 overflow-hidden rounded-full bg-raised " + className}
      role="meter"
      aria-label="Input level"
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Math.round(20 * Math.log10(Math.max(level, 1e-6)))}
    >
      <div
        className={"h-full rounded-full " + (open ? "bg-correct" : "bg-faint")}
        style={{ width: `${pct(level)}%` }}
      />
      <div className="absolute inset-y-0 w-0.5 bg-brass" style={{ left: `${pct(gate)}%` }} aria-hidden="true" />
    </div>
  );
}
