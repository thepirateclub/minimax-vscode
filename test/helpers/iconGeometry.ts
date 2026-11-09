// A minimal SVG path parser, the panel icons are checked for a centered ink.
// The parser understands the commands the icons use, arcs are sampled.

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Command {
  cmd: string;
  args: number[];
}

const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0
};

function parse(d: string): Command[] {
  const raw: Array<{ cmd: string; args: number[] }> = [];
  const re = /([astvzqmhlc])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let current: { cmd: string; args: number[] } | undefined;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) {
      current = { cmd: match[1], args: [] };
      raw.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    current.args.push(Number(match[2]));
  }

  const flat: Command[] = [];
  for (const item of raw) {
    const key = item.cmd.toLowerCase();
    const size = ARITY[key];
    if (size === undefined) {
      continue;
    }
    if (size === 0) {
      flat.push({ cmd: item.cmd, args: [] });
      continue;
    }
    const groups = Math.floor(item.args.length / size);
    for (let i = 0; i < groups; i++) {
      const args = item.args.slice(i * size, (i + 1) * size);
      // A repeated moveto continues as a lineto of the same kind.
      const cmd = i === 0 ? item.cmd : item.cmd === 'M' ? 'L' : item.cmd === 'm' ? 'l' : item.cmd;
      flat.push({ cmd, args });
    }
  }
  return flat;
}

function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function addPoint(box: Box, x: number, y: number): void {
  box.minX = Math.min(box.minX, x);
  box.minY = Math.min(box.minY, y);
  box.maxX = Math.max(box.maxX, x);
  box.maxY = Math.max(box.maxY, y);
}

function addCubic(
  box: Box,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): void {
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    addPoint(box, x, y);
  }
}

function addQuad(
  box: Box,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    addPoint(
      box,
      u * u * x0 + 2 * u * t * x1 + t * t * x2,
      u * u * y0 + 2 * u * t * y1 + t * t * y2
    );
  }
}

function addArc(
  box: Box,
  x1: number,
  y1: number,
  rxInput: number,
  ryInput: number,
  rotation: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): void {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx === 0 || ry === 0) {
    addPoint(box, x2, y2);
    return;
  }
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    const value = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (sweep === 0 && delta > 0) {
    delta -= 2 * Math.PI;
  }
  if (sweep === 1 && delta < 0) {
    delta += 2 * Math.PI;
  }

  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = theta + (delta * i) / steps;
    const px = cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi;
    const py = cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi;
    addPoint(box, px, py);
  }
}

export function pathBBox(d: string): Box {
  const box = emptyBox();
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubicX: number | undefined;
  let lastCubicY: number | undefined;
  let lastQuadX: number | undefined;
  let lastQuadY: number | undefined;

  const resetSmooth = (): void => {
    lastCubicX = undefined;
    lastCubicY = undefined;
    lastQuadX = undefined;
    lastQuadY = undefined;
  };

  for (const { cmd, args } of parse(d)) {
    const relative = cmd === cmd.toLowerCase();
    const key = cmd.toLowerCase();
    switch (key) {
      case 'm': {
        const nx = relative ? x + (args[0] ?? 0) : args[0] ?? 0;
        const ny = relative ? y + (args[1] ?? 0) : args[1] ?? 0;
        x = nx;
        y = ny;
        startX = x;
        startY = y;
        addPoint(box, x, y);
        resetSmooth();
        break;
      }
      case 'l': {
        x = relative ? x + (args[0] ?? 0) : args[0] ?? x;
        y = relative ? y + (args[1] ?? 0) : args[1] ?? y;
        addPoint(box, x, y);
        resetSmooth();
        break;
      }
      case 'h': {
        x = relative ? x + (args[0] ?? 0) : args[0] ?? x;
        addPoint(box, x, y);
        resetSmooth();
        break;
      }
      case 'v': {
        y = relative ? y + (args[0] ?? 0) : args[0] ?? y;
        addPoint(box, x, y);
        resetSmooth();
        break;
      }
      case 'c': {
        const x1 = relative ? x + (args[0] ?? 0) : args[0] ?? x;
        const y1 = relative ? y + (args[1] ?? 0) : args[1] ?? y;
        const x2 = relative ? x + (args[2] ?? 0) : args[2] ?? x;
        const y2 = relative ? y + (args[3] ?? 0) : args[3] ?? y;
        const x3 = relative ? x + (args[4] ?? 0) : args[4] ?? x;
        const y3 = relative ? y + (args[5] ?? 0) : args[5] ?? y;
        addCubic(box, x, y, x1, y1, x2, y2, x3, y3);
        x = x3;
        y = y3;
        lastCubicX = x2;
        lastCubicY = y2;
        lastQuadX = undefined;
        lastQuadY = undefined;
        break;
      }
      case 's': {
        const x2 = relative ? x + (args[0] ?? 0) : args[0] ?? x;
        const y2 = relative ? y + (args[1] ?? 0) : args[1] ?? y;
        const x3 = relative ? x + (args[2] ?? 0) : args[2] ?? x;
        const y3 = relative ? y + (args[3] ?? 0) : args[3] ?? y;
        const x1 = lastCubicX === undefined ? x : 2 * x - lastCubicX;
        const y1 = lastCubicY === undefined ? y : 2 * y - lastCubicY;
        addCubic(box, x, y, x1, y1, x2, y2, x3, y3);
        x = x3;
        y = y3;
        lastCubicX = x2;
        lastCubicY = y2;
        break;
      }
      case 'q': {
        const x1 = relative ? x + (args[0] ?? 0) : args[0] ?? x;
        const y1 = relative ? y + (args[1] ?? 0) : args[1] ?? y;
        const x2 = relative ? x + (args[2] ?? 0) : args[2] ?? x;
        const y2 = relative ? y + (args[3] ?? 0) : args[3] ?? y;
        addQuad(box, x, y, x1, y1, x2, y2);
        x = x2;
        y = y2;
        lastQuadX = x1;
        lastQuadY = y1;
        lastCubicX = undefined;
        lastCubicY = undefined;
        break;
      }
      case 't': {
        const x2 = relative ? x + (args[0] ?? 0) : args[0] ?? x;
        const y2 = relative ? y + (args[1] ?? 0) : args[1] ?? y;
        const x1 = lastQuadX === undefined ? x : 2 * x - lastQuadX;
        const y1 = lastQuadY === undefined ? y : 2 * y - lastQuadY;
        addQuad(box, x, y, x1, y1, x2, y2);
        x = x2;
        y = y2;
        lastQuadX = x1;
        lastQuadY = y1;
        break;
      }
      case 'a': {
        const x2 = relative ? x + (args[5] ?? 0) : args[5] ?? x;
        const y2 = relative ? y + (args[6] ?? 0) : args[6] ?? y;
        addArc(
          box,
          x,
          y,
          args[0] ?? 0,
          args[1] ?? 0,
          args[2] ?? 0,
          args[3] ?? 0,
          args[4] ?? 0,
          x2,
          y2
        );
        x = x2;
        y = y2;
        resetSmooth();
        break;
      }
      case 'z': {
        x = startX;
        y = startY;
        addPoint(box, x, y);
        resetSmooth();
        break;
      }
      default:
        break;
    }
  }
  return box;
}

export function mergeBoxes(boxes: Box[]): Box {
  const merged = emptyBox();
  for (const box of boxes) {
    addPoint(merged, box.minX, box.minY);
    addPoint(merged, box.maxX, box.maxY);
  }
  return merged;
}

// The markup of an icon carries shapes besides the path, the circle of the
// magnifier and the sheet of the copy button have to be measured too.
export function markupBBox(markup: string): Box {
  const boxes: Box[] = [];
  for (const match of markup.matchAll(/\sd="([^"]+)"/g)) {
    boxes.push(pathBBox(match[1] ?? ''));
  }
  for (const match of markup.matchAll(
    /<circle[^>]*cx="(-?[\d.]+)"[^>]*cy="(-?[\d.]+)"[^>]*r="(-?[\d.]+)"/g
  )) {
    const cx = Number(match[1]);
    const cy = Number(match[2]);
    const r = Number(match[3]);
    boxes.push({ minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r });
  }
  for (const match of markup.matchAll(
    /<rect[^>]*x="(-?[\d.]+)"[^>]*y="(-?[\d.]+)"[^>]*width="(-?[\d.]+)"[^>]*height="(-?[\d.]+)"/g
  )) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    boxes.push({
      minX: x,
      minY: y,
      maxX: x + Number(match[3]),
      maxY: y + Number(match[4])
    });
  }
  return mergeBoxes(boxes);
}
