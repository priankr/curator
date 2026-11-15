import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildSite } from './lib/build-site.mjs';
import { launch } from './lib/cdp.mjs';
import { argValue, requireBrowser } from './lib/headless.mjs';
import { startServer } from './lib/serve.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const BUDGET = 300 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const only = (argValue(args, '--only') ?? 'transfer,lazy,smooth,hidden').split(',');
const RUNS = Number(argValue(args, '--runs') ?? 3);
const SMOOTH_PATH = argValue(args, '--path') ?? '/?stress=1';
const jsonFile = argValue(args, '--json');
const outsideUrl = argValue(args, '--url');
const browserPath = requireBrowser();

const kb = (n) => (n / 1024).toFixed(1);
const ms = (n) => n.toFixed(1);
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0);

// Builds a temp copy of the repo content with an advanced override and serves it. Online, so self-hosted fonts can download.
async function openVariant(override) {
  const temp = mkdtempSync(join(tmpdir(), 'curator-perf-'));
  cpSync(join(repoRoot, 'content'), join(temp, 'content'), { recursive: true });
  if (existsSync(join(repoRoot, '.cache'))) {
    for (const name of ['images', 'images.json', 'fonts', 'fonts.json']) {
      if (existsSync(join(repoRoot, '.cache', name))) cpSync(join(repoRoot, '.cache', name), join(temp, '.cache', name), { recursive: true });
    }
  }
  const config = JSON.parse(readFileSync(join(repoRoot, 'curator.config.json'), 'utf8'));
  config.advanced = { ...config.advanced, ...override };
  writeFileSync(join(temp, 'curator.config.json'), JSON.stringify(config, null, 2));
  let server = null;
  const close = async () => {
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    rmSync(temp, { recursive: true, force: true });
  };
  try {
    const built = await buildSite({ root: temp, log: () => {} });
    if (!built.ok) throw new Error('the build failed');
    server = await startServer({ dir: built.outDir, port: 0 });
  } catch (e) {
    await close();
    throw e;
  }
  return { base: `http://localhost:${server.address().port}`, close };
}

// Records every request of a page, with its type, status and encoded size. idle() waits for no request in flight.
function track(page) {
  const list = [];
  const byId = new Map();
  let inflight = 0;
  let changed = Date.now();
  page.on('Network.requestWillBeSent', (p) => {
    if (p.request.url.startsWith('data:')) return;
    const known = byId.get(p.requestId);
    if (known) { known.url = p.request.url; return; }
    const r = { url: p.request.url, type: p.type ?? 'Other', bytes: 0, status: 0, mime: '', done: false, failed: '' };
    byId.set(p.requestId, r);
    list.push(r);
    inflight++;
    changed = Date.now();
  });
  page.on('Network.responseReceived', (p) => {
    const r = byId.get(p.requestId);
    if (r) { r.status = p.response.status; r.mime = p.response.mimeType ?? ''; }
  });
  page.on('Network.loadingFinished', (p) => {
    const r = byId.get(p.requestId);
    if (r && !r.done) { r.done = true; r.bytes = p.encodedDataLength; inflight--; changed = Date.now(); }
  });
  page.on('Network.loadingFailed', (p) => {
    const r = byId.get(p.requestId);
    if (r && !r.done) { r.done = true; r.failed = p.errorText ?? 'failed'; inflight--; changed = Date.now(); }
  });
  return {
    list,
    async idle(quietMs = 1000, limitMs = 25000) {
      const end = Date.now() + limitMs;
      for (;;) {
        if (inflight === 0 && Date.now() - changed >= quietMs) return true;
        if (Date.now() > end) return false;
        await sleep(50);
      }
    },
  };
}

async function freshPage(browser, url, { throttle = 1, width = 1440, height = 900 } = {}) {
  const page = await browser.newPage({ width, height });
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const net = track(page);
  await page.goto(url);
  const idle = await net.idle();
  return { page, net, idle };
}

const TEXT_MIME = /^(text\/|application\/(javascript|json|xml)|image\/svg)/;
const GROUPS = ['document', 'script', 'stylesheet', 'font', 'fetch', 'image', 'other'];
const groupOf = (t) => ({ Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Font: 'font', Fetch: 'fetch', XHR: 'fetch', Image: 'image' }[t] ?? 'other');

// Raw is the encoded size the browser saw. Gzip replaces the size of local text files with their gzipped size, since static hosts compress. Remote files are already encoded on the wire.
async function transferOf(base, list) {
  const rows = [];
  for (const r of list) {
    let gzip = r.bytes;
    if (r.url.startsWith(base) && r.status === 200 && TEXT_MIME.test(r.mime)) {
      const body = Buffer.from(await (await fetch(r.url)).arrayBuffer());
      gzip = Math.min(r.bytes, r.bytes - body.length + gzipSync(body, { level: 9 }).length);
    }
    rows.push({ url: r.url, group: groupOf(r.type), raw: r.bytes, gzip, status: r.status, failed: r.failed });
  }
  const sum = (key, fn) => rows.filter(fn).reduce((a, r) => a + r[key], 0);
  const out = { groups: {}, rows };
  for (const g of GROUPS) out.groups[g] = { raw: sum('raw', (r) => r.group === g), gzip: sum('gzip', (r) => r.group === g) };
  out.totalNoImages = { raw: sum('raw', (r) => r.group !== 'image'), gzip: sum('gzip', (r) => r.group !== 'image') };
  out.totalNoImagesNoFonts = { raw: sum('raw', (r) => r.group !== 'image' && r.group !== 'font'), gzip: sum('gzip', (r) => r.group !== 'image' && r.group !== 'font') };
  out.failed = rows.filter((r) => r.failed || r.status >= 400).map((r) => `${r.status || r.failed} ${r.url}`);
  return out;
}

async function measureTransfer(browser, base) {
  const { page, net, idle } = await freshPage(browser, `${base}/`);
  try {
    await page.evaluate('document.fonts.ready.then(() => true)', { awaitPromise: true, timeoutMs: 20000 });
    await net.idle();
    const result = await transferOf(base, net.list);
    result.idle = idle;
    return result;
  } finally {
    await page.close();
  }
}

// Which items are on which page, and which requested images belong where.
function imageIndex(site) {
  const size = site.scene.pageSize;
  const map = new Map();
  for (const col of site.collections) col.items.forEach((it, i) => { if (it.image) map.set(it.image.src, { col: col.id, id: it.id, page: Math.floor(i / size) }); });
  return map;
}
const locate = (index, url) => { const path = decodeURIComponent(new URL(url).pathname); return index.get(path) ?? null; };

async function measureLazy(browser, base) {
  const site = await (await fetch(`${base}/data/site.json`)).json();
  const index = imageIndex(site);
  const cur = site.defaultCollection ?? site.collections[0].id;
  const { page, net } = await freshPage(browser, `${base}/`);
  try {
    await page.evaluate('document.fonts.ready.then(() => true)', { awaitPromise: true, timeoutMs: 20000 });
    await net.idle();
    const images = (from) => net.list.slice(from).filter((r) => r.type === 'Image');
    const shownNow = () => page.evaluate(`[...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }).map((i) => i.getAttribute('src'))`);
    const tag = async (from) => { const on = await shownNow(); return images(from).map((r) => ({ url: r.url, at: locate(index, r.url), shown: on.includes(decodeURIComponent(new URL(r.url).pathname)) })); };
    const load = await tag(0);
    const first = net.list.length;
    await page.evaluate(`window.__r = document.querySelector('.table.on .tb-rng').textContent; document.querySelector('.table.on .tb-pg[data-d="1"]').click()`);
    await page.waitFor(`document.querySelector('.table.on .slides').getAnimations().length === 0 && document.querySelector('.table.on .tb-rng').textContent !== window.__r`, 10000);
    await net.idle();
    const paged = await tag(first);
    const second = net.list.length;
    await page.evaluate(`document.getElementById('next-col').click()`);
    await page.waitFor(`document.querySelector('.table.on').dataset.col !== ${JSON.stringify(cur)}`, 10000);
    await net.idle();
    const switched = await tag(second);
    const next = site.collections[1].id;
    const perPage = (col, p) => [...index.values()].filter((v) => v.col === col && v.page === p).length;
    const wrong = (list, p) => list.filter((x) => !x.at || x.at.col !== cur || x.at.page !== p).map((x) => x.url);
    return {
      current: cur,
      imageItems: Object.fromEntries(site.collections.map((c) => [c.id, c.items.filter((i) => i.image).length])),
      page0Images: perPage(cur, 0),
      page1Images: perPage(cur, 1),
      loadRequests: load.length,
      loadByTable: load.reduce((a, x) => { const k = x.at ? `${x.at.col} page ${x.at.page + 1}` : 'unmatched'; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      loadWrong: wrong(load.filter((x) => !x.shown), 0),
      loadVisibleOutside: load.filter((x) => x.shown && (!x.at || x.at.col !== cur || x.at.page !== 0)).length,
      pagedRequests: paged.length,
      pagedByTable: paged.reduce((a, x) => { const k = x.at ? `${x.at.col} page ${x.at.page + 1}` : 'unmatched'; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      pagedWrong: wrong(paged.filter((x) => !x.shown), 1),
      switchedRequests: switched.length,
      switchedByTable: switched.reduce((a, x) => { const k = x.at ? `${x.at.col} page ${x.at.page + 1}` : 'unmatched'; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      switchedWrong: switched.filter((x) => !x.shown && (!x.at || x.at.col !== next || x.at.page !== 0)).map((x) => x.url),
      pageSize: site.scene.pageSize,
    };
  } finally {
    await page.close();
  }
}

// Runs one action inside the page: records requestAnimationFrame intervals from the click until the done test passes.
const timed = (click, done, sample = false) => `new Promise((resolve) => {
  const T0 = performance.now(), T = [T0], limit = 12000;
  let live = true, maxAnim = 0, bad = 0, off = 0, slideAnim = 0;
  const kinds = {};
  const finish = (end, timeout) => { if (!live) return; live = false; const f = []; for (let i = 1; i < T.length; i++) f.push(T[i] - T[i - 1]); resolve({ duration: end - T0, frames: f, timeout, maxAnim, bad, off, slideAnim, kinds }); };
  const look = () => {
    const all = document.getAnimations();
    maxAnim = Math.max(maxAnim, all.length);
    for (const a of all) {
      const t = a.effect && a.effect.target; if (!t || !t.closest) continue;
      const table = t.closest('.table'), slide = t.closest('.slide');
      const k = (a.constructor.name || 'Animation') + ':' + (a.transitionProperty || '') + ':' + t.tagName.toLowerCase() + '.' + (String(t.className).split(' ')[0] || '-') + (table ? (table.classList.contains('on') ? '@on' : '@other') : '');
      kinds[k] = Math.max(kinds[k] || 0, 1);
      if (table && !table.classList.contains('on')) bad++;
      if (slide && slide.classList.contains('off')) off++;
      if (slide) slideAnim++;
    }
  };
  const tick = (n) => { if (!live) return; T.push(n); ${sample ? 'look();' : ''} if (${done}) return finish(n, false); if (n - T0 > limit) return finish(n, true); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => finish(performance.now(), true), limit + 1500);
  ${click}
})`;

const ACTIONS = {
  open: { click: `document.querySelector('.table.on .slide:not(.off)').click()`, done: `document.getElementById('booth').classList.contains('open')` },
  advance: { click: `window.__t = document.getElementById('cp-title').textContent; document.getElementById('pj-next').click()`, done: `document.getElementById('cp-title').textContent !== window.__t && document.getElementById('proj').getAnimations().length === 0 && !document.getElementById('cap').firstChild.getAnimations().length` },
  close: { click: `document.getElementById('bt-close').click()`, done: `document.getElementById('booth').hidden` },
  tablepage: { click: `window.__r = document.querySelector('.table.on .tb-rng').textContent; document.querySelector('.table.on .tb-pg[data-d="1"]').click()`, done: `document.querySelector('.table.on .tb-rng').textContent !== window.__r && document.querySelector('.table.on .slides').getAnimations().length === 0` },
};

const summarise = (runs) => {
  const frames = runs.flatMap((r) => r.frames).sort((a, b) => a - b);
  const durs = runs.map((r) => r.duration);
  return {
    runs: runs.length,
    timeouts: runs.filter((r) => r.timeout).length,
    durationMean: durs.reduce((a, b) => a + b, 0) / durs.length,
    durationMin: Math.min(...durs),
    durationMax: Math.max(...durs),
    framesPerRun: frames.length / runs.length,
    median: pct(frames, 0.5),
    p95: pct(frames, 0.95),
    worst: frames[frames.length - 1] ?? 0,
    over50: runs.reduce((a, r) => a + r.frames.filter((f) => f > 50).length, 0) / runs.length,
    perRun: runs.map((r) => ({ duration: r.duration, frames: r.frames.length, worst: Math.max(0, ...r.frames), over50: r.frames.filter((f) => f > 50).length })),
  };
};

async function measureSmooth(browser, base, throttle) {
  const { page, net } = await freshPage(browser, `${base}${SMOOTH_PATH}`, { throttle });
  try {
    await page.waitFor(`document.querySelectorAll('.slide').length >= 30 && document.body.classList.contains('lt-page')`, 30000);
    await page.evaluate('document.fonts.ready.then(() => true)', { awaitPromise: true, timeoutMs: 20000 });
    await net.idle();
    await sleep(2000 * throttle);
    const metrics = async () => Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await page.send('Performance.enable');
    const runs = { open: [], advance: [], close: [], tablepage: [] };
    const cost = { open: [], advance: [], close: [], tablepage: [] };
    const hidden = [];
    const act = async (name, sample = false) => {
      const a = ACTIONS[name];
      const before = await metrics();
      const r = await page.evaluate(timed(a.click, a.done, sample), { awaitPromise: true, timeoutMs: 30000 });
      const after = await metrics();
      runs[name].push(r);
      cost[name].push({ layout: after.LayoutDuration - before.LayoutDuration, style: after.RecalcStyleDuration - before.RecalcStyleDuration, script: after.ScriptDuration - before.ScriptDuration });
      await sleep(600 * Math.min(throttle, 2));
      return r;
    };
    for (let i = 0; i < RUNS; i++) {
      await act('open');
      await act('advance');
      await act('close');
    }
    const idleAnims = await page.evaluate('document.getAnimations().length');
    for (let i = 0; i < RUNS; i++) hidden.push(await act('tablepage', true));
    const out = { throttle, idleAnimations: idleAnims, actions: {}, cost: {} };
    for (const name of Object.keys(runs)) {
      out.actions[name] = summarise(runs[name]);
      const c = cost[name];
      out.cost[name] = { layoutMs: (c.reduce((a, x) => a + x.layout, 0) / c.length) * 1000, styleMs: (c.reduce((a, x) => a + x.style, 0) / c.length) * 1000, scriptMs: (c.reduce((a, x) => a + x.script, 0) / c.length) * 1000 };
    }
    out.hidden = {
      maxRunningAnimations: Math.max(...hidden.map((h) => h.maxAnim)),
      inInactiveTables: hidden.reduce((a, h) => a + h.bad, 0),
      onHiddenSlides: hidden.reduce((a, h) => a + h.off, 0),
      onAnySlide: hidden.reduce((a, h) => a + h.slideAnim, 0),
      targets: [...new Set(hidden.flatMap((h) => Object.keys(h.kinds)))],
    };
    return out;
  } finally {
    await page.close();
  }
}

const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
const result = { runs: RUNS, budgetBytes: BUDGET };
let browser = null;
const sites = [];
try {
  browser = await launch(browserPath);
  const own = !outsideUrl;
  const google = own ? await openVariant({}) : { base: outsideUrl.replace(/\/+$/, ''), close: async () => {} };
  sites.push(google);
  const self = own ? await openVariant({ fonts: { source: 'self' } }) : null;
  if (self) sites.push(self);

  if (only.includes('transfer')) {
    out('TRANSFER BUDGET (/ with the cache off, network idle for 1s, budget 300 KB before images and webfonts)');
    result.transfer = {};
    for (const [name, site] of [['google', google], ['self', self]]) {
      if (!site) { out(`  ${name}: skipped, a --url site has one font source`); continue; }
      const t = await measureTransfer(browser, site.base);
      result.transfer[name] = t;
      out(`  fonts: ${name}${t.idle ? '' : ' (network did not go idle in time)'}`);
      out('    group        raw KB   gzip KB');
      for (const g of GROUPS) out(`    ${g.padEnd(11)} ${kb(t.groups[g].raw).padStart(8)} ${kb(t.groups[g].gzip).padStart(9)}`);
      out(`    ${'no images'.padEnd(11)} ${kb(t.totalNoImages.raw).padStart(8)} ${kb(t.totalNoImages.gzip).padStart(9)}`);
      out(`    ${'and no fonts'.padEnd(11)} ${kb(t.totalNoImagesNoFonts.raw).padStart(8)} ${kb(t.totalNoImagesNoFonts.gzip).padStart(9)}   (budget ${kb(BUDGET)})`);
      for (const f of t.failed) out(`    failed: ${f}`);
      t.pass = t.totalNoImagesNoFonts.gzip < BUDGET;
      t.passRaw = t.totalNoImagesNoFonts.raw < BUDGET;
      out(`    verdict: gzip ${t.pass ? 'PASS' : 'FAIL'}, raw ${t.passRaw ? 'pass' : 'fail'}`);
    }
    out('  Judged against the budget of 300 KB gzip before images and webfonts. Font bytes are shown above so their growth stays visible. The server here sends no compression, so raw is shown as the upper bound. Remote files (Google) are counted as received, already encoded.');
    out();
  }

  if (only.includes('lazy')) {
    out('LAZY IMAGES (1440x900, fresh load of /, one table page forward, then the next table). The default site has no second page of images, so this runs on a copy with pageSize 4');
    const small = own ? await openVariant({ scene: { pageSize: 4 } }) : null;
    if (small) sites.push(small);
    const l = await measureLazy(browser, (small ?? google).base);
    result.lazy = l;
    out(`  page size ${l.pageSize}, items with images: ${JSON.stringify(l.imageItems)}, ${l.current} page 1 has ${l.page0Images}, page 2 has ${l.page1Images}`);
    out(`  on load: ${l.loadRequests} image requests ${JSON.stringify(l.loadByTable)}`);
    out(`  on load, images outside ${l.current} page 1 but partly on screen (the next table's edge): ${l.loadVisibleOutside}`);
    out(`  on load, outside ${l.current} page 1 and off screen: ${l.loadWrong.length}${l.loadWrong.length ? ` ${JSON.stringify(l.loadWrong)}` : ''}`);
    out(`  after paging: ${l.pagedRequests} new image requests ${JSON.stringify(l.pagedByTable)}`);
    out(`  after paging, outside ${l.current} page 2: ${l.pagedWrong.length}${l.pagedWrong.length ? ` ${JSON.stringify(l.pagedWrong)}` : ''}`);
    out(`  after switching to the next table: ${l.switchedRequests} new image requests ${JSON.stringify(l.switchedByTable)}`);
    out(`  after switching, outside the next table page 1: ${l.switchedWrong.length}${l.switchedWrong.length ? ` ${JSON.stringify(l.switchedWrong)}` : ''}`);
    l.pass = l.loadWrong.length === 0 && l.pagedWrong.length === 0 && l.switchedWrong.length === 0;
    out(`  verdict: ${l.pass ? 'PASS' : 'FAIL'}`);
    out();
  }

  if (only.includes('smooth') || only.includes('hidden')) {
    result.smooth = {};
    for (const throttle of [4, 1]) {
      const s = await measureSmooth(browser, google.base, throttle);
      result.smooth[throttle === 1 ? 'unthrottled' : 'throttled4x'] = s;
      out(`SMOOTHNESS at ${SMOOTH_PATH}, ${throttle === 1 ? 'no CPU throttle' : `${throttle}x CPU throttle`}, real motion, ${RUNS} runs per action`);
      out('  action       dur ms (min-max)      frames  median  p95    worst  >50ms  layout/style/script ms');
      for (const name of ['tablepage', 'open', 'advance', 'close']) {
        const a = s.actions[name];
        const c = s.cost[name];
        out(`  ${name.padEnd(11)} ${ms(a.durationMean).padStart(7)} (${Math.round(a.durationMin)}-${Math.round(a.durationMax)})`.padEnd(34) + `${a.framesPerRun.toFixed(0).padStart(6)} ${ms(a.median).padStart(7)} ${ms(a.p95).padStart(6)} ${ms(a.worst).padStart(7)} ${a.over50.toFixed(1).padStart(6)}  ${c.layoutMs.toFixed(0)}/${c.styleMs.toFixed(0)}/${c.scriptMs.toFixed(0)}${a.timeouts ? `  (${a.timeouts} timed out)` : ''}`);
      }
      s.pass = Object.values(s.actions).every((a) => a.p95 <= 50 && a.perRun.filter((r) => r.worst > 100.5).length <= 1 && !a.timeouts);
      out(`  smooth verdict: ${throttle === 1 ? (s.pass ? 'PASS' : 'FAIL') : 'not judged'} (judged only without throttle: p95 at most 50 ms and a frame over 100 ms in at most one run. Headless draws with software, so the throttled run is a pessimistic bound)`);
      const h = s.hidden;
      out(`  hidden pages (table page change): ${s.idleAnimations} animations idle, at most ${h.maxRunningAnimations} running, ${h.inInactiveTables} samples in other tables, ${h.onHiddenSlides} on hidden slides, ${h.onAnySlide} on any slide`);
      out(`    targets seen: ${h.targets.join(', ') || 'none'}`);
      h.pass = h.inInactiveTables === 0 && h.onHiddenSlides === 0;
      out(`    verdict: ${h.pass ? 'PASS' : 'FAIL'}`);
      out();
    }
  }
} catch (e) {
  console.error(`perf failed: ${e.stack ?? e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const s of sites) await s.close();
}
if (jsonFile) writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`);
process.exit(process.exitCode ?? 0);
