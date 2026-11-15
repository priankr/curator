import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPalette, normalizeBrand, contrast, WEIGHTS } from '../src/js/palette.js';
import { hash, rng } from '../src/js/seed.js';
import { resolveConfig, validateConfig } from '../scripts/lib/config.mjs';
import { readCollections } from '../scripts/lib/parse.mjs';

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const schema = JSON.parse(readFileSync(path('../src/config.schema.json'), 'utf8'));
const required = () => ({ basic: { site: { title: 'Sample brand', url: 'https://links.example.com' } } });

const curatorCfg = resolveConfig(required(), schema);
const sampleFile = JSON.parse(readFileSync(path('../docs/examples/sample-brand.json'), 'utf8'));
const sampleCfg = resolveConfig({ basic: { ...required().basic, ...sampleFile.basic }, advanced: sampleFile.advanced }, schema);

const titles = readCollections(path('../content')).flatMap((c) => c.items.map((i) => i.title));
const keys = titles.concat(Array.from({ length: 200 }, (_, i) => 'synthetic-' + i));
const brands = { Curator: curatorCfg, Sample: sampleCfg };

test('the sample brand file is a valid partial config', () => {
  const merged = { basic: { ...required().basic, ...sampleFile.basic }, advanced: sampleFile.advanced };
  assert.deepEqual(validateConfig(merged, schema), []);
  assert.deepEqual(validateConfig(sampleCfg, schema), []);
});

test('the content has titles to use as poster keys', () => {
  assert.ok(titles.length > 0);
});

for (const [name, cfg] of Object.entries(brands)) {
  const brand = cfg.basic.brand, posters = cfg.advanced.posters;
  const T = buildPalette(brand, posters);
  const nb = normalizeBrand(brand);
  const hexOf = (label) => [...nb.primary, ...nb.secondary, ...nb.accent].filter((e) => e.name === label).map((e) => e.value);
  const primaries = new Set(nb.primary.map((e) => e.value));
  const bad = new Set();
  (posters.avoidPairs || []).forEach(([a, b]) => hexOf(a).forEach((x) => hexOf(b).forEach((y) => { bad.add(x + '|' + y); bad.add(y + '|' + x); })));

  test(name + ': every palette has a primary, no avoided pair, readable and distinct inks', () => {
    for (const k of keys) {
      const P = T.palette(k), all = [P.paper, ...P.inks];
      assert.ok(all.some((h) => primaries.has(h)), 'no primary for ' + k);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(!bad.has(all[i] + '|' + all[j]), 'avoided pair for ' + k);
      P.inks.forEach((h) => assert.ok(contrast(h, P.paper) >= posters.minContrast, 'contrast for ' + k));
      assert.equal(new Set(P.inks).size, 3, 'distinct inks for ' + k);
    }
  });

  test(name + ': primary share and inverse share are near their targets', () => {
    const s = T.stats(keys);
    assert.ok(Math.abs(s.primaryShare - posters.primaryShare) <= 0.1, 'primary share ' + s.primaryShare);
    assert.ok(Math.abs(s.inverseShare - posters.inverseShare) <= 0.1, 'inverse share ' + s.inverseShare);
    assert.equal(s.violations, 0);
    assert.ok(s.minContrast >= posters.minContrast);
    assert.ok(WEIGHTS.includes(T.primaryWeight));
  });

  test(name + ': the band ink reaches 4.5:1 when any ink does', () => {
    for (const k of keys) {
      const P = T.palette(k);
      if (P.inks.some((h) => contrast(h, P.paper) >= 4.5)) assert.ok(contrast(P.band, P.paper) >= 4.5, 'band for ' + k);
      else assert.ok([nb.neutral.dark, nb.neutral.light].includes(P.band));
    }
  });

  test(name + ': palettes are deterministic and cached', () => {
    const again = buildPalette(brand, posters);
    for (const k of keys) {
      assert.deepEqual(again.palette(k), T.palette(k));
      assert.equal(T.palette(k), T.palette(k));
    }
  });

  test(name + ': inverseShare 0 gives no inverse sets', () => {
    const z = buildPalette(brand, { ...posters, inverseShare: 0 });
    assert.equal(z.stats(keys).inverseShare, 0);
    keys.forEach((k) => assert.equal(z.palette(k).set, 'light'));
  });
}

test('excludeFromPosters keeps a named colour out of every palette', () => {
  const brand = curatorCfg.basic.brand, posters = { ...curatorCfg.advanced.posters, excludeFromPosters: ['vermilion', 'Teal'] };
  const T = buildPalette(brand, posters);
  for (const k of keys) {
    const P = T.palette(k);
    assert.ok(![P.paper, ...P.inks].some((h) => h === '#e4572e' || h === '#0f6e63'), 'excluded colour for ' + k);
  }
});

test('a one primary, one neutral brand still gives three distinct inks', () => {
  const brand = { primary: [{ name: 'Red', value: '#CC2222' }], secondary: [], accent: [], neutral: { light: '#ffffff', dark: '#111111' } };
  const T = buildPalette(brand, curatorCfg.advanced.posters);
  for (const k of keys) {
    const P = T.palette(k);
    assert.equal(new Set(P.inks).size, 3, 'inks for ' + k);
    P.inks.forEach((h) => assert.match(h, /^#[0-9a-f]{6}$/));
  }
});

test('normalizeBrand lowercases hex and derives surface and muted', () => {
  const nb = normalizeBrand({ primary: [{ name: 'Red', value: '#CC2222' }], neutral: { light: '#FFF', dark: '#111111' } });
  assert.equal(nb.primary[0].value, '#cc2222');
  assert.equal(nb.neutral.light, '#ffffff');
  assert.match(nb.neutral.surface, /^#[0-9a-f]{6}$/);
  assert.match(nb.neutral.muted, /^#[0-9a-f]{6}$/);
  assert.deepEqual(nb.secondary, []);
});

test('seed functions are stable', () => {
  assert.equal(hash('curator'), hash('curator'));
  assert.ok(hash('a') >= 0 && Number.isInteger(hash('a')));
  const a = rng(5), b = rng(5);
  assert.equal(a(), b());
});
