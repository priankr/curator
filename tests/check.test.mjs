import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCollections } from '../scripts/lib/parse.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test('the real repo passes with a summary line', () => {
  const r = run();
  assert.equal(r.status, 0);
  const cols = readCollections(fileURLToPath(new URL('../content', import.meta.url)));
  const items = cols.reduce((n, c) => n + c.items.length, 0);
  assert.match(r.out, new RegExp(`^Checked ${cols.length} collections and ${items} items: 0 errors, 0 warnings\\.$`, 'm'));
});

test('the errors fixture exits 1 with an Errors heading on stderr', () => {
  const r = run('--root', 'tests/fixtures/errors');
  assert.equal(r.status, 1);
  assert.match(r.err, /^Errors$/m);
  assert.match(r.err, /^ {2}- content\/Bad_Name\.md: /m);
  assert.match(r.out, /^Checked 3 collections and 11 items: 11 errors, 0 warnings\.$/m);
});

test('warnings print to stdout under a Warnings heading and do not fail', () => {
  const r = run('--root', 'tests/fixtures/warnings');
  assert.equal(r.status, 0);
  assert.match(r.out, /^Warnings$/m);
  assert.match(r.out, /^Checked 2 collections and 4 items: 0 errors, 10 warnings\.$/m);
});

test('singular forms are used for one of each', () => {
  const r = run('--root', 'tests/fixtures/config-refs');
  assert.match(r.out, /^Checked 1 collection and 1 item: 4 errors, 1 warning\.$/m);
});

test('an invalid config stops the check with a config summary', () => {
  const r = run('--root', 'tests/fixtures/bad-config');
  assert.equal(r.status, 1);
  assert.match(r.err, /^Errors$/m);
  assert.match(r.out, /^Config has 1 error\. Content was not checked\.$/m);
});
