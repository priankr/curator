import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, typeNames, getType, inferType } from '../src/js/types.js';

const match = (name, url) => getType(name).match(new URL(url));

test('video matches listed hosts and subdomains', () => {
  for (const u of [
    'https://youtube.com/watch?v=abc',
    'https://www.youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://music.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://vimeo.com/123',
    'https://player.vimeo.com/video/123',
  ]) {
    assert.equal(match('video', u), true, u);
  }
});

test('video rejects lookalike hosts', () => {
  for (const u of [
    'https://notyoutube.com/watch',
    'https://youtube.com.example.com/watch',
    'https://example.com/youtube.com',
    'https://myvimeo.com/1',
  ]) {
    assert.equal(match('video', u), false, u);
  }
});

test('repo needs a host and at least two path segments', () => {
  for (const u of [
    'https://github.com/owner/repo',
    'https://www.github.com/owner/repo',
    'https://github.com/owner/repo/tree/main/src',
    'https://gitlab.com/owner/repo',
    'https://codeberg.org/owner/repo/',
  ]) {
    assert.equal(match('repo', u), true, u);
  }
});

test('repo rejects root, owner pages and other hosts', () => {
  for (const u of [
    'https://github.com/',
    'https://github.com',
    'https://github.com/owner',
    'https://github.com/owner/',
    'https://notgithub.com/owner/repo',
    'https://example.com/owner/repo',
  ]) {
    assert.equal(match('repo', u), false, u);
  }
});

test('image checks the pathname extension, case insensitive', () => {
  for (const u of [
    'https://example.com/a.jpg',
    'https://example.com/a.jpeg',
    'https://example.com/a.png',
    'https://example.com/a.gif',
    'https://example.com/a.webp',
    'https://example.com/a.svg',
    'https://example.com/a.PNG',
    'https://example.com/a.png?w=200&fmt=x',
  ]) {
    assert.equal(match('image', u), true, u);
  }
  for (const u of [
    'https://example.com/a.png/page',
    'https://example.com/page?file=a.png',
    'https://example.com/a.pdf',
    'https://example.com/png',
  ]) {
    assert.equal(match('image', u), false, u);
  }
});

test('webpage matches everything and article matches nothing', () => {
  assert.equal(match('webpage', 'https://example.com/'), true);
  assert.equal(match('webpage', 'https://youtube.com/watch'), true);
  assert.equal(match('article', 'https://example.com/'), false);
  assert.equal(getType('article').label, 'Article');
});

test('inferType follows the registry order', () => {
  assert.equal(inferType('https://www.youtube.com/watch?v=1'), 'video');
  assert.equal(inferType('https://github.com/owner/repo'), 'repo');
  assert.equal(inferType('https://github.com/owner'), 'webpage');
  assert.equal(inferType('https://example.com/a.JPG'), 'image');
  assert.equal(inferType('https://example.com/post'), 'webpage');
  assert.equal(inferType('https://github.com/owner/repo/logo.png'), 'repo');
});

test('inferType returns webpage for unparseable input', () => {
  assert.equal(inferType('not a url'), 'webpage');
  assert.equal(inferType(''), 'webpage');
});

test('typeNames lists names in inference order', () => {
  assert.deepEqual(typeNames(), ['video', 'repo', 'image', 'article', 'webpage']);
});

test('getType finds known names and returns null otherwise', () => {
  assert.equal(getType('repo').label, 'Repository');
  assert.equal(getType('nope'), null);
  assert.equal(getType(''), null);
});

test('every entry has a label and a colour role dot', () => {
  for (const t of TYPES) {
    assert.ok(t.label.length > 0, t.name);
    assert.match(t.dot, /^(primary|secondary|accent)\.\d+$/, t.name);
    assert.equal(typeof t.match, 'function');
  }
  assert.equal(TYPES.at(-1).name, 'webpage');
});
