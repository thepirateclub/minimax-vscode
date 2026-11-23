import { describe, expect, it } from 'vitest';
import { VoiceController, type VoiceDeps } from '../../src/voice/controller';
import { BYTES_PER_SECOND } from '../../src/voice/pcm';
import type { ExtToWeb } from '../../src/ui/protocol';

function silence(seconds: number): Uint8Array {
  return new Uint8Array(Math.round(seconds * BYTES_PER_SECOND));
}

function harness(overrides: Partial<VoiceDeps> = {}) {
  const posted: ExtToWeb[] = [];
  const sent: number[] = [];
  let pcm = silence(0);
  let tick: (() => void) | undefined;
  let stopped = false;
  let replies = ['hello world'];
  const deps: VoiceDeps = {
    post: (message) => posted.push(message),
    getApiKey: async () => 'key',
    config: () => ({ ffmpeg: 'ffmpeg', microphone: '', language: 'ru', baseUrl: 'https://api.minimax.io/anthropic' }),
    every: (_ms, fn) => {
      tick = fn;
      return () => {
        tick = undefined;
      };
    },
    createRecorder: () => ({
      start: async () => undefined,
      snapshot: () => pcm,
      stop: async () => {
        stopped = true;
        return pcm;
      },
      cancel: () => undefined
    }),
    createClient: () => ({
      transcribe: async (audio) => {
        // The wav header is 44 bytes, the rest is the window.
        sent.push((audio.length - 44) / BYTES_PER_SECOND);
        return replies.shift() ?? '';
      }
    }),
    ...overrides
  };
  const controller = new VoiceController(deps);
  return {
    controller,
    posted,
    sent,
    record: (seconds: number) => {
      pcm = silence(seconds);
    },
    tick: async () => {
      tick?.();
      await controller.idle();
    },
    reply: (...texts: string[]) => {
      replies = texts;
    },
    wasStopped: () => stopped,
    ticking: () => tick !== undefined
  };
}

describe('the voice input', () => {
  it('records, transcribes and puts the final text into the field', async () => {
    const h = harness();
    await h.controller.start();
    h.record(2);
    await h.controller.stop();
    expect(h.posted).toEqual([
      { type: 'voice_state', state: 'recording' },
      { type: 'voice_state', state: 'transcribing' },
      { type: 'voice_text', text: 'hello world' },
      { type: 'voice_state', state: 'idle' }
    ]);
  });

  it('shows the text while the reader speaks', async () => {
    const h = harness();
    h.reply('first words', 'first words and more', 'first words and more done');
    await h.controller.start();
    h.record(2);
    await h.tick();
    h.record(5);
    await h.tick();
    expect(h.posted.filter((m) => m.type === 'voice_partial')).toEqual([
      { type: 'voice_partial', text: 'first words' },
      { type: 'voice_partial', text: 'first words and more' }
    ]);
    // The window grows, each request carries the whole open window.
    expect(h.sent).toEqual([2, 5]);
    await h.controller.stop();
    expect(h.posted).toContainEqual({ type: 'voice_text', text: 'first words and more done' });
  });

  it('waits for a second of speech before the first request', async () => {
    const h = harness();
    await h.controller.start();
    h.record(0.5);
    await h.tick();
    expect(h.sent).toEqual([]);
  });

  it('closes a long window, keeps its text and starts a new one', async () => {
    const h = harness();
    h.reply('the first window', 'the second');
    await h.controller.start();
    h.record(22);
    await h.tick();
    // The closed window is cut within its last seconds, not at its very end.
    expect(h.sent[0]).toBeGreaterThan(16);
    expect(h.sent[0]).toBeLessThanOrEqual(22);
    expect(h.posted).toContainEqual({ type: 'voice_partial', text: 'the first window' });
    h.record(25);
    await h.controller.stop();
    // The final request carries only the open window, the closed text stays.
    expect(h.sent[1]).toBeLessThan(8);
    expect(h.posted).toContainEqual({ type: 'voice_text', text: 'the first window the second' });
  });

  it('joins the windows inside a sentence without a capital letter', async () => {
    const h = harness();
    h.reply('if the window grows past twenty seconds,', 'It closes in a pause.');
    await h.controller.start();
    h.record(22);
    await h.tick();
    h.record(25);
    await h.controller.stop();
    expect(h.posted).toContainEqual({
      type: 'voice_text',
      text: 'if the window grows past twenty seconds, it closes in a pause.'
    });
  });

  it('keeps the capital letter after the end of a sentence and in a name', async () => {
    const h = harness();
    h.reply('The first sentence.', 'Second one', );
    await h.controller.start();
    h.record(22);
    await h.tick();
    h.record(25);
    await h.controller.stop();
    expect(h.posted).toContainEqual({ type: 'voice_text', text: 'The first sentence. Second one' });
  });

  it('writes the words of the vocabulary in their own letters', async () => {
    const h = harness({
      config: () => ({ ffmpeg: 'ffmpeg', microphone: '', language: 'ru', vocabulary: ['PreSonus'], baseUrl: 'x' })
    });
    h.reply('это прессонус');
    await h.controller.start();
    h.record(2);
    await h.controller.stop();
    expect(h.posted).toContainEqual({ type: 'voice_text', text: 'это PreSonus' });
  });

  it('a cancel during the request of a long window leaves the field empty', async () => {
    const posted: ExtToWeb[] = [];
    const pcm = silence(22);
    let step: (() => void) | undefined;
    let release: (() => void) | undefined;
    const controller = new VoiceController({
      post: (message) => posted.push(message),
      getApiKey: async () => 'key',
      config: () => ({
        ffmpeg: 'ffmpeg',
        microphone: '',
        language: 'ru',
        baseUrl: 'https://api.minimax.io/anthropic'
      }),
      every: (_ms, fn) => {
        step = fn;
        return () => {
          step = undefined;
        };
      },
      createRecorder: () => ({
        start: async () => undefined,
        snapshot: () => pcm,
        stop: async () => pcm,
        cancel: () => undefined
      }),
      createClient: () => ({
        transcribe: () =>
          new Promise<string>((resolve) => {
            release = () => resolve('the first window');
          })
      })
    });
    await controller.start();
    // The long window asks for its text, the answer hangs in the air.
    step?.();
    // The reader cancels the input, the answer comes back after it.
    controller.cancel();
    release?.();
    await controller.idle();
    // The cancel cleared the field, the late answer did not write into it.
    expect(posted).toContainEqual({ type: 'voice_text', text: '' });
    expect(posted.filter((message) => message.type === 'voice_partial')).toHaveLength(0);
    expect(posted.at(-1)).toEqual({ type: 'voice_state', state: 'idle' });
  });

  it('stops the timer when the recording ends', async () => {
    const h = harness();
    await h.controller.start();
    expect(h.ticking()).toBe(true);
    h.record(2);
    await h.controller.stop();
    expect(h.ticking()).toBe(false);
  });

  it('asks for the key before it opens the microphone', async () => {
    let opened = false;
    const h = harness({
      getApiKey: async () => undefined,
      createRecorder: () => {
        opened = true;
        throw new Error('must not record');
      }
    });
    await h.controller.start();
    expect(opened).toBe(false);
    expect(h.posted[0]).toMatchObject({ type: 'notice', kind: 'error' });
    expect(h.posted.at(-1)).toEqual({ type: 'voice_state', state: 'idle' });
  });

  it('tells the reason when the microphone fails and returns to idle', async () => {
    const h = harness({
      createRecorder: () => ({
        start: async () => {
          throw new Error('No microphone was found.');
        },
        snapshot: () => new Uint8Array(),
        stop: async () => new Uint8Array(),
        cancel: () => undefined
      })
    });
    await h.controller.start();
    expect(h.posted).toContainEqual({ type: 'notice', kind: 'error', message: 'No microphone was found.' });
    expect(h.posted.at(-1)).toEqual({ type: 'voice_state', state: 'idle' });
  });

  it('ends with an empty text when nothing was heard', async () => {
    const h = harness();
    h.reply('');
    await h.controller.start();
    h.record(2);
    await h.controller.stop();
    // The final message clears the live text in the field.
    expect(h.posted).toContainEqual({ type: 'voice_text', text: '' });
    expect(h.posted.at(-1)).toEqual({ type: 'voice_state', state: 'idle' });
  });

  it('cancels a recording without sending it', async () => {
    const h = harness();
    await h.controller.start();
    h.controller.cancel();
    expect(h.wasStopped()).toBe(false);
    expect(h.ticking()).toBe(false);
    expect(h.posted).toContainEqual({ type: 'voice_text', text: '' });
    expect(h.posted.at(-1)).toEqual({ type: 'voice_state', state: 'idle' });
  });
});
