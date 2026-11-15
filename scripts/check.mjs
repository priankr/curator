import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSiteWithFonts } from './lib/validate.mjs';
import { plural, printIssues } from './lib/report.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--root');
const root = at !== -1 && args[at + 1] ? resolve(args[at + 1]) : repoRoot;

const result = await checkSiteWithFonts(root, { offline: args.includes('--offline') });

printIssues(result);
if (result.configFailed) {
  console.log(`Config has ${plural(result.errors.length, 'error')}. Content was not checked.`);
} else {
  console.log(`Checked ${plural(result.collections.length, 'collection')} and ${plural(result.itemCount, 'item')}: ${plural(result.errors.length, 'error')}, ${plural(result.warnings.length, 'warning')}.`);
}
process.exitCode = result.errors.length ? 1 : 0;
