import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubLookup } from './stub-lookup.mjs';
import { parseCollection } from '../scripts/lib/parse.mjs';
import { resolveImages as resolveWith, youtubeId, githubPreviewUrl, findMetaImage } from '../scripts/lib/images.mjs';

function pngBytes(w, h, total = 100) {
  const b = Buffer.alloc(Math.max(total, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function jpegBytes(w, h, total) {
  const b = Buffer.alloc(total, 0x11);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 0);
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}

const SQUARE = pngBytes(100, 100);
const WIDE = pngBytes(400, 100);
const BIG = pngBytes(100, 100, 20000);
const SVG = Buffer.from('<svg width="10" height="10"></svg>');

let server;
let base;
let origin;
let hits;
let dirs = [];

// Sends pages.example.com to the local server, because the build refuses loopback addresses.
const local = (input, init) => {
  const u = new URL(String(input));
  if (u.hostname === 'pages.example.com') return fetch(`${origin}${u.pathname}${u.search}`, init);
  if (u.hostname === 'down.example.com') return fetch(`http://127.0.0.1:1${u.pathname}`, init);
  throw new Error(`unexpected request to ${u.hostname}`);
};
const resolveImages = (args) => resolveWith({ fetchImpl: local, lookup: stubLookup, ...args });

const html = (head) => `<!doctype html><html><head>${head}</head><body></body></html>`;

before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits[path] = (hits[path] ?? 0) + 1;
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    const page = (head) => send(200, 'text/html; charset=utf-8', html(head));
    switch (path) {
      case '/og-abs': return page(`<meta property="og:image" content="${base}/img/square.png">`);
      case '/og-rel': return page('<meta property="og:image" content="/img/square.png">');
      case '/og-url': return page(`<meta property="og:image:url" content="${base}/img/wide.png">`);
      case '/twitter': return page('<meta name="twitter:image" content="/img/wide.png">');
      case '/twitter-src': return page('<meta name="twitter:image:src" content="/img/wide.png">');
      case '/both': return page('<meta name="twitter:image" content="/img/wide.png"><meta property="og:image" content="/img/square.png">');
      case '/nometa': return page('<meta name="description" content="Nothing here">');
      case '/reversed': return page('<meta content="/img/square.png" property="og:image" />');
      case '/quotes': return page("<meta   content='/img/q.png?a=1&amp;b=2' name = 'twitter:image'>");
      case '/redirect': res.writeHead(302, { Location: '/dir/og-rel-nested' }); return res.end();
      case '/dir/og-rel-nested': return page('<meta property="og:image" content="../img/wide.png">');
      case '/direct': return send(200, 'image/png', SQUARE);
      case '/textimg': return page('<meta property="og:image" content="/img/plain">');
      case '/img/plain': return send(200, 'text/plain', SQUARE);
      case '/bigimg': return page('<meta property="og:image" content="/img/big.png">');
      case '/img/big.png': return send(200, 'image/png', BIG);
      case '/svgimg': return page('<meta property="og:image" content="/img/x.svg">');
      case '/img/x.svg': return send(200, 'image/svg+xml', SVG);
      case '/slow': setTimeout(() => { try { send(200, 'text/html', html('')); } catch { /* closed */ } }, 5000); return undefined;
      case '/img/square.png': return send(200, 'image/png', SQUARE);
      case '/img/wide.png': return send(200, 'image/png', WIDE);
      case '/img/q.png': return send(200, 'image/png', SQUARE);
      case '/img/notimage': return send(200, 'image/png', Buffer.from('not an image at all'));
      case '/badformat': return page('<meta property="og:image" content="/img/notimage">');
      case '/yt/maxres': return send(200, 'image/jpeg', jpegBytes(1280, 720, 5000));
      case '/yt/hq': return send(200, 'image/jpeg', jpegBytes(480, 360, 4000));
      case '/yt/grey': return send(200, 'image/jpeg', jpegBytes(120, 90, 4000));
      case '/yt/tiny': return send(200, 'image/jpeg', jpegBytes(1280, 720, 1500));
      case '/gh/img': return send(200, 'image/png', pngBytes(1200, 600, 3000));
      default: return send(404, 'text/plain', 'missing');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  base = 'http://pages.example.com';
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function site(items, files = {}) {
  hits = {};
  const root = mkdtempSync(join(tmpdir(), 'curator-images-'));
  dirs.push(root);
  mkdirSync(join(root, 'content', 'images'), { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(root, 'content', name), data);
  const text = `---\ntitle: Sample\n---\n\n${items.map((i) => `## ${i.title}\nurl: ${i.url}\nimage: ${i.image ?? 'auto'}\n`).join('\n')}`;
  const collections = [parseCollection(text, { id: 'sample', file: 'content/sample.md' })];
  return { root, collections };
}

const cfg = (images = {}) => ({ advanced: { images: { fetch: true, timeoutMs: 3000, maxBytes: 5000, fitDomains: ['github.com'], ...images } } });
const one = (path, extra = {}) => site([{ title: 'Thing', url: `${base}${path}`, ...extra }]);
const value = (out) => out.images.get('sample/thing');
const manifest = (root) => JSON.parse(readFileSync(join(root, '.cache', 'images.json'), 'utf8'));

async function failure(path, reason, images = {}) {
  const s = one(path);
  const out = await resolveImages({ ...s, config: cfg(images) });
  assert.equal(value(out), null);
  assert.deepEqual(out.warnings, [`content/sample.md, "Thing" (line 5): no preview image found for ${base}${path} (${reason}). A poster is used instead.`]);
  assert.equal(existsSync(join(s.root, '.cache', 'images.json')), false);
}

test('og:image with an absolute address is fetched and cached', async () => {
  const s = one('/og-abs');
  const logs = [];
  const out = await resolveImages({ ...s, config: cfg(), log: (l) => logs.push(l) });
  const img = value(out);
  assert.equal(out.warnings.length, 0);
  assert.equal(img.origin, 'fetched');
  assert.equal(img.type, 'png');
  assert.equal(img.width, 100);
  assert.equal(img.height, 100);
  assert.equal(img.bytes, SQUARE.length);
  assert.equal(img.fit, false);
  assert.match(img.file, /[\\/]\.cache[\\/]images[\\/][0-9a-f]{16}\.png$/);
  assert.deepEqual(readFileSync(img.file), SQUARE);
  assert.deepEqual(logs, ['fetched sample/thing']);
  const m = manifest(s.root);
  assert.equal(m.version, 1);
  const entry = m.entries[`${base}/og-abs`];
  assert.deepEqual(Object.keys(entry), ['source', 'file', 'type', 'width', 'height', 'bytes', 'fetched']);
  assert.equal(entry.source, `${base}/img/square.png`);
  assert.equal(entry.file, img.file.split(/[\\/]/).pop());
  assert.ok(!Number.isNaN(Date.parse(entry.fetched)));
  assert.ok(readFileSync(join(s.root, '.cache', 'images.json'), 'utf8').startsWith('{\n  "version": 1,'));
});

test('a relative og:image resolves against the page', async () => {
  const out = await resolveImages({ ...one('/og-rel'), config: cfg() });
  assert.equal(value(out).width, 100);
});

test('og:image:url, twitter:image and twitter:image:src are read', async () => {
  for (const path of ['/og-url', '/twitter', '/twitter-src']) {
    const out = await resolveImages({ ...one(path), config: cfg() });
    assert.equal(value(out).width, 400, path);
    assert.equal(value(out).fit, true, path);
  }
});

test('og:image wins over twitter:image', async () => {
  const out = await resolveImages({ ...one('/both'), config: cfg() });
  assert.equal(value(out).width, 100);
});

test('attribute order, single quotes and entities are handled', async () => {
  const out = await resolveImages({ ...one('/reversed'), config: cfg() });
  assert.equal(value(out).width, 100);
  const q = one('/quotes');
  const out2 = await resolveImages({ ...q, config: cfg() });
  assert.equal(value(out2).width, 100);
  assert.equal(manifest(q.root).entries[`${base}/quotes`].source, `${base}/img/q.png?a=1&b=2`);
});

test('a redirect to a page resolves relative addresses against the final address', async () => {
  const out = await resolveImages({ ...one('/redirect'), config: cfg() });
  assert.equal(value(out).width, 400);
});

test('a direct image response is used as it is', async () => {
  const s = one('/direct');
  const out = await resolveImages({ ...s, config: cfg() });
  assert.equal(value(out).width, 100);
  assert.equal(manifest(s.root).entries[`${base}/direct`].source, `${base}/direct`);
});

test('failures give one warning and a poster', async () => {
  await failure('/nometa', 'the page names no preview image');
  await failure('/textimg', 'the response is not an image');
  await failure('/bigimg', 'the file is too large');
  await failure('/svgimg', 'remote SVG images are not used');
  await failure('/slow', 'the request timed out', { timeoutMs: 300 });
  await failure('/missing', 'the server answered 404');
  await failure('/badformat', 'the image format is not recognised');
});

test('a failed request is reported', async () => {
  const s = site([{ title: 'Thing', url: 'http://down.example.com/nothing' }]);
  const out = await resolveImages({ ...s, config: cfg() });
  assert.equal(value(out), null);
  assert.match(out.warnings[0], /\(the request failed\)\. A poster is used instead\.$/);
});

test('warning text uses no semicolons or em dashes', async () => {
  const s = one('/nometa');
  const out = await resolveImages({ ...s, config: cfg() });
  assert.ok(!/[;\u2014]/.test(out.warnings[0]));
});

test('the cache is reused with no requests and the manifest is not rewritten', async () => {
  const s = one('/og-abs');
  const first = await resolveImages({ ...s, config: cfg() });
  const text = readFileSync(join(s.root, '.cache', 'images.json'), 'utf8');
  hits = {};
  const second = await resolveImages({ ...s, config: cfg() });
  assert.deepEqual(hits, {});
  assert.equal(value(second).origin, 'cache');
  assert.equal(value(second).file, value(first).file);
  assert.equal(readFileSync(join(s.root, '.cache', 'images.json'), 'utf8'), text);
});

test('a cache entry whose file is gone is fetched again', async () => {
  const s = one('/og-abs');
  const first = await resolveImages({ ...s, config: cfg() });
  rmSync(value(first).file);
  hits = {};
  const second = await resolveImages({ ...s, config: cfg() });
  assert.equal(value(second).origin, 'fetched');
  assert.equal(hits['/og-abs'], 1);
});

test('refresh true refetches everything and per item refetches one', async () => {
  const s = site([{ title: 'Thing', url: `${base}/og-abs` }, { title: 'Other', url: `${base}/og-rel` }]);
  await resolveImages({ ...s, config: cfg() });
  hits = {};
  const all = await resolveImages({ ...s, config: cfg(), refresh: true });
  assert.equal(hits['/og-abs'], 1);
  assert.equal(hits['/og-rel'], 1);
  assert.equal(all.images.get('sample/thing').origin, 'fetched');
  hits = {};
  const some = await resolveImages({ ...s, config: cfg(), refresh: 'sample/other' });
  assert.equal(hits['/og-abs'], undefined);
  assert.equal(hits['/og-rel'], 1);
  assert.equal(some.images.get('sample/thing').origin, 'cache');
  assert.equal(some.images.get('sample/other').origin, 'fetched');
});

test('fetch off with no cache warns and uses a poster without requests', async () => {
  const s = one('/og-abs');
  const out = await resolveImages({ ...s, config: cfg({ fetch: false }) });
  assert.equal(value(out), null);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /no preview image found for .* \(fetching is turned off and the image is not cached\)/);
  assert.deepEqual(hits, {});
});

test('fetch off still uses the cache, even when a refresh is asked for', async () => {
  const s = one('/og-abs');
  await resolveImages({ ...s, config: cfg() });
  hits = {};
  const out = await resolveImages({ ...s, config: cfg({ fetch: false }), refresh: true });
  assert.equal(value(out).origin, 'cache');
  assert.equal(out.warnings.length, 0);
  assert.deepEqual(hits, {});
});

test('entries for urls no longer used are kept', async () => {
  const s = one('/og-abs');
  await resolveImages({ ...s, config: cfg() });
  const again = site([{ title: 'Thing', url: `${base}/og-rel` }]);
  mkdirSync(join(again.root, '.cache'), { recursive: true });
  writeFileSync(join(again.root, '.cache', 'images.json'), readFileSync(join(s.root, '.cache', 'images.json')));
  mkdirSync(join(again.root, '.cache', 'images'), { recursive: true });
  await resolveImages({ ...again, config: cfg() });
  assert.deepEqual(Object.keys(manifest(again.root).entries).sort(), [`${base}/og-abs`, `${base}/og-rel`]);
});

test('fit follows the aspect ratio and the domain list', async () => {
  const wide = await resolveImages({ ...one('/twitter'), config: cfg() });
  assert.equal(value(wide).fit, true);
  const square = await resolveImages({ ...one('/og-abs'), config: cfg() });
  assert.equal(value(square).fit, false);
  const byDomain = await resolveImages({ ...one('/og-abs'), config: cfg({ fitDomains: ['pages.example.com'] }) });
  assert.equal(value(byDomain).fit, true);
  const sub = site([{ title: 'Thing', url: `${base}/og-abs` }]);
  sub.collections[0].items[0].domain = 'docs.github.com';
  const out = await resolveImages({ ...sub, config: cfg() });
  assert.equal(value(out).fit, true);
  sub.collections[0].items[0].domain = 'notgithub.com';
  const out2 = await resolveImages({ ...sub, config: cfg(), refresh: false });
  assert.equal(value(out2).fit, false);
});

test('exactly 1.75 is not fitted and just over is', async () => {
  const s = site([{ title: 'Thing', url: `${base}/og-abs`, image: './images/a.png' }, { title: 'Over', url: `${base}/og-abs`, image: './images/b.png' }], {
    'images/a.png': pngBytes(175, 100),
    'images/b.png': pngBytes(176, 100),
  });
  const out = await resolveImages({ ...s, config: cfg() });
  assert.equal(out.images.get('sample/thing').fit, false);
  assert.equal(out.images.get('sample/over').fit, true);
});

test('uploads read their size, svg may have none, and none gives null', async () => {
  const s = site([
    { title: 'Photo', url: 'https://example.com/a', image: './images/p.png' },
    { title: 'Vector', url: 'https://example.com/b', image: './images/v.svg' },
    { title: 'Plain', url: 'https://example.com/c', image: './images/n.svg' },
    { title: 'Skip', url: 'https://example.com/d', image: 'None' },
  ], {
    'images/p.png': pngBytes(300, 200),
    'images/v.svg': '<svg viewBox="0 0 20 10"></svg>',
    'images/n.svg': '<svg></svg>',
  });
  const out = await resolveImages({ ...s, config: cfg() });
  assert.equal(out.warnings.length, 0);
  const photo = out.images.get('sample/photo');
  assert.deepEqual({ ...photo, file: undefined }, { file: undefined, type: 'png', width: 300, height: 200, bytes: 100, fit: false, origin: 'upload' });
  assert.equal(photo.file, join(s.root, 'content', 'images', 'p.png'));
  const vector = out.images.get('sample/vector');
  assert.equal(vector.width, 20);
  assert.equal(vector.fit, true);
  const plain = out.images.get('sample/plain');
  assert.equal(plain.type, 'svg');
  assert.equal(plain.width, null);
  assert.equal(plain.fit, false);
  assert.equal(out.images.get('sample/skip'), null);
  assert.equal(existsSync(join(s.root, '.cache', 'images.json')), false);
});

test('an upload with an unreadable size warns and uses a poster', async () => {
  const s = site([{ title: 'Thing', url: 'https://example.com/a', image: './images/bad.png' }], { 'images/bad.png': 'not an image' });
  const out = await resolveImages({ ...s, config: cfg() });
  assert.equal(value(out), null);
  assert.deepEqual(out.warnings, ['content/sample.md, "Thing" (line 5): the size of image "./images/bad.png" could not be read. A poster is used instead.']);
});

test('items sharing a url are fetched once', async () => {
  const s = site([{ title: 'Thing', url: `${base}/og-abs` }, { title: 'Twin', url: `${base}/og-abs` }]);
  const out = await resolveImages({ ...s, config: cfg() });
  assert.equal(hits['/og-abs'], 1);
  assert.equal(out.images.get('sample/twin').width, 100);
});

test('at most four fetches run at once', async () => {
  let active = 0;
  let peak = 0;
  const fetchImpl = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return new Response(SQUARE, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  const items = Array.from({ length: 10 }, (_, i) => ({ title: `Item ${i}`, url: `https://example.com/${i}` }));
  const out = await resolveImages({ ...site(items), config: cfg(), fetchImpl });
  assert.equal(peak, 4);
  assert.equal(out.warnings.length, 0);
});

test('every fetch sends the generic user agent and checks redirects itself', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init);
    return new Response(SQUARE, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  await resolveImages({ ...site([{ title: 'Thing', url: 'https://example.com/a' }]), config: cfg(), fetchImpl });
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers['User-Agent'], 'Curator link preview builder');
  assert.ok(calls[0].signal instanceof AbortSignal);
});

// Sends i.ytimg.com and opengraph.githubassets.com requests to the local server.
function rewriting(map) {
  const seen = [];
  const fetchImpl = (url, init) => {
    const u = new URL(url);
    seen.push(url);
    for (const [host, route] of Object.entries(map)) {
      if (u.hostname === host) {
        const target = typeof route === 'function' ? route(u) : route;
        return fetch(`${origin}${target}`, init);
      }
    }
    return local(url, init);
  };
  return { fetchImpl, seen };
}

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('youtube uses the maxres thumbnail when it is real', async () => {
  const { fetchImpl, seen } = rewriting({ 'i.ytimg.com': '/yt/maxres' });
  const s = site([{ title: 'Thing', url: YT }]);
  const out = await resolveImages({ ...s, config: cfg({ maxBytes: 100000 }), fetchImpl });
  assert.equal(value(out).width, 1280);
  assert.equal(value(out).type, 'jpeg');
  assert.match(value(out).file, /\.jpg$/);
  assert.deepEqual(seen, ['https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg']);
  assert.equal(manifest(s.root).entries[YT].source, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
});

test('youtube falls back to hqdefault when maxres is missing, tiny or the grey placeholder', async () => {
  for (const first of ['/missing', '/yt/tiny', '/yt/grey']) {
    const { fetchImpl, seen } = rewriting({ 'i.ytimg.com': (u) => (u.pathname.endsWith('maxresdefault.jpg') ? first : '/yt/hq') });
    const out = await resolveImages({ ...site([{ title: 'Thing', url: YT }]), config: cfg({ maxBytes: 100000 }), fetchImpl });
    assert.equal(value(out).width, 480, first);
    assert.equal(seen.length, 2, first);
    assert.match(seen[1], /hqdefault\.jpg$/);
  }
});

test('youtube with only placeholders gives a warning and a poster', async () => {
  const { fetchImpl } = rewriting({ 'i.ytimg.com': '/yt/grey' });
  const out = await resolveImages({ ...site([{ title: 'Thing', url: YT }]), config: cfg({ maxBytes: 100000 }), fetchImpl });
  assert.equal(value(out), null);
  assert.match(out.warnings[0], /\(only the grey placeholder exists\)\. A poster is used instead\.$/);
});

test('github repositories use the open graph image and fit by domain', async () => {
  const { fetchImpl, seen } = rewriting({ 'opengraph.githubassets.com': '/gh/img' });
  const url = 'https://github.com/sample-owner/sample-repo';
  const out = await resolveImages({ ...site([{ title: 'Thing', url }]), config: cfg({ maxBytes: 100000 }), fetchImpl });
  assert.deepEqual(seen, ['https://opengraph.githubassets.com/1/sample-owner/sample-repo']);
  assert.equal(value(out).width, 1200);
  assert.equal(value(out).fit, true);
});

test('youtube id extraction covers every url form', () => {
  const id = 'dQw4w9WgXcQ';
  const good = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?feature=share&v=${id}&t=5`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=10`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
  ];
  for (const url of good) assert.equal(youtubeId(url), id, url);
  const bad = ['https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://www.youtube.com/@someone', 'https://notyoutube.com/watch?v=dQw4w9WgXcQ', 'https://example.com/youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'not a url'];
  for (const url of bad) assert.equal(youtubeId(url), null, url);
});

test('github preview address needs a github.com repository path', () => {
  assert.equal(githubPreviewUrl('https://github.com/a/b'), 'https://opengraph.githubassets.com/1/a/b');
  assert.equal(githubPreviewUrl('https://github.com/a/b/issues/3'), 'https://opengraph.githubassets.com/1/a/b');
  assert.equal(githubPreviewUrl('https://github.com/a'), null);
  assert.equal(githubPreviewUrl('https://gitlab.com/a/b'), null);
  assert.equal(githubPreviewUrl('https://example.com/a/b'), null);
});

test('meta parsing handles entities and ignores unrelated tags', () => {
  assert.equal(findMetaImage('<meta property="og:image" content="a&amp;b&quot;c&lt;d&gt;e&#x27;f&#39;g">'), 'a&b"c<d>e\'f\'g');
  assert.equal(findMetaImage('<meta property="og:title" content="x"><meta name=twitter:image content=/p.png>'), '/p.png');
  assert.equal(findMetaImage('<p>no tags</p>'), null);
});

test('skipUrls skips the fetch and uses a poster with the session reason', async () => {
  const s = one('/og-abs');
  const out = await resolveImages({ ...s, config: cfg(), skipUrls: new Set([`${base}/og-abs`]) });
  assert.equal(value(out), null);
  assert.deepEqual(out.warnings, [`content/sample.md, "Thing" (line 5): no preview image found for ${base}/og-abs (it failed earlier in this session). A poster is used instead.`]);
  assert.deepEqual(out.failedUrls, []);
  assert.equal(hits['/og-abs'], undefined);
});

test('a cached image is still used when its url is in skipUrls, and failures are reported', async () => {
  const s = one('/og-abs');
  await resolveImages({ ...s, config: cfg() });
  const again = await resolveImages({ ...s, config: cfg(), skipUrls: new Set([`${base}/og-abs`]) });
  assert.equal(value(again).origin, 'cache');
  const bad = one('/missing-page');
  const out = await resolveImages({ ...bad, config: cfg() });
  assert.deepEqual(out.failedUrls, [`${base}/missing-page`]);
});

const redirecting = (routes) => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const route = routes[url];
    return route ? route() : new Response('missing', { status: 404 });
  };
  return { fetchImpl, seen };
};
const pageWith = (head) => new Response(html(head), { status: 200, headers: { 'Content-Type': 'text/html' } });
const picture = () => new Response(SQUARE, { status: 200, headers: { 'Content-Type': 'image/png' } });
const moved = (to) => () => new Response(null, { status: 302, headers: { Location: to } });

test('an og:image that names a private address is never requested', async () => {
  const { fetchImpl, seen } = redirecting({ 'https://example.com/a': () => pageWith('<meta property="og:image" content="http://169.254.169.254/latest/meta-data/">') });
  const out = await resolveImages({ ...site([{ title: 'Thing', url: 'https://example.com/a' }]), config: cfg(), fetchImpl });
  assert.deepEqual(seen, ['https://example.com/a']);
  assert.equal(value(out), null);
  assert.match(out.warnings[0], /\(the address is not public\)\. A poster is used instead\.$/);
});

test('an item url on a private address is never requested', async () => {
  const { fetchImpl, seen } = redirecting({});
  const out = await resolveImages({ ...site([{ title: 'Thing', url: 'http://127.0.0.1:9000/admin' }]), config: cfg(), fetchImpl });
  assert.deepEqual(seen, []);
  assert.equal(value(out), null);
  assert.match(out.warnings[0], /the address is not public/);
});

test('a redirect from a public page to a private address is refused', async () => {
  const { fetchImpl, seen } = redirecting({ 'https://example.com/a': moved('http://10.0.0.1/x.png') });
  const out = await resolveImages({ ...site([{ title: 'Thing', url: 'https://example.com/a' }]), config: cfg(), fetchImpl });
  assert.deepEqual(seen, ['https://example.com/a']);
  assert.equal(value(out), null);
  assert.match(out.warnings[0], /the address is not public/);
});

test('a host whose DNS answer is private is refused when a lookup is given', async () => {
  const { fetchImpl, seen } = redirecting({ 'https://example.com/a': picture });
  const lookup = async () => [{ address: '10.0.0.7', family: 4 }];
  const out = await resolveImages({ ...site([{ title: 'Thing', url: 'https://example.com/a' }]), config: cfg(), fetchImpl, lookup });
  assert.deepEqual(seen, []);
  assert.equal(value(out), null);
});

test('public redirects are followed to the image', async () => {
  const { fetchImpl } = redirecting({ 'https://example.com/a': moved('https://cdn.example.com/p.png'), 'https://cdn.example.com/p.png': picture });
  const out = await resolveImages({ ...site([{ title: 'Thing', url: 'https://example.com/a' }]), config: cfg(), fetchImpl });
  assert.equal(value(out).width, 100);
});
