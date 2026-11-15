import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './lib/build-site.mjs';
import { printIssues } from './lib/report.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--root');
const root = at !== -1 && args[at + 1] ? resolve(args[at + 1]) : repoRoot;
let refresh = false;
for (const arg of args) {
  if (arg === '--refresh-images') refresh = true;
  else if (arg.startsWith('--refresh-images=')) refresh = arg.slice('--refresh-images='.length) || true;
}

const result = await buildSite({ root, refresh, offline: args.includes('--offline') });
printIssues(result);
if (result.ok) {
  const out = relative(root, result.outDir).split('\\').join('/');
  console.log(`Built ${result.pages} pages and ${result.images} images into ${out} in ${(result.ms / 1000).toFixed(1)}s.`);
}
process.exitCode = result.ok ? 0 : 1;
