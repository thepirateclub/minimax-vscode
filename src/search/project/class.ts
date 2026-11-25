import { join } from 'node:path';
import { collectTextFiles, isIgnoredName, isTextFile, toRelative } from '../files';
import { LexicalIndex } from '../lexical';
import { chunkContent, cosineSimilarity, fuseRankings, type Passage } from '../semantic';
import { trigramScore } from '../trigram';
import { buildRepoMap, isMapFile } from '../repoMap';
import { bestLinesOf } from './lines';
import {
  delay,
  EMBED_BATCH,
  EMBED_DELAY_MS,
  FUZZY_FILE_BUDGET,
  FUZZY_MIN_SCORE,
  MAX_CANDIDATE_FILES,
  READ_BATCH,
  readIfSmall,
  SEMANTIC_MAX_CHUNKS,
  signatureOf,
  SNIPPET_LIMIT,
  type SearchHit,
  type SearchMode,
  type SearchOutcome,
  type SemanticProvider,
  type VectorEntry
} from './protocol';

// The index of the project. The lexical part always works and works offline,
// the semantic part is optional and sends the code to the server.
export class ProjectSearch {
  private readonly root: string;
  private readonly index = new LexicalIndex();
  // The relative path of the file and the absolute one.
  private readonly files = new Map<string, string>();
  private readonly vectors = new Map<string, VectorEntry>();
  // The text of the code files, the map of the project reads it.
  private readonly sources = new Map<string, string>();
  private provider: SemanticProvider | undefined;
  private building: Promise<void> | undefined;
  private built = false;
  private semanticBuilding: Promise<void> | undefined;
  private semanticReady = false;

  constructor(root: string) {
    this.root = root;
  }

  setSemanticProvider(provider: SemanticProvider | undefined): void {
    this.provider = provider;
    this.semanticReady = false;
  }

  get semanticAvailable(): boolean {
    return this.provider !== undefined;
  }

  get fileCount(): number {
    return this.files.size;
  }

  // The index is built once, the files that change are added one by one.
  async ensureIndex(): Promise<void> {
    if (this.built) {
      return;
    }
    if (!this.building) {
      this.building = this.build().finally(() => {
        this.building = undefined;
      });
    }
    await this.building;
  }

  // The file changed on the disk, the index takes the new content.
  invalidate(path: string): void {
    if (!this.built) {
      return;
    }
    const name = path.split('/').pop() ?? '';
    if (isIgnoredName(name)) {
      return;
    }
    const absolute = join(this.root, path);
    const relative = toRelative(this.root, absolute);
    this.index.removeDocument(relative);
    this.files.delete(relative);
    this.vectors.delete(relative);
    this.sources.delete(relative);
    if (!isTextFile(path)) {
      return;
    }
    void this.addFile(absolute, relative);
  }

  // The index is built again from the files of the disk.
  async rebuild(): Promise<void> {
    if (this.building) {
      await this.building;
    }
    this.built = false;
    this.index.clear();
    this.files.clear();
    this.vectors.clear();
    this.sources.clear();
    await this.ensureIndex();
  }

  // The files and the names they declare, for the system prompt.
  async repoMap(): Promise<string> {
    await this.ensureIndex();
    return buildRepoMap(this.sources);
  }

  async search(
    query: string,
    options: { limit?: number; mode?: SearchMode; path?: string } = {}
  ): Promise<SearchOutcome> {
    const limit = Math.max(1, Math.min(200, options.limit ?? 30));
    const requested = options.mode ?? 'auto';
    const prefix = this.prefixOf(options.path);
    await this.ensureIndex();

    const wantsSemantic = requested === 'semantic' || requested === 'hybrid';
    const semanticAllowed = this.provider !== undefined;
    let note: string | undefined;

    const lexical = requested === 'semantic' ? [] : this.index.rank(query, MAX_CANDIDATE_FILES, prefix);
    let semantic: SearchHit[] = [];
    if (wantsSemantic || (requested === 'auto' && semanticAllowed)) {
      if (semanticAllowed) {
        try {
          semantic = await this.semanticHits(query, MAX_CANDIDATE_FILES);
        } catch (error) {
          note =
            'the semantic layer failed: ' +
            (error instanceof Error ? error.message : String(error));
        }
      } else {
        note = 'the semantic layer is off, the lexical index was used';
      }
    }

    if (requested === 'semantic' && semantic.length > 0) {
      return { hits: semantic.slice(0, limit), mode: 'semantic', files: this.files.size, note };
    }

    const semanticByPath = new Map(semantic.map((hit) => [hit.path, hit]));
    let order = lexical.map((item) => item.path);
    if (semantic.length > 0) {
      for (const hit of semantic) {
        if (!order.includes(hit.path)) {
          order.push(hit.path);
        }
      }
      if (requested === 'hybrid' || requested === 'auto') {
        order = fuseRankings([
          lexical.map((item) => item.path),
          semantic.map((hit) => hit.path)
        ]);
      }
    }

    const hits: SearchHit[] = [];
    for (const path of order) {
      if (hits.length >= limit) {
        break;
      }
      const known = semanticByPath.get(path);
      if (known) {
        hits.push(known);
        continue;
      }
      const absolute = this.files.get(path);
      if (!absolute) {
        continue;
      }
      const lines = await this.bestLines(absolute, query);
      for (const item of lines) {
        hits.push({ path, line: item.line, score: 0, snippet: item.snippet });
        if (hits.length >= limit) {
          break;
        }
      }
    }

    if (hits.length === 0 && requested !== 'semantic') {
      const fuzzy = await this.fuzzySearch(query, limit, prefix);
      if (fuzzy.length > 0) {
        return {
          hits: fuzzy,
          mode: 'lexical',
          files: this.files.size,
          note: note ?? 'the exact words were not found, the fuzzy match was used'
        };
      }
    }

    const mode: 'lexical' | 'semantic' | 'hybrid' =
      requested === 'semantic'
        ? 'semantic'
        : semantic.length > 0
          ? 'hybrid'
          : 'lexical';
    return { hits, mode, files: this.files.size, note };
  }

  private async build(): Promise<void> {
    const paths = await collectTextFiles(this.root);
    for (let i = 0; i < paths.length; i += READ_BATCH) {
      const batch = paths.slice(i, i + READ_BATCH);
      await Promise.all(
        batch.map(async (absolute) => {
          const relative = toRelative(this.root, absolute);
          await this.addFile(absolute, relative);
        })
      );
    }
    this.built = true;
  }

  private async addFile(absolute: string, relative: string): Promise<void> {
    const content = await readIfSmall(absolute);
    if (content === undefined) {
      this.index.removeDocument(relative);
      this.files.delete(relative);
      this.sources.delete(relative);
      return;
    }
    this.files.set(relative, absolute);
    if (isMapFile(relative)) {
      this.sources.set(relative, content);
    }
    this.index.addDocument(relative, content);
  }

  // The lines of the file that hold the words of the query, the best ones
  // first.
  private async bestLines(
    absolute: string,
    query: string
  ): Promise<Array<{ line: number; snippet: string }>> {
    const content = await readIfSmall(absolute);
    if (content === undefined) {
      return [];
    }
    return bestLinesOf(content, query);
  }

  // The query has no word of the index, the triples of the text catch a word
  // that is cut or misspelled.
  private async fuzzySearch(
    query: string,
    limit: number,
    prefix: string
  ): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    const entries = [...this.files.entries()].filter(([path]) =>
      prefix.length === 0 ? true : path.startsWith(prefix)
    );
    for (const [path, absolute] of entries.slice(0, FUZZY_FILE_BUDGET)) {
      const content = await readIfSmall(absolute);
      if (content === undefined) {
        continue;
      }
      const score = trigramScore(query, content);
      if (score < FUZZY_MIN_SCORE) {
        continue;
      }
      const lines = await this.bestLines(absolute, query);
      hits.push({
        path,
        line: lines[0]?.line ?? 1,
        score,
        snippet: lines[0]?.snippet ?? ''
      });
      if (hits.length >= limit) {
        break;
      }
    }
    return hits.sort((left, right) => right.score - left.score);
  }

  private async semanticHits(query: string, limit: number): Promise<SearchHit[]> {
    const provider = this.provider;
    if (!provider) {
      return [];
    }
    await this.ensureSemantic();
    const [vector] = await provider.embed([query], 'query');
    if (!vector || vector.length === 0) {
      return [];
    }
    const hits: SearchHit[] = [];
    for (const entry of this.vectors.values()) {
      entry.vectors.forEach((candidate, index) => {
        const similarity = cosineSimilarity(vector, candidate);
        if (similarity <= 0.25) {
          return;
        }
        hits.push({
          path: entry.path,
          line: entry.lines[index] ?? 1,
          score: similarity,
          snippet: entry.texts[index] ?? ''
        });
      });
    }
    hits.sort((left, right) => right.score - left.score);
    return hits.slice(0, limit);
  }

  private async ensureSemantic(): Promise<void> {
    if (!this.provider || this.semanticReady) {
      return;
    }
    if (!this.semanticBuilding) {
      this.semanticBuilding = this.buildSemantic().finally(() => {
        this.semanticBuilding = undefined;
      });
    }
    await this.semanticBuilding;
  }

  // The passages of the files become vectors. The vectors of the files that
  // did not change are kept, the server is asked only about the new ones.
  private async buildSemantic(): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      return;
    }
    const pending: Array<{ path: string; signature: string; passages: Passage[] }> = [];
    let chunks = 0;
    for (const [path, absolute] of this.files) {
      const content = await readIfSmall(absolute);
      if (content === undefined) {
        continue;
      }
      const signature = signatureOf(content);
      const cached = this.vectors.get(path);
      if (cached && cached.signature === signature) {
        chunks += cached.vectors.length;
        if (chunks >= SEMANTIC_MAX_CHUNKS) {
          break;
        }
        continue;
      }
      const passages = chunkContent(path, content);
      if (passages.length === 0) {
        continue;
      }
      pending.push({ path, signature, passages });
      chunks += passages.length;
      if (chunks >= SEMANTIC_MAX_CHUNKS) {
        break;
      }
    }

    for (const item of pending) {
      const vectors: number[][] = [];
      for (let i = 0; i < item.passages.length; i += EMBED_BATCH) {
        const batch = item.passages.slice(i, i + EMBED_BATCH).map((passage) => passage.text);
        const result = await provider.embed(batch, 'db');
        vectors.push(...result);
        if (i + EMBED_BATCH < item.passages.length) {
          await delay(EMBED_DELAY_MS);
        }
      }
      if (vectors.length > 0) {
        this.vectors.set(item.path, {
          path: item.path,
          signature: item.signature,
          vectors,
          lines: item.passages.map((passage) => passage.line),
          texts: item.passages.map((passage) => passage.text.slice(0, SNIPPET_LIMIT))
        });
      }
    }
    this.semanticReady = true;
  }

  private prefixOf(sub: string | undefined): string {
    if (!sub || sub.trim().length === 0 || sub === '.') {
      return '';
    }
    const normalized = sub.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return normalized.length === 0 ? '' : normalized + '/';
  }
}
