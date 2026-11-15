import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../scripts/lib/build-site.mjs';
import { startServer } from '../scripts/lib/serve.mjs';
import { themePageMounts, themePageRoutes } from '../scripts/lib/theme-page.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));
const REPO = fileURLToPath(new URL('../', import.meta.url));
const temps = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// Builds the valid fixture with image fetching off and returns its root and build result.
async function built() {
  const base = mkdtempSync(join(tmpdir(), 'curator-theme-'));
  temps.push(base);
  const root = join(base, 'site');
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, 'curator.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  config.advanced = { images: { fetch: false } };
  writeFileSync(file, JSON.stringify(config, null, 2));
  const result = await buildSite({ root, log: () => {} });
  assert.equal(result.ok, true, result.errors.join('\n'));
  return { root, result };
}

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

test('the production build holds nothing from the dev theme page', async () => {
  const { result } = await built();
  const names = ['__theme', '__dev', 'theme-page'];
  const files = walk(result.outDir);
  assert.ok(files.length > 5);
  for (const file of files) {
    const text = readFileSync(file, 'latin1');
    for (const name of names) {
      assert.ok(!file.includes(name), `${file} is named like the theme page`);
      assert.ok(!text.includes(name), `${file} mentions ${name}`);
    }
  }
});

test('the dev server serves the theme page, its modules and its data', async () => {
  const { root, result } = await built();
  const server = await startServer({
    dir: result.outDir,
    port: 0,
    mounts: themePageMounts(REPO),
    routes: themePageRoutes({ repoRoot: REPO, root, getOutDir: () => result.outDir }),
  });
  const base = `http://localhost:${server.address().port}`;
  try {
    const page = await fetch(`${base}/__theme/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Brand switch/);
    const kit = await fetch(`${base}/__theme/js/kit.js`);
    assert.equal(kit.status, 200);
    assert.equal(await kit.text(), readFileSync(join(REPO, 'src', 'js', 'kit.js'), 'utf8'));
    const res = await fetch(`${base}/__theme/data.json`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.tokens.length > 20);
    assert.ok(data.roleTokens.includes('button-visit-fill'));
    assert.equal(data.brands.sample.name, 'Sample brand');
    assert.ok(data.brands.sample.roles.visit.fill);
    assert.equal(data.brands.configured.posters.minContrast, 1.6);
    assert.equal((await fetch(`${base}/__theme/theme-page.css`)).status, 200);
    assert.equal((await fetch(`${base}/__theme/../package.json`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
