// Reads image dimensions from file headers. Never throws and has no dependencies.

const NONE = { type: null, width: null, height: null };

function png(b) {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return NONE;
  return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b) {
  if (b.length < 10) return NONE;
  return { type: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpeg(b) {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    // Skip fill bytes before the marker code.
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) break;
    const marker = b[i++];
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x00) continue;
    if (i + 2 > b.length) break;
    const len = b.readUInt16BE(i);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > b.length) break;
      return { type: 'jpeg', width: b.readUInt16BE(i + 5), height: b.readUInt16BE(i + 3) };
    }
    if (len < 2) break;
    i += len;
  }
  return NONE;
}

function webp(b) {
  if (b.length < 20) return NONE;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return NONE;
    return { type: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return NONE;
    const bits = b.readUInt32LE(21);
    return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return NONE;
    return { type: 'webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return NONE;
}

const SVG_START_RE = /^(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>)*<svg[\s>/]/i;
const SVG_LENGTH_RE = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/i;

function attr(tag, name) {
  const m = new RegExp(String.raw`\s${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2]) : null;
}

function svg(b) {
  const text = b.toString('utf8', 0, Math.min(b.length, 65536)).replace(/^\uFEFF/, '');
  if (!SVG_START_RE.test(text)) return null;
  const open = /<svg(?=[\s>/])[^>]*>/i.exec(text.replace(/<!--[\s\S]*?-->/g, ''));
  const tag = open ? open[0] : '';
  const w = SVG_LENGTH_RE.exec(attr(tag, 'width') ?? '');
  const h = SVG_LENGTH_RE.exec(attr(tag, 'height') ?? '');
  if (w && h && Number(w[1]) > 0 && Number(h[1]) > 0) return { type: 'svg', width: Number(w[1]), height: Number(h[1]) };
  const vb = attr(tag, 'viewBox');
  if (vb) {
    const n = vb.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) return { type: 'svg', width: n[2], height: n[3] };
  }
  return { type: 'svg', width: null, height: null };
}

export function imageSize(buffer) {
  try {
    const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return png(b);
    if (b.length >= 6 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) return gif(b);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return webp(b);
    return svg(b) || NONE;
  } catch {
    return NONE;
  }
}
