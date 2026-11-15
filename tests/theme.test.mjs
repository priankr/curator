import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast, mix, normalizeBrand } from '../src/js/palette.js';
import { TYPES } from '../src/js/types.js';
import { resolveConfig } from '../scripts/lib/config.mjs';
import { ROLE_TOKENS, collectTokens, computeRoles, isColor, themeStyle, tokensFromCss, validateColors } from '../scripts/lib/theme.mjs';
import { checkSite } from '../scripts/lib/validate.mjs';
import { buildSite } from '../scripts/lib/build-site.mjs';

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const SRC = path('../src/');
const schema = JSON.parse(readFileSync(path('../src/config.schema.json'), 'utf8'));
const sampleFile = JSON.parse(readFileSync(path('../docs/examples/sample-brand.json'), 'utf8'));
const required = { site: { title: 'Sample brand', url: 'https://links.example.com' } };
const defaultBrand = resolveConfig({ basic: required }, schema).basic.brand;
const sampleBrand = resolveConfig({ basic: { ...required, ...sampleFile.basic } }, schema).basic.brand;
const types = TYPES.map((t) => ({ name: t.name, dot: t.dot }));
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

test('the default brand: Marigold fill, dark text, Marigold focus', () => {
  const r = computeRoles(defaultBrand, types);
  assert.equal(r.visit.fill, '#f2b134');
  assert.equal(r.pill.fill, '#f2b134');
  assert.equal(r.visit.text, '#1d1b18');
  assert.equal(r.pill.text, '#1d1b18');
  assert.equal(r.focus, '#f2b134');
  assert.deepEqual(r.warnings, []);
});

test('the sample brand: first accent, dark text, Lime focus', () => {
  const r = computeRoles(sampleBrand, types);
  assert.equal(r.visit.fill, '#ccf53a');
  assert.equal(r.visit.text, '#2b1d16');
  assert.equal(r.focus, '#ccf53a');
  assert.deepEqual(r.warnings, []);
});

test('Visit and active item text reach 4.5:1 for both shipped brands', () => {
  for (const brand of [defaultBrand, sampleBrand]) {
    const r = computeRoles(brand, types);
    assert.ok(contrast(r.visit.text, r.visit.fill) >= 4.5);
    assert.ok(contrast(r.pill.text, r.pill.fill) >= 4.5);
    assert.equal(r.visit.contrast, contrast(r.visit.text, r.visit.fill));
  }
});

test('hover is lighter and pressed is darker than the fill', () => {
  const r = computeRoles(defaultBrand, types);
  assert.equal(r.visit.hover, mix(r.visit.fill, '#ffffff', 0.12));
  assert.equal(r.visit.pressed, mix(r.visit.fill, '#000000', 0.12));
});

test('a primary that reads poorly with both neutrals falls back to black or white with a warning', () => {
  const brand = { primary: [{ name: 'Grey', value: '#808080' }], neutral: { light: '#999999', dark: '#666666' } };
  const r = computeRoles(brand, types);
  assert.ok(contrast('#666666', '#808080') < 4.5 && contrast('#999999', '#808080') < 4.5);
  assert.equal(r.visit.text, '#000000');
  assert.equal(r.pill.text, '#000000');
  assert.ok(r.visit.contrast >= 4.5);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /^brand: the Visit button and active collection item text reaches only 1\.\d\d:1 /);
  assert.ok(r.warnings[0].includes('black is used instead'));
  const light = computeRoles({ primary: [{ name: 'Navy', value: '#303060' }], neutral: { light: '#555577', dark: '#444466' } }, types);
  assert.equal(light.visit.text, '#ffffff');
  assert.ok(light.warnings[0].includes('white is used instead'));
});

test('the build warns about a poor brand through npm run check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-theme-'));
  temps.push(dir);
  cpSync(path('./fixtures/valid'), dir, { recursive: true });
  const config = { basic: { site: required.site, brand: { primary: [{ name: 'Grey', value: '#808080' }], neutral: { light: '#999999', dark: '#666666' } } } };
  writeFileSync(join(dir, 'curator.config.json'), JSON.stringify(config));
  const r = checkSite(dir);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].startsWith('brand: the Visit button and active collection item text'));
});

test('the Visit button and the active collection item fill with accent 1, else primary 1, and warn on a pale accent', () => {
  const r = computeRoles(defaultBrand, types);
  assert.equal(r.pill.fill, r.focus);
  assert.ok(contrast(r.pill.text, r.pill.fill) >= 4.5);
  const noAccent = { primary: [{ name: 'A', value: '#1a5fb4' }], neutral: { light: '#ffffff', dark: '#111111' } };
  assert.equal(computeRoles(noAccent, types).pill.fill, '#1a5fb4');
  assert.equal(computeRoles(noAccent, types).visit.fill, '#1a5fb4');
  const pale = computeRoles({ primary: [{ name: 'A', value: '#1a5fb4' }], accent: [{ name: 'Mid', value: '#808080' }], neutral: { light: '#999999', dark: '#666666' } }, types);
  assert.equal(pale.visit.fill, '#808080');
  assert.equal(pale.pill.fill, '#808080');
  assert.equal(pale.pill.text, '#000000');
  assert.ok(pale.warnings.some((w) => w.startsWith('brand: the Visit button and active collection item text reaches only') && w.includes('accent 1')));
});

test('the focus ring uses accent 1, else primary 1', () => {
  assert.equal(computeRoles(defaultBrand, types).focus, '#f2b134');
  const noAccent = { primary: [{ name: 'A', value: '#1a5fb4' }, { name: 'B', value: '#e01b24' }], neutral: { light: '#ffffff', dark: '#111111' } };
  assert.equal(computeRoles(noAccent, types).focus, '#1a5fb4');
});

test('the side arrows use accent 1 with an icon that reaches 3:1', () => {
  const r = computeRoles(defaultBrand, types);
  assert.equal(r.arrow.fill, '#f2b134');
  assert.equal(r.arrow.icon, '#1d1b18');
  assert.ok(contrast(r.arrow.icon, r.arrow.fill) >= 3);
  assert.deepEqual(r.warnings, []);
  const noAccent = { primary: [{ name: 'A', value: '#1a5fb4' }], neutral: { light: '#ffffff', dark: '#111111' } };
  assert.equal(computeRoles(noAccent, types).arrow.fill, '#1a5fb4');
  assert.equal(computeRoles(noAccent, types).arrow.icon, '#ffffff');
});

test('a pale accent with pale neutrals gives a black arrow icon and a warning', () => {
  const brand = { primary: [{ name: 'A', value: '#1a5fb4' }], accent: [{ name: 'Pale', value: '#f0f0f0' }], neutral: { light: '#fafafa', dark: '#e0e0e0' } };
  const r = computeRoles(brand, types);
  assert.equal(r.arrow.icon, '#000000');
  assert.ok(contrast(r.arrow.icon, r.arrow.fill) >= 3);
  assert.ok(r.warnings.some((w) => w.startsWith('brand: the side arrow icon reaches only ') && w.includes('black is used instead')));
});

test('the arrow tokens are role tokens, written by the theme and not overridable', () => {
  assert.ok(ROLE_TOKENS.includes('chrome-arrow-fill') && ROLE_TOKENS.includes('chrome-arrow-icon'));
  const tokens = collectTokens(SRC, 'lighttable');
  const html = themeStyle({ roles: computeRoles(defaultBrand, types), fonts: {}, colors: { 'chrome-arrow-fill': '#000000' }, tokens });
  assert.ok(html.includes('--chrome-arrow-fill:#f2b134;--chrome-arrow-icon:#1d1b18'));
  assert.ok(!html.includes('#000000'));
  assert.equal(validateColors({ 'chrome-arrow-icon': '#fff' }, tokens).length, 1);
});

test('the dot roles resolve like the front end always did', () => {
  const brand = normalizeBrand(defaultBrand);
  const r = computeRoles(defaultBrand, types);
  assert.deepEqual(r.dots, {
    video: brand.primary[1].value,
    repo: brand.secondary[0].value,
    image: brand.accent[0].value,
    article: brand.primary[2].value,
    webpage: brand.primary[0].value,
  });
  // A role past the end of its list falls back to the first entry, and an empty list to primary 1.
  const short = computeRoles({ primary: [{ name: 'A', value: '#1a5fb4' }], neutral: { light: '#ffffff', dark: '#111111' } }, types);
  assert.deepEqual(Object.values(short.dots), ['#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4']);
  const two = computeRoles({ primary: [{ name: 'A', value: '#1a5fb4' }, { name: 'B', value: '#26a269' }], neutral: { light: '#ffffff', dark: '#111111' } }, types);
  assert.equal(two.dots.article, '#1a5fb4');
  assert.equal(two.dots.webpage, '#1a5fb4');
  const bare = computeRoles({ neutral: { light: '#ffffff', dark: '#111111' } }, types);
  assert.deepEqual(Object.values(bare.dots), ['#111111', '#111111', '#111111', '#111111', '#111111']);
});

test('tokens are collected from the :root blocks with their comments', () => {
  const css = ':root { --f-serif: Georgia, serif; --a-b: #fff; /* One */ --c: rgba(0, 0, 0, .5); }\n.x { --not-root: #123; }\n:root{--d:transparent;/* Four */}';
  assert.deepEqual(tokensFromCss(css), [
    { name: 'a-b', value: '#fff', comment: 'One' },
    { name: 'c', value: 'rgba(0, 0, 0, .5)', comment: '' },
    { name: 'd', value: 'transparent', comment: 'Four' },
  ]);
});

test('the real stylesheets give tokens in every object group, each with a comment', () => {
  const tokens = collectTokens(SRC, 'lighttable');
  const names = tokens.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const group of ['page', 'chrome', 'table', 'glass', 'mount', 'label', 'screen', 'caption', 'beam', 'projector', 'button']) {
    assert.ok(names.some((n) => n.startsWith(group + '-')), group);
  }
  for (const t of tokens) assert.ok(t.comment.length > 0, t.name);
  for (const role of ROLE_TOKENS) assert.ok(names.includes(role), role);
  assert.ok(!names.includes('f-serif') && !names.includes('ease'));
});

test('colour syntax', () => {
  for (const ok of ['#fff', '#ffff', '#1d1b18', '#1d1b18cc', 'rgb(0, 0, 0)', 'rgba(0, 0, 0, 0.5)', 'rgba(0,0,0,.5)', 'hsl(210, 40%, 50%)', 'hsla(210, 40%, 50%, 50%)', 'rgb(0 0 0 / 50%)', 'transparent']) {
    assert.ok(isColor(ok), ok);
  }
  for (const bad of ['red', '#ff', '#fffff', '#ggg', 'rgb(0, 0)', 'rgb(0, 0, 0, 0, 0)', 'rgb(var(--x), 0, 0)', 'url(x)', 'red;}body{display:none', '#fff;', '', 5, null]) {
    assert.ok(!isColor(bad), String(bad));
  }
});

test('override validation gives each message exactly', () => {
  const tokens = collectTokens(SRC, 'lighttable');
  const unknown = (n) => `curator.config.json: advanced.scene.colors.${n} is not a scene colour token. See docs/CONFIG.md for the list.`;
  const badValue = (n) => `curator.config.json: advanced.scene.colors.${n} must be a colour such as #1d1b18 or rgba(0, 0, 0, 0.5).`;
  assert.deepEqual(validateColors({ 'table-frame-top': '#112233', 'glass-grid': 'rgba(1, 2, 3, 0.1)', 'page-bg': 'transparent' }, tokens), []);
  assert.deepEqual(validateColors({ nope: '#fff' }, tokens), [unknown('nope')]);
  assert.deepEqual(validateColors({ '--table-frame-top': '#fff' }, tokens), [unknown('--table-frame-top')]);
  assert.deepEqual(validateColors({ 'f-serif': '#fff' }, tokens), [unknown('f-serif')]);
  assert.deepEqual(validateColors({ 'button-visit-fill': '#fff', 'chrome-focus': '#fff' }, tokens), [unknown('button-visit-fill'), unknown('chrome-focus')]);
  assert.deepEqual(validateColors({ 'dot-video': '#fff' }, tokens), [unknown('dot-video')]);
  assert.deepEqual(validateColors({ 'table-frame-top': 'red' }, tokens), [badValue('table-frame-top')]);
  assert.deepEqual(validateColors({ 'table-frame-top': 'red;}body{display:none' }, tokens), [badValue('table-frame-top')]);
  assert.deepEqual(validateColors({ 'table-frame-top': '#fff;} body{display:none' }, tokens), [badValue('table-frame-top')]);
  assert.deepEqual(validateColors({ 'table-frame-top': 'rgb(0, 0, 0) !important' }, tokens), [badValue('table-frame-top')]);
});

test('npm run check reports colour override errors from the config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-theme-'));
  temps.push(dir);
  cpSync(path('./fixtures/valid'), dir, { recursive: true });
  const config = { basic: { site: required.site }, advanced: { scene: { colors: { 'table-frame-top': 'red;}body{display:none', 'bogus-token': '#fff', 'page-room': '#101010' } } } };
  writeFileSync(join(dir, 'curator.config.json'), JSON.stringify(config));
  assert.deepEqual(checkSite(dir).errors, [
    'curator.config.json: advanced.scene.colors.table-frame-top must be a colour such as #1d1b18 or rgba(0, 0, 0, 0.5).',
    'curator.config.json: advanced.scene.colors.bogus-token is not a scene colour token. See docs/CONFIG.md for the list.',
  ]);
});

test('the injected style holds roles, fonts and only valid overrides', () => {
  const tokens = collectTokens(SRC, 'lighttable');
  const roles = computeRoles(defaultBrand, types);
  const fonts = { display: 'Fraunces', body: "Evil';}</style><script>x()</script>", mono: null, poster: 'Archivo', typewriter: 'Special Elite', handwriting: 'Caveat' };
  const colors = { 'table-frame-top': '#112233', 'glass-grid': 'red;}body{display:none', 'button-visit-fill': '#000000', nope: '#fff' };
  const html = themeStyle({ roles, fonts, colors, tokens });
  assert.ok(html.startsWith('<style id="curator-theme">:root{') && html.endsWith('}</style>'));
  assert.equal(html.split('<style').length, 2);
  assert.equal(html.split('</style>').length, 2);
  assert.ok(html.includes('--button-visit-fill:#f2b134'));
  assert.ok(html.includes('--button-visit-text:#1d1b18'));
  assert.ok(html.includes('--chrome-focus:#f2b134'));
  assert.ok(html.includes('--dot-video:#2b4ea2;--dot-repo:#0f6e63;--dot-image:#f2b134;--dot-article:#17304f;--dot-webpage:#e4572e'));
  assert.ok(html.includes("--f-serif:'Fraunces', 'Iowan Old Style', Georgia, serif"));
  assert.ok(html.includes("--f-mono:ui-monospace, Menlo, monospace"));
  assert.ok(html.includes("--f-sans:'Evil/stylescriptx()/script', 'Helvetica Neue', Arial, sans-serif"));
  assert.ok(html.includes('--table-frame-top:#112233'));
  assert.ok(!html.includes('body{display'));
  assert.ok(!html.includes('--glass-grid'));
  assert.ok(!html.includes('--nope'));
  assert.ok(!html.includes('--button-visit-fill:#000000'));
});

test('the build writes the theme block into every page head after the stylesheets', async () => {
  const base = mkdtempSync(join(tmpdir(), 'curator-theme-'));
  temps.push(base);
  const root = join(base, 'site');
  cpSync(path('./fixtures/valid'), root, { recursive: true });
  const config = { basic: { site: required.site }, advanced: { images: { fetch: false }, scene: { colors: { 'table-frame-top': '#123456' } } } };
  writeFileSync(join(root, 'curator.config.json'), JSON.stringify(config));
  const r = await buildSite({ root, log: () => {} });
  assert.equal(r.ok, true, r.errors.join('\n'));
  for (const file of ['index.html', '404.html', 'links/index.html']) {
    const html = readFileSync(join(root, 'dist', file), 'utf8');
    assert.equal(html.split('id="curator-theme"').length, 2, file);
    assert.ok(html.indexOf('id="curator-theme"') > html.indexOf('scene.css'), file);
    assert.ok(html.indexOf('id="curator-theme"') < html.indexOf('</head>'), file);
    assert.ok(html.includes('--table-frame-top:#123456'), file);
    assert.ok(html.includes('--button-visit-fill:#f2b134'), file);
  }
});

test('a bad override stops the build and nothing is injected', async () => {
  const base = mkdtempSync(join(tmpdir(), 'curator-theme-'));
  temps.push(base);
  const root = join(base, 'site');
  cpSync(path('./fixtures/valid'), root, { recursive: true });
  const config = { basic: { site: required.site }, advanced: { images: { fetch: false }, scene: { colors: { 'table-frame-top': 'red;}body{display:none' } } } };
  writeFileSync(join(root, 'curator.config.json'), JSON.stringify(config));
  const r = await buildSite({ root, log: () => {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['curator.config.json: advanced.scene.colors.table-frame-top must be a colour such as #1d1b18 or rgba(0, 0, 0, 0.5).']);
});
