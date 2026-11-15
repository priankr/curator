import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../scripts/lib/build-site.mjs';
import { startServer } from '../scripts/lib/serve.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));
const REPO_PACKAGE = readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');

let temp;
let dist;
let server;
let base;
let error = null;

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'curator-serve-'));
  const root = join(temp, 'site');
  cpSync(FIXTURE, root, { recursive: true });
  const configFile = join(root, 'curator.config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.advanced = { images: { fetch: false } };
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  const built = await buildSite({ root, log: () => {} });
  assert.equal(built.ok, true, built.errors.join('\n'));
  dist = built.outDir;
  writeFileSync(join(dist, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dist, 'photo.jpeg'), Buffer.from([0xff, 0xd8]));
  writeFileSync(join(dist, 'font.woff2'), 'x');
  writeFileSync(join(dist, 'shape.svg'), '<svg></svg>');
  writeFileSync(join(dist, 'blob.unknown'), 'x');
  server = await startServer({ dir: dist, port: 0, getError: () => error });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(temp, { recursive: true, force: true });
});

const canonical = (html) => /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];

// Sends a request line as is, since fetch would normalise dot segments away.
function rawRequest(target) {
  return new Promise((resolve, reject) => {
    const socket = connect(server.address().port, 'localhost', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (d) => { data += d; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('pages serve as HTML with the matching canonical link', async () => {
  for (const path of ['/', '/links/', '/links/first-page/']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    const url = new URL(canonical(await res.text()));
    assert.equal(url.pathname, path);
  }
});

test('a folder without a trailing slash redirects and keeps the query', async () => {
  const res = await fetch(`${base}/links?a=1&b=2`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/links/?a=1&b=2');
  const plain = await fetch(`${base}/links`, { redirect: 'manual' });
  assert.equal(plain.headers.get('location'), '/links/');
  assert.match(await rawRequest('//links'), /\r\nLocation: \/links\/\r\n/i);
});

test('a missing path serves the 404 page with status 404', async () => {
  const res = await fetch(`${base}/nope/`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), readFileSync(join(dist, '404.html'), 'utf8'));
});

test('content types', async () => {
  const type = async (path) => (await fetch(base + path)).headers.get('content-type');
  assert.equal(await type('/data/site.json'), 'application/json; charset=utf-8');
  assert.equal(await type('/sitemap.xml'), 'application/xml; charset=utf-8');
  assert.equal(await type('/robots.txt'), 'text/plain; charset=utf-8');
  assert.equal(await type('/pixel.png'), 'image/png');
  assert.equal(await type('/photo.jpeg'), 'image/jpeg');
  assert.equal(await type('/font.woff2'), 'font/woff2');
  assert.equal(await type('/blob.unknown'), 'application/octet-stream');
  assert.equal(await type('/shape.svg'), 'image/svg+xml');
  const hash = readdirSync(join(dist, 'assets'))[0];
  assert.equal(await type(`/assets/${hash}/js/kit.js`), 'text/javascript; charset=utf-8');
});

test('traversal attempts never leave the folder', async () => {
  const bs = String.fromCharCode(92);
  const paths = ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json', `/..${bs}package.json`, '/a%00b', '/%2e%2e%2fpackage.json', '/..%2f..%2fpackage.json'];
  for (const path of paths) {
    const res = await fetch(base + path);
    const body = await res.text();
    assert.equal(res.status, 404, path);
    assert.notEqual(body, REPO_PACKAGE, path);
    assert.ok(!body.includes('"name": "curator"'), path);
  }
  for (const target of ['/../../package.json', '/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json', '/a%00b']) {
    const raw = await rawRequest(target);
    assert.match(raw, /^HTTP\/1\.1 404/, target);
    assert.ok(!raw.includes('"name": "curator"'), target);
  }
});

test('HEAD has no body and other methods get 405', async () => {
  const head = await fetch(`${base}/links/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(`${base}/links/`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405);
});

test('every response is no-store', async () => {
  for (const path of ['/', '/nope/', '/data/site.json']) {
    assert.equal((await fetch(base + path)).headers.get('cache-control'), 'no-store', path);
  }
  assert.equal((await fetch(`${base}/links`, { redirect: 'manual' })).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base, { method: 'POST' })).headers.get('cache-control'), 'no-store');
});

test('build errors turn HTML requests into an escaped 500 page', async () => {
  error = ['content/x.md: bad <b>"tag"</b> & more'];
  try {
    for (const path of ['/', '/links/', '/nope/']) {
      const res = await fetch(base + path);
      const body = await res.text();
      assert.equal(res.status, 500, path);
      assert.match(body, /<title>Build failed<\/title>/);
      assert.ok(body.includes('content/x.md: bad &lt;b&gt;&quot;tag&quot;&lt;/b&gt; &amp; more'));
      assert.ok(!body.includes('<b>'));
    }
    const json = await fetch(`${base}/data/site.json`);
    assert.equal(json.status, 200);
    assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');
  } finally {
    error = null;
  }
  assert.equal((await fetch(base)).status, 200);
});

test('mounts serve a prefix from another folder with the same protections', async () => {
  const mount = join(temp, 'mounted');
  mkdirSync(join(mount, 'sub'), { recursive: true });
  writeFileSync(join(mount, 'page.html'), '<p>mounted</p>');
  writeFileSync(join(mount, 'sub', 'index.html'), '<p>sub</p>');
  writeFileSync(join(temp, 'secret.txt'), 'secret');
  const mounted = await startServer({ dir: dist, port: 0, mounts: { '/__tests/': mount } });
  const url = `http://localhost:${mounted.address().port}`;
  try {
    const page = await fetch(`${url}/__tests/page.html`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await page.text(), '<p>mounted</p>');
    assert.equal(await (await fetch(`${url}/__tests/sub/`)).text(), '<p>sub</p>');
    assert.equal((await fetch(`${url}/__tests/sub`, { redirect: 'manual' })).headers.get('location'), '/__tests/sub/');
    assert.equal((await fetch(`${url}/__tests/missing.html`)).status, 404);
    assert.equal((await fetch(`${url}/`)).status, 200);
    for (const path of ['/__tests/../secret.txt', '/__tests/%2e%2e/secret.txt', '/__tests/..%2fsecret.txt']) {
      const res = await fetch(url + path);
      assert.equal(res.status, 404, path);
      assert.ok(!(await res.text()).includes('secret'), path);
    }
    // Raw request lines keep the dot segments that fetch would remove.
    const raw = await new Promise((resolve, reject) => {
      const socket = connect(mounted.address().port, 'localhost', () => socket.write(`GET /__tests/../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
      let data = '';
      socket.on('data', (d) => { data += d; });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.1 404/);
    assert.ok(!raw.includes('secret'));

  } finally {
    mounted.closeAllConnections();
    await new Promise((r) => mounted.close(r));
  }
  // Without the option the prefix is just a missing path.
  assert.equal((await fetch(`${base}/__tests/page.html`)).status, 404);
});
