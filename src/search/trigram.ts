// The triples of the text, they catch a word that is cut or misspelled.
export function trigrams(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  const triples: string[] = [];
  for (let i = 0; i + 3 <= normalized.length; i++) {
    triples.push(normalized.slice(i, i + 3));
  }
  return triples;
}

// The share of the triples of the query that the text holds, from zero to one.
export function trigramScore(query: string, text: string): number {
  const wanted = trigrams(query);
  if (wanted.length === 0) {
    return 0;
  }
  const present = new Set(trigrams(text));
  let hits = 0;
  for (const triple of wanted) {
    if (present.has(triple)) {
      hits += 1;
    }
  }
  return hits / wanted.length;
}
