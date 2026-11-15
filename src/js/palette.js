// Shared by the browser and Node: plain ES module, no DOM, no node: imports, no globals.
import { hash, rng } from './seed.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- colour helpers ---------- */
const norm = (h) => { h = String(h).trim().replace(/^#/, ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return '#' + h.slice(0, 6).toLowerCase(); };
const rgb = (h) => { const n = parseInt(norm(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const lum = (h) => { const c = rgb(h); return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export const WEIGHTS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32];
const BASE_WEIGHT = 8;
const CALIBRATION_KEYS = Array.from({ length: 240 }, (_, i) => 'calibrate-' + i);

/* lowercase six digit hex everywhere, with surface and muted derived when missing */
export function normalizeBrand(brand) {
  const b = brand || {}, n = b.neutral || {};
  const light = norm(n.light || '#ffffff'), dark = norm(n.dark || '#111111');
  const list = (l, t) => (l || []).map((e, i) => (typeof e === 'string' ? { name: t + ' ' + (i + 1), value: e } : e)).map((e) => ({ name: String(e.name || t), value: norm(e.value) }));
  return {
    primary: list(b.primary, 'primary'),
    secondary: list(b.secondary, 'secondary'),
    accent: list(b.accent, 'accent'),
    neutral: { light, dark, surface: n.surface ? norm(n.surface) : mix(light, dark, 0.08), muted: n.muted ? norm(n.muted) : mix(dark, light, 0.45) }
  };
}

function make(brandIn, posters, weight) {
  const brand = normalizeBrand(brandIn), rules = posters || {};
  const inverseShare = rules.inverseShare ?? 0.25, MIN = rules.minContrast ?? 1.6;
  const neutral = brand.neutral, { light, dark } = neutral;
  const tag = (list, t) => list.map((e) => ({ name: e.name, value: e.value, tier: t }));
  const primary = tag(brand.primary, 'primary'), secondary = tag(brand.secondary, 'secondary'), accent = tag(brand.accent, 'accent');
  if (!primary.length) primary.push({ name: 'primary', value: dark, tier: 'primary' });
  const all = primary.concat(secondary, accent);
  const lc = (s) => String(s).toLowerCase();
  const bad = new Set(); /* avoidPairs as "hexA|hexB" in both orders, resolved through names */
  const byName = {}; all.forEach((e) => { (byName[lc(e.name)] = byName[lc(e.name)] || []).push(e.value); });
  byName.dark = [dark]; byName.light = [light]; byName.surface = [neutral.surface]; byName.muted = [neutral.muted];
  (rules.avoidPairs || []).forEach((p) => { (byName[lc(p[0])] || []).forEach((x) => (byName[lc(p[1])] || []).forEach((y) => { bad.add(x + '|' + y); bad.add(y + '|' + x); })); });
  const excluded = new Set((rules.excludeFromPosters || []).map(lc));
  const inks = all.filter((e) => !excluded.has(lc(e.name)));
  const D = { name: 'Dark', value: dark, tier: 'neutral' }, L = { name: 'Light', value: light, tier: 'neutral' }, S = { name: 'Surface', value: neutral.surface, tier: 'neutral' };
  const W = { primary: weight, secondary: 1.1, accent: 0.8, neutral: 1 };

  /* the ink pool for one paper: every brand colour (plus the neutrals the set allows) that reads on it and may sit beside it */
  function pool(paper, set) {
    const extra = set === 'light' ? [D] : [D, L];
    return inks.concat(extra).filter((e) => e.value !== paper.value && contrast(e.value, paper.value) >= MIN && !bad.has(e.value + '|' + paper.value));
  }
  const papers = {
    light: [{ e: L, w: 3 }].concat(neutral.surface !== light ? [{ e: S, w: 1 }] : []),
    inverse: [{ e: D, w: 1.6 }].concat(primary.filter((e) => !excluded.has(lc(e.name)) && pool(e, 'inverse').some((x) => x.tier === 'primary')).map((e) => ({ e, w: 0.6 })))
  };
  const inkSets = { light: { papers: papers.light.map((x) => x.e), pool: papers.light.map((x) => pool(x.e, 'light')) }, inverse: { papers: papers.inverse.map((x) => x.e), pool: papers.inverse.map((x) => pool(x.e, 'inverse')) } };

  function sample(list, k, r) { /* weighted, without replacement */
    const src = list.slice(), out = [];
    while (out.length < k && src.length) {
      const tot = src.reduce((s, e) => s + (W[e.tier] || 1), 0); let x = r() * tot, i = 0;
      for (; i < src.length - 1; i++) { x -= W[src[i].tier] || 1; if (x < 0) break; }
      out.push(src.splice(i, 1)[0]);
    }
    return out;
  }

  /* title band ink: the most legible own ink at 4.5:1 or more, else the dark or light neutral that contrasts more */
  function bandInk(paper, own) {
    const c = own.concat([dark, light]).map((h) => [h, contrast(h, paper)]);
    const best = c.slice(0, 3).filter((x) => x[1] >= 4.5).sort((x, y) => y[1] - x[1])[0];
    return best ? best[0] : c.slice(3).sort((x, y) => y[1] - x[1])[0][0];
  }

  const cache = new Map();
  function palette(key) {
    key = String(key);
    if (cache.has(key)) return cache.get(key);
    const r = rng(hash(key + '|ink'));
    const set = r() < inverseShare ? 'inverse' : 'light', pl = papers[set];
    const tot = pl.reduce((s, x) => s + x.w, 0); let x = r() * tot, pi = 0;
    for (; pi < pl.length - 1; pi++) { x -= pl[pi].w; if (x < 0) break; }
    const paper = pl[pi].e, pp = pool(paper, set);
    let pick = null;
    for (let att = 0; att < 80 && pp.length >= 3; att++) {
      const s = sample(pp, 3, r);
      const okPair = s.every((a, i) => s.every((c, j) => i === j || (!bad.has(a.value + '|' + c.value) && contrast(a.value, c.value) >= 1.1)));
      const hasPrimary = paper.tier === 'primary' || s.some((e) => e.tier === 'primary');
      if (okPair && (hasPrimary || att > 50)) { pick = s; break; }
    }
    if (!pick && pp.length >= 3) { /* heavy primary weights can starve the random draw, so search every triple for one that obeys the pair rules */
      const ok = (t) => t.every((x, i) => t.every((y, j) => i === j || (!bad.has(x.value + '|' + y.value) && contrast(x.value, y.value) >= 1.1)));
      let any = null;
      for (let i = 0; i < pp.length && !pick; i++) for (let j = i + 1; j < pp.length && !pick; j++) for (let k = j + 1; k < pp.length && !pick; k++) {
        const t = [pp[i], pp[j], pp[k]];
        if (!ok(t)) continue;
        if (paper.tier === 'primary' || t.some((e) => e.tier === 'primary')) pick = t; else if (!any) any = t;
      }
      if (!pick) pick = any;
    }
    if (!pick) { /* a very small pool: use what reads, then fill with tints so three distinct inks always exist */
      pick = pp.slice(0, 3);
      const toward = lum(paper.value) > 0.4 ? dark : light;
      for (let i = 0; pick.length < 3 && i < 12; i++) {
        const src = pick.length ? pick[i % pick.length] : D, t = mix(src.value, toward, 0.3 + 0.2 * Math.floor(i / Math.max(1, pick.length)));
        if (contrast(t, paper.value) >= MIN && !pick.some((e) => e.value === t)) pick.push({ name: src.name + ' tint', value: t, tier: src.tier });
      }
      while (pick.length < 3) pick.push({ name: 'Ink', value: mix(dark, light, 0.5 + pick.length * 0.1), tier: 'neutral' });
    }
    const pi0 = pick.findIndex((e) => e.tier === 'primary'); if (pi0 > 0) pick.unshift(pick.splice(pi0, 1)[0]);
    const ink = [pick[0].value, pick[1].value, pick[2].value];
    const out = { set, paper: paper.value, inks: ink, names: [paper.name, pick[0].name, pick[1].name, pick[2].name], tiers: [paper.tier, pick[0].tier, pick[1].tier, pick[2].tier], band: bandInk(paper.value, ink) };
    cache.set(key, out);
    return out;
  }

  /* primary share of colour use (inks, plus a brand colour used as paper), inverse share, rule breaks, lowest ink to paper contrast */
  function stats(keys) {
    let slots = 0, prim = 0, inv = 0, viol = 0, minC = 99, noPrim = 0;
    keys.forEach((k) => {
      const P = palette(k), v = [P.paper].concat(P.inks);
      inv += P.set === 'inverse' ? 1 : 0;
      [1, 2, 3].forEach((i) => { slots++; if (P.tiers[i] === 'primary') prim++; minC = Math.min(minC, contrast(v[i], P.paper)); });
      if (P.tiers[0] !== 'neutral') { slots++; if (P.tiers[0] === 'primary') prim++; } /* a brand colour used as the ground counts as one use */
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (bad.has(v[i] + '|' + v[j])) viol++;
      if (!P.tiers.some((t) => t === 'primary')) noPrim++;
    });
    return { items: keys.length, primaryShare: slots ? prim / slots : 0, inverseShare: keys.length ? inv / keys.length : 0, violations: viol, minContrast: minC, noPrimary: noPrim };
  }

  return { palette, inkSets, stats, primaryWeight: weight };
}

/* opts.primaryWeight skips calibration and forces a weight, used by the parity tests */
export function buildPalette(brand, posters, opts) {
  if (opts && opts.primaryWeight != null) return make(brand, posters, opts.primaryWeight);
  const target = posters && posters.primaryShare != null ? posters.primaryShare : 0.75;
  let best = null;
  for (const w of WEIGHTS) {
    const err = Math.abs(make(brand, posters, w).stats(CALIBRATION_KEYS).primaryShare - target);
    if (!best || err < best.err - 1e-12 || (Math.abs(err - best.err) <= 1e-12 && Math.abs(w - BASE_WEIGHT) < Math.abs(best.w - BASE_WEIGHT))) best = { err, w };
  }
  return make(brand, posters, best.w);
}
