import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './lib/cdp.mjs';
import { argValue, openSite, requireBrowser } from './lib/headless.mjs';

const SHOT_LIMIT_MS = 30000;

const args = process.argv.slice(2);
const out = resolve(argValue(args, '--out') ?? '.cache/shots');
const browserPath = requireBrowser();
const site = await openSite(argValue(args, '--url'));
mkdirSync(out, { recursive: true });

// Runs in the page. Waits per document for the ready marker, fonts, images and two frames. Resolves with the src of every image that failed to load.
const settle = (frames, limit) => `(async (frames, limit) => {
  const end = Date.now() + limit, failed = new Set();
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const docs = () => {
    const fs = [...document.querySelectorAll('iframe')];
    if (fs.length < frames) return null;
    const all = [document];
    for (const f of fs) { try { if (f.contentDocument) all.push(f.contentDocument); } catch (e) { /* cross-origin */ } }
    return all;
  };
  const until = async (fn) => { while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await nap(50); } };
  const ready = () => { const ds = docs(); return !!ds && ds.every((d) => (frames && d === document) || d.documentElement.dataset.ready === '1') && ds.every((d) => d.readyState === 'complete'); };
  const fonts = () => docs().every((d) => d.fonts.status === 'loaded' && ![...d.fonts].some((f) => f.status === 'loading'));
  const wanted = (d, i) => {
    if (!i.getAttribute('src') || i.dataset.src) return false;
    if (i.loading !== 'lazy') return true;
    const r = i.getBoundingClientRect(), w = d.defaultView;
    return !(r.right <= 0 || r.bottom <= 0 || r.left >= w.innerWidth || r.top >= w.innerHeight);
  };
  const images = () => docs().every((d) => [...d.images].every((i) => {
    if (!wanted(d, i)) return true;
    if (!i.complete) return false;
    if (i.naturalWidth === 0) failed.add(i.getAttribute('src'));
    return true;
  }));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  await until(ready);
  for (;;) { await until(fonts); await nap(200); if (fonts()) break; }
  for (;;) { await until(images); await frame(); await frame(); if (images()) break; }
  await Promise.all(docs().flatMap((d) => [...d.images].filter((i) => wanted(d, i) && i.naturalWidth > 0).map((i) => i.decode().catch(() => {}))));
  await nap(300); await frame(); await frame();
  return [...failed];
})(${frames}, ${limit})`;

let failed = 0;
let browser = null;
try {
  const data = await (await fetch(`${site.base}/data/site.json`)).json();
  // Any collection will do, because the content decides which items have an image and which a poster.
  const first = (want) => { for (const col of data.collections) { const it = col.items.find(want); if (it) return `/${col.id}/${it.id}/?still=1`; } return null; };
  const image = first((i) => i.image);
  const poster = first((i) => i.poster);
  const shots = [];
  for (const [w, h] of [[1440, 900], [1280, 720]]) {
    shots.push([`table-${w}`, '/?still=1', w, h, 0]);
    if (image) shots.push([`open-image-${w}`, image, w, h, 0]);
    if (poster) shots.push([`open-poster-${w}`, poster, w, h, 0]);
  }
  shots.push(['stress-1440', '/?stress=1&still=1', 1440, 900, 0], ['not-found-1440', '/nope/?still=1', 1440, 900, 0], ['phone-1240', '/__tests/phone.html', 1640, 900, 4]);

  browser = await launch(browserPath, { args: ['--disable-lcd-text', '--font-render-hinting=none', '--disable-partial-raster'] });
  for (const [name, path, w, h, frames] of shots) {
    const file = join(out, `${name}.png`);
    const started = Date.now();
    let page = null;
    try {
      page = await browser.newPage({ width: w, height: h });
      let timedOut = false;
      try {
        await page.goto(site.base + path, SHOT_LIMIT_MS);
        const bad = await page.evaluate(settle(frames, Math.max(1000, SHOT_LIMIT_MS - (Date.now() - started))), { awaitPromise: true, timeoutMs: SHOT_LIMIT_MS + 5000 });
        for (const src of bad) console.log(`WARNING ${name} image failed to load: ${src}`);
      } catch {
        timedOut = true;
      }
      if (timedOut) console.log(`WARNING ${name} did not settle within ${SHOT_LIMIT_MS / 1000}s, taking the screenshot anyway`);
      await page.screenshot(file);
      console.log(file);
    } catch (e) {
      failed++;
      console.log(`FAILED ${file} (${e.message})`);
    } finally {
      await page?.close();
    }
  }
} catch (e) {
  failed++;
  console.log(`FAILED ${e.message}`);
} finally {
  await browser?.close();
  await site.close();
}
process.exit(failed ? 1 : 0);
