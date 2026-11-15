import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { checkSite } from './validate.mjs';
import { resolveImages } from './images.mjs';
import { resolveFonts } from './fonts.mjs';
import { buildSiteData } from './site.mjs';
import { pageHead } from './html.mjs';
import { faviconSvg } from './favicon.mjs';
import { escapeHtml } from './markdown.mjs';
import { collectTokens, computeRoles, themeStyle } from './theme.mjs';

const REPO_SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const MARKER = '.curator-build';
const PROTECTED = ['src', 'content', 'docs', 'scripts', 'tests', '.cache', 'node_modules', '.git'];
const SKIPPED = new Set(['index.html', 'config.schema.json']);

const inside = (parent, child) => child === parent || child.startsWith(parent + sep);

// Returns the resolved output folder, or null when it is not a safe place to write.
function safeOutDir(root, value) {
  const out = resolve(root, value);
  const rel = relative(root, out);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  for (const name of PROTECTED) {
    const dir = resolve(root, name);
    if (inside(dir, out) || inside(out, dir)) return null;
  }
  return out;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

// Returns the front end files as relative paths and the hash over their paths and contents.
function frontEnd(srcDir) {
  const files = listFiles(srcDir).filter((f) => !SKIPPED.has(f)).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update('\0').update(readFileSync(join(srcDir, f))).update('\0');
  return { files, hash: hash.digest('hex').slice(0, 10) };
}

function write(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

// The front end comes from srcDir, which defaults to this repo's src folder.
export async function buildSite({ root, refresh = false, log = console.log, srcDir = REPO_SRC, skipUrls = null, offline = false, fetchImpl = fetch, lookup }) {
  const started = Date.now();
  const base = resolve(root);
  const fail = (errors, warnings = []) => ({ ok: false, errors, warnings, pages: 0, images: 0, outDir: null, failedUrls: [], ms: Date.now() - started });

  const checked = checkSite(base, { srcDir });
  if (checked.errors.length) return fail(checked.errors, checked.warnings);
  const { config } = loadConfig(join(base, 'curator.config.json'));
  const { collections } = checked;

  // The folder is judged before any image is fetched, so a refusal costs nothing.
  const outValue = config.advanced.build.outDir;
  const outDir = safeOutDir(base, outValue);
  if (!outDir) {
    return fail([`curator.config.json: advanced.build.outDir "${outValue}" must be a folder inside the project, such as dist.`], checked.warnings);
  }
  if (existsSync(outDir) && (!statSync(outDir).isDirectory() || (readdirSync(outDir).length > 0 && !existsSync(join(outDir, MARKER))))) {
    return fail([`advanced.build.outDir "${outValue}" already holds files that Curator did not write. Empty it or choose another folder.`], checked.warnings);
  }

  const resolved = await resolveImages({ collections, config, root: base, refresh, log, skipUrls, offline, fetchImpl, lookup });
  const fonts = await resolveFonts({ config, root: base, offline, fetchImpl, lookup });
  const warnings = checked.warnings.concat(resolved.warnings, fonts.warnings);
  if (fonts.errors.length) return fail(fonts.errors, warnings);
  const { data, assets } = buildSiteData({ config, collections, images: resolved.images, root: base });

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, MARKER), 'This folder is written by Curator and emptied on every build.\n');

  const front = frontEnd(srcDir);
  for (const f of front.files) {
    const to = join(outDir, 'assets', front.hash, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(srcDir, f), to);
  }
  for (const a of assets) {
    const to = join(outDir, a.to);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(a.from, to);
  }
  for (const f of fonts.files) {
    const to = join(outDir, f.to);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(f.from, to);
  }
  if (fonts.sheet) write(join(outDir, 'fonts', fonts.sheet.name), fonts.sheet.text);
  write(join(outDir, 'data', 'site.json'), JSON.stringify(data));
  write(join(outDir, 'favicon.svg'), faviconSvg(data.brand));

  const template = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const roles = computeRoles(data.brand, data.types);
  const theme = themeStyle({ roles, fonts: data.fonts, colors: data.scene.colors, tokens: collectTokens(srcDir, data.scene.name) });
  const values = { theme, lang: escapeHtml(data.site.language), assets: `/assets/${front.hash}/`, scene: escapeHtml(data.scene.name), fonts: fonts.html };
  let pages = 0;
  const page = (file, head) => {
    write(join(outDir, file), template.replace(/\{\{(lang|head|assets|scene|theme|fonts)\}\}/g, (_, token) => (token === 'head' ? head : values[token])));
    pages++;
  };

  const urls = [`${data.site.url}/`];
  page('index.html', pageHead({ site: data.site, kind: 'home', path: '/' }));
  for (const c of data.collections) {
    page(`${c.id}/index.html`, pageHead({ site: data.site, kind: 'collection', collection: c, path: `/${c.id}/` }));
    urls.push(`${data.site.url}/${c.id}/`);
    if (!config.advanced.build.itemPages) continue;
    for (const item of c.items) {
      page(`${c.id}/${item.id}/index.html`, pageHead({ site: data.site, kind: 'item', collection: c, item, path: `/${c.id}/${item.id}/` }));
      urls.push(`${data.site.url}/${c.id}/${item.id}/`);
    }
  }
  page('404.html', pageHead({ site: data.site, kind: '404' }));

  const entries = urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n');
  write(join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`);
  write(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${data.site.url}/sitemap.xml\n`);

  return { ok: true, errors: [], warnings, pages, images: assets.length, outDir, failedUrls: resolved.failedUrls, ms: Date.now() - started };
}
