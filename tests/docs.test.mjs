import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../scripts/docs-config.mjs';

test('docs/CONFIG.md matches the generator output', () => {
  const file = readFileSync(fileURLToPath(new URL('../docs/CONFIG.md', import.meta.url)), 'utf8');
  assert.ok(generate() === file, 'docs/CONFIG.md is out of date. Run npm run docs.');
});
