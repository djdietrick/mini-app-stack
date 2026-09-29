import { frameSizeFor } from "../../../src/theory/index.js";

/**
 * The worklet lives in web/public, so it ships as a file of its own. Imported
 * with `?url`, Vite would inline a file this small as a data: URL, which is
 * not a dependable way to load a worklet module across browsers.
 */
const WORKLET_URL = `${import.meta.env.BASE_URL}capture.worklet.js`;

/**
 * Microphone frames. An AudioWorklet copies them off the audio thread; where
 * AudioWorklet is missing (old Safari, some in-app browsers) an AnalyserNode
 * is polled on a timer instead. Either way the caller gets the newest
 * `frameSize` samples roughly every 10 ms.
 */

export interface Capture {
  sampleRate: number;
  frameSize: number;
  mode: "worklet" | "analyser";
  stop(): void;
}

/**
 * Phone DSP (echo cancellation, noise suppression, auto gain) is built for
 * voices: it gates sustained tones, pumps the level and smears pitch.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
};

export async function openCapture(
  ctx: AudioContext,
  stream: MediaStream,
  onFrame: (frame: Float32Array) => void,
): Promise<Capture> {
  const sampleRate = ctx.sampleRate;
  const frameSize = frameSizeFor(sampleRate);
  // A quarter frame: 10.7 ms at 48 kHz, 11.6 ms at 44.1 kHz.
  const hop = frameSize / 4;
  const source = ctx.createMediaStreamSource(stream);
  // Some browsers only pull nodes that reach the destination; route through silence.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);

  const disconnect = () => {
    source.disconnect();
    sink.disconnect();
  };

  if (ctx.audioWorklet) {
    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const node = new AudioWorkletNode(ctx, "fretwork-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { frameSize, hop },
      });
      node.port.onmessage = (e: MessageEvent<{ frame: Float32Array }>) => onFrame(e.data.frame);
      source.connect(node).connect(sink);
      return {
        sampleRate,
        frameSize,
        mode: "worklet",
        stop: () => {
          node.port.onmessage = null;
          node.disconnect();
          disconnect();
        },
      };
    } catch {
      // Fall through to the analyser.
    }
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = frameSize;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser).connect(sink);
  const buf = new Float32Array(frameSize);
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    onFrame(buf);
  }, (hop / sampleRate) * 1000);
  return {
    sampleRate,
    frameSize,
    mode: "analyser",
    stop: () => {
      window.clearInterval(timer);
      analyser.disconnect();
      disconnect();
    },
  };
}
