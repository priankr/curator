import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../scripts/lib/build-site.mjs';
import { buildPalette, contrast, normalizeBrand } from '../src/js/palette.js';
import { pageTitle } from '../src/js/title.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const BUILD_CLI = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const DOT = String.fromCharCode(0xb7);
const temps = [];
const quiet = () => {};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])]);

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// Copies the valid fixture into a temp folder with image fetching off, and returns its site root.
function makeSite({ build = {}, files = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'curator-build-'));
  temps.push(base);
  const root = join(base, 'site');
  cpSync(FIXTURE, root, { recursive: true });
  const configFile = join(root, 'curator.config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.advanced = { images: { fetch: false }, build };
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

function editConfig(root, edit) {
  const file = join(root, 'curator.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  edit(config);
  writeFileSync(file, JSON.stringify(config, null, 2));
}

const read = (root, ...parts) => readFileSync(join(root, 'dist', ...parts), 'utf8');
const head = (html) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const tag = (html, attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`).exec(html)?.[1];

const ODD = '---\ntitle: Odd <"&\'> shelf\nshort: Odd\ndescription: Odd "described" <text>\n---\n\n## Quote <"&\'> item\nurl: https://example.com/q\nimage: none\n\nNotes with <b>raw</b> html and a [link](https://example.com/x).\n';
const BAD = '---\ntitle: Bad\n---\n\n## No link\n';

test('a build writes every expected file', async () => {
  const root = makeSite();
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.pages, 7);
  assert.equal(r.images, 0);
  assert.equal(r.outDir, join(root, 'dist'));
  for (const f of ['.curator-build', 'index.html', '404.html', 'sitemap.xml', 'robots.txt', 'data/site.json', 'links/index.html', 'notes/index.html', 'links/first-page/index.html', 'links/second-page/index.html', 'notes/only-note/index.html']) {
    assert.ok(existsSync(join(root, 'dist', f)), f);
  }
  const assets = readdirSync(join(root, 'dist', 'assets'));
  assert.equal(assets.length, 1);
  assert.match(assets[0], /^[0-9a-f]{10}$/);
  assert.ok(existsSync(join(root, 'dist', 'assets', assets[0], 'js', 'kit.js')));
  assert.ok(!existsSync(join(root, 'dist', 'assets', assets[0], 'index.html')));
  assert.ok(!existsSync(join(root, 'dist', 'assets', assets[0], 'config.schema.json')));
  assert.match(read(root, 'index.html'), new RegExp(`content="/assets/${assets[0]}/"`));
});

test('site.json has the documented shape', async () => {
  const root = makeSite();
  await buildSite({ root, log: quiet });
  const text = read(root, 'data', 'site.json');
  assert.ok(!text.includes('\n'));
  const data = JSON.parse(text);
  assert.equal(data.version, 1);
  assert.deepEqual(data.site, { title: 'Sample site', description: '', url: 'https://links.example.com', language: 'en', socialImage: null });
  assert.deepEqual(Object.keys(data.scene), ['name', 'pageSize', 'motion', 'colors']);
  assert.equal(data.scene.pageSize, 12);
  assert.deepEqual(Object.keys(data.fonts), ['display', 'body', 'mono', 'poster', 'typewriter', 'handwriting']);
  assert.equal(data.fonts.typewriter, 'Special Elite');
  assert.ok(data.brand.neutral.surface && data.brand.neutral.muted);
  assert.deepEqual(data.types.map((t) => t.name), ['video', 'repo', 'image', 'article', 'webpage']);
  assert.equal(data.defaultCollection, 'links');
  assert.deepEqual(data.collections.map((c) => c.id), ['links', 'notes']);

  const links = data.collections[0];
  assert.deepEqual(Object.keys(links), ['id', 'title', 'short', 'description', 'tags', 'items']);
  assert.equal(links.short, 'Links');
  assert.deepEqual(links.tags, ['neutral', 'sample']);
  assert.deepEqual(links.items.map((i) => i.no), ['01', '02']);
  assert.deepEqual(Object.keys(links.items[0]), ['id', 'key', 'no', 'title', 'url', 'domain', 'type', 'tags', 'notesHtml', 'notesText', 'image', 'poster']);
  const [first, second] = links.items;
  assert.equal(first.key, 'First page');
  assert.equal(first.notesHtml, '<p>A short note.</p>');
  assert.equal(first.notesText, 'A short note.');
  assert.equal(first.domain, 'example.com');
  assert.match(first.image.src, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(Object.keys(first.image), ['src', 'width', 'height', 'fit']);
  assert.equal(first.poster, null);
  assert.equal(second.type, 'video');
  assert.equal(second.image, null);
  assert.equal(second.notesHtml, '');

  const palette = buildPalette(normalizeBrand(data.brand), {}).palette('Second page');
  assert.deepEqual(Object.keys(second.poster), ['v', 'set', 'paper', 'inks', 'band']);
  assert.ok(Number.isInteger(second.poster.v) && second.poster.v >= 0 && second.poster.v < 16);
  assert.equal(second.poster.set, palette.set);
  assert.equal(second.poster.paper, palette.paper);
  assert.deepEqual(second.poster.inks, palette.inks);
  assert.equal(second.poster.band, palette.band);
  assert.deepEqual(data.collections[1].items.map((i) => i.poster), [null]);
});

test('collection order follows the config, then the rest alphabetically', async () => {
  const root = makeSite({ files: { 'content/aaa.md': '---\ntitle: Aaa\n---\n\n## One\nurl: https://example.com/1\nimage: none\n' } });
  editConfig(root, (c) => { c.basic.collections = { order: ['notes'] }; });
  await buildSite({ root, log: quiet });
  const data = JSON.parse(read(root, 'data', 'site.json'));
  assert.deepEqual(data.collections.map((c) => c.id), ['notes', 'aaa', 'links']);
  assert.equal(data.defaultCollection, 'notes');
});

test('types take label and dot overrides', async () => {
  const root = makeSite();
  editConfig(root, (c) => { c.advanced.types = { repo: { label: 'Code', dot: 'primary.2' } }; });
  await buildSite({ root, log: quiet });
  const data = JSON.parse(read(root, 'data', 'site.json'));
  assert.deepEqual(data.types.find((t) => t.name === 'repo'), { name: 'repo', label: 'Code', dot: 'primary.2' });
  assert.equal(data.types.find((t) => t.name === 'video').label, 'Video');
});

test('head tags for home, collection, item and 404', async () => {
  const root = makeSite();
  await buildSite({ root, log: quiet });

  const home = head(read(root, 'index.html'));
  assert.match(home, /<title>Sample site<\/title>/);
  assert.match(home, /<link rel="canonical" href="https:\/\/links\.example\.com\/">/);
  assert.equal(tag(home, 'property', 'og:type'), 'website');
  assert.equal(tag(home, 'property', 'og:url'), 'https://links.example.com/');
  assert.equal(tag(home, 'name', 'twitter:card'), 'summary');
  assert.equal(tag(home, 'property', 'og:image'), undefined);
  assert.equal(tag(home, 'name', 'twitter:image'), undefined);

  const col = head(read(root, 'links', 'index.html'));
  assert.ok(col.includes(`<title>Sample links ${DOT} Sample site</title>`));
  assert.equal(tag(col, 'name', 'description'), 'A neutral collection.');
  assert.match(col, /href="https:\/\/links\.example\.com\/links\/"/);

  const bare = head(read(root, 'notes', 'index.html'));
  assert.equal(tag(bare, 'name', 'description'), '');

  const item = head(read(root, 'links', 'first-page', 'index.html'));
  assert.ok(item.includes(`<title>First page ${DOT} Links</title>`));
  assert.equal(tag(item, 'name', 'description'), 'A short note.');
  assert.equal(tag(item, 'property', 'og:type'), 'article');
  assert.equal(tag(item, 'property', 'og:site_name'), 'Sample site');
  assert.match(item, /href="https:\/\/links\.example\.com\/links\/first-page\/"/);
  const data = JSON.parse(read(root, 'data', 'site.json'));
  assert.ok(data.collections[0].items[0].image.src.startsWith('data:'));
  assert.equal(tag(item, 'property', 'og:image'), undefined);
  assert.equal(tag(item, 'name', 'twitter:image'), undefined);
  assert.equal(tag(item, 'name', 'twitter:card'), 'summary');

  // No notes: the collection description is used.
  const noNotes = head(read(root, 'links', 'second-page', 'index.html'));
  assert.equal(tag(noNotes, 'name', 'description'), 'A neutral collection.');

  const missing = head(read(root, '404.html'));
  assert.ok(missing.includes(`<title>Not found ${DOT} Sample site</title>`));
  assert.match(missing, /<meta name="robots" content="noindex">/);
  assert.ok(!missing.includes('canonical'));
});

test('the social image is the fallback for pages without a preview image', async () => {
  const root = makeSite();
  writeFileSync(join(root, 'card.png'), PNG);
  editConfig(root, (c) => { c.basic.site.socialImage = './card.png'; });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const data = JSON.parse(read(root, 'data', 'site.json'));
  const social = data.site.socialImage;
  assert.match(social, /^\/images\/[0-9a-f]{16}\.png$/);
  assert.ok(existsSync(join(root, 'dist', social)));
  const home = head(read(root, 'index.html'));
  assert.equal(tag(home, 'property', 'og:image'), `https://links.example.com${social}`);
  assert.equal(tag(home, 'name', 'twitter:card'), 'summary_large_image');
  const poster = head(read(root, 'links', 'second-page', 'index.html'));
  assert.equal(tag(poster, 'property', 'og:image'), `https://links.example.com${social}`);
  const svgItem = head(read(root, 'links', 'first-page', 'index.html'));
  assert.equal(tag(svgItem, 'property', 'og:image'), `https://links.example.com${social}`);
  assert.equal(tag(svgItem, 'name', 'twitter:image'), `https://links.example.com${social}`);
});

test('an uploaded SVG is embedded in site.json and never written as a file', async () => {
  const root = makeSite();
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const data = JSON.parse(read(root, 'data', 'site.json'));
  const { image } = data.collections[0].items[0];
  const bytes = readFileSync(join(root, 'content', 'images', 'dot.svg'));
  assert.equal(image.src, `data:image/svg+xml;base64,${bytes.toString('base64')}`);
  assert.deepEqual([image.width, image.height], [8, 8]);
  const files = existsSync(join(root, 'dist', 'images')) ? readdirSync(join(root, 'dist', 'images')) : [];
  assert.deepEqual(files.filter((f) => f.endsWith('.svg')), []);
  const item = head(read(root, 'links', 'first-page', 'index.html'));
  assert.ok(!item.includes('data:'));
  assert.equal(tag(item, 'property', 'og:image'), undefined);
});

test('head values are escaped', async () => {
  const root = makeSite({ files: { 'content/odd.md': ODD } });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const col = head(read(root, 'odd', 'index.html'));
  assert.ok(col.includes(`<title>Odd &lt;&quot;&amp;&#39;&gt; shelf ${DOT} Sample site</title>`));
  assert.equal(tag(col, 'name', 'description'), 'Odd &quot;described&quot; &lt;text&gt;');
  const item = head(read(root, 'odd', 'quote-item', 'index.html'));
  assert.ok(item.includes(`<title>Quote &lt;&quot;&amp;&#39;&gt; item ${DOT} Odd</title>`));
  assert.equal(tag(item, 'name', 'description'), 'Notes with &lt;b&gt;raw&lt;/b&gt; html and a link.');
  assert.ok(!/<b>|<text>/.test(item));
  const data = JSON.parse(read(root, 'data', 'site.json'));
  const odd = data.collections.find((c) => c.id === 'odd').items[0];
  assert.ok(odd.notesHtml.includes('&lt;b&gt;raw&lt;/b&gt;'));
  assert.equal(odd.key, 'Quote <"&\'> item');
});

test('sitemap and robots', async () => {
  const root = makeSite({ files: { 'content/odd.md': ODD } });
  await buildSite({ root, log: quiet });
  const sitemap = read(root, 'sitemap.xml');
  const urls = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(urls, [
    'https://links.example.com/',
    'https://links.example.com/links/',
    'https://links.example.com/links/first-page/',
    'https://links.example.com/links/second-page/',
    'https://links.example.com/notes/',
    'https://links.example.com/notes/only-note/',
    'https://links.example.com/odd/',
    'https://links.example.com/odd/quote-item/',
  ]);
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.equal(read(root, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://links.example.com/sitemap.xml\n');
});

test('a trailing slash on the site url is dropped', async () => {
  const root = makeSite();
  editConfig(root, (c) => { c.basic.site.url = 'https://links.example.com/'; });
  await buildSite({ root, log: quiet });
  assert.match(read(root, 'sitemap.xml'), /<loc>https:\/\/links\.example\.com\/links\/<\/loc>/);
  assert.equal(JSON.parse(read(root, 'data', 'site.json')).site.url, 'https://links.example.com');
});

test('the scene token is filled from advanced.scene.name on every page', async () => {
  const root = makeSite();
  let r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join(String.fromCharCode(10)));
  const hash = readdirSync(join(root, 'dist', 'assets'))[0];
  for (const page of [['index.html'], ['links', 'index.html'], ['404.html']]) {
    const html = read(root, ...page);
    assert.ok(html.includes(`href="/assets/${hash}/scenes/lighttable/scene.css"`), page.join('/'));
    assert.ok(!html.includes('{{'), page.join('/'));
  }
  editConfig(root, (c) => { c.advanced.scene = { name: 'shelf' }; });
  r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join(String.fromCharCode(10)));
  assert.ok(read(root, 'index.html').includes('/scenes/shelf/scene.css'));
});

test('itemPages false writes no item pages and no item URLs', async () => {
  const root = makeSite({ build: { itemPages: false } });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.pages, 4);
  assert.ok(!existsSync(join(root, 'dist', 'links', 'first-page')));
  assert.ok(existsSync(join(root, 'dist', 'links', 'index.html')));
  const sitemap = read(root, 'sitemap.xml');
  assert.ok(!sitemap.includes('first-page'));
  assert.ok(sitemap.includes('/links/'));
  assert.equal(JSON.parse(read(root, 'data', 'site.json')).collections[0].items.length, 2);
});

test('the asset hash follows the src files', async () => {
  const root = makeSite();
  const src = join(root, '..', 'src');
  cpSync(SRC, src, { recursive: true });
  const hashOf = async () => {
    const r = await buildSite({ root, srcDir: src, log: quiet });
    assert.equal(r.ok, true, r.errors.join('\n'));
    const names = readdirSync(join(root, 'dist', 'assets'));
    assert.equal(names.length, 1);
    return names[0];
  };
  const a = await hashOf();
  assert.equal(await hashOf(), a);
  writeFileSync(join(src, 'js', 'extra.js'), 'export const x = 1;\n');
  const b = await hashOf();
  assert.notEqual(b, a);
  writeFileSync(join(src, 'js', 'extra.js'), 'export const x = 2;\n');
  assert.notEqual(await hashOf(), b);
});

test('outDir must be a folder inside the project and not a source folder', async () => {
  for (const outDir of ['../out', '.', 'content', 'src', 'content/images', '.git']) {
    const root = makeSite({ build: { outDir } });
    const r = await buildSite({ root, log: quiet });
    assert.equal(r.ok, false, outDir);
    assert.deepEqual(r.errors, [`curator.config.json: advanced.build.outDir "${outDir}" must be a folder inside the project, such as dist.`]);
    assert.ok(existsSync(join(root, 'content', 'links.md')), outDir);
    assert.ok(!existsSync(join(root, '..', 'out')), outDir);
  }
});

test('an existing folder without the marker is refused and left alone', async () => {
  const root = makeSite();
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'mine.txt'), 'keep');
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['advanced.build.outDir "dist" already holds files that Curator did not write. Empty it or choose another folder.']);
  assert.equal(read(root, 'mine.txt'), 'keep');
});

test('an empty existing folder is fine and a second build replaces its own output', async () => {
  const root = makeSite();
  mkdirSync(join(root, 'dist'));
  assert.equal((await buildSite({ root, log: quiet })).ok, true);
  writeFileSync(join(root, 'dist', 'stale.txt'), 'old');
  const again = await buildSite({ root, log: quiet });
  assert.equal(again.ok, true);
  assert.ok(!existsSync(join(root, 'dist', 'stale.txt')));
  assert.ok(existsSync(join(root, 'dist', 'index.html')));
});

test('validation errors stop the build and write nothing', async () => {
  const root = makeSite({ files: { 'content/bad.md': BAD } });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('url is missing')));
  assert.equal(r.pages, 0);
  assert.ok(!existsSync(join(root, 'dist')));
});

test('a failed preview fetch is a warning returned by the build', async () => {
  const root = makeSite({ files: { 'content/auto.md': '---\ntitle: Auto\n---\n\n## Needs image\nurl: https://example.com/p\n' } });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('"Needs image"') && w.includes('A poster is used instead')));
  const item = JSON.parse(read(root, 'data', 'site.json')).collections.find((c) => c.id === 'auto').items[0];
  assert.equal(item.image, null);
  assert.ok(item.poster);
});

test('the command line builds into the root and prints a summary', () => {
  const root = makeSite();
  const r = spawnSync(process.execPath, [BUILD_CLI, '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Built 7 pages and 0 images into dist in \d+\.\ds\.$/m);
  assert.ok(existsSync(join(root, 'dist', 'index.html')));
});

test('the command line exits 1 on errors and prints them', () => {
  const root = makeSite({ files: { 'content/bad.md': BAD } });
  const r = spawnSync(process.execPath, [BUILD_CLI, '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Errors$/m);
  assert.ok(!r.stdout.includes('Built'));
  assert.ok(!existsSync(join(root, 'dist')));
});

// Builds the valid fixture plus 40 imageless items with the given advanced.posters, and returns every poster.
async function builtPosters(posters = {}) {
  let text = '---\ntitle: Many posters\n---\n';
  for (let i = 1; i <= 40; i++) text += `\n## Poster item ${i}\nurl: https://example.com/p${i}\nimage: none\n`;
  const root = makeSite({ files: { 'content/many.md': text } });
  editConfig(root, (c) => { c.advanced.posters = posters; });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const data = JSON.parse(read(root, 'data', 'site.json'));
  const list = data.collections.flatMap((c) => c.items).map((i) => i.poster).filter(Boolean);
  assert.ok(list.length >= 40);
  return list;
}

const colorsOf = (p) => [p.paper, ...p.inks, p.band];

test('poster compositions limit the variants used', async () => {
  const list = await builtPosters({ compositions: [3, 5] });
  assert.deepEqual([...new Set(list.map((p) => p.v))].sort(), [2, 4]);
});

test('poster inverseShare 0 and 1 give only light or only inverse sets', async () => {
  assert.ok((await builtPosters({ inverseShare: 0 })).every((p) => p.set === 'light'));
  assert.ok((await builtPosters({ inverseShare: 1 })).every((p) => p.set === 'inverse'));
});

test('poster excludeFromPosters keeps a colour out of every paper and ink', async () => {
  const list = await builtPosters({ excludeFromPosters: ['Vermilion', 'Marigold'] });
  for (const p of list) {
    for (const c of colorsOf(p)) assert.ok(c !== '#e4572e' && c !== '#f2b134', c);
  }
});

test('poster avoidPairs never put both colours in one poster', async () => {
  const list = await builtPosters({ avoidPairs: [['Vermilion', 'Ultramarine'], ['Teal', 'Plum']] });
  for (const p of list) {
    const all = [p.paper, ...p.inks];
    assert.ok(!(all.includes('#e4572e') && all.includes('#2b4ea2')));
    assert.ok(!(all.includes('#0f6e63') && all.includes('#5b3a6e')));
  }
});

test('poster minContrast keeps every ink readable on its paper', async () => {
  const list = await builtPosters({ minContrast: 3 });
  for (const p of list) for (const ink of p.inks) assert.ok(contrast(ink, p.paper) >= 3, `${ink} on ${p.paper}`);
});

test('every poster has a band ink that reads at 4.5 to 1 when an ink does', async () => {
  const list = await builtPosters();
  for (const p of list) {
    if (p.inks.some((ink) => contrast(ink, p.paper) >= 4.5)) assert.ok(contrast(p.band, p.paper) >= 4.5, `${p.band} on ${p.paper}`);
    assert.ok(p.inks.includes(p.band) || contrast(p.band, p.paper) > 1);
  }
});

test('the favicon is a generated slide mount in the brand colours and every page links it', async () => {
  const root = makeSite();
  editConfig(root, (c) => { c.basic.brand = { primary: [{ name: 'Sample', value: '#336699' }], neutral: { light: '#FAF9F5', dark: '#222222' } }; });
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join(String.fromCharCode(10)));
  const svg = read(root, 'favicon.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.includes('fill="#336699"'), svg);
  assert.ok(svg.toLowerCase().includes('fill="#faf9f5"'), svg);
  for (const page of [['index.html'], ['links', 'index.html'], ['links', 'first-page', 'index.html'], ['404.html']]) {
    assert.ok(head(read(root, ...page)).includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'), page.join('/'));
  }
});

test('the shared title function gives the title written into each built page head', async () => {
  const root = makeSite();
  const r = await buildSite({ root, log: quiet });
  assert.equal(r.ok, true, r.errors.join(String.fromCharCode(10)));
  const data = JSON.parse(read(root, 'data', 'site.json'));
  const siteTitle = data.site.title;
  const col = data.collections[0];
  const item = col.items[0];
  const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)[1];
  assert.equal(titleOf(read(root, 'index.html')), pageTitle({ siteTitle, kind: 'home' }));
  assert.equal(titleOf(read(root, col.id, 'index.html')), pageTitle({ siteTitle, kind: 'collection', collection: col }));
  assert.equal(titleOf(read(root, col.id, item.id, 'index.html')), pageTitle({ siteTitle, kind: 'item', collection: col, item }));
  assert.equal(titleOf(read(root, '404.html')), pageTitle({ siteTitle, kind: '404' }));
  assert.equal(pageTitle({ siteTitle: 'S', kind: 'item', collection: { short: 'C' }, item: { title: 'T' } }), `T ${DOT} C`);
});
