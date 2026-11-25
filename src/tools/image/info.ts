// The size of an image from its header: PNG, JPEG, WebP and GIF. The model
// asked the shell or the REPL for it, the header is enough and needs no
// decoder.

export interface ImageInfo {
  format: 'png' | 'jpeg' | 'webp' | 'gif';
  width: number;
  height: number;
}

function jpegSize(buffer: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1]!;
    // The frame headers of the baseline, the progressive and the other codings.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return undefined;
}

function webpSize(buffer: Buffer): { width: number; height: number } | undefined {
  const kind = buffer.toString('latin1', 12, 16);
  if (kind === 'VP8X') {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return undefined;
}

export function imageInfo(buffer: Buffer): ImageInfo | undefined {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const size = jpegSize(buffer);
    return size ? { format: 'jpeg', ...size } : undefined;
  }
  if (buffer.length >= 30 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    const size = webpSize(buffer);
    return size ? { format: 'webp', ...size } : undefined;
  }
  if (buffer.length >= 10 && buffer.toString('latin1', 0, 3) === 'GIF') {
    return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  return undefined;
}
