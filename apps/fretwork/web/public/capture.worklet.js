/**
 * Runs on the audio thread. Keeps the newest `frameSize` samples of channel 0
 * in a ring buffer and, every `hop` samples, posts a copy of them in order to
 * the main thread, which runs the pitch detector. Plain JS with no imports,
 * served from web/public as-is and loaded by addModule() (src/audio/capture.ts).
 */
class FretworkCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { frameSize, hop } = options.processorOptions;
    this.frameSize = frameSize;
    this.hop = hop;
    this.ring = new Float32Array(frameSize);
    this.write = 0;
    this.filled = 0;
    this.sinceHop = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    const { ring, frameSize } = this;
    for (let i = 0; i < channel.length; i++) {
      ring[this.write] = channel[i];
      this.write = (this.write + 1) % frameSize;
    }
    this.filled = Math.min(frameSize, this.filled + channel.length);
    this.sinceHop += channel.length;
    if (this.sinceHop >= this.hop && this.filled === frameSize) {
      this.sinceHop = 0;
      const frame = new Float32Array(frameSize);
      frame.set(ring.subarray(this.write));
      frame.set(ring.subarray(0, this.write), frameSize - this.write);
      this.port.postMessage({ frame, time: currentTime }, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("fretwork-capture", FretworkCapture);
