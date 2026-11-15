import { mkdirSync, readFileSync, watch } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './lib/build-site.mjs';
import { printIssues } from './lib/report.mjs';
import { startServer } from './lib/serve.mjs';
import { THEME_PAGE_PATH, themePageMounts, themePageRoutes } from './lib/theme-page.mjs';

const DEBOUNCE_MS = 150;
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const repoSrc = join(repoRoot, 'src');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at !== -1 && args[at + 1] !== undefined ? args[at + 1] : null;
};
const root = flag('--root') ? resolve(flag('--root')) : repoRoot;
const portText = flag('--port') ?? process.env.PORT ?? '4321';
const port = Number(portText);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`The port "${portText}" is not valid.`);
  process.exit(1);
}

// The out folder name comes from the config when it can be read, otherwise dist.
function configuredOutDir() {
  try {
    const value = JSON.parse(readFileSync(join(root, 'curator.config.json'), 'utf8'))?.advanced?.build?.outDir;
    const out = resolve(root, typeof value === 'string' && value ? value : 'dist');
    const rel = relative(root, out);
    return rel && !rel.startsWith('..') ? out : resolve(root, 'dist');
  } catch {
    return resolve(root, 'dist');
  }
}

const skipUrls = new Set();
let errors = [];
let outDir = null;

async function runBuild() {
  let result;
  try {
    result = await buildSite({ root, skipUrls });
  } catch (err) {
    result = { ok: false, errors: [`The build stopped unexpectedly: ${err?.message ?? err}`], warnings: [], failedUrls: [], ms: 0 };
  }
  printIssues(result);
  for (const url of result.failedUrls ?? []) skipUrls.add(url);
  // A failed build returns before it touches the out folder, so the last good output stays.
  errors = result.ok ? [] : result.errors;
  if (result.ok) outDir = result.outDir;
  return result;
}

const first = await runBuild();
if (first.ok) {
  const out = relative(root, first.outDir).split(sep).join('/');
  console.log(`Built ${first.pages} pages and ${first.images} images into ${out} in ${(first.ms / 1000).toFixed(1)}s.`);
}
const serveDir = outDir ?? configuredOutDir();
mkdirSync(serveDir, { recursive: true });

const server = await startServer({
  dir: serveDir,
  port,
  getError: () => errors,
  mounts: { '/__tests/': join(repoRoot, 'tests', 'browser'), ...themePageMounts(repoRoot) },
  routes: themePageRoutes({ repoRoot, root, getOutDir: () => serveDir }),
});
console.log(`Serving on http://localhost:${server.address().port}`);
console.log(`Theme page on http://localhost:${server.address().port}${THEME_PAGE_PATH}`);

let building = false;
let again = false;
let timer = null;

async function rebuild() {
  if (building) {
    again = true;
    return;
  }
  building = true;
  try {
    do {
      again = false;
      const result = await runBuild();
      if (result.ok) console.log(`Rebuilt in ${(result.ms / 1000).toFixed(1)}s.`);
    } while (again);
  } finally {
    building = false;
  }
}

function changed(name) {
  if (name) {
    const parts = String(name).split(/[\/]/);
    if (parts[0] === '.cache') return;
  }
  clearTimeout(timer);
  timer = setTimeout(rebuild, DEBOUNCE_MS);
}

const watchers = [];
function add(dir, onName, deep = true) {
  for (const recursive of deep ? [true, false] : [false]) {
    try {
      watchers.push(watch(dir, { recursive }, (_, name) => onName(name)));
      return;
    } catch {
      // Recursive watching is missing on some platforms, so fall back to the top folder.
    }
  }
  console.error(`Could not watch ${dir}`);
}
add(join(root, 'content'), changed);
add(join(root, 'src'), changed);
if (resolve(repoSrc) !== resolve(root, 'src')) add(repoSrc, changed);
// The config file is watched through its folder so that editors which replace it are seen.
add(root, (name) => {
  if (name === 'curator.config.json') changed(name);
}, false);
for (const w of watchers) w.on('error', () => {});

process.on('SIGINT', () => {
  clearTimeout(timer);
  for (const w of watchers) w.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
