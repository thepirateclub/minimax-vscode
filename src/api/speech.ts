import { mapHttpError, MiniMaxApiError } from './errors';

// The public model of the speech recognition of MiniMax.
export const DEFAULT_SPEECH_MODEL = 'asr-1.0';

// The messages endpoint lives under /anthropic, the speech api at the root.
export function speechToTextUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/anthropic$/, '');
  return root + '/v1/speech_to_text';
}

// The particles of Russian that are written with a hyphen: какой-то,
// кто-нибудь, всё-таки. Before any other word the hyphen is a space.
const HYPHEN_PARTICLES = /^(то|либо|нибудь|таки|ка|де|тка)(?![а-яё])/i;

// The joint of two words comes with a markup after the hyphen, and the
// markup changes from answer to answer: "какую-${ }$то", "что-"+то". Any run
// of symbols between a hyphen and the next word is a joint. A space inside
// the run counts only when another symbol follows it, so a spaced dash
// ("того - сказал") and a plain hyphen ("кое-как") stay as they are.
const JOINT = /-(?:[^\p{L}\p{N}\s]|\s(?=[^\p{L}\p{N}\s]))+\s*(?=\p{L})/gu;

// The text of the field needs plain spaces and the hyphens of Russian.
export function normalizeTranscript(raw: string): string {
  let text = raw.replace(JOINT, (joint: string, offset: number, whole: string) =>
    HYPHEN_PARTICLES.test(whole.slice(offset + joint.length)) ? '-' : ' '
  );
  // Any other latex space between the dollars: ${ }$, ${}$, $\,$, $~$.
  text = text.replace(/\$\{?\s*(?:\\[,;: ]|~)?\s*\}?\$/g, ' ');
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

interface TranscriptBody {
  text?: unknown;
}

export function parseTranscript(payload: unknown): string {
  const text = ((payload ?? {}) as TranscriptBody).text;
  if (typeof text !== 'string') {
    throw new MiniMaxApiError('MiniMax returned no transcript.', 200, undefined, true);
  }
  return normalizeTranscript(text);
}

export interface SpeechClient {
  // An empty language lets the model pick the dominant one of the audio.
  transcribe(audio: Uint8Array, options: { language: string }): Promise<string>;
}

export class HttpSpeechClient implements SpeechClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.url = speechToTextUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async transcribe(audio: Uint8Array, options: { language: string }): Promise<string> {
    const form = new FormData();
    form.append('model', DEFAULT_SPEECH_MODEL);
    // The copy keeps the bytes in a plain ArrayBuffer, a Blob refuses a
    // view of a shared one.
    form.append('file', new Blob([audio.slice()], { type: 'audio/wav' }), 'speech.wav');
    const headers: Record<string, string> = { Authorization: 'Bearer ' + this.apiKey };
    // The language is a header of the request, not a field of the form.
    if (options.language.length > 0) {
      headers['language'] = options.language;
    }
    const response = await this.fetchImpl(this.url, { method: 'POST', headers, body: form });
    if (!response.ok) {
      throw await mapHttpError(response);
    }
    return parseTranscript(await response.json());
  }
}
