import { deflateSync, inflateSync } from 'node:zlib';

// A PNG without a library: the crop of a screenshot needs the pixels, and
// the extension has no image dependency. The decoder reads the common PNG of
// a screenshot and of a game asset: 8 and 16 bits, gray, RGB, palette, gray
// with alpha, RGBA, no interlace. The encoder writes RGBA 8 bit.

export interface RgbaImage {
  width: number;
  height: number;
  // Four bytes per pixel, row by row.
  data: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function isPng(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(0, 8).equals(SIGNATURE);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buffer: Buffer): RgbaImage {
  if (!isPng(buffer)) {
    throw new Error('not a PNG file');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer = Buffer.alloc(0);
  let alpha: Buffer = Buffer.alloc(0);
  const chunks: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      alpha = body;
    } else if (type === 'IDAT') {
      chunks.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = CHANNELS[colorType];
  if (!channels || (depth !== 8 && depth !== 16) || interlace !== 0) {
    throw new Error('this PNG cannot be cropped: only 8 or 16 bit images without interlace are supported');
  }
  const bytes = (depth / 8) * channels;
  const stride = width * bytes;
  const raw = inflateSync(Buffer.concat(chunks));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x]!;
      const left = x >= bytes ? rows[target + x - bytes]! : 0;
      const up = y > 0 ? rows[target - stride + x]! : 0;
      const corner = y > 0 && x >= bytes ? rows[target - stride + x - bytes]! : 0;
      const predicted =
        filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, corner) : 0;
      rows[target + x] = (value + predicted) & 0xff;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  const step = depth / 8;
  for (let i = 0; i < width * height; i++) {
    // A 16 bit sample keeps its high byte.
    const sample = (channel: number): number => rows[i * bytes + channel * step]!;
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    if (colorType === 3) {
      const index = sample(0);
      r = palette[index * 3] ?? 0;
      g = palette[index * 3 + 1] ?? 0;
      b = palette[index * 3 + 2] ?? 0;
      a = alpha[index] ?? 255;
    } else if (colorType === 0 || colorType === 4) {
      r = g = b = sample(0);
      a = colorType === 4 ? sample(1) : 255;
    } else {
      r = sample(0);
      g = sample(1);
      b = sample(2);
      a = colorType === 6 ? sample(3) : 255;
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// The rectangle of the image, clamped to its edges.
export function cropImage(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const left = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const w = Math.max(1, Math.min(image.width - left, Math.floor(width)));
  const h = Math.max(1, Math.min(image.height - top, Math.floor(height)));
  const data = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    image.data.copy(data, row * w * 4, ((top + row) * image.width + left) * 4, ((top + row) * image.width + left + w) * 4);
  }
  return { width: w, height: h, data };
}

// The crop made larger: the vision model reads small text of a screenshot
// better at two or three times the size. Bilinear, so the letters stay
// smooth instead of turning into blocks.
export function scaleImage(image: RgbaImage, factor: number): RgbaImage {
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const at = (px: number, py: number): number => image.data[(py * image.width + px) * 4 + c]!;
        const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
        const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
        data[(y * width + x) * 4 + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { width, height, data };
}
