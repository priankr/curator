import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite, validateSite } from '../scripts/lib/validate.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const fixture = (name) => join(REPO, 'tests', 'fixtures', name);

test('the valid fixture and the real repo have no errors or warnings', () => {
  for (const root of [fixture('valid'), REPO]) {
    const r = checkSite(root);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  }
  assert.equal(checkSite(fixture('valid')).itemCount, 3);
});

test('errors fixture gives every item and collection error in order', () => {
  const r = checkSite(fixture('errors'));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.errors, [
    'content/Bad_Name.md: the file name must use lowercase letters, digits and hyphens only, such as tools.md.',
    'content/items.md, "No url" (line 5): url is missing. Add a line such as url: https://example.com/page under the heading.',
    'content/items.md, "Bad url" (line 8): url "ftp://example.com/file" must be an absolute http or https address, such as https://example.com/page.',
    'content/items.md, "Unparseable url" (line 11): url "not a url" must be an absolute http or https address, such as https://example.com/page.',
    'content/items.md, "Unknown type" (line 14): type "podcast" is not a known type. Use one of webpage, video, repo, image, article.',
    'content/items.md, "Web image" (line 18): image must be auto, none or a path to a file in content/, not a web address.',
    'content/items.md, "Outside image" (line 22): image path "../secret.png" must stay inside the content folder.',
    'content/items.md, "Wrong extension" (line 26): image "images/notes.txt" must be a .png, .jpg, .jpeg, .gif, .webp or .svg file.',
    'content/items.md, "Missing image" (line 30): image file "images/missing.png" was not found in the content folder.',
    'content/notitle.md: the collection has no title. Add a title line to the front matter at the top of the file.',
    'content/notitle.md (line 4): an item heading has no title.',
  ]);
});

test('warnings fixture gives every warning in order', () => {
  const r = checkSite(fixture('warnings'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [
    'content/empty.md: the collection has no items yet. Each item starts with a ## heading.',
    'content/warn.md: unknown front matter key "author". Known keys are title, short and description.',
    'content/warn.md: text before the first ## heading is ignored.',
    'content/warn.md, "Same" (line 11): another item has the same link name, so this one becomes same-2. Rename it to give it a link of its own.',
    'content/warn.md, "Typos" (line 14): unknown field "tag" on line 16. Known fields are url, type, tags and image. Did you mean tags?',
    'content/warn.md, "Typos" (line 14): unknown field "urls" on line 17. Known fields are url, type, tags and image. Did you mean url?',
    'content/warn.md, "Typos" (line 14): unknown field "imgae" on line 18. Known fields are url, type, tags and image. Did you mean image?',
    'content/warn.md, "Typos" (line 14): unknown field "colour" on line 19. Known fields are url, type, tags and image.',
    'content/warn.md, "Repeated" (line 21): field "url" appears more than once. The first value is used.',
    'curator.config.json: basic.collections.order lists "empty" more than once.',
  ]);
});

test('config cross-checks come last and name the problem', () => {
  const r = checkSite(fixture('config-refs'));
  assert.deepEqual(r.warnings, ['curator.config.json: basic.collections.order lists "ghost" more than once.']);
  assert.deepEqual(r.errors, [
    'curator.config.json: basic.collections.order names "ghost", but there is no content/ghost.md.',
    'curator.config.json: basic.collections.default is "nope", but there is no content/nope.md.',
    'curator.config.json: advanced.types.podcast is not a known type. Use one of webpage, video, repo, image, article.',
    'curator.config.json: basic.site.socialImage "missing-card.png" was not found.',
  ]);
});

test('config errors stop the check at once', () => {
  const r = checkSite(fixture('bad-config'));
  assert.deepEqual(r.errors, ['curator.config.json: basic.site.url is required.']);
  assert.equal(r.itemCount, 0);
});

test('no collections is an error', () => {
  const root = fixture('valid');
  const { errors } = validateSite({ config: null, collections: [], root });
  assert.deepEqual(errors, ['content: there are no collections yet. Add a Markdown file such as content/links.md.']);
});

test('a collection with more than 100 items warns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-many-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    let text = '---\ntitle: Many\n---\n';
    for (let i = 1; i <= 101; i++) text += `\n## Item ${i}\nurl: https://example.com/${i}\n`;
    mkdirSync(join(dir, 'content'), { recursive: true });
    writeFileSync(join(dir, 'content', 'many.md'), text);
    const r = checkSite(dir);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, ['content/many.md: the collection has 101 items. Past about 100 items it is a library, not a collection. Consider splitting it.']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exactly 100 items does not warn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-hundred-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    let text = '---\ntitle: Many\n---\n';
    for (let i = 1; i <= 100; i++) text += `\n## Item ${i}\nurl: https://example.com/${i}\n`;
    writeFileSync(join(dir, 'content', 'many.md'), text);
    assert.deepEqual(checkSite(dir).warnings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tag named all warns, in any case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-all-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    writeFileSync(join(dir, 'content', 'tagall.md'), '---\ntitle: Tag all\n---\n\n## One\nurl: https://example.com/one\ntags: a, ALL\n');
    const r = checkSite(dir);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, ['content/tagall.md, "One" (line 5): the tag "all" on line 7 shows as a second all chip, because the all chip already clears the filter. Rename the tag.']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('field suggestions appear only for near misses', () => {
  const warnings = checkSite(fixture('warnings')).warnings;
  const hint = (key) => warnings.find((w) => w.includes(`unknown field "${key}"`));
  assert.ok(hint('tag').endsWith(' Did you mean tags?'));
  assert.ok(hint('urls').endsWith(' Did you mean url?'));
  assert.ok(hint('imgae').endsWith(' Did you mean image?'));
  assert.ok(!hint('colour').includes('Did you mean'));
});

test('an explicit article or webpage type is valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-types-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    const file = join(dir, 'content', 'tagged.md');
    writeFileSync(file, '---\ntitle: Tagged\n---\n\n## One\nurl: https://example.com/one\ntype: article\n\n## Two\nurl: https://example.com/two\ntype: webpage\n');
    const r = checkSite(dir);
    assert.deepEqual(r.errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the article dot falls back with a warning on a two primary brand', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-types-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    const file = join(dir, 'curator.config.json');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    config.basic.brand = { primary: [{ name: 'A', value: '#112233' }, { name: 'B', value: '#445566' }], secondary: [], accent: [] };
    config.advanced = { types: { article: { dot: 'primary.2' } } };
    writeFileSync(file, JSON.stringify(config));
    const r = checkSite(dir);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, ['curator.config.json: advanced.types.article.dot is primary.2, but the brand has only 2 primary colours. primary.0 is used instead.']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a type dot role beyond the brand list warns and names the fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-types-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    const file = join(dir, 'curator.config.json');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    config.basic.brand = { primary: [{ name: 'A', value: '#112233' }], secondary: [{ name: 'B', value: '#445566' }, { name: 'C', value: '#778899' }], accent: [] };
    config.advanced = { types: { repo: { dot: 'primary.1' }, video: { dot: 'secondary.1' }, image: { dot: 'accent.0' }, article: { dot: 'secondary.2' } } };
    writeFileSync(file, JSON.stringify(config));
    const r = checkSite(dir);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, [
      'curator.config.json: advanced.types.repo.dot is primary.1, but the brand has only 1 primary colour. primary.0 is used instead.',
      'curator.config.json: advanced.types.image.dot is accent.0, but the brand has only 0 accent colours. primary.0 is used instead.',
      'curator.config.json: advanced.types.article.dot is secondary.2, but the brand has only 2 secondary colours. secondary.0 is used instead.',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>';

// Copies the valid fixture, adds files, an optional item with an image and an optional socialImage, and returns the errors.
function checkWith({ files = {}, image = null, social = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'curator-img-'));
  try {
    cpSync(fixture('valid'), dir, { recursive: true });
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    if (image) writeFileSync(join(dir, 'content', 'extra.md'), `---\ntitle: Extra\n---\n\n## Pic\nurl: https://example.com/pic\nimage: ${image}\n`);
    if (social) {
      const file = join(dir, 'curator.config.json');
      const config = JSON.parse(readFileSync(file, 'utf8'));
      config.basic.site.socialImage = social;
      writeFileSync(file, JSON.stringify(config));
    }
    return checkSite(dir).errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an upload must hold the format its extension says', () => {
  assert.deepEqual(checkWith({ files: { 'content/images/pic.png': SVG_TEXT }, image: 'images/pic.png' }), [
    'content/extra.md, "Pic" (line 5): image "images/pic.png" holds an svg image, not a png. Rename it to match or replace it with a real png.',
  ]);
  assert.deepEqual(checkWith({ files: { 'content/images/pic.jpg': PNG }, image: 'images/pic.jpg' }), [
    'content/extra.md, "Pic" (line 5): image "images/pic.jpg" holds a png image, not a jpeg. Rename it to match or replace it with a real jpeg.',
  ]);
  assert.deepEqual(checkWith({ files: { 'content/images/pic.jpeg': JPEG }, image: 'images/pic.jpeg' }), []);
  assert.deepEqual(checkWith({ files: { 'content/images/pic.png': PNG }, image: 'images/pic.png' }), []);
  assert.deepEqual(checkWith({ files: { 'content/images/pic.svg': '<svg width="8" height="8"></svg>' }, image: 'images/pic.svg' }), []);
  const junk = checkWith({ files: { 'content/images/pic.png': 'not an image' }, image: 'images/pic.png' });
  assert.equal(junk.length, 1);
  assert.match(junk[0], /image "images\/pic\.png" is not a png, jpeg, gif, webp or svg image/);
});

test('an SVG upload over 100 KB is an error', () => {
  const big = `<svg width="8" height="8"><!-- ${'x'.repeat(102400)} --></svg>`;
  const errors = checkWith({ files: { 'content/images/big.svg': big }, image: 'images/big.svg' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /image "images\/big\.svg" is larger than 100 KB/);
});

test('socialImage must be a raster image inside the project', () => {
  const social = (value, files = {}) => checkWith({ files, social: value });
  assert.deepEqual(social('./card.png', { 'card.png': PNG }), []);
  assert.deepEqual(social('./card.jpeg', { 'card.jpeg': JPEG }), []);
  assert.match(social('../outside-secret.png')[0], /basic\.site\.socialImage "\.\.\/outside-secret\.png" must stay inside the project folder/);
  assert.match(social('./note.txt', { 'note.txt': 'secret' })[0], /basic\.site\.socialImage "\.\/note\.txt" must be a .png, .jpg, .jpeg, .gif or .webp file/);
  assert.match(social('./card.svg', { 'card.svg': SVG_TEXT })[0], /basic\.site\.socialImage "\.\/card\.svg" must be a .png, .jpg, .jpeg, .gif or .webp file/);
  assert.match(social('./card.png', { 'card.png': SVG_TEXT })[0], /basic\.site\.socialImage "\.\/card\.png" holds an svg image, not a png/);
});
