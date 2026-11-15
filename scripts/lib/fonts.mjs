import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { escapeHtml } from './markdown.mjs';
import { NetRefusal, guardedFetch } from './net.mjs';

const CSS2 = 'https://fonts.googleapis.com/css2';
// A generic desktop browser string, because Google answers woff2 only to modern browsers.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CSS_LIMIT = 2000000;
const FILE_LIMIT = 5000000;
const CONCURRENCY = 6;
const DEFAULT_UNKNOWN = 'wght@400;700';
const ROLES = ['display', 'body', 'mono', 'poster'];
const ADVANCED_ROLES = ['typewriter', 'handwriting'];

// Axis specs for the families the approved design uses. An empty string means no axes.
const KNOWN_SPECS = {
  Fraunces: 'ital,opsz,wght,SOFT@0,9..144,300..900,0..100;1,9..144,300..900,0..100',
  Archivo: 'wght@400..900',
  Caveat: 'wght@700',
  'IBM Plex Mono': 'wght@400;500;600',
  'Special Elite': '',
};

class FontFailure extends Error {}

const isAbort = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const knownSpec = (family) => (own(KNOWN_SPECS, family) ? KNOWN_SPECS[family] : null);

// Returns the distinct family names of the six roles, in role order.
export function collectFamilies(config) {
  const basic = config?.basic?.fonts ?? {};
  const advanced = config?.advanced?.fonts ?? {};
  const out = [];
  for (const family of [...ROLES.map((r) => basic[r]), ...ADVANCED_ROLES.map((r) => advanced[r])]) {
    const name = typeof family === 'string' ? family.trim() : '';
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const encodeFamily = (family) => encodeURIComponent(family).replace(/%20/g, '+');

// Builds the CSS2 address. specs maps a family to its axis spec, an empty string meaning none.
export function googleUrl(families, specs = {}) {
  const parts = families.map((f) => {
    const spec = own(specs, f) ? specs[f] : knownSpec(f) ?? DEFAULT_UNKNOWN;
    return `family=${encodeFamily(f)}${spec ? `:${spec}` : ''}`;
  });
  return `${CSS2}?${parts.join('&')}&display=swap`;
}

function readCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data && data.version === 1) {
      const obj = (v) => (v && typeof v === 'object' ? v : {});
      return { specs: obj(data.specs), css: obj(data.css), files: obj(data.files) };
    }
  } catch {
    // A missing or damaged cache starts empty.
  }
  return { specs: {}, css: {}, files: {} };
}

function cacheText(cache) {
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return `${JSON.stringify({ version: 1, specs: sorted(cache.specs), css: sorted(cache.css), files: sorted(cache.files) }, null, 2)}\n`;
}

function saveCache(file, before, cache) {
  if (cacheText(cache) === cacheText(before)) return;
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, cacheText(cache));
}

// Reads a body as a stream and fails once it passes the limit.
async function readBody(res, limit) {
  if (Number(res.headers.get('content-length')) > limit) throw new FontFailure('the file is too large');
  if (!res.body || typeof res.body.getReader !== 'function') {
    const all = Buffer.from(await res.arrayBuffer());
    if (all.length > limit) throw new FontFailure('the file is too large');
    return all;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new FontFailure('the file is too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

// Returns a getter giving { status, mime, bytes }, with bytes only for a 200. A network problem throws FontFailure.
function makeGetter({ fetchImpl, timeoutMs, lookup }) {
  return async function get(url, limit) {
    let res;
    try {
      ({ res } = await guardedFetch(fetchImpl, url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } }, { lookup }));
    } catch (err) {
      if (err instanceof NetRefusal) throw new FontFailure(err.message);
      throw new FontFailure(isAbort(err) ? 'the request timed out' : 'the request failed');
    }
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (res.status !== 200) {
      res.body?.cancel?.().catch(() => {});
      return { status: res.status, mime, bytes: null };
    }
    try {
      return { status: 200, mime, bytes: await readBody(res, limit) };
    } catch (err) {
      if (err instanceof FontFailure) throw err;
      throw new FontFailure(isAbort(err) ? 'the request timed out' : 'the download failed');
    }
  };
}

// Decides the axis spec of each family. Unknown families are asked of Google, cache first.
async function resolveSpecs({ families, cache, get, offline }) {
  const specs = {};
  const errors = [];
  const warnings = [];
  for (const family of families) {
    const known = knownSpec(family);
    if (known !== null) {
      specs[family] = known;
    } else if (own(cache.specs, family) && typeof cache.specs[family] === 'string') {
      specs[family] = cache.specs[family];
    } else if (offline) {
      specs[family] = '';
    } else {
      let notFound = 0;
      let reason = null;
      let found = null;
      for (const spec of [DEFAULT_UNKNOWN, '']) {
        try {
          const r = await get(googleUrl([family], { [family]: spec }), CSS_LIMIT);
          if (r.status === 200 && r.mime === 'text/css') {
            found = spec;
            break;
          }
          if (r.status === 400) notFound++;
          else reason = r.status === 200 ? 'the response is not CSS' : `the server answered ${r.status}`;
        } catch (err) {
          reason = err.message;
        }
      }
      specs[family] = found ?? '';
      if (found !== null) cache.specs[family] = found;
      else if (notFound === 2) errors.push(`curator.config.json: font "${family}" was not found on Google Fonts. Check the spelling, or choose a family that Google Fonts offers. Both font sources load families from Google Fonts.`);
      else warnings.push(`curator.config.json: font "${family}" could not be checked with Google Fonts (${reason}). It is requested without weights.`);
    }
  }
  return { specs, errors, warnings };
}

const PRECONNECT = ['<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'];
const URL_RE = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g;

// Returns the distinct file addresses named by the font face blocks of a stylesheet.
export function parseFontFaces(css) {
  const urls = [];
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    for (const m of block.matchAll(URL_RE)) if (!urls.includes(m[2])) urls.push(m[2]);
  }
  return urls;
}

// Replaces every url() in the font face blocks using a map from source address to new address.
export function rewriteCss(css, map) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (block) => block.replace(URL_RE, (all, _q, url) => (map.has(url) ? `url(${map.get(url)})` : all)));
}

async function pool(tasks, limit) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

const extOf = (url) => /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? 'woff2';

// Downloads the stylesheet and its files into the cache. Returns { sheet, css, files } or throws FontFailure.
async function selfHost({ url, cache, cacheDir, get, offline }) {
  const fontDir = join(cacheDir, 'fonts');
  let css = cache.css[url];
  if (typeof css !== 'string') {
    if (offline) throw new FontFailure('offline mode is on and nothing is cached');
    const r = await get(url, CSS_LIMIT);
    if (r.status !== 200) throw new FontFailure(`the server answered ${r.status}`);
    if (r.mime !== 'text/css') throw new FontFailure('the response is not CSS');
    css = r.bytes.toString('utf8');
    cache.css[url] = css;
  }
  const sources = parseFontFaces(css);
  if (!sources.length) throw new FontFailure('the stylesheet names no font files');
  const map = new Map();
  const tasks = [];
  for (const source of sources) {
    const entry = cache.files[source];
    if (entry && existsSync(join(fontDir, entry.file))) {
      map.set(source, entry.file);
      continue;
    }
    if (offline) throw new FontFailure('offline mode is on and a font file is not cached');
    tasks.push(async () => {
      const r = await get(source, FILE_LIMIT);
      if (r.status !== 200) throw new FontFailure(`the server answered ${r.status}`);
      const file = `${createHash('sha256').update(r.bytes).digest('hex').slice(0, 16)}.${extOf(source)}`;
      mkdirSync(fontDir, { recursive: true });
      writeFileSync(join(fontDir, file), r.bytes);
      cache.files[source] = { file, bytes: r.bytes.length };
      map.set(source, file);
    });
  }
  await pool(tasks, CONCURRENCY);
  const rewritten = rewriteCss(css, new Map([...map].map(([src, file]) => [src, `/fonts/${file}`])));
  const names = [...new Set(map.values())].sort();
  const files = names.map((name) => ({ to: `fonts/${name}`, from: join(fontDir, name) }));
  const sheet = `fonts-${createHash('sha256').update(rewritten).digest('hex').slice(0, 10)}.css`;
  return { sheet, css: rewritten, files };
}

// Resolves the font links for every page. Returns { html, errors, warnings, files, sheet }.
// files lists { to, from } copies for the output folder, and sheet is { name, text } or null.
export async function resolveFonts({ config, root, fetchImpl = fetch, offline = false, lookup }) {
  const settings = config?.advanced?.fonts ?? {};
  const families = collectFamilies(config);
  const cacheDir = resolve(root, '.cache');
  const cacheFile = join(cacheDir, 'fonts.json');
  const before = readCache(cacheFile);
  const cache = structuredClone(before);
  const get = makeGetter({ fetchImpl, timeoutMs: config?.advanced?.images?.timeoutMs ?? 15000, lookup });
  const result = { html: '', errors: [], warnings: [], files: [], sheet: null };
  if (!families.length) return result;

  let url = settings.googleFontsUrl || null;
  if (!url) {
    const decided = await resolveSpecs({ families, cache, get, offline });
    result.errors.push(...decided.errors);
    result.warnings.push(...decided.warnings);
    url = googleUrl(families, decided.specs);
  }

  if (result.errors.length) {
    // A missing family is reported and no link is written.
  } else if (settings.source !== 'self') {
    result.html = [...PRECONNECT, `<link href="${escapeHtml(url)}" rel="stylesheet">`].join('\n    ');
  } else {
    try {
      const hosted = await selfHost({ url, cache, cacheDir, get, offline });
      result.files = hosted.files;
      result.sheet = { name: hosted.sheet, text: hosted.css };
      result.html = `<link rel="stylesheet" href="/fonts/${hosted.sheet}">`;
    } catch (err) {
      const reason = err instanceof FontFailure ? err.message : 'an unexpected error occurred';
      result.warnings.push(`fonts could not be downloaded for self hosting (${reason}). The fallback fonts are used.`);
    }
  }
  saveCache(cacheFile, before, cache);
  return result;
}

// Runs only the Google family check, for npm run check. Returns { errors, warnings }.
export async function checkFonts({ config, root, fetchImpl = fetch, offline = false, lookup }) {
  const settings = config?.advanced?.fonts ?? {};
  if (settings.source === 'self' || settings.googleFontsUrl) return { errors: [], warnings: [] };
  const cacheFile = join(resolve(root, '.cache'), 'fonts.json');
  const before = readCache(cacheFile);
  const cache = structuredClone(before);
  const get = makeGetter({ fetchImpl, timeoutMs: config?.advanced?.images?.timeoutMs ?? 15000, lookup });
  const { errors, warnings } = await resolveSpecs({ families: collectFamilies(config), cache, get, offline });
  saveCache(cacheFile, before, cache);
  return { errors, warnings };
}
