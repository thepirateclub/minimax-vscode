// The recognition has no hint of words, and in a Russian phrase it writes
// the foreign names in Cyrillic: "прессонус" for PreSonus. The vocabulary of
// the reader fixes them after the recognition: a bare term is matched by its
// sound, a pair "heard=term" replaces the heard word exactly.
export interface VocabularyEntry {
  heard: string | undefined;
  term: string;
}

export function parseVocabulary(lines: readonly string[]): VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  for (const line of lines) {
    const eq = line.indexOf('=');
    const heard = eq >= 0 ? line.slice(0, eq).trim() : undefined;
    const term = (eq >= 0 ? line.slice(eq + 1) : line).trim();
    if (term.length > 0 && heard !== '') {
      out.push({ heard, term });
    }
  }
  return out;
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'ia'
};

// A coarse key of the sound: both alphabets meet in the same letters, the
// double letters collapse.
function soundKey(word: string): string {
  const lower = word.toLowerCase();
  let latin = '';
  for (const ch of lower) {
    latin += CYRILLIC[ch] ?? ch;
  }
  latin = latin
    .replace(/ph/g, 'f')
    .replace(/ck|q|c(?=[aou]|$)/g, 'k')
    .replace(/c/g, 's')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/[^a-z0-9]/g, '');
  return latin.replace(/(.)\1+/g, '$1');
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

export function applyVocabulary(text: string, vocabulary: readonly VocabularyEntry[]): string {
  if (vocabulary.length === 0) {
    return text;
  }
  const exact = new Map<string, string>();
  const sounds: { key: string; term: string }[] = [];
  for (const entry of vocabulary) {
    if (entry.heard) {
      exact.set(entry.heard.toLowerCase(), entry.term);
    } else {
      sounds.push({ key: soundKey(entry.term), term: entry.term });
    }
  }
  return text.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const pinned = exact.get(word.toLowerCase());
    if (pinned) {
      return pinned;
    }
    const key = soundKey(word);
    if (key.length < 3) {
      return word;
    }
    // A short word must sound the same: "покой" is not poco. A long one may
    // differ by a letter, the recognition hears the vowels loosely.
    const allowed = key.length >= 7 ? 1 : 0;
    for (const sound of sounds) {
      if (distance(key, sound.key) <= allowed) {
        return sound.term;
      }
    }
    return word;
  });
}
