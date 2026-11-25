import { can, defineMachine, step } from '../fsm/machine';
import type { SpeechClient } from '../api/speech';
import type { ExtToWeb, VoiceState } from '../ui/protocol';
import { BYTES_PER_SECOND, quietestCut, wavFromPcm } from './pcm';
import { applyVocabulary, parseVocabulary, type VocabularyEntry } from './vocabulary';

export interface VoiceRecorder {
  start(): Promise<void>;
  // The raw samples recorded so far, the recording goes on.
  snapshot(): Uint8Array;
  // Ends the recording and returns all of its raw samples.
  stop(): Promise<Uint8Array>;
  cancel(): void;
}

export interface VoiceConfig {
  ffmpeg: string;
  microphone: string;
  // An empty language lets the model pick the dominant one of the audio.
  language: string;
  // Foreign words the recognition writes in the letters of the language.
  vocabulary?: string[];
  baseUrl: string;
}

export interface VoiceDeps {
  post(message: ExtToWeb): void;
  getApiKey(): Promise<string | undefined>;
  config(): VoiceConfig;
  createRecorder(config: VoiceConfig): VoiceRecorder;
  createClient(config: VoiceConfig, apiKey: string): SpeechClient;
  // Runs the callback every few milliseconds, the result stops it.
  every(ms: number, fn: () => void): () => void;
}

// How often the open window goes to the recognition while the reader speaks.
export const TICK_MS = 3000;
// A window shorter than this has too little speech for a stable text.
const MIN_WINDOW = 1 * BYTES_PER_SECOND;
// A window longer than this is closed: the requests stay short and fast.
const MAX_WINDOW = 20 * BYTES_PER_SECOND;
// The cut of a long window is looked for in its last seconds: a smooth
// voice has few pauses, a short range cut a word in two.
const CUT_SEARCH = 5 * BYTES_PER_SECOND;
// The tail after the last cut, shorter than this, is only a breath.
const MIN_TAIL = 0.3 * BYTES_PER_SECOND;

// The voice input of the panel. The recognition of MiniMax takes a whole
// file and has no streaming input, so the stream is made here: every few
// seconds the open window of the recording is transcribed again and the live
// text in the field is replaced. A long window is closed in a pause, its text
// is kept, and a new window starts.
// The states of the voice input and the steps between them. A failure
// from any state ends at idle, the panel shows the reason as a notice.
export type VoiceEvent = 'start' | 'stop' | 'done' | 'cancel' | 'fail';

export const voiceMachine = defineMachine<VoiceState, VoiceEvent>('voice', 'idle', [
  { from: 'idle', on: 'start', to: 'recording' },
  { from: 'recording', on: 'stop', to: 'transcribing' },
  { from: 'transcribing', on: 'done', to: 'idle' },
  { from: ['recording', 'transcribing'], on: 'cancel', to: 'idle' },
  { from: ['idle', 'recording', 'transcribing'], on: 'fail', to: 'idle' }
]);

export class VoiceController {
  private recorder: VoiceRecorder | undefined;
  private state: VoiceState = 'idle';
  private stopTimer: (() => void) | undefined;
  private inFlight: Promise<void> = Promise.resolve();
  private busy = false;
  // The text of the closed windows and where the open window starts.
  private committed: string[] = [];
  private windowStart = 0;
  private client: SpeechClient | undefined;
  private language = '';
  private vocabulary: VocabularyEntry[] = [];

  constructor(private readonly deps: VoiceDeps) {}

  // Resolves when the request that is running now has finished.
  idle(): Promise<void> {
    return this.inFlight;
  }

  async start(): Promise<void> {
    if (!can(voiceMachine, this.state, 'start')) {
      return;
    }
    // The key is checked first: a minute of speech without a key is lost.
    const key = await this.deps.getApiKey();
    if (!key) {
      this.fail('No API key yet. Paste your MiniMax key in the settings to use the voice input.');
      return;
    }
    const config = this.deps.config();
    try {
      const recorder = this.deps.createRecorder(config);
      await recorder.start();
      this.recorder = recorder;
      this.client = this.deps.createClient(config, key);
      this.language = config.language;
      this.vocabulary = parseVocabulary(config.vocabulary ?? []);
      this.committed = [];
      this.windowStart = 0;
      this.fire('start');
      this.stopTimer = this.deps.every(TICK_MS, () => this.tick());
    } catch (error) {
      this.recorder = undefined;
      this.fail(messageOf(error));
    }
  }

  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || !can(voiceMachine, this.state, 'stop')) {
      return;
    }
    this.stopTimer?.();
    this.stopTimer = undefined;
    this.recorder = undefined;
    this.fire('stop');
    try {
      // The live request that runs now ends first, the final one follows.
      await this.inFlight;
      const pcm = await recorder.stop();
      if (pcm.length - this.windowStart >= MIN_TAIL) {
        const tail = await this.transcribe(pcm.subarray(this.windowStart));
        this.committed.push(tail);
      }
      // The final text replaces the live one, an empty text clears it.
      this.deps.post({ type: 'voice_text', text: this.text() });
      this.fire('done');
    } catch (error) {
      this.deps.post({ type: 'voice_text', text: this.text() });
      this.fail(messageOf(error));
    }
  }

  cancel(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
    const running = can(voiceMachine, this.state, 'cancel');
    this.recorder?.cancel();
    this.recorder = undefined;
    this.committed = [];
    if (running) {
      this.deps.post({ type: 'voice_text', text: '' });
      this.fire('cancel');
    }
  }

  // One step of the live text. A step never overlaps the previous one: a slow
  // answer makes the next step wait, the requests do not pile up.
  private tick(): void {
    const recorder = this.recorder;
    if (this.busy || !recorder) {
      return;
    }
    const pcm = recorder.snapshot();
    const size = pcm.length - this.windowStart;
    if (size < MIN_WINDOW) {
      return;
    }
    this.busy = true;
    this.inFlight = (async () => {
      try {
        if (size > MAX_WINDOW) {
          const end = pcm.length;
          const cut = quietestCut(pcm, end - CUT_SEARCH, end);
          const text = await this.transcribe(pcm.subarray(this.windowStart, cut));
          // The recording can be gone while the request ran: a cancelled
          // input must not come back as a live text over the empty field.
          if (this.recorder) {
            this.committed.push(text);
            this.windowStart = cut;
            this.postPartial(this.text());
          }
          return;
        }
        const text = await this.transcribe(pcm.subarray(this.windowStart));
        if (this.recorder) {
          this.postPartial(join([...this.committed, text]));
        }
      } catch {
        // A failed live step is skipped, the final request tells the error.
      } finally {
        this.busy = false;
      }
    })();
  }

  private transcribe(pcm: Uint8Array): Promise<string> {
    if (!this.client) {
      return Promise.resolve('');
    }
    return this.client
      .transcribe(wavFromPcm(pcm), { language: this.language })
      .then((text) => applyVocabulary(text, this.vocabulary));
  }

  private text(): string {
    return join(this.committed);
  }

  private postPartial(text: string): void {
    this.deps.post({ type: 'voice_partial', text });
  }

  // One step of the machine of the voice, the panel learns the new state.
  // A step the table does not know leaves the state as it is.
  private fire(event: VoiceEvent): void {
    const result = step(voiceMachine, this.state, event);
    if (result.ok) {
      this.state = result.state;
      this.deps.post({ type: 'voice_state', state: result.state });
    }
  }

  private fail(message: string): void {
    this.deps.post({ type: 'notice', kind: 'error', message });
    this.fire('fail');
  }
}

// The recognition starts every window with a capital letter. Inside a
// sentence that capital is wrong: after a comma the next window goes on in
// lower case. A word in capitals (an abbreviation) keeps its case.
function join(parts: string[]): string {
  let out = '';
  for (const raw of parts) {
    const part = raw.trim();
    if (part.length === 0) {
      continue;
    }
    if (out.length === 0) {
      out = part;
      continue;
    }
    const insideSentence = !/[.!?…]["»)]*$/.test(out);
    const next =
      insideSentence && /^\p{Lu}\p{Ll}/u.test(part) ? part[0]!.toLowerCase() + part.slice(1) : part;
    out += ' ' + next;
  }
  return out;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
