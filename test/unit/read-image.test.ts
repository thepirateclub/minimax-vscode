import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { imageInfo } from '../../src/tools/image/info';
import { cropImage, decodePng, encodePng, scaleImage, type RgbaImage } from '../../src/tools/image/png';
import { createReadImageTool, prepareImage, readCrop } from '../../src/tools/image/readImage';
import type { ToolContext } from '../../src/tools/types';

// The model cropped and enlarged a screenshot in the Python REPL and saved
// it to a file to look at it: read_image does it in memory.
function gradient(width: number, height: number): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([x, y, 7, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe('the PNG without a library', () => {
  it('writes and reads back the same pixels', () => {
    const image = gradient(20, 10);
    const back = decodePng(encodePng(image));
    expect(back.width).toBe(20);
    expect(back.height).toBe(10);
    expect(back.data.equals(image.data)).toBe(true);
  });

  it('reads an RGB image with the filters of a real encoder', () => {
    // Filter 1 (sub) on the first row, filter 2 (up) on the second.
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 2;
    const raw = Buffer.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1]);
    const chunk = (type: string, body: Buffer): Buffer => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ]);
    const image = decodePng(png);
    expect([...image.data.subarray(0, 8)]).toEqual([10, 20, 30, 255, 15, 25, 35, 255]);
    expect([...image.data.subarray(8, 12)]).toEqual([11, 21, 31, 255]);
  });

  it('crops a region and clamps it to the edges', () => {
    const part = cropImage(gradient(20, 10), 5, 2, 4, 3);
    expect(part.width).toBe(4);
    expect([...part.data.subarray(0, 4)]).toEqual([5, 2, 7, 255]);
    expect(cropImage(gradient(20, 10), 18, 8, 100, 100).width).toBe(2);
  });

  it('enlarges the crop', () => {
    const big = scaleImage(gradient(4, 2), 3);
    expect([big.width, big.height]).toEqual([12, 6]);
  });
});

describe('read_image', () => {
  it('reads the size of PNG and JPEG from the header', () => {
    expect(imageInfo(encodePng(gradient(30, 12)))).toEqual({ format: 'png', width: 30, height: 12 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 40, 0, 64, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageInfo(jpeg)).toEqual({ format: 'jpeg', width: 64, height: 40 });
  });

  it('names the crop and the scale, and refuses a crop of a JPEG', async () => {
    const prepared = await prepareImage(encodePng(gradient(30, 12)), { x: 2, y: 3, width: 10, height: 5 }, 3);
    expect(prepared.line).toBe('PNG, 30x12 px, the crop 10x5 px at 2,3, shown at 3x (30x15 px)');
    expect(prepared.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 40, 0, 64, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(prepareImage(jpeg, { x: 0, y: 0, width: 5, height: 5 })).rejects.toThrow('PNG images only');
    expect(readCrop({ x: 1, y: 2, width: 0, height: 3 })).toBeUndefined();
  });

  it('gives the size without the vision model and without a key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-img-'));
    await writeFile(join(root, 'shot.png'), encodePng(gradient(30, 12)));
    const tool = createReadImageTool(async () => undefined);
    const ctx = { workspaceRoot: root } as unknown as ToolContext;
    expect((await tool.execute({ path: 'shot.png', info_only: true }, ctx)).content).toMatch(/^shot\.png: PNG, 30x12 px, [\d.]+ KB$/);
    expect((await tool.execute({ path: 'shot.png' }, ctx)).content).toContain('No API key');
    expect((await tool.execute({ path: '../x.png' }, ctx)).isError).toBe(true);
  });
});
