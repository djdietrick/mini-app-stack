import { useEffect, useRef, useSyncExternalStore } from "react";
import * as stream from "./noteStream";
import type { NoteStreamState, StreamNote } from "./noteStream";

export type { LivePitch, MicStatus, NoteStreamState, StreamNote } from "./noteStream";

/** Screens currently using the mic; when the last one goes, the mic is released. */
let users = 0;
let releaseTimer: number | undefined;

export interface NoteStream extends NoteStreamState {
  /** Turn the mic on. Call it from a tap: iOS needs a user gesture. */
  start: () => Promise<void>;
  stop: () => void;
  /** Feed a note from the tap-the-fretboard fallback. */
  tap: (midi: number) => void;
}

/**
 * The mic as a React hook: status for the permission UI, a live pitch for
 * tuners, and `onNote` for engines. `onNote` sees taps and mic notes alike.
 * The latest callback is always used, so it does not need to be memoised.
 */
export function useNoteStream(onNote?: (note: StreamNote) => void): NoteStream {
  const state = useSyncExternalStore(stream.subscribe, stream.getState);
  const handler = useRef(onNote);
  handler.current = onNote;

  useEffect(() => {
    users++;
    window.clearTimeout(releaseTimer);
    const off = stream.onNote((n) => handler.current?.(n));
    return () => {
      off();
      users--;
      // A short grace period, so moving between two screens that both listen keeps the mic.
      if (users === 0) releaseTimer = window.setTimeout(() => users === 0 && stream.stop(), 800);
    };
  }, []);

  return { ...state, start: stream.start, stop: stream.stop, tap: stream.tap };
}
