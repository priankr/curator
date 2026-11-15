import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, parseCollection, readCollections } from '../scripts/lib/parse.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));

test('front matter with short and description', () => {
  const c = parseCollection('---\ntitle: Sample brand\nshort: Sample\ndescription: Neutral text.\n---\n\n## A\nurl: https://example.com/a\n', { id: 'x', file: 'content/x.md' });
  assert.equal(c.id, 'x');
  assert.equal(c.file, 'content/x.md');
  assert.equal(c.hasFrontMatter, true);
  assert.equal(c.title, 'Sample brand');
  assert.equal(c.short, 'Sample');
  assert.equal(c.description, 'Neutral text.');
  assert.deepEqual(c.meta, { title: 'Sample brand', short: 'Sample', description: 'Neutral text.' });
  assert.equal(c.items[0].line, 7);
});

test('short defaults to title and description to empty', () => {
  const c = parseCollection('---\nTitle: Sample brand\n---\n## A\nurl: https://example.com/a');
  assert.equal(c.short, 'Sample brand');
  assert.equal(c.description, '');
  assert.equal(c.items[0].line, 4);
});

test('missing front matter is recorded without a title', () => {
  const c = parseCollection('## A\nurl: https://example.com/a\n');
  assert.equal(c.hasFrontMatter, false);
  assert.equal(c.title, '');
  assert.equal(c.short, '');
  assert.deepEqual(c.meta, {});
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].line, 1);
});

test('unclosed front matter is treated as absent', () => {
  const c = parseCollection('---\ntitle: Sample brand\n\n## A\nurl: https://example.com/a\n');
  assert.equal(c.hasFrontMatter, false);
  assert.equal(c.items.length, 1);
});

test('BOM and CRLF input give the same result with correct line numbers', () => {
  const lf = '---\ntitle: Sample brand\n---\n\nIntro text.\n\n## A\nurl: https://example.com/a\n\nNote one.\n\n## B\nurl: https://example.com/b\n';
  const crlf = '\uFEFF' + lf.replace(/\n/g, '\r\n');
  const a = parseCollection(lf);
  const b = parseCollection(crlf);
  assert.deepEqual(b, a);
  assert.equal(b.title, 'Sample brand');
  assert.deepEqual(b.items.map((i) => i.line), [7, 12]);
  assert.equal(b.items[0].notes, 'Note one.');
});

test('preamble is the text between front matter and the first item', () => {
  const c = parseCollection('---\ntitle: T\n---\n\n  Intro line.  \n\n## A\nurl: https://example.com/a\n');
  assert.equal(c.preamble, 'Intro line.');
  assert.equal(parseCollection('---\ntitle: T\n---\n\n## A\n').preamble, '');
});

test('fields end at the first blank line', () => {
  const [it] = parseCollection('## A\nurl: https://example.com/a\ntags: x\n\nimage: nope.png\n\nMore.\n').items;
  assert.deepEqual(it.fields, { url: 'https://example.com/a', tags: 'x' });
  assert.equal(it.image, 'auto');
  assert.equal(it.notes, 'image: nope.png\n\nMore.');
  assert.deepEqual(it.fieldLines, { url: 2, tags: 3 });
});

test('a non-field line before the blank line starts the notes', () => {
  const [it] = parseCollection('## A\nurl: https://example.com/a\nThis is prose.\ntags: x\n\nAfter.\n').items;
  assert.deepEqual(it.fields, { url: 'https://example.com/a' });
  assert.equal(it.notes, 'This is prose.\ntags: x\n\nAfter.');
});

test('triple hash lines stay in the notes', () => {
  const c = parseCollection('## A\nurl: https://example.com/a\n\nIntro.\n\n### Sub heading\n\nBody.\n\n## B\nurl: https://example.com/b\n');
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].notes, 'Intro.\n\n### Sub heading\n\nBody.');
});

test('notes keep key: value text after the blank line', () => {
  const [it] = parseCollection('## A\nurl: https://example.com/a\n\nNote: this stays.\nother: so does this\n').items;
  assert.equal(it.notes, 'Note: this stays.\nother: so does this');
  assert.deepEqual(Object.keys(it.fields), ['url']);
});

test('field keys are lowercased and values trimmed', () => {
  const [it] = parseCollection('## A\nURL:   https://example.com/a   \nTags:  a ,b\n').items;
  assert.equal(it.url, 'https://example.com/a');
  assert.deepEqual(it.tags, ['a', 'b']);
});

test('tags are split, trimmed and de-duplicated in order', () => {
  const [it] = parseCollection('## A\nurl: https://example.com/a\ntags: b, a, , b,c ,a, B\n').items;
  assert.deepEqual(it.tags, ['b', 'a', 'c', 'B']);
  assert.deepEqual(parseCollection('## A\n').items[0].tags, []);
});

test('image defaults to auto and keeps explicit values', () => {
  const items = parseCollection('## A\nurl: https://example.com/a\n\n## B\nurl: https://example.com/b\nimage: none\n\n## C\nurl: https://example.com/c\nimage: ./images/c.png\n').items;
  assert.deepEqual(items.map((i) => i.image), ['auto', 'none', './images/c.png']);
});

test('type is inferred unless given', () => {
  const items = parseCollection('## A\nurl: https://github.com/o/r\n\n## B\nurl: https://github.com/o/r\ntype: Article\n\n## C\nurl: https://example.com/c\ntype: bogus\n\n## D\n').items;
  assert.deepEqual(items.map((i) => [i.type, i.typeInferred]), [
    ['repo', true],
    ['article', false],
    ['bogus', false],
    ['webpage', true],
  ]);
});

test('domain drops www and is empty for bad urls', () => {
  const items = parseCollection('## A\nurl: https://www.example.com/a\n\n## B\nurl: https://docs.example.com/b\n\n## C\nurl: not a url\n\n## D\n').items;
  assert.deepEqual(items.map((i) => i.domain), ['example.com', 'docs.example.com', '', '']);
  assert.equal(items[2].url, 'not a url');
  assert.equal(items[2].type, 'webpage');
  assert.equal(items[3].url, '');
});

test('unknown and repeated fields are recorded', () => {
  const [it] = parseCollection('## A\nurl: https://example.com/a\nauthor: Sample\nurl: https://example.com/other\ncolour: red\nauthor: Other\n').items;
  assert.equal(it.url, 'https://example.com/a');
  assert.equal(it.fields.author, 'Sample');
  assert.deepEqual(it.unknownFields, ['author', 'colour']);
  assert.deepEqual(it.repeatedFields, ['url', 'author']);
  assert.deepEqual(it.fieldLines, { url: 2, author: 3, colour: 5 });
});

test('slugify examples', () => {
  assert.equal(slugify("Josh Comeau's blog"), 'josh-comeaus-blog');
  assert.equal(slugify('Josh Comeau\u2019s blog'), 'josh-comeaus-blog');
  assert.equal(slugify('!!!'), 'item');
  assert.equal(slugify(''), 'item');
  assert.equal(slugify('  --Hello, World!--  '), 'hello-world');
  assert.equal(slugify('A  &  B / C'), 'a-b-c');
});

test('same title three times gives x, x-2, x-3', () => {
  const c = parseCollection('## x\n\n## x\n\n## x\n');
  assert.deepEqual(c.items.map((i) => i.id), ['x', 'x-2', 'x-3']);
  assert.deepEqual(c.duplicates, [
    { title: 'x', line: 3, id: 'x-2', base: 'x' },
    { title: 'x', line: 5, id: 'x-3', base: 'x' },
  ]);
});

test('suffixes skip ids used by real items', () => {
  const c = parseCollection('## uv\n\n## uv 2\n\n## uv\n');
  assert.deepEqual(c.items.map((i) => i.id), ['uv', 'uv-2', 'uv-3']);
  assert.deepEqual(c.duplicates.map((d) => d.id), ['uv-3']);
});

test('readCollections reads the real content folder', () => {
  const cols = readCollections(resolve(REPO, 'content'));
  const ids = readdirSync(resolve(REPO, 'content')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(cols.map((c) => c.id), ids);
  assert.deepEqual(cols.map((c) => c.file), ids.map((id) => `content/${id}.md`));
  for (const c of cols) {
    const text = readFileSync(resolve(REPO, c.file), 'utf8');
    const short = (text.match(/^short:\s*(.+?)\s*$/m) || [])[1];
    if (short) assert.equal(c.short, short, c.id);
    const headings = text.split(/\r?\n/).filter((l) => l.startsWith('## ')).length;
    assert.equal(c.items.length, headings, c.id);
    assert.ok(c.title.length > 0, c.id);
    assert.ok(c.short.length > 0, c.id);
    assert.deepEqual(c.duplicates, [], c.id);
    for (const it of c.items) assert.ok(it.url.length > 0, `${c.id}/${it.title}`);
  }
});

test('image keywords are stored lowercase and paths are kept as written', () => {
  const items = parseCollection('## A\nurl: https://example.com/a\nimage: None\n\n## B\nurl: https://example.com/b\nimage: AUTO\n\n## C\nurl: https://example.com/c\nimage: ./Images/C.PNG\n').items;
  assert.deepEqual(items.map((i) => i.image), ['none', 'auto', './Images/C.PNG']);
});

test('the known field list is exported', async () => {
  const { KNOWN_FIELDS } = await import('../scripts/lib/parse.mjs');
  assert.deepEqual(KNOWN_FIELDS, ['url', 'type', 'tags', 'image']);
});
