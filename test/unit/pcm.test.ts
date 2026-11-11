import { describe, expect, it } from 'vitest';
import { quietestCut, wavFromPcm, SAMPLE_RATE, BYTES_PER_SECOND } from '../../src/voice/pcm';

// 16 bit mono samples of one value, little endian.
function tone(seconds: number, level: number): Uint8Array {
  const samples = Math.round(seconds * SAMPLE_RATE);
  const out = new Uint8Array(samples * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples; i++) {
    view.setInt16(i * 2, i % 2 === 0 ? level : -level, true);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('the raw sound of the recording', () => {
  it('counts 16 kHz mono 16 bit', () => {
    expect(SAMPLE_RATE).toBe(16000);
    expect(BYTES_PER_SECOND).toBe(32000);
  });

  it('wraps the samples into a wav file the recognition reads', () => {
    const pcm = tone(0.5, 1000);
    const wav = wavFromPcm(pcm);
    const text = (from: number, to: number) => String.fromCharCode(...wav.slice(from, to));
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + pcm.length);
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm.length);
  });

  it('cuts a long window in the pause between the words', () => {
    // speech, a pause from 2.0 to 2.4 seconds, speech again
    const pcm = concat(tone(2, 8000), tone(0.4, 30), tone(1.6, 8000));
    const cut = quietestCut(pcm, 1 * BYTES_PER_SECOND, 4 * BYTES_PER_SECOND);
    expect(cut).toBeGreaterThanOrEqual(2 * BYTES_PER_SECOND);
    expect(cut).toBeLessThanOrEqual(2.4 * BYTES_PER_SECOND);
    // A sample is two bytes, the cut never splits one.
    expect(cut % 2).toBe(0);
  });
});
