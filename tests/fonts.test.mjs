import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubLookup } from './stub-lookup.mjs';
import { checkFonts as checkFontsWith, collectFamilies, googleUrl, parseFontFaces, resolveFonts as resolveFontsWith, rewriteCss } from '../scripts/lib/fonts.mjs';
import { buildSite as buildSiteWith } from '../scripts/lib/build-site.mjs';
import { checkSiteWithFonts as checkSiteWith } from '../scripts/lib/validate.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));
const DEFAULT_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..900,0..100;1,9..144,300..900,0..100&family=Archivo:wght@400..900&family=IBM+Plex+Mono:wght@400;500;600&family=Special+Elite&family=Caveat:wght@700&display=swap';
const DEFAULTS = { display: 'Fraunces', body: 'Archivo', mono: 'IBM Plex Mono', poster: 'Archivo' };
const quiet = () => {};
const resolveFonts = (args) => resolveFontsWith({ lookup: stubLookup, ...args });
const checkFonts = (args) => checkFontsWith({ lookup: stubLookup, ...args });
const buildSite = (args) => buildSiteWith({ lookup: stubLookup, ...args });
const checkSiteWithFonts = (root, opts) => checkSiteWith(root, { lookup: stubLookup, ...opts });

let server;
let port;
let hits;
let cssFor;
let temps = [];

// Answers by path. A css2 request goes to cssFor, and /s/ requests serve a fake font file.
before(async () => {
  server = createServer((req, res) => {
    hits.push(req.url);
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/css2') {
      const answer = cssFor(url.search, req.headers['user-agent']);
      res.writeHead(answer.status, { 'content-type': answer.type ?? 'text/css; charset=utf-8' });
      res.end(answer.body ?? '');
    } else if (url.pathname.startsWith('/s/')) {
      res.writeHead(url.pathname.includes('missing') ? 404 : 200, { 'content-type': 'font/woff2' });
      res.end(Buffer.from(`wOF2 ${url.pathname}`));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  hits = [];
  cssFor = () => ({ status: 200, body: '/* ok */' });
});

// Sends the two font hosts to the local server and leaves every other address alone.
const fetchImpl = (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
  }
  throw new Error(`unexpected request to ${url.hostname}`);
};
const failingFetch = () => Promise.reject(new TypeError('fetch failed'));

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'curator-fonts-'));
  temps.push(dir);
  return dir;
}

const cfg = ({ basic = {}, advanced = {} } = {}) => ({
  basic: { fonts: { ...DEFAULTS, ...basic } },
  advanced: { fonts: { typewriter: 'Special Elite', handwriting: 'Caveat', source: 'google', googleFontsUrl: null, ...advanced } },
});

const STYLESHEET = `/* latin-ext */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/ext.woff2) format('woff2');
  unicode-range: U+0100-02AF, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* latin */
@font-face {
  font-family: 'Caveat';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("https://fonts.gstatic.com/s/caveat/v1/latin.woff2") format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin again, sharing one file */
@font-face {
  font-family: 'Caveat';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/caveat/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

test('the families of the six roles keep role order and drop repeats', () => {
  assert.deepEqual(collectFamilies(cfg()), ['Fraunces', 'Archivo', 'IBM Plex Mono', 'Special Elite', 'Caveat']);
  assert.deepEqual(collectFamilies(cfg({ basic: { poster: 'Anton', body: 'Fraunces' } })), ['Fraunces', 'IBM Plex Mono', 'Anton', 'Special Elite', 'Caveat']);
});

test('the default config makes the exact address of the old links, without Anton', async () => {
  const r = await resolveFonts({ config: cfg(), root: tempRoot(), fetchImpl });
  assert.equal(googleUrl(collectFamilies(cfg())), DEFAULT_URL);
  assert.equal(r.html, ['<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>', `<link href="${DEFAULT_URL.replace(/&/g, '&amp;')}" rel="stylesheet">`].join('\n    '));
  assert.ok(!r.html.includes('Anton'));
  assert.deepEqual(hits, []);
  assert.deepEqual([r.errors, r.warnings], [[], []]);
});

test('googleFontsUrl is used as it is and no request is made', async () => {
  const own = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400&family=Mystery+Face&display=block';
  const r = await resolveFonts({ config: cfg({ advanced: { googleFontsUrl: own } }), root: tempRoot(), fetchImpl });
  assert.ok(r.html.includes(`<link href="${own.replace(/&/g, '&amp;')}" rel="stylesheet">`));
  assert.deepEqual(hits, []);
});

test('an unknown family is checked with weights first and cached', async () => {
  const root = tempRoot();
  const config = cfg({ basic: { poster: 'Space Grotesk' } });
  const r = await resolveFonts({ config, root, fetchImpl });
  assert.ok(r.html.includes('family=Space+Grotesk:wght@400;700&amp;family=Special'));
  assert.equal(hits.length, 1);
  assert.match(hits[0], /family=Space\+Grotesk:wght@400;700/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.cache', 'fonts.json'), 'utf8')).specs, { 'Space Grotesk': 'wght@400;700' });
  hits = [];
  const again = await resolveFonts({ config, root, fetchImpl: failingFetch });
  assert.deepEqual(hits, []);
  assert.equal(again.html, r.html);
  assert.deepEqual(again.warnings, []);
});

test('a 400 for the weights falls back to the bare family', async () => {
  cssFor = (search) => (search.includes('wght') ? { status: 400, body: 'bad' } : { status: 200, body: '/* ok */' });
  const root = tempRoot();
  const r = await resolveFonts({ config: cfg({ basic: { poster: 'Pacifico' } }), root, fetchImpl });
  assert.equal(hits.length, 2);
  assert.ok(r.html.includes('family=Pacifico&amp;family=Special'));
  assert.ok(!r.html.includes('Pacifico:'));
  assert.equal(JSON.parse(readFileSync(join(root, '.cache', 'fonts.json'), 'utf8')).specs.Pacifico, '');
});

test('a family that answers 400 every way is an error', async () => {
  cssFor = () => ({ status: 400, body: 'bad' });
  const r = await resolveFonts({ config: cfg({ basic: { poster: 'Nopee Sans' } }), root: tempRoot(), fetchImpl });
  assert.deepEqual(r.errors, ['curator.config.json: font "Nopee Sans" was not found on Google Fonts. Check the spelling, or choose a family that Google Fonts offers. Both font sources load families from Google Fonts.']);
  assert.equal(r.html, '');
});

test('a network failure is a warning, requests the bare family and is not cached', async () => {
  const root = tempRoot();
  const r = await resolveFonts({ config: cfg({ basic: { poster: 'Pacifico' } }), root, fetchImpl: failingFetch });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['curator.config.json: font "Pacifico" could not be checked with Google Fonts (the request failed). It is requested without weights.']);
  assert.ok(r.html.includes('family=Pacifico&amp;family=Special'));
  assert.ok(!existsSync(join(root, '.cache', 'fonts.json')));
});

test('checkFonts reports the same error and skips self hosting and custom addresses', async () => {
  cssFor = () => ({ status: 400, body: 'bad' });
  const bad = cfg({ basic: { poster: 'Nopee Sans' } });
  assert.equal((await checkFonts({ config: bad, root: tempRoot(), fetchImpl })).errors.length, 1);
  hits = [];
  assert.deepEqual(await checkFonts({ config: cfg({ basic: { poster: 'Nopee Sans' }, advanced: { source: 'self' } }), root: tempRoot(), fetchImpl }), { errors: [], warnings: [] });
  assert.deepEqual(hits, []);
});

test('offline mode makes no request and uses the cache only', async () => {
  const root = tempRoot();
  const config = cfg({ basic: { poster: 'Space Grotesk', mono: 'Pacifico' } });
  await resolveFonts({ config: cfg({ basic: { poster: 'Space Grotesk' } }), root, fetchImpl });
  hits = [];
  const r = await resolveFonts({ config, root, fetchImpl: failingFetch, offline: true });
  assert.deepEqual(hits, []);
  assert.deepEqual([r.errors, r.warnings], [[], []]);
  assert.ok(r.html.includes('family=Space+Grotesk:wght@400;700'));
  assert.ok(r.html.includes('family=Pacifico&amp;'));
});

test('font face parsing finds every distinct file and rewriting keeps the rest', () => {
  assert.deepEqual(parseFontFaces(STYLESHEET), [
    'https://fonts.gstatic.com/s/fraunces/v1/ext.woff2',
    'https://fonts.gstatic.com/s/fraunces/v1/latin.woff2',
    'https://fonts.gstatic.com/s/caveat/v1/latin.woff2',
  ]);
  const out = rewriteCss(STYLESHEET, new Map(parseFontFaces(STYLESHEET).map((u, i) => [u, `/fonts/f${i}.woff2`])));
  assert.ok(!out.includes('gstatic'));
  assert.equal((out.match(/url\(\/fonts\/f\d\.woff2\)/g) ?? []).length, 4);
  assert.ok(out.includes('unicode-range: U+0100-02AF, U+1E00-1EFF;'));
  assert.ok(out.includes('font-display: swap;'));
  assert.ok(out.includes('/* latin-ext */'));
});

test('self hosting downloads each file once, rewrites the sheet and reuses the cache', async () => {
  const agents = [];
  cssFor = (search, agent) => {
    agents.push(agent);
    return { status: 200, body: STYLESHEET };
  };
  const root = tempRoot();
  const config = cfg({ advanced: { source: 'self' } });
  const r = await resolveFonts({ config, root, fetchImpl });
  assert.deepEqual([r.errors, r.warnings], [[], []]);
  assert.equal(hits.filter((h) => h.startsWith('/s/')).length, 3);
  assert.equal(hits.filter((h) => h.startsWith('/css2')).length, 1);
  assert.match(agents[0], /^Mozilla\/5\.0 .*Chrome\//);
  assert.equal(r.files.length, 3);
  for (const f of r.files) {
    assert.match(f.to, /^fonts\/[0-9a-f]{16}\.woff2$/);
    assert.ok(existsSync(f.from));
  }
  assert.match(r.sheet.name, /^fonts-[0-9a-f]{10}\.css$/);
  assert.equal(r.html, `<link rel="stylesheet" href="/fonts/${r.sheet.name}">`);
  assert.ok(!/gstatic|googleapis/.test(r.sheet.text));
  assert.equal((r.sheet.text.match(/unicode-range/g) ?? []).length, 4);
  for (const f of r.files) assert.ok(r.sheet.text.includes(`/${f.to}`));
  const cache = JSON.parse(readFileSync(join(root, '.cache', 'fonts.json'), 'utf8'));
  assert.equal(Object.keys(cache.files).length, 3);

  hits = [];
  const again = await resolveFonts({ config, root, fetchImpl: failingFetch });
  assert.deepEqual(hits, []);
  assert.equal(again.sheet.name, r.sheet.name);
  const offline = await resolveFonts({ config, root, fetchImpl: failingFetch, offline: true });
  assert.equal(offline.html, r.html);
});

test('self hosting without network or cache warns and writes no link', async () => {
  const r = await resolveFonts({ config: cfg({ advanced: { source: 'self' } }), root: tempRoot(), fetchImpl: failingFetch });
  assert.equal(r.html, '');
  assert.deepEqual(r.warnings, ['fonts could not be downloaded for self hosting (the request failed). The fallback fonts are used.']);
  const off = await resolveFonts({ config: cfg({ advanced: { source: 'self' } }), root: tempRoot(), fetchImpl: failingFetch, offline: true });
  assert.equal(off.html, '');
  assert.equal(off.warnings.length, 1);
});

test('a failing font file or an oversized stylesheet falls back with a warning', async () => {
  cssFor = () => ({ status: 200, body: STYLESHEET.replace('ext.woff2', 'missing.woff2') });
  const r = await resolveFonts({ config: cfg({ advanced: { source: 'self' } }), root: tempRoot(), fetchImpl });
  assert.equal(r.html, '');
  assert.match(r.warnings[0], /^fonts could not be downloaded for self hosting \(the server answered 404\)/);
  cssFor = () => ({ status: 200, body: 'x'.repeat(2000001) });
  const big = await resolveFonts({ config: cfg({ advanced: { source: 'self' } }), root: tempRoot(), fetchImpl });
  assert.match(big.warnings[0], /the file is too large/);
});

// Copies the valid fixture into a temp site with image fetching off.
function makeSite(fonts) {
  const root = join(tempRoot(), 'site');
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, 'curator.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  config.advanced = { images: { fetch: false }, fonts };
  writeFileSync(file, JSON.stringify(config, null, 2));
  return root;
}

function allFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

test('a google build fills the token on every page', async () => {
  const root = makeSite({});
  const r = await buildSite({ root, log: quiet, fetchImpl });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const pages = allFiles(join(root, 'dist')).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 7);
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    assert.ok(html.includes(DEFAULT_URL.replace(/&/g, '&amp;')), page);
    assert.ok(!html.includes('{{fonts}}'));
  }
  assert.ok(!existsSync(join(root, 'dist', 'fonts')));
});

test('a self build writes the font files and sheet and leaves no third-party host', async () => {
  cssFor = () => ({ status: 200, body: STYLESHEET });
  const root = makeSite({ source: 'self' });
  const r = await buildSite({ root, log: quiet, fetchImpl });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const names = readdirSync(join(root, 'dist', 'fonts')).sort();
  assert.equal(names.filter((n) => /^[0-9a-f]{16}\.woff2$/.test(n)).length, 3);
  const sheets = names.filter((n) => /^fonts-[0-9a-f]{10}\.css$/.test(n));
  assert.equal(sheets.length, 1);
  assert.equal(names.length, 4);
  const index = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  assert.ok(index.includes(`<link rel="stylesheet" href="/fonts/${sheets[0]}">`));
  assert.ok(!index.includes('preconnect'));
  for (const file of allFiles(join(root, 'dist'))) {
    if (statSync(file).size > 0) assert.ok(!/googleapis|gstatic/.test(readFileSync(file, 'latin1')), file);
  }
});

test('a self build with no network and no cache still builds without a font link', async () => {
  const root = makeSite({ source: 'self' });
  const r = await buildSite({ root, log: quiet, fetchImpl: failingFetch, offline: true });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
  assert.ok(!readFileSync(join(root, 'dist', 'index.html'), 'utf8').includes('fonts-'));
  assert.ok(!/<link[^>]*font/.test(readFileSync(join(root, 'dist', 'index.html'), 'utf8')));
});

test('a build stops on a font Google does not have, and check reports it', async () => {
  cssFor = () => ({ status: 400, body: 'bad' });
  const root = makeSite({ handwriting: 'Nopee Sans' });
  const r = await buildSite({ root, log: quiet, fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /font "Nopee Sans" was not found on Google Fonts/);
  const checked = await checkSiteWithFonts(root, { fetchImpl });
  assert.equal(checked.errors.length, 1);
  const offline = await checkSiteWithFonts(root, { fetchImpl: failingFetch, offline: true });
  assert.deepEqual(offline.errors, []);
});

test('self hosting never fetches a font file at a private address', async () => {
  cssFor = () => ({ status: 200, body: STYLESHEET.replace('https://fonts.gstatic.com/s/fraunces/v1/ext.woff2', 'http://127.0.0.1/f.woff2') });
  const seen = [];
  const watching = (input, init) => {
    seen.push(String(input));
    return fetchImpl(input, init);
  };
  const r = await resolveFonts({ config: cfg({ advanced: { source: 'self' } }), root: tempRoot(), fetchImpl: watching });
  assert.ok(!seen.some((u) => u.includes('127.0.0.1')));
  assert.equal(r.html, '');
  assert.match(r.warnings[0], /^fonts could not be downloaded for self hosting \(the address is not public\)/);
});
