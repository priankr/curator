import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build-site.mjs';
import { printIssues } from './report.mjs';
import { startServer } from './serve.mjs';
import { themePageMounts, themePageRoutes } from './theme-page.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const WINDOWS = [
  ['PROGRAMFILES', 'Google/Chrome/Application/chrome.exe'],
  ['PROGRAMFILES(X86)', 'Google/Chrome/Application/chrome.exe'],
  ['LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe'],
  ['PROGRAMFILES', 'Microsoft/Edge/Application/msedge.exe'],
  ['PROGRAMFILES(X86)', 'Microsoft/Edge/Application/msedge.exe'],
];
const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

// Returns the path of a Chrome or Edge binary, or null.
export function findBrowser() {
  const env = process.env.CURATOR_BROWSER;
  if (env) return existsSync(env) ? env : null;
  if (process.platform === 'win32') {
    for (const [name, rest] of WINDOWS) {
      const base = process.env[name];
      if (base && existsSync(join(base, rest))) return join(base, rest);
    }
    return null;
  }
  if (process.platform === 'darwin') {
    for (const path of MAC) if (existsSync(path)) return path;
  }
  for (const name of PATH_NAMES) {
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    const path = found.status === 0 ? found.stdout.split(/\r?\n/)[0].trim() : '';
    if (path) return path;
  }
  return null;
}

export function requireBrowser() {
  const browser = findBrowser();
  if (!browser) {
    const hint = process.env.CURATOR_BROWSER ? `CURATOR_BROWSER points to "${process.env.CURATOR_BROWSER}", which does not exist.` : 'Install Chrome, Chromium or Edge, or set CURATOR_BROWSER to its path.';
    console.error(`No browser found. ${hint}`);
    process.exit(1);
  }
  return browser;
}

// Resolves the base URL: the one given, or a fresh build served on a free port with the test mount.
// The build is always of a temp copy, so it never overwrites the repo's own output folder.
// With own, the copy is of tests/fixtures/<own.fixture> when set, else of the repo, with own.advanced merged in.
export async function openSite(url, own = null) {
  if (url) return { base: url.replace(/\/+$/, ''), close: async () => {} };
  const source = own?.fixture ? join(repoRoot, 'tests', 'fixtures', own.fixture) : repoRoot;
  const temp = mkdtempSync(join(tmpdir(), 'curator-browser-site-'));
  const root = temp;
  cpSync(join(source, 'content'), join(temp, 'content'), { recursive: true });
  for (const name of ['images', 'images.json', 'fonts', 'fonts.json']) {
    const from = join(repoRoot, '.cache', name);
    if (existsSync(from)) cpSync(from, join(temp, '.cache', name), { recursive: true });
  }
  const config = JSON.parse(readFileSync(join(source, 'curator.config.json'), 'utf8'));
  if (own?.advanced) config.advanced = { ...config.advanced, ...own.advanced };
  writeFileSync(join(temp, 'curator.config.json'), JSON.stringify(config, null, 2));
  const cleanup = () => rmSync(temp, { recursive: true, force: true });
  const built = await buildSite({ root, offline: true });
  printIssues(built);
  if (!built.ok) {
    console.error('The build failed, so there is nothing to test.');
    cleanup();
    process.exit(1);
  }
  const server = await startServer({
    dir: built.outDir,
    port: 0,
    mounts: { '/__tests/': join(repoRoot, 'tests', 'browser'), ...themePageMounts(repoRoot) },
    routes: themePageRoutes({ repoRoot, root, getOutDir: () => built.outDir }),
  });
  return {
    base: `http://localhost:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => { cleanup(); resolve(); }); }),
  };
}

export const argValue = (args, name) => {
  const at = args.indexOf(name);
  return at !== -1 && args[at + 1] !== undefined ? args[at + 1] : null;
};
