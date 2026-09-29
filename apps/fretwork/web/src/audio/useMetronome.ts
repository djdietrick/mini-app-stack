import { useEffect, useRef, useState } from "react";
import { Metronome } from "./output";

/**
 * The click as a hook: it runs while `on` is true, follows `bpm` without a
 * restart, and reports the beat being heard (null when stopped) for a visual
 * pulse. Starting needs sound unlocked, so the tap that turns `on` true should
 * call unlockOutput() first.
 */
export function useMetronome(bpm: number, on: boolean): { beat: number | null } {
  const m = useRef<Metronome | null>(null);
  const [beat, setBeat] = useState<number | null>(null);

  useEffect(() => {
    if (!on) return;
    const metronome = new Metronome(4);
    metronome.onBeat = (b) => setBeat(b);
    metronome.start(bpm);
    m.current = metronome;
    return () => {
      metronome.stop();
      m.current = null;
      setBeat(null);
    };
    // bpm follows below, without restarting the bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  useEffect(() => {
    m.current?.setBpm(bpm);
  }, [bpm]);

  return { beat };
}
