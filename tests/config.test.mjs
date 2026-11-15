import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, resolveConfig, loadConfig } from '../scripts/lib/config.mjs';

const schema = JSON.parse(readFileSync(new URL('../src/config.schema.json', import.meta.url), 'utf8'));
const base = () => ({ basic: { site: { title: 'Sample brand', url: 'https://links.example.com' } } });
const errorsFor = (patch) => {
  const cfg = base();
  patch(cfg);
  return validateConfig(cfg, schema);
};
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const adv = (cfg, section, values) => {
  cfg.advanced = { ...(cfg.advanced ?? {}), [section]: values };
};

test('schema defaults resolve to a valid config', () => {
  const resolved = resolveConfig(base(), schema);
  assert.deepEqual(validateConfig(resolved, schema), []);
  assert.equal(resolved.advanced.scene.name, 'lighttable');
  assert.equal(resolved.basic.brand.primary.length, 3);
  assert.equal('surface' in resolved.basic.brand.neutral, false);
});

test('shipped config loads and includes every advanced default', () => {
  const { config, errors } = loadConfig();
  assert.deepEqual(errors, []);
  const a = config.advanced;
  assert.deepEqual(a.fonts, { typewriter: 'Special Elite', handwriting: 'Caveat', source: 'google', googleFontsUrl: null });
  assert.deepEqual(a.posters, { avoidPairs: [], excludeFromPosters: [], inverseShare: 0.25, primaryShare: 0.75, minContrast: 1.6, compositions: 'all' });
  assert.deepEqual(a.scene, { name: 'lighttable', pageSize: 12, motion: 'normal', colors: {} });
  assert.deepEqual(a.images, { fetch: true, timeoutMs: 15000, maxBytes: 3000000, fitDomains: ['github.com'] });
  assert.deepEqual(a.types, {});
  assert.deepEqual(a.build, { outDir: 'dist', itemPages: true });
  assert.equal(config.basic.site.socialImage, './content/images/social.png');
});

test('exact example messages', () => {
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { minContrast: 30 })), ['advanced.posters.minContrast must be a number from 1 to 21']);
  assert.deepEqual(errorsFor((c) => delete c.basic.site.url), ['basic.site.url is required']);
  assert.deepEqual(errorsFor((c) => adv(c, 'scene', { motion: 'slow' })), ['advanced.scene.motion must be one of normal, fast, off']);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { colours: [] })), ['advanced.posters.colours is not a known setting']);
  assert.deepEqual(errorsFor((c) => { c.basic.brand = { primary: [{ name: 'A', value: 'red' }] }; }), ['basic.brand.primary[0].value must be a hex colour such as #e4572e']);
  assert.deepEqual(errorsFor((c) => { c.basic.site.url = 'https://links.example.com/docs'; }), ['basic.site.url must be an http or https address with no path, such as https://links.example.com']);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { compositions: [1, 17] })), ['advanced.posters.compositions must be "all" or a list of composition numbers from 1 to 16']);
  assert.deepEqual(errorsFor((c) => { c.basic.brand = { primary: [] }; }), ['basic.brand.primary must have at least one colour']);
});

test('url variants', () => {
  for (const ok of ['https://a.example.com', 'http://a.example.com/', 'https://a.example.com:8080']) {
    assert.deepEqual(errorsFor((c) => { c.basic.site.url = ok; }), [], ok);
  }
  for (const bad of ['ftp://a.example.com', 'a.example.com', 'https://a.example.com?x=1', 'https://a.example.com/#top']) {
    assert.equal(errorsFor((c) => { c.basic.site.url = bad; }).length, 1, bad);
  }
});

test('hex colours accept short and mixed case forms', () => {
  const cfg = base();
  cfg.basic.brand = { primary: [{ name: 'A', value: '#ABC' }, { name: 'B', value: '#aBcDeF' }], neutral: { light: '#fff', surface: '#123456' } };
  assert.deepEqual(validateConfig(cfg, schema), []);
});

test('several errors are reported together', () => {
  const errors = errorsFor((c) => {
    delete c.basic.site.title;
    c.basic.site.url = 'nope';
    adv(c, 'scene', { motion: 'slow', pageSize: 0, extra: 1 });
  });
  assert.equal(errors.length, 5);
  assert.ok(errors.includes('basic.site.title is required'));
  assert.ok(errors.includes('advanced.scene.extra is not a known setting'));
});

test('missing required keys, including a missing basic section', () => {
  assert.deepEqual(validateConfig({}, schema).sort(), ['basic.site.title is required', 'basic.site.url is required']);
  assert.deepEqual(validateConfig({ basic: {} }, schema).sort(), ['basic.site.title is required', 'basic.site.url is required']);
});

test('wrong types', () => {
  assert.deepEqual(validateConfig([], schema), ['config must be an object']);
  assert.deepEqual(errorsFor((c) => { c.basic.site.title = 5; }), ['basic.site.title must be a non-empty string']);
  assert.deepEqual(errorsFor((c) => { c.basic.site.description = 5; }), ['basic.site.description must be a string']);
  assert.deepEqual(errorsFor((c) => adv(c, 'images', { fetch: 'yes' })), ['advanced.images.fetch must be true or false']);
  assert.deepEqual(errorsFor((c) => { c.basic = 'x'; }), ['basic must be an object']);
  assert.deepEqual(errorsFor((c) => adv(c, 'scene', { colors: { a: 5 } })), ['advanced.scene.colors.a must be a colour string']);
});

test('unknown keys at several depths', () => {
  const cfg = base();
  cfg.extra = 1;
  cfg.basic.site.colour = 'x';
  cfg.basic.brand = { primary: [{ name: 'A', value: '#fff', alpha: 1 }], neutral: { mid: '#fff' } };
  cfg.advanced = { types: { repo: { colour: 'x' } } };
  assert.deepEqual(validateConfig(cfg, schema).sort(), [
    'advanced.types.repo.colour is not a known setting',
    'basic.brand.neutral.mid is not a known setting',
    'basic.brand.primary[0].alpha is not a known setting',
    'basic.site.colour is not a known setting',
    'extra is not a known setting'
  ]);
});

test('enums and ranges', () => {
  assert.deepEqual(errorsFor((c) => adv(c, 'fonts', { source: 'cdn' })), ['advanced.fonts.source must be one of google, self']);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { inverseShare: 1.5 })), ['advanced.posters.inverseShare must be a number from 0 to 1']);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { minContrast: 0.5 })), ['advanced.posters.minContrast must be a number from 1 to 21']);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { minContrast: 'high' })), ['advanced.posters.minContrast must be a number from 1 to 21']);
  assert.deepEqual(errorsFor((c) => adv(c, 'scene', { pageSize: 101 })), ['advanced.scene.pageSize must be a whole number from 1 to 100']);
  assert.deepEqual(errorsFor((c) => adv(c, 'scene', { pageSize: 12.5 })), ['advanced.scene.pageSize must be a whole number from 1 to 100']);
  assert.deepEqual(errorsFor((c) => adv(c, 'images', { timeoutMs: 10 })), ['advanced.images.timeoutMs must be a whole number of milliseconds from 1000 to 120000']);
  assert.deepEqual(errorsFor((c) => adv(c, 'build', { outDir: '/abs' })), ['advanced.build.outDir must be a relative folder path such as dist']);
});

test('compositions forms', () => {
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { compositions: 'all' })), []);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { compositions: [1, 16, 7] })), []);
  for (const bad of [[], [1, 1], [0], [1.5], 'some']) {
    assert.equal(errorsFor((c) => adv(c, 'posters', { compositions: bad })).length, 1, JSON.stringify(bad));
  }
});

test('nullable and list settings', () => {
  assert.deepEqual(errorsFor((c) => { c.basic.collections = { default: null, order: ['a-b', 'c1'] }; }), []);
  assert.equal(errorsFor((c) => { c.basic.collections = { order: ['Bad Id'] }; }).length, 1);
  assert.equal(errorsFor((c) => adv(c, 'fonts', { googleFontsUrl: 'http://x.example.com/f' })).length, 1);
  assert.deepEqual(errorsFor((c) => adv(c, 'fonts', { googleFontsUrl: 'https://x.example.com/f' })), []);
  assert.deepEqual(errorsFor((c) => adv(c, 'posters', { avoidPairs: [['A', 'B']] })), []);
  assert.equal(errorsFor((c) => adv(c, 'posters', { avoidPairs: [['A']] })).length, 1);
  assert.deepEqual(errorsFor((c) => adv(c, 'types', { repo: { label: 'Project', dot: 'accent.1' } })), []);
  assert.deepEqual(errorsFor((c) => adv(c, 'types', { repo: { dot: 'accent.9' } })), []);
  for (const dot of ['accent', 'accent.', 'tertiary.0', 'Primary.0', 'primary.-1', 'primary.0.1']) {
    assert.deepEqual(errorsFor((c) => adv(c, 'types', { repo: { dot } })), ['advanced.types.repo.dot must be a colour role such as primary.0, secondary.0 or accent.0'], dot);
  }
});

test('user arrays replace default arrays', () => {
  const cfg = base();
  adv(cfg, 'images', { fitDomains: ['example.org'] });
  assert.deepEqual(resolveConfig(cfg, schema).advanced.images.fitDomains, ['example.org']);
  cfg.basic.brand = { primary: [{ name: 'Only', value: '#000' }] };
  assert.equal(resolveConfig(cfg, schema).basic.brand.primary.length, 1);
});

test('objects merge deeply', () => {
  const cfg = base();
  adv(cfg, 'scene', { motion: 'fast' });
  const r = resolveConfig(cfg, schema);
  assert.equal(r.advanced.scene.motion, 'fast');
  assert.equal(r.advanced.scene.pageSize, 12);
  assert.equal(r.basic.site.language, 'en');
});

test('resolveConfig does not mutate its input or share references', () => {
  const cfg = base();
  adv(cfg, 'images', { fitDomains: ['example.org'] });
  const copy = structuredClone(cfg);
  const r = resolveConfig(cfg, schema);
  assert.deepEqual(cfg, copy);
  r.advanced.images.fitDomains.push('x');
  r.basic.brand.primary.push({ name: 'x', value: '#000' });
  assert.deepEqual(cfg, copy);
  assert.equal(resolveConfig(base(), schema).basic.brand.primary.length, 3);
});

test('loadConfig reports invalid JSON, missing files and validation errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-config-'));
  temps.push(dir);
  const file = join(dir, 'curator.config.json');
  assert.deepEqual(loadConfig(file), { config: null, errors: ['curator.config.json was not found'] });
  writeFileSync(file, '{ "basic": ');
  const bad = loadConfig(file);
  assert.equal(bad.config, null);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /^curator\.config\.json is not valid JSON: .+/);
  writeFileSync(file, JSON.stringify({ basic: { site: { title: 'T' } } }));
  assert.deepEqual(loadConfig(file), { config: null, errors: ['basic.site.url is required'] });
  writeFileSync(file, JSON.stringify(base()));
  const ok = loadConfig(file);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.config.advanced.build.outDir, 'dist');
});
