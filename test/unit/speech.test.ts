import { describe, expect, it } from 'vitest';
import {
  HttpSpeechClient,
  normalizeTranscript,
  parseTranscript,
  speechToTextUrl
} from '../../src/api/speech';
import { MiniMaxApiError } from '../../src/api/errors';

describe('speech to text of MiniMax', () => {
  it('lives at the root of the api, not under /anthropic', () => {
    expect(speechToTextUrl('https://api.minimax.io/anthropic')).toBe(
      'https://api.minimax.io/v1/speech_to_text'
    );
    expect(speechToTextUrl('https://api.minimaxi.com/anthropic/')).toBe(
      'https://api.minimaxi.com/v1/speech_to_text'
    );
  });

  it('reads the text of the answer and trims it', () => {
    expect(parseTranscript({ text: '  rename the function ', duration: 2.1 })).toBe(
      'rename the function'
    );
  });

  it('fails on an answer without text', () => {
    expect(() => parseTranscript({ duration: 1 })).toThrow(MiniMaxApiError);
  });

  it('sends the audio as a form with the model and the language header', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new HttpSpeechClient({
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: 'k',
      fetchImpl: fakeFetch
    });
    const text = await client.transcribe(new Uint8Array([1, 2, 3]), { language: 'ru' });
    expect(text).toBe('hello');
    expect(seen?.url).toBe('https://api.minimax.io/v1/speech_to_text');
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer k');
    expect(headers['language']).toBe('ru');
    const form = seen?.init.body as FormData;
    expect(form.get('model')).toBe('asr-1.0');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('lets the model pick the language when none is set', async () => {
    let headers: Record<string, string> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ text: 'x' }), { status: 200 });
    }) as unknown as typeof fetch;
    await new HttpSpeechClient({ baseUrl: 'https://api.minimax.io/anthropic', apiKey: 'k', fetchImpl: fakeFetch })
      .transcribe(new Uint8Array([1]), { language: '' });
    expect('language' in headers).toBe(false);
  });
});

describe('the clean text of a transcript', () => {
  it('turns the latex spaces of the model into plain spaces and hyphens', () => {
    const raw =
      'Я бы хотел сказать какую-${ }$то часть, которую-${ }$бы можно было-${ }$бы сюда записать, ' +
      'и она-${ }$сюда попала, и-${ }$соответственно, каким-${ }$то образом все-${ }$это дело, ' +
      'оно-${ }$как-${ }$бы объединилось, эта-${ }$проверка, на-${ }$сколько она-${ }$будет нормальная.';
    expect(normalizeTranscript(raw)).toBe(
      'Я бы хотел сказать какую-то часть, которую бы можно было бы сюда записать, ' +
        'и она сюда попала, и соответственно, каким-то образом все это дело, ' +
        'оно как бы объединилось, эта проверка, на сколько она будет нормальная.'
    );
  });

  it('reads any markup of the joint, not only latex', () => {
    // The server changes the markup: "${ }$" in one answer, '"+' in another.
    const raw =
      'Проверка какая-"+транскрибация, насколько она работает адекватно. ' +
      'Пока что непонятно, но сколько-"+какое-"+то количество времени она что-"+то там делает. ' +
      'Вот, то, что там получается, наверное, что-"+то не получается, но пока-"+это все дела.';
    expect(normalizeTranscript(raw)).toBe(
      'Проверка какая транскрибация, насколько она работает адекватно. ' +
        'Пока что непонятно, но сколько какое-то количество времени она что-то там делает. ' +
        'Вот, то, что там получается, наверное, что-то не получается, но пока это все дела.'
    );
  });

  it('leaves a plain hyphen and a spaced dash alone', () => {
    expect(normalizeTranscript('из-за того - сказал он, кое-как')).toBe(
      'из-за того - сказал он, кое-как'
    );
  });

  it('keeps the hyphen of the particles that need it', () => {
    expect(normalizeTranscript('кто-${ }$нибудь где-${ }$либо всё-${ }$таки дай-${ }$ка')).toBe(
      'кто-нибудь где-либо всё-таки дай-ка'
    );
  });

  it('drops the other latex spaces and the double blanks', () => {
    expect(normalizeTranscript('a${ }$b  c$\\,$d ${}$ e')).toBe('a b c d e');
  });

  it('cleans the text of the answer of the server', () => {
    expect(parseTranscript({ text: 'было-${ }$бы' })).toBe('было бы');
  });
});
