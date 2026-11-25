import { readFile, stat } from 'node:fs/promises';
import { understandImage, webSearch, type CodingPlanOptions } from '../api/codingPlan';
import { resolveWorkspacePath } from '../paths';
import type { ToolEntry } from './types';

export interface WebToolOptions {
  // The address and the key of the M Plan, absent without a key.
  connection: () => Promise<Omit<CodingPlanOptions, 'signal'> | undefined>;
  // The search sends the query to MiniMax, the user turns it on.
  webSearchEnabled: () => boolean;
}

const IMAGE_TYPES: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// The image as the vlm endpoint takes it: a data URL. A file of the
// workspace is read here, a https address is passed on as it is.
export async function imageSource(workspaceRoot: string, source: string): Promise<string> {
  const value = source.trim().replace(/^@/, '');
  if (/^https:\/\//i.test(value) || value.startsWith('data:image/')) {
    return value;
  }
  const path = resolveWorkspacePath(workspaceRoot, value);
  const extension = value.split('.').pop()?.toLowerCase() ?? '';
  const type = IMAGE_TYPES[extension];
  if (!type) {
    throw new Error('Only PNG, JPEG and WebP images can be read.');
  }
  if ((await stat(path)).size > MAX_IMAGE_BYTES) {
    throw new Error('The image is larger than 10 MB.');
  }
  return 'data:image/' + type + ';base64,' + (await readFile(path)).toString('base64');
}

function failure(error: unknown): { content: string; isError: true } {
  return { content: error instanceof Error ? error.message : String(error), isError: true };
}

export function createWebTools(options: WebToolOptions): ToolEntry[] {
  const search: ToolEntry = {
    name: 'web_search',
    description:
      'Search the web with MiniMax: the titles, the links and the snippets of the results. Use it for the documentation of a library, an error message or anything newer than your knowledge.',
    approval: 'never',
    sideEffect: false,
    available: options.webSearchEnabled,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The query, 3 to 8 words work best.' } },
      required: ['query']
    },
    async execute(input, ctx) {
      const query = String(input['query'] ?? '').trim();
      if (!query) {
        return { content: 'The query is empty.', isError: true };
      }
      const connection = await options.connection();
      if (!connection) {
        return { content: 'No API key, the search needs the key of the M Plan.', isError: true };
      }
      try {
        return { content: await webSearch({ ...connection, signal: ctx.signal }, query) };
      } catch (error) {
        return failure(error);
      }
    }
  };
  const image: ToolEntry = {
    name: 'understand_image',
    description:
      'Look at an image with the vision model of MiniMax and answer the prompt about it: a screenshot of a bug, a design, a diagram. The image is a PNG, JPEG or WebP file of the workspace or a https address.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to find or describe in the image.' },
        image: { type: 'string', description: 'The path of the image in the workspace or a https address.' }
      },
      required: ['prompt', 'image']
    },
    async execute(input, ctx) {
      const connection = await options.connection();
      if (!connection) {
        return { content: 'No API key, the vision model needs the key of the M Plan.', isError: true };
      }
      try {
        const url = await imageSource(ctx.workspaceRoot, String(input['image'] ?? ''));
        const prompt = String(input['prompt'] ?? '');
        return { content: await understandImage({ ...connection, signal: ctx.signal }, prompt, url) };
      } catch (error) {
        return failure(error);
      }
    }
  };
  return [search, image];
}
