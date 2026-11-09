import { tokenize } from './tokenize';

// The two constants of the BM25 ranking.
const K1 = 1.2;
const B = 0.75;

interface DocumentEntry {
  path: string;
  // The ids of the tokens of the document, sorted, the counts keep the same
  // order. The pairs live in typed arrays, a big project keeps them small.
  ids: Int32Array;
  counts: Int32Array;
  length: number;
}

export interface RankedDocument {
  path: string;
  score: number;
}

// The lexical index of the project. It ranks the files by the BM25 score and
// keeps the tokens of every file, the content is read again only for the
// files that made it into the result.
export class LexicalIndex {
  private readonly documents = new Map<string, DocumentEntry>();
  // The dictionary of the tokens, a token gets a number once.
  private readonly vocabulary = new Map<string, number>();
  // How many documents hold the token.
  private readonly frequency = new Map<number, number>();
  private totalLength = 0;

  get size(): number {
    return this.documents.size;
  }

  has(path: string): boolean {
    return this.documents.has(path);
  }

  // The index is emptied, the next build starts from the scratch.
  clear(): void {
    this.documents.clear();
    this.vocabulary.clear();
    this.frequency.clear();
    this.totalLength = 0;
  }

  addDocument(path: string, content: string): void {
    this.removeDocument(path);
    const tokens = tokenize(content);
    const counts = new Map<number, number>();
    for (const token of tokens) {
      const id = this.idOf(token);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const pairs = [...counts.entries()].sort((left, right) => left[0] - right[0]);
    const entry: DocumentEntry = {
      path,
      ids: Int32Array.from(pairs.map(([id]) => id)),
      counts: Int32Array.from(pairs.map(([, count]) => count)),
      length: tokens.length
    };
    this.documents.set(path, entry);
    this.totalLength += entry.length;
    for (const id of entry.ids) {
      this.frequency.set(id, (this.frequency.get(id) ?? 0) + 1);
    }
  }

  removeDocument(path: string): void {
    const entry = this.documents.get(path);
    if (!entry) {
      return;
    }
    this.documents.delete(path);
    this.totalLength -= entry.length;
    for (const id of entry.ids) {
      const value = (this.frequency.get(id) ?? 1) - 1;
      if (value <= 0) {
        this.frequency.delete(id);
      } else {
        this.frequency.set(id, value);
      }
    }
  }

  // The files that hold the words of the query, the best one first.
  rank(query: string, limit = 50, prefix = ''): RankedDocument[] {
    const terms = [...new Set(tokenize(query))]
      .map((token) => this.vocabulary.get(token))
      .filter((id): id is number => id !== undefined);
    if (terms.length === 0 || this.documents.size === 0) {
      return [];
    }
    const average = this.totalLength / this.documents.size;
    const ranked: RankedDocument[] = [];
    for (const entry of this.documents.values()) {
      if (prefix.length > 0 && !entry.path.startsWith(prefix)) {
        continue;
      }
      let score = 0;
      for (const term of terms) {
        const count = this.countOf(entry, term);
        if (count === 0) {
          continue;
        }
        const documents = this.frequency.get(term) ?? 1;
        const rarity = Math.log(
          1 + (this.documents.size - documents + 0.5) / (documents + 0.5)
        );
        const norm = K1 * (1 - B + (B * entry.length) / average);
        score += rarity * ((count * (K1 + 1)) / (count + norm));
      }
      if (score > 0) {
        ranked.push({ path: entry.path, score });
      }
    }
    ranked.sort((left, right) => right.score - left.score);
    return ranked.slice(0, limit);
  }

  private idOf(token: string): number {
    const existing = this.vocabulary.get(token);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.vocabulary.size;
    this.vocabulary.set(token, id);
    return id;
  }

  private countOf(entry: DocumentEntry, id: number): number {
    let low = 0;
    let high = entry.ids.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const value = entry.ids[middle]!;
      if (value === id) {
        return entry.counts[middle]!;
      }
      if (value < id) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return 0;
  }
}
