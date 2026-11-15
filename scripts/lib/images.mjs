import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { imageSize } from './imagesize.mjs';
import { getType } from '../../src/js/types.js';
import { NetRefusal, guardedFetch } from './net.mjs';

const USER_AGENT = 'Curator link preview builder';
const CONCURRENCY = 4;
const EXT = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', svg: 'svg' };
const FIT_RATIO = 1.75;
const META_ORDER = [['og:image', 'og:image:url'], ['twitter:image', 'twitter:image:src']];
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>' };

const hostIs = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// Returns the video id of a YouTube link, or null.
export function youtubeId(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (hostIs(host, 'youtu.be')) id = parts[0];
  else if (hostIs(host, 'youtube.com')) {
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// Returns the github.com repository preview address, or null.
export function githubPreviewUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com' || !getType('repo').match(url)) return null;
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}

function decodeEntities(text) {
  return text.replace(/&(?:amp|quot|lt|gt|#39|#x27);/gi, (m) => ENTITIES[m.toLowerCase()]);
}

// Returns the preview image address named by the page's meta tags, or null.
export function findMetaImage(html) {
  const found = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const m of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    }
    const key = (attrs.property ?? attrs.name ?? '').trim().toLowerCase();
    const content = (attrs.content ?? '').trim();
    if (key && content && !found.has(key)) found.set(key, decodeEntities(content));
  }
  for (const group of META_ORDER) {
    for (const key of group) if (found.has(key)) return found.get(key);
  }
  return null;
}

class FetchFailure extends Error {}

const isAbort = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

// Reads a body as a stream and stops once it passes the limit.
async function readBody(res, limit, { truncate = false } = {}) {
  const declared = Number(res.headers.get('content-length'));
  if (!truncate && declared > limit) throw new FetchFailure('the file is too large');
  if (!res.body || typeof res.body.getReader !== 'function') {
    const all = Buffer.from(await res.arrayBuffer());
    if (all.length > limit && !truncate) throw new FetchFailure('the file is too large');
    return all.subarray(0, limit);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        if (!truncate) throw new FetchFailure('the file is too large');
        chunks.push(Buffer.from(value.subarray(0, value.length - (total - limit))));
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

function makeFinder({ fetchImpl, timeoutMs, maxBytes, lookup }) {
  // Returns { res, url } where url is the final address after redirects.
  async function get(url) {
    let res;
    let finalUrl;
    try {
      const init = { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,image/*;q=0.8,*/*;q=0.5' } };
      ({ res, url: finalUrl } = await guardedFetch(fetchImpl, url, init, { lookup }));
    } catch (err) {
      if (err instanceof NetRefusal) throw new FetchFailure(err.message);
      throw new FetchFailure(isAbort(err) ? 'the request timed out' : 'the request failed');
    }
    if (!res.ok) {
      res.body?.cancel?.().catch(() => {});
      throw new FetchFailure(`the server answered ${res.status}`);
    }
    return { res, url: finalUrl };
  }

  async function read(res, opts) {
    try {
      return await readBody(res, maxBytes, opts);
    } catch (err) {
      if (err instanceof FetchFailure) throw err;
      throw new FetchFailure(isAbort(err) ? 'the request timed out' : 'the download failed');
    }
  }

  const mimeOf = (res) => (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

  function checkImage(mime, bytes) {
    if (!mime.startsWith('image/')) throw new FetchFailure('the response is not an image');
    if (mime === 'image/svg+xml') throw new FetchFailure('remote SVG images are not used');
    const size = imageSize(bytes);
    if (!size.type || size.type === 'svg' || !size.width || !size.height) throw new FetchFailure('the image format is not recognised');
    return size;
  }

  async function fetchImage(url) {
    const { res } = await get(url);
    const mime = mimeOf(res);
    if (!mime.startsWith('image/')) {
      res.body?.cancel?.().catch(() => {});
      throw new FetchFailure('the response is not an image');
    }
    if (mime === 'image/svg+xml') {
      res.body?.cancel?.().catch(() => {});
      throw new FetchFailure('remote SVG images are not used');
    }
    const bytes = await read(res);
    return { bytes, size: checkImage(mime, bytes), source: url };
  }

  async function fetchYoutube(id) {
    let last = null;
    for (const name of ['maxresdefault', 'hqdefault']) {
      try {
        const found = await fetchImage(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
        if (found.bytes.length < 2048 || (found.size.width === 120 && found.size.height === 90)) {
          throw new FetchFailure('only the grey placeholder exists');
        }
        return found;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }

  async function fetchPage(url) {
    const { res, url: finalUrl } = await get(url);
    const mime = mimeOf(res);
    if (mime.startsWith('image/')) {
      if (mime === 'image/svg+xml') {
        res.body?.cancel?.().catch(() => {});
        throw new FetchFailure('remote SVG images are not used');
      }
      const bytes = await read(res);
      return { bytes, size: checkImage(mime, bytes), source: finalUrl };
    }
    if (mime && mime !== 'text/html' && mime !== 'application/xhtml+xml') {
      res.body?.cancel?.().catch(() => {});
      throw new FetchFailure('the page is not HTML');
    }
    const html = (await read(res, { truncate: true })).toString('utf8');
    const ref = findMetaImage(html);
    if (!ref) throw new FetchFailure('the page names no preview image');
    let target;
    try {
      target = new URL(ref, finalUrl);
    } catch {
      throw new FetchFailure('the preview image address is not valid');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new FetchFailure('the preview image address is not valid');
    return fetchImage(target.href);
  }

  return async function find(url) {
    const id = youtubeId(url);
    if (id) return fetchYoutube(id);
    const gh = githubPreviewUrl(url);
    if (gh) return fetchImage(gh);
    return fetchPage(url);
  };
}

// Runs async tasks with a fixed number in flight.
async function pool(tasks, limit) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function readManifest(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data && data.version === 1 && data.entries && typeof data.entries === 'object') return data.entries;
  } catch {
    // A missing or damaged manifest starts empty.
  }
  return {};
}

function manifestText(entries) {
  const sorted = {};
  for (const key of Object.keys(entries).sort()) {
    const e = entries[key];
    sorted[key] = { source: e.source, file: e.file, type: e.type, width: e.width, height: e.height, bytes: e.bytes, fetched: e.fetched };
  }
  return `${JSON.stringify({ version: 1, entries: sorted }, null, 2)}\n`;
}

function wantsFit(item, size, fitDomains) {
  if (size.width && size.height && size.width / size.height > FIT_RATIO) return true;
  const host = (item.domain || '').toLowerCase();
  return fitDomains.some((d) => hostIs(host, String(d).toLowerCase()));
}

export async function resolveImages({ collections, config, root, refresh = false, fetchImpl = fetch, log = () => {}, skipUrls = null, offline = false, lookup }) {
  const settings = config?.advanced?.images ?? {};
  const fetchOn = settings.fetch !== false && !offline;
  const fitDomains = settings.fitDomains ?? [];
  const contentDir = resolve(root, 'content');
  const cacheDir = resolve(root, '.cache');
  const imageDir = join(cacheDir, 'images');
  const manifestFile = join(cacheDir, 'images.json');

  const before = readManifest(manifestFile);
  const entries = structuredClone(before);
  const images = new Map();
  const problems = new Map();
  const find = makeFinder({ fetchImpl, timeoutMs: settings.timeoutMs ?? 15000, maxBytes: settings.maxBytes ?? 3000000, lookup });
  const inflight = new Map();
  const tasks = [];
  const failedUrls = new Set();

  const describe = (c, item) => `content/${c.id}.md, "${item.title}" (line ${item.line}): `;

  function use(c, item, size, file, bytes, origin) {
    images.set(`${c.id}/${item.id}`, {
      file,
      type: size.type,
      width: size.width,
      height: size.height,
      bytes,
      fit: wantsFit(item, size, fitDomains),
      origin,
    });
  }

  function fail(c, item, message) {
    const key = `${c.id}/${item.id}`;
    images.set(key, null);
    problems.set(key, `${describe(c, item)}${message}`);
  }

  const failFetch = (c, item, reason) => fail(c, item, `no preview image found for ${item.url} (${reason}). A poster is used instead.`);

  function useEntry(c, item, entry, origin) {
    use(c, item, entry, join(imageDir, entry.file), entry.bytes, origin);
  }

  async function download(url) {
    try {
      const { bytes, size, source } = await find(url);
      const file = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${EXT[size.type]}`;
      mkdirSync(imageDir, { recursive: true });
      writeFileSync(join(imageDir, file), bytes);
      const entry = { source, file, type: size.type, width: size.width, height: size.height, bytes: bytes.length, fetched: new Date().toISOString() };
      entries[url] = entry;
      return { entry };
    } catch (err) {
      return { reason: err instanceof FetchFailure ? err.message : 'an unexpected error occurred' };
    }
  }

  for (const c of collections) {
    for (const item of c.items) {
      const key = `${c.id}/${item.id}`;
      if (item.image === 'none') {
        images.set(key, null);
      } else if (item.image !== 'auto') {
        const file = resolve(contentDir, item.image);
        let bytes = null;
        let size = null;
        try {
          bytes = readFileSync(file);
          size = imageSize(bytes);
        } catch {
          size = null;
        }
        if (!size || !size.type) {
          fail(c, item, `the size of image "${item.image}" could not be read. A poster is used instead.`);
        } else {
          use(c, item, size, file, bytes.length, 'upload');
        }
      } else {
        const cached = entries[item.url];
        const hit = Boolean(cached) && existsSync(join(imageDir, cached.file));
        const refreshed = refresh === true || refresh === key;
        if (hit && !(refreshed && fetchOn)) {
          useEntry(c, item, cached, 'cache');
        } else if (!fetchOn) {
          failFetch(c, item, 'fetching is turned off and the image is not cached');
        } else if (skipUrls?.has(item.url)) {
          failFetch(c, item, 'it failed earlier in this session');
        } else {
          tasks.push(async () => {
            if (!inflight.has(item.url)) inflight.set(item.url, download(item.url));
            const result = await inflight.get(item.url);
            if (result.entry) {
              log(`fetched ${key}`);
              useEntry(c, item, result.entry, 'fetched');
            } else {
              log(`failed ${key}`);
              failedUrls.add(item.url);
              failFetch(c, item, result.reason);
            }
          });
        }
      }
    }
  }

  await pool(tasks, CONCURRENCY);

  // Results and warnings follow file order, whatever order the fetches finished in.
  const ordered = new Map();
  const warnings = [];
  for (const c of collections) {
    for (const item of c.items) {
      const key = `${c.id}/${item.id}`;
      ordered.set(key, images.get(key) ?? null);
      if (problems.has(key)) warnings.push(problems.get(key));
    }
  }

  const text = manifestText(entries);
  if (text !== manifestText(before)) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(manifestFile, text);
  }
  return { images: ordered, warnings, failedUrls: [...failedUrls] };
}
