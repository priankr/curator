// Shared by the browser and Node: plain ES module, no DOM, no node: imports, no globals.
import { hash, rng } from './seed.js';
import { lum } from './palette.js';

export const COUNT = 16;
export const NAMES = ['Sun and stripes', 'Quarter tiles', 'Corner rings', 'Circle, square, triangle', 'Diagonal wedge', 'Dot grid', 'Nested squares', 'Rising sun', 'Split field', 'Arches', 'Fan of rays', 'Three circles', 'Sine bands', 'Staircase', 'Semicircle and bar', 'Crossing bars'];

let n = 0;
const f = (v) => (Math.round(v * 10) / 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONTS = { sans: "'Archivo','Helvetica Neue',Arial,sans-serif", mono: "'IBM Plex Mono',ui-monospace,monospace" };

/* paper tone decides blending: multiply only on pale paper, screen only on dark paper, none on a saturated mid-tone paper */
const dark = (hex) => lum(hex) < 0.18, pale = (hex) => lum(hex) >= 0.55;
const mul = (P) => (pale(P.p) ? ' style="mix-blend-mode:multiply"' : '');
const rect = (x, y, w, h, fill, extra) => '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" fill="' + fill + '"' + (extra || '') + '/>';
const circ = (x, y, r, fill, extra) => '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(r) + '" fill="' + fill + '"' + (extra || '') + '/>';
const text = (x, y, s, size, fam, fill, extra) => '<text x="' + f(x) + '" y="' + f(y) + '" font-size="' + f(size) + '" font-family="' + fam + '" fill="' + fill + '"' + (extra || '') + '>' + esc(s) + '</text>';
function wrap(str, max, maxLines) {
  const words = String(str).split(/\s+/), lines = []; let cur = '';
  words.forEach((w) => { if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
  if (cur) lines.push(cur);
  if (maxLines && lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '') + '...'; }
  return lines;
}
function svg(kind, w, h, inner, noGrain) {
  return '<svg class="kit kit-' + kind + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" style="isolation:isolate">' + inner + (noGrain ? '' : '<rect width="' + w + '" height="' + h + '" fill="url(#kit-grain)" opacity=".55"/>') + '</svg>';
}
/* title band used by every composition */
function band(item, w, h, y0, ink, F) {
  const pad = w * 0.07, fs = clamp(w * 0.056, 9, 30), max = Math.floor((w - 2 * pad) * 0.8 / (fs * 0.62));
  const lines = wrap(String(item.title).toUpperCase(), max, 2); let s = '';
  s += rect(pad, y0, w - 2 * pad, Math.max(1, w * 0.006), ink);
  lines.forEach((l, i) => { s += text(pad, y0 + fs * 1.45 + i * fs * 1.08, l, fs, F.sans, ink, ' font-weight="800" letter-spacing="' + f(fs * 0.04) + '"'); });
  s += text(w - pad, y0 + fs * 1.4, 'No. ' + item.no, fs * 0.6, F.mono, ink, ' text-anchor="end" opacity=".75"');
  s += text(pad, y0 + fs * 1.45 + lines.length * fs * 1.08 + fs * 0.1, item.domain, fs * 0.6, F.mono, ink, ' opacity=".7"');
  return s;
}

const pth = (d, fill, extra) => '<path d="' + d + '" fill="' + fill + '"' + (extra || '') + '/>';
/* Compositions 6 to 15. Each takes the drawing field (ax, ay, aw, ah) and must hold up from 3.5:1 wide to portrait. */
const COMPS = [
  /* 6. Nested squares pushed toward the right and bottom edges */
  function (X) {
    const { P, ax, aw, ah, bx, by, s } = X, L = Math.min(ah * 0.96, aw * 0.72), ccx = Math.max(ax + L / 2, bx - L / 2 - aw * 0.07), inks = [P.a, P.b, P.c, P.p], t = s * 0.035;
    let g = rect(ax, by - t, aw, t, P.b);
    for (let i = 0; i < 4; i++) { const q = L * (1 - i * 0.255); g += rect(ccx - q / 2, by - t - q, q, q, inks[i]); }
    return g;
  },
  /* 7. Rising half sun with stripes cut through it */
  function (X) {
    const { P, r, ax, ay, aw, ah, by, s } = X, hy = ay + ah * 0.72, R = Math.min(aw * 0.4, ah * 0.66), sx = ax + aw * (0.4 + r() * 0.2);
    let g = '<path d="M' + f(sx - R) + ' ' + f(hy) + 'A' + f(R) + ' ' + f(R) + ' 0 0 1 ' + f(sx + R) + ' ' + f(hy) + 'Z" fill="' + P.a + '"/>';
    for (let i = 0; i < 5; i++) g += rect(sx - R - 1, hy - R * (0.14 + i * 0.19) - R * (0.085 - i * 0.012), R * 2 + 2, R * (0.085 - i * 0.012), P.p);
    g += rect(ax, hy, aw, by - hy, P.b) + rect(ax, hy + (by - hy) * 0.34, aw, Math.max(1, s * 0.02), P.c) + rect(ax, hy + (by - hy) * 0.64, aw, Math.max(1, s * 0.035), P.c);
    return g;
  },
  /* 8. Diagonal split in two inks, a circle that swaps inks across the split */
  function (X) {
    const { P, r, ax, ay, aw, ah, bx, by, cx, cy, s } = X, flip = r() < 0.5, id1 = X.uid(), id2 = X.uid();
    const A = flip ? [[ax, ay], [bx, ay], [ax, by]] : [[ax, ay], [bx, ay], [bx, by]], B = flip ? [[bx, ay], [bx, by], [ax, by]] : [[ax, ay], [bx, by], [ax, by]];
    const d = (p) => 'M' + p.map((q) => f(q[0]) + ' ' + f(q[1])).join('L') + 'Z', R = Math.min(ah * 0.4, aw * 0.3), L = flip ? [[bx, ay], [ax, by]] : [[ax, ay], [bx, by]];
    let g = pth(d(A), P.a) + pth(d(B), P.b);
    g += '<clipPath id="' + id1 + '"><path d="' + d(A) + '"/></clipPath><clipPath id="' + id2 + '"><path d="' + d(B) + '"/></clipPath>';
    g += '<g clip-path="url(#' + id1 + ')">' + circ(cx, cy, R, P.c) + '</g><g clip-path="url(#' + id2 + ')">' + circ(cx, cy, R, P.p) + '</g>';
    g += '<line x1="' + f(L[0][0]) + '" y1="' + f(L[0][1]) + '" x2="' + f(L[1][0]) + '" y2="' + f(L[1][1]) + '" stroke="' + P.c + '" stroke-width="' + f(Math.max(1, s * 0.022)) + '"/>';
    return g;
  },
  /* 9. Stacked concentric arches standing on the base line */
  function (X) {
    const { P, ax, aw, ah, by, cx, s } = X, H = ah * 0.9, R = Math.min(aw * 0.46, H * 0.62), top = by - H, ccy = top + R, inks = [P.a, P.c, P.b, P.p], t = s * 0.035;
    let g = '';
    for (let i = 0; i < 4; i++) { const q = R * (1 - i * 0.24); g += pth('M' + f(cx - q) + ' ' + f(by - t) + 'L' + f(cx - q) + ' ' + f(ccy) + 'A' + f(q) + ' ' + f(q) + ' 0 0 1 ' + f(cx + q) + ' ' + f(ccy) + 'L' + f(cx + q) + ' ' + f(by - t) + 'Z', inks[i]); }
    return g + rect(ax, by - t, aw, t, P.b);
  },
  /* 10. Thin rays fanning from a point on the bottom edge, one solid ray */
  function (X) {
    const { P, r, aw, ah, by, cx, s } = X, ox = cx + (r() - 0.5) * aw * 0.24, n = 15, solid = 3 + Math.floor(r() * (n - 6)), len = Math.hypot(aw, ah) * 1.5, sw = Math.max(1, s * 0.011);
    let g = '';
    for (let i = 0; i < n; i++) {
      const a = (-78 + (156 * i) / (n - 1)) * Math.PI / 180;
      if (i === solid) { const hw = 0.085; g += pth('M' + f(ox) + ' ' + f(by) + 'L' + f(ox + Math.sin(a - hw) * len) + ' ' + f(by - Math.cos(a - hw) * len) + 'L' + f(ox + Math.sin(a + hw) * len) + ' ' + f(by - Math.cos(a + hw) * len) + 'Z', P.a); }
      else g += '<line x1="' + f(ox) + '" y1="' + f(by) + '" x2="' + f(ox + Math.sin(a) * len) + '" y2="' + f(by - Math.cos(a) * len) + '" stroke="' + P.b + '" stroke-width="' + f(sw) + '"/>';
    }
    return g + pth('M' + f(ox - s * 0.09) + ' ' + f(by) + 'A' + f(s * 0.09) + ' ' + f(s * 0.09) + ' 0 0 1 ' + f(ox + s * 0.09) + ' ' + f(by) + 'Z', P.c);
  },
  /* 11. Three overlapping circles in multiply */
  function (X) {
    const { P, mb, aw, ah, cx, cy } = X, wide = aw / ah > 1.6;
    const R = wide ? Math.min(ah * 0.4, aw * 0.9 / 3.9) : Math.min(aw * 0.9 / 3.1, ah * 0.92 / 2.95), pos = wide ? [[-0.95, 0.14], [0, -0.26], [0.95, 0.14]] : [[-0.55, -0.35], [0.55, -0.35], [0, 0.6]];
    return [P.a, P.b, P.c].map((c, i) => circ(cx + pos[i][0] * R, cy + pos[i][1] * R, R, c, mb)).join('');
  },
  /* 12. Horizontal sine-wave bands */
  function (X) {
    const { P, r, mb, ax, ay, aw, ah } = X, n = clamp(Math.round(ah / 24), 4, 8), pitch = ah / n, th = pitch * 0.62, A = pitch * 0.42, lam = aw / (1.8 + r() * 0.8), ph = r() * 6, inks = [P.a, P.b, P.c], steps = 48;
    let g = '';
    for (let i = 0; i < n; i++) {
      const y0 = ay + pitch * (i + 0.5) - th / 2, p = ph + i * 0.55, up = [], dn = [];
      for (let k = 0; k <= steps; k++) { const x = ax + (aw * k) / steps, o = A * Math.sin((2 * Math.PI * (x - ax)) / lam + p); up.push(f(x) + ' ' + f(y0 + o)); dn.unshift(f(x) + ' ' + f(y0 + th + o)); }
      g += pth('M' + up.join('L') + 'L' + dn.join('L') + 'Z', inks[i % 3], mb);
    }
    return g;
  },
  /* 13. Staircase rising left to right with a small circle on the top step */
  function (X) {
    const { P, mb, ax, aw, ah, by } = X, n = aw / ah > 1.6 ? 6 : aw / ah > 1 ? 5 : 4, sw = (aw * 0.86) / n, x0 = ax + aw * 0.07, inks = [P.a, P.b, P.c], r0 = Math.min(sw * 0.3, ah * 0.12);
    let g = '';
    for (let i = 0; i < n; i++) { const hh = ah * (0.18 + 0.54 * (i / (n - 1))); g += rect(x0 + i * sw, by - hh, sw * (i < n - 1 ? 1.3 : 1), hh, inks[i % 3], i ? mb : ''); }
    return g + circ(x0 + (n - 1) * sw + sw / 2, by - ah * 0.72 - r0 * 1.15, r0, inks[n % 3]);
  },
  /* 14. One large semicircle cut by a single thin bar, mostly empty field */
  function (X) {
    const { P, r, ax, ay, aw, ah, by, s } = X, base = ay + ah * 0.84, R = Math.min(aw * 0.4, ah * 0.78), sx = ax + aw * (0.34 + r() * 0.32), bw = Math.max(1.5, s * 0.03), bxx = sx + (r() < 0.5 ? -1 : 1) * R * 0.32;
    return pth('M' + f(sx - R) + ' ' + f(base) + 'A' + f(R) + ' ' + f(R) + ' 0 0 1 ' + f(sx + R) + ' ' + f(base) + 'Z', P.a) + rect(bxx - bw / 2, ay + ah * 0.06, bw, by - ay - ah * 0.06, P.b);
  },
  /* 15. Two thick crossing bars overprinted at the crossing, one small square accent */
  function (X) {
    const { P, mb, ax, ay, aw, ah, s } = X, t = s * 0.2, hy = ay + ah * 0.34, vx = ax + aw * 0.62, q = s * 0.13;
    return rect(ax, hy, aw, t, P.a) + rect(vx, ay, t, ah, P.b, mb) + rect(ax + aw * 0.14, ay + ah * 0.66, q, q, P.c);
  }
];

/* Geometric poster. inks is { paper, inks: [a, b, c], band }. opts is { v, fonts: { band, mono }, id }. */
export function poster(item, w, h, inks, opts) {
  const o = opts || {}, F = { sans: (o.fonts && o.fonts.band) || FONTS.sans, mono: (o.fonts && o.fonts.mono) || FONTS.mono };
  const P = { p: inks.paper, a: inks.inks[0], b: inks.inks[1], c: inks.inks[2] };
  let sub = 0; const uid = () => (o.id != null ? (sub++ ? o.id + '-' + sub : String(o.id)) : 'k' + (++n));
  const r = rng(hash(item.key) ^ 0x51), v = o.v != null ? o.v : hash(item.key + '|pv') % COUNT, id = uid();
  const pad = w * 0.07, bandH = clamp(w * 0.25, h * 0.17, h * 0.34), ax = pad, ay = pad, aw = w - 2 * pad, ah = h - bandH - pad * 1.25, m = mul(P);
  let g = rect(ax, ay, aw, ah, dark(P.p) ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)');
  if (v === 0) {
    const R = Math.min(aw, ah) * 0.33, cx = ax + aw * (0.34 + r() * 0.3), cy = ay + ah * 0.4;
    g += circ(cx, cy, R, P.a);
    let y = ay + ah * 0.5; const t = ah * 0.5 / 5;
    for (let i = 0; i < 5; i++) { g += rect(ax, y + t * (1 - (0.24 + 0.15 * i)), aw, t * (0.24 + 0.15 * i), P.b, m); y += t; }
    g += circ(ax + aw * (0.74 + r() * 0.1), ay + ah * 0.2, R * 0.3, P.c, m);
  } else if (v === 1) {
    const cols = aw / ah > 1.25 ? 5 : aw / ah > 0.9 ? 4 : 3, t = aw / cols, rows = Math.max(1, Math.floor(ah / t + 0.02)), oy = ay + (ah - rows * t) / 2, ik = [P.a, P.b, P.c, P.p];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const bg = ik[Math.floor(r() * 4)]; let fg = ik[Math.floor(r() * 4)]; if (fg === bg) fg = ik[(ik.indexOf(bg) + 1) % 4];
      const X = ax + x * t, Y = oy + y * t, c = [[X, Y], [X + t, Y], [X + t, Y + t], [X, Y + t]], k = Math.floor(r() * 4), kind = r();
      g += rect(X, Y, t + 0.3, t + 0.3, bg);
      if (kind < 0.62) { const a = c[(k + 1) % 4], b = c[(k + 3) % 4]; g += '<path d="M' + f(c[k][0]) + ' ' + f(c[k][1]) + 'L' + f(a[0]) + ' ' + f(a[1]) + 'A' + f(t) + ' ' + f(t) + ' 0 0 1 ' + f(b[0]) + ' ' + f(b[1]) + 'Z" fill="' + fg + '"/>'; }
      else if (kind < 0.82) g += circ(X + t / 2, Y + t / 2, t * 0.3, fg);
      else { const a = c[(k + 1) % 4], b = c[(k + 2) % 4]; g += '<path d="M' + f(c[k][0]) + ' ' + f(c[k][1]) + 'L' + f(a[0]) + ' ' + f(a[1]) + 'L' + f(b[0]) + ' ' + f(b[1]) + 'Z" fill="' + fg + '"/>'; }
    }
  } else if (v === 2) {
    const k = Math.floor(r() * 4), cx = ax + (k % 2 ? aw : 0), cy = ay + (k > 1 ? ah : 0), R = Math.hypot(aw, ah) * 0.96, fills = [P.a, P.p, P.b, P.p, P.c, P.p, P.a];
    for (let i = 0; i < 7; i++) g += circ(cx, cy, R * (1 - i / 7.4), fills[i]);
    g += circ(ax + (k % 2 ? aw * 0.2 : aw * 0.8), ay + (k > 1 ? ah * 0.2 : ah * 0.8), Math.min(aw, ah) * 0.07, P.b);
  } else if (v === 3) {
    const s = Math.min(aw, ah);
    g += circ(ax + aw * 0.4, ay + ah * 0.42, s * 0.34, P.a);
    g += '<rect x="' + f(ax + aw * 0.42) + '" y="' + f(ay + ah * 0.3) + '" width="' + f(s * 0.5) + '" height="' + f(s * 0.5) + '" fill="' + P.b + '" transform="rotate(' + f(8 + r() * 14) + ' ' + f(ax + aw * 0.6) + ' ' + f(ay + ah * 0.5) + ')"' + m + '/>';
    g += '<path d="M' + f(ax + aw * 0.12) + ' ' + f(ay + ah * 0.94) + 'L' + f(ax + aw * 0.5) + ' ' + f(ay + ah * 0.46) + 'L' + f(ax + aw * 0.88) + ' ' + f(ay + ah * 0.94) + 'Z" fill="' + P.c + '"' + m + '/>';
  } else if (v === 4) {
    g += '<path d="M' + f(ax) + ' ' + f(ay + ah) + 'L' + f(ax + aw) + ' ' + f(ay) + 'L' + f(ax + aw) + ' ' + f(ay + ah) + 'Z" fill="' + P.a + '"/>';
    for (let i = 0; i < 4; i++) { const o2 = aw * (0.1 + i * 0.16), t = aw * 0.07; g += '<path d="M' + f(ax + o2) + ' ' + f(ay + ah) + 'L' + f(ax + o2 + t) + ' ' + f(ay + ah) + 'L' + f(ax + aw) + ' ' + f(ay + ah * (o2 + t) / aw) + 'L' + f(ax + aw) + ' ' + f(ay + ah * o2 / aw) + 'Z" fill="' + P.b + '"' + m + '/>'; }
    g += circ(ax + aw * 0.27, ay + ah * 0.29, Math.min(aw, ah) * 0.17, P.c);
  } else if (v === 5) {
    const cols = aw / ah > 1.25 ? 9 : 6, s = aw / cols, rows = Math.max(2, Math.floor(ah / s)), oy = ay + (ah - rows * s) / 2 + s / 2, bx = 1 + Math.floor(r() * (cols - 2)), by = 1 + Math.floor(r() * Math.max(1, rows - 2));
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g += circ(ax + s / 2 + x * s, oy + y * s, s * 0.17, P.b);
    g += circ(ax + bx * s, oy + by * s - s / 2 + s / 2, s * 1.05, P.a, m);
    g += '<circle cx="' + f(ax + (cols - bx) * s) + '" cy="' + f(oy + (rows - 1 - by) * s) + '" r="' + f(s * 0.72) + '" fill="none" stroke="' + P.c + '" stroke-width="' + f(s * 0.16) + '"/>';
  } else {
    g += COMPS[v - 6]({ P, r, m, mb: dark(P.p) ? ' style="mix-blend-mode:screen"' : mul(P), ax, ay, aw, ah, bx: ax + aw, by: ay + ah, cx: ax + aw / 2, cy: ay + ah / 2, s: Math.min(aw, ah), uid });
  }
  const bandInk = inks.band || P.a;
  return svg('poster', w, h, rect(0, 0, w, h, P.p) + '<clipPath id="' + id + '"><rect x="' + f(ax) + '" y="' + f(ay) + '" width="' + f(aw) + '" height="' + f(ah) + '"/></clipPath><g clip-path="url(#' + id + ')">' + g + '</g>' + band(item, w, h, h - bandH, bandInk, F));
}

/* Within one collection, no two items share a composition until every allowed one is used: a collision moves to the next unused allowed one. */
export function assignPosters(keys, allowed) {
  const list = allowed === 'all' || allowed == null ? Array.from({ length: COUNT }, (_, i) => i) : [...new Set(allowed.map((x) => x - 1))].filter((x) => x >= 0 && x < COUNT).sort((a, b) => a - b);
  const ok = new Set(list), used = new Set();
  return keys.map((key) => {
    let v = hash(key + '|pv') % COUNT;
    while (!ok.has(v)) v = (v + 1) % COUNT;
    if (used.size < ok.size) while (used.has(v)) { v = (v + 1) % COUNT; while (!ok.has(v)) v = (v + 1) % COUNT; }
    used.add(v);
    return v;
  });
}
