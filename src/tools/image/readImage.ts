import { readFile, stat } from 'node:fs/promises';
import { understandImage, type CodingPlanOptions } from '../../api/codingPlan';
import { resolveWorkspacePath } from '../../paths';
import type { ToolEntry } from '../types';
import { imageInfo } from './info';
import { cropImage, decodePng, encodePng, isPng, scaleImage } from './png';

// The model reads an image of the project: its size from the header, the
// content through the vision model of the M Plan (the chat model does not
// see images), and a region of it cropped first, so a small detail of a
// screenshot is read instead of lost in the whole picture.

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_PROMPT =
  'Describe this image in detail: the layout, the elements and their positions, the colors, and read out all visible text exactly.';

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function readCrop(value: unknown): CropBox | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const box = ['x', 'y', 'width', 'height'].map((key) => Number(record[key]));
  if (box.some((part) => !Number.isFinite(part)) || box[2]! <= 0 || box[3]! <= 0) {
    return undefined;
  }
  return { x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! };
}

// The image to show and the line about it. A crop works on PNG only, the
// other formats need a decoder the extension does not carry.
export async function prepareImage(
  file: Buffer,
  crop: CropBox | undefined,
  scale = 1
): Promise<{ dataUrl: string; line: string }> {
  const info = imageInfo(file);
  if (!info) {
    throw new Error('the file is not a PNG, JPEG, WebP or GIF image');
  }
  const size = info.width + 'x' + info.height;
  if (!crop && scale === 1) {
    return {
      dataUrl: 'data:image/' + info.format + ';base64,' + file.toString('base64'),
      line: info.format.toUpperCase() + ', ' + size + ' px, ' + (file.length / 1024).toFixed(1) + ' KB'
    };
  }
  if (!isPng(file)) {
    throw new Error('a crop and a scale work on PNG images only, this one is ' + info.format.toUpperCase() + '; read it whole');
  }
  const decoded = decodePng(file);
  const part = crop ? cropImage(decoded, crop.x, crop.y, crop.width, crop.height) : decoded;
  const shown = scale === 1 ? part : scaleImage(part, scale);
  const png = encodePng(shown);
  return {
    dataUrl: 'data:image/png;base64,' + png.toString('base64'),
    line:
      'PNG, ' + size + ' px' +
      (crop ? ', the crop ' + part.width + 'x' + part.height + ' px at ' + Math.max(0, Math.floor(crop.x)) + ',' + Math.max(0, Math.floor(crop.y)) : '') +
      (scale === 1 ? '' : ', shown at ' + scale + 'x (' + shown.width + 'x' + shown.height + ' px)')
  };
}

export function createReadImageTool(
  connection: () => Promise<Omit<CodingPlanOptions, 'signal'> | undefined>
): ToolEntry {
  return {
    name: 'read_image',
    description:
      'Read an image of the workspace: its format and size, and what it shows through the vision model. Give crop to look at a region in pixels (x and y from the top left corner), for example one button or one line of text of a screenshot: a small detail reads better cropped, and scale 2-4 enlarges small text. Never crop or resize an image in the REPL and save it to a file to look at it: this tool does it in memory. Use info_only to get the size without the vision model, to plan a crop. A crop works on PNG, the other formats are read whole.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The image, relative to the workspace root.' },
        prompt: { type: 'string', description: 'What to find or describe. Default: a full description with all the text.' },
        crop: {
          type: 'object',
          description: 'The region to look at, in pixels of the image.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' }
          },
          required: ['x', 'y', 'width', 'height']
        },
        scale: { type: 'number', minimum: 1, maximum: 4, description: 'Enlarge the image or the crop, 1-4, for example 3 for small text.' },
        info_only: { type: 'boolean', description: 'Only the format and the size, no description.' }
      },
      required: ['path']
    },
    async execute(input, ctx) {
      const path = String(input['path'] ?? '').trim().replace(/^@/, '');
      try {
        const full = resolveWorkspacePath(ctx.workspaceRoot, path);
        if ((await stat(full)).size > MAX_IMAGE_BYTES) {
          return { content: 'read_image failed: the image is larger than 10 MB.', isError: true };
        }
        const crop = input['crop'] === undefined ? undefined : readCrop(input['crop']);
        if (input['crop'] !== undefined && !crop) {
          return { content: 'read_image failed: crop needs x, y, width and height, the size above 0.', isError: true };
        }
        const scale = Math.min(4, Math.max(1, Number(input['scale'] ?? 1) || 1));
        const prepared = await prepareImage(await readFile(full), crop, scale);
        const head = path + ': ' + prepared.line;
        if (input['info_only'] === true) {
          return { content: head };
        }
        const options = await connection();
        if (!options) {
          return { content: head + '\nNo API key: the vision model needs the key of the M Plan to describe the image.' };
        }
        const prompt = typeof input['prompt'] === 'string' && input['prompt'].trim() ? input['prompt'].trim() : DEFAULT_PROMPT;
        const answer = await understandImage({ ...options, signal: ctx.signal }, prompt, prepared.dataUrl);
        return { content: head + '\n\n' + answer };
      } catch (error) {
        return { content: 'read_image failed: ' + (error instanceof Error ? error.message : String(error)), isError: true };
      }
    }
  };
}
