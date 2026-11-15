import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));
const DEV = fileURLToPath(new URL('../scripts/dev.mjs', import.meta.url));
const LIMIT_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls until check returns something truthy, or fails after the limit.
async function until(what, check) {
  const end = Date.now() + LIMIT_MS;
  let last = null;
  while (Date.now() < end) {
    try {
      const found = await check();
      if (found) return found;
    } catch (err) {
      last = err;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}${last ? ` (${last.message})` : ''}`);
}

test('dev serves, rebuilds on change, shows build errors and recovers', { timeout: 90000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'curator-dev-'));
  const root = join(temp, 'site');
  cpSync(FIXTURE, root, { recursive: true });
  const configFile = join(root, 'curator.config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.advanced = { images: { fetch: false } };
  writeFileSync(configFile, JSON.stringify(config, null, 2));

  const child = spawn(process.execPath, [DEV, '--root', root, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  try {
    const port = await until('the serving line', () => /Serving on http:\/\/localhost:(\d+)/.exec(output)?.[1]);
    const base = `http://localhost:${port}`;
    assert.match(output, /Built 7 pages and 0 images into dist in \d+\.\ds\./);

    assert.match(output, new RegExp(`Serving on [^\\n]*\\nTheme page on ${base}/__theme/\\n`));

    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);

    const file = join(root, 'content', 'links.md');
    const original = readFileSync(file, 'utf8');
    appendFileSync(file, '\n## Added item\nurl: https://example.com/added\nimage: none\n');
    await until('the new item', async () => {
      const data = await (await fetch(`${base}/data/site.json`)).json();
      return data.collections[0].items.some((i) => i.key === 'Added item');
    });
    assert.match(output, /Rebuilt in \d+\.\ds\./);
    assert.equal((await fetch(`${base}/links/added-item/`)).status, 200);

    writeFileSync(file, original.replace('url: https://example.com/second\n', ''));
    const broken = await until('the build failed page', async () => {
      const res = await fetch(`${base}/`);
      return res.status === 500 ? res.text() : null;
    });
    assert.match(broken, /Build failed/);
    assert.match(broken, /url is missing/);
    assert.equal((await fetch(`${base}/data/site.json`)).status, 200);

    writeFileSync(file, original);
    await until('the site to recover', async () => (await fetch(`${base}/`)).status === 200);
  } catch (err) {
    err.message += `\n--- dev output ---\n${output}`;
    throw err;
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r)));
    rmSync(temp, { recursive: true, force: true });
  }
});
