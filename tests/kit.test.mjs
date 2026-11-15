import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poster, assignPosters, COUNT, NAMES } from '../src/js/kit.js';
import { buildPalette } from '../src/js/palette.js';
import { hash } from '../src/js/seed.js';

const brand = { primary: [{ name: 'Red', value: '#cc2222' }, { name: 'Blue', value: '#2244aa' }], secondary: [{ name: 'Green', value: '#228844' }], accent: [{ name: 'Gold', value: '#eeaa22' }], neutral: { light: '#f4efe4', dark: '#1a1a1a' } };
const T = buildPalette(brand, { inverseShare: 0.25, primaryShare: 0.65, minContrast: 1.6 });
const item = (title) => ({ key: 'k-' + title, title, no: '03', domain: 'example.com' });

// Checks that every tag opens and closes in order, ignoring self-closing tags.
function balanced(s) {
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0;
}

test('constants', () => {
  assert.equal(COUNT, 16);
  assert.equal(NAMES.length, 16);
  assert.equal(NAMES[0], 'Sun and stripes');
  assert.equal(NAMES[15], 'Crossing bars');
});

test('every composition renders well formed SVG at three shapes', () => {
  const it = item('A fairly long title for wrapping across lines');
  const inks = T.palette(it.key);
  for (let v = 0; v < 16; v++) {
    for (const [w, h] of [[300, 200], [350, 100], [200, 300]]) {
      const s = poster(it, w, h, inks, { v });
      assert.ok(s.startsWith('<svg'), 'start ' + v);
      assert.ok(s.endsWith('</svg>'), 'end ' + v);
      assert.ok(balanced(s), 'balanced ' + v + ' ' + w + 'x' + h);
      assert.ok(!/NaN|undefined/.test(s), 'NaN or undefined in ' + v + ' ' + w + 'x' + h);
      assert.ok(s.includes('url(#kit-grain)'));
    }
  }
});

test('posters work with default composition, palette per key and options', () => {
  for (const t of ['One', 'Two words', 'Three little words']) {
    const it = item(t), s = poster(it, 300, 200, T.palette(it.key));
    assert.ok(balanced(s));
    const again = poster(it, 300, 200, T.palette(it.key), { v: hash(it.key + '|pv') % 16 });
    assert.equal(s.replace(/\bk\d+\b/g, 'id'), again.replace(/\bk\d+\b/g, 'id'));
  }
  const it = item('Fonts');
  const s = poster(it, 300, 200, T.palette(it.key), { v: 8, id: 'mine', fonts: { band: 'Anton', mono: 'Courier' } });
  assert.ok(s.includes('id="mine"') && s.includes('url(#mine)'));
  assert.ok(s.includes('font-family="Anton"') && s.includes('font-family="Courier"'));
  assert.ok(balanced(s));
  const ids = [...s.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('text is escaped', () => {
  const it = { key: 'x', title: '<b>&"\'</b>', no: '01', domain: '<d&"\'>' };
  for (const v of [0, 8, 15]) {
    const s = poster(it, 300, 200, T.palette('x'), { v });
    assert.ok(!s.includes('<b>'));
    assert.ok(s.includes('&lt;B&gt;&amp;&quot;&#39;&lt;/B&gt;'));
    assert.ok(s.includes('&lt;d&amp;&quot;&#39;&gt;'));
    assert.ok(balanced(s));
  }
});

const keys = (n, p = 'item-') => Array.from({ length: n }, (_, i) => p + i);

test('assignPosters gives no repeats for 16 keys', () => {
  const v = assignPosters(keys(16), 'all');
  assert.equal(v.length, 16);
  assert.equal(new Set(v).size, 16);
  v.forEach((x) => assert.ok(x >= 0 && x <= 15));
});

test('assignPosters starts at the hashed composition and cycles after 16', () => {
  const k = keys(20), v = assignPosters(k, 'all');
  assert.equal(v[0], hash(k[0] + '|pv') % 16);
  assert.equal(new Set(v.slice(0, 16)).size, 16);
  v.slice(16).forEach((x, i) => assert.equal(x, hash(k[16 + i] + '|pv') % 16));
});

test('assignPosters respects an allowed list', () => {
  const v = assignPosters(keys(10), [2, 5, 9]);
  v.forEach((x) => assert.ok([1, 4, 8].includes(x), 'value ' + x));
  assert.equal(new Set(v.slice(0, 3)).size, 3);
});

test('assignPosters is deterministic and handles empty input', () => {
  assert.deepEqual(assignPosters(keys(12), 'all'), assignPosters(keys(12), 'all'));
  assert.deepEqual(assignPosters([], 'all'), []);
});
