// The recording is raw 16 bit mono at 16 kHz: the size the recognition
// needs, and plain bytes that can be cut at any sample.
export const SAMPLE_RATE = 16000;
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;

// The recognition takes files, not raw samples: a window of the recording
// gets the 44 bytes of a wav header.
export function wavFromPcm(pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      out[at + i] = text.charCodeAt(i);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, BYTES_PER_SECOND, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

// A long window is closed in the quietest fifth of a second of the range,
// so the cut falls into a pause and not into the middle of a word: a short
// frame found the gap between two syllables.
export function quietestCut(pcm: Uint8Array, from: number, to: number): number {
  const frame = BYTES_PER_SECOND / 5;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const start = Math.max(0, from - (from % 2));
  const end = Math.min(pcm.length, to);
  let best = end - (end % 2);
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let at = start; at + frame <= end; at += frame / 2) {
    let energy = 0;
    for (let i = at; i < at + frame; i += 2) {
      const sample = view.getInt16(i, true);
      energy += sample * sample;
    }
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = at + frame / 2;
    }
  }
  return best - (best % 2);
}
