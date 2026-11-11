import { describe, expect, it } from 'vitest';
import { applyVocabulary, parseVocabulary } from '../../src/voice/vocabulary';

describe('the vocabulary of the voice input', () => {
  const vocabulary = parseVocabulary(['PreSonus', 'poco', 'ballu', 'радиатор=Revelator']);

  it('writes the foreign words of a Russian phrase in their own letters', () => {
    expect(
      applyVocabulary('И еще пару иностранных слов попробую, это радиатор, прессонус. Поко, баллу.', vocabulary)
    ).toBe('И еще пару иностранных слов попробую, это Revelator, PreSonus. poco, ballu.');
  });

  it('leaves the ordinary words alone', () => {
    expect(applyVocabulary('пока что баллон и покой', vocabulary)).toBe('пока что баллон и покой');
  });

  it('fixes the case of a term heard in Latin letters', () => {
    expect(applyVocabulary('my presonus box', vocabulary)).toBe('my PreSonus box');
  });

  it('reads a pair and a bare term, skips the empty lines', () => {
    expect(parseVocabulary([' ', 'a = B', 'Term'])).toEqual([
      { heard: 'a', term: 'B' },
      { heard: undefined, term: 'Term' }
    ]);
  });

  it('does nothing without a vocabulary', () => {
    expect(applyVocabulary('прессонус', [])).toBe('прессонус');
  });
});
