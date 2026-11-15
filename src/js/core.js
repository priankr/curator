/* Curator core: loads site.json, owns routing, the tag filter, motion helpers and the top bar, then mounts the scene. */
import { hash, rng } from './seed.js';
import { poster } from './kit.js';
import { pageTitle } from './title.js';

const root = document.documentElement;

/* ---------- error catcher (read by the headless checks) ---------- */
const errs = [];
function noteErr(m) { errs.push(String(m)); root.setAttribute('data-errors', errs.join(' | ')); }
window.addEventListener('error', (e) => noteErr(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => noteErr('rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

/* ---------- small utilities ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* deterministic pick: same item and salt always give the same answer */
const pick = (item, salt, arr) => arr[hash(item.key + '|' + salt) % arr.length];
const num = (item, salt, lo, hi) => lo + (hash(item.key + '|' + salt) % 10000) / 10000 * (hi - lo);
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

/* font stack for the poster kit: the configured family, then the fallback */
const stack = (family, fallback) => (family ? "'" + String(family).replace(/['"\\;{}<>]/g, '') + "', " : '') + fallback;

/* ---------- grain: one canvas noise tile shared as a CSS variable and the kit-grain pattern ---------- */
function grain() {
  let url = '';
  try {
    const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n;
    const cx = cv.getContext('2d'), im = cx.createImageData(n, n), r = rng(7);
    for (let i = 0; i < n * n; i++) { const v = r() > 0.5 ? 255 : 0; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = Math.floor(r() * r() * 46); }
    cx.putImageData(im, 0, 0);
    url = cv.toDataURL('image/png');
    root.style.setProperty('--grain', 'url(' + url + ')');
  } catch (e) { url = ''; }
  if (!document.getElementById('kit-defs')) {
    document.body.insertAdjacentHTML('afterbegin', '<svg id="kit-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><pattern id="kit-grain" width="128" height="128" patternUnits="userSpaceOnUse"><image href="' + url + '" width="128" height="128"/></pattern></defs></svg>');
  }
}

/* ---------- data: derived fields and ?stress=1 ---------- */
function prepare(site, stress) {
  site.collections.forEach((col, ci) => {
    if (stress && col.items.length) {
      const base = col.items.slice(); let k = 1;
      while (col.items.length < 80) { base.forEach((it) => { if (col.items.length < 80) col.items.push(Object.assign({}, it, { tags: it.tags.slice(), id: it.id + '-' + (k + 1), key: it.title + '#' + k })); }); k++; }
    }
    col.index = ci;
    col.items.forEach((it, i) => { it.index = i; it.col = col.id; it.no = String(i + 1).padStart(2, '0'); });
  });
}

/* ---------- the screen reader list: every item, rendered once. Its links stay out of the tab order because they have no visible focus ring. ---------- */
function renderList(host, site, typeLabel) {
  const nav = document.createElement('nav'); nav.className = 'sr-only'; nav.setAttribute('aria-label', 'All items');
  nav.innerHTML = site.collections.map((col) => '<section><h2>' + esc(col.title) + '</h2><ul>' + col.items.map((it) =>
    '<li><h3><a href="/' + encodeURIComponent(col.id) + '/' + encodeURIComponent(it.id) + '/">' + esc(it.title) + '</a></h3><p>' + esc(typeLabel(it.type)) + '</p><div>' + it.notesHtml + '</div>' +
    '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Visit link: ' + esc(it.title) + '">Visit link</a></li>').join('') + '</ul></section>').join('');
  nav.querySelectorAll('a').forEach((a) => { a.tabIndex = -1; });
  host.appendChild(nav);
}

function createApi(app, site) {
  const cols = site.collections, byId = new Map(cols.map((c) => [c.id, c]));
  const defId = byId.has(site.defaultCollection) ? site.defaultCollection : cols[0].id;
  const motion = site.scene.motion;
  const still = /[?&]still=1/.test(location.search);
  const reduced = still || motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const k = motion === 'fast' ? 0.6 : 1;
  if (still || motion === 'off') root.classList.add('cu-still');

  /* ---------- motion ---------- */
  const dur = (ms) => (reduced ? 1 : ms * k);
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms * k));
  const anim = (el, frames, opts) => {
    if (reduced) { /* no motion: jump straight to the last frame */
      const last = Array.isArray(frames) ? frames[frames.length - 1] : frames;
      Object.keys(last).forEach((p) => { if (p !== 'offset' && p !== 'easing') el.style[p] = last[p]; });
      return Promise.resolve(null);
    }
    const o = Object.assign({ duration: 500, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' }, opts);
    o.duration *= k; if (o.delay) o.delay *= k;
    const a = el.animate(frames, o);
    /* timer fallback: `finished` can stall when the browser stops drawing frames (background tab, headless) */
    const cap = new Promise((r) => setTimeout(r, (o.duration || 0) + (o.delay || 0) + 80));
    return Promise.race([a.finished.catch(() => {}), cap]).then(() => a);
  };

  /* ---------- types and poster fonts ---------- */
  const types = new Map(site.types.map((t) => [t.name, t]));
  const typeLabel = (type) => (types.has(type) ? types.get(type).label : String(type));
  /* the build writes one --dot-<type> variable per type into the page head */
  const typeDot = (type) => 'var(--dot-' + (types.has(type) ? type : 'webpage') + ')';
  const posterFonts = { band: stack(site.fonts.poster, "'Helvetica Neue', Arial, sans-serif"), mono: stack(site.fonts.mono, 'ui-monospace, monospace') };

  const visual = (item, w, h) => {
    if (item.image) return '<img class="vis-img' + (item.image.fit ? ' vis-fit' : '') + '" src="' + esc(item.image.src) + '" alt="" loading="lazy" draggable="false">';
    if (!item.poster) return '';
    return poster(item, w || 900, h || 600, item.poster, { v: item.poster.v, fonts: posterFonts });
  };

  /* ---------- routing: real paths ---------- */
  function route() {
    const p = location.pathname.split('/').filter(Boolean).map(dec);
    if (p[p.length - 1] === 'index.html') p.pop();
    const r = { col: defId, item: null, notFound: false, home: !p.length };
    if (!p.length) return r;
    const col = byId.get(p[0]);
    if (!col || p.length > 2) { r.notFound = true; return r; }
    if (p[1]) {
      if (!col.items.some((it) => it.id === p[1])) { r.notFound = true; return r; }
      r.item = p[1];
    }
    r.col = col.id;
    return r;
  }
  const pathFor = (col, item) => '/' + encodeURIComponent(col) + '/' + (item ? encodeURIComponent(item) + '/' : '');
  /* pushState keeps an early click (before the page has finished loading) in its own history entry. The entry for an open item is marked, so closing can step back to it. */
  let routeFn = null;
  /* the tab title follows the route and matches the title the build writes into each page head */
  const syncTitle = (r) => {
    const col = byId.get(r.col), item = r.item ? col.items.find((it) => it.id === r.item) : null;
    document.title = pageTitle({ siteTitle: site.site.title, kind: r.notFound ? '404' : item ? 'item' : r.home ? 'home' : 'collection', collection: col, item });
  };
  let closeMenu = () => {}; /* set by chrome.mount, so any route change closes the collections menu */
  const fire = () => { const r = route(); syncTitle(r); closeMenu(false); if (routeFn) routeFn(r); };
  const go = (col, item, mark) => {
    const to = { col: col || defId, item: item || null }, now = route();
    if (!now.notFound && now.col === to.col && now.item === to.item) return;
    history.pushState(mark ? { cuItem: true } : null, '', pathFor(to.col, to.item) + location.search); fire();
  };
  const open = (item) => go(item.col, item.id, true);
  /* replace: page to another item in place, keeping one history entry per open session */
  const replace = (item) => {
    const to = pathFor(item.col, item.id);
    if (location.pathname === to) return;
    history.replaceState(history.state, '', to + location.search); fire();
  };
  const close = () => {
    const r = route(); if (!r.item) return;
    if (history.state && history.state.cuItem) history.back(); else { history.replaceState(null, '', pathFor(r.col) + location.search); fire(); }
  };
  let popBound = false;
  const onRoute = (fn) => { routeFn = fn; if (!popBound) { popBound = true; window.addEventListener('popstate', fire); } };

  /* ---------- chrome: top bar ---------- */
  const chrome = {
    mount(opts = {}) {
      const bar = document.createElement('header'); bar.className = 'cu-top';
      bar.innerHTML = '<div class="cu-left"><a class="cu-brand" href="/' + esc(location.search) + '"><b>' + esc(site.site.title) + '</b></a></div><div class="cu-menu"><button type="button" class="cu-menu-btn" aria-label="Collections" aria-expanded="false" aria-controls="cu-menu-panel"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><nav id="cu-menu-panel" class="cu-cols" aria-label="Collections" hidden></nav></div>';
      app.prepend(bar);
      const menu = bar.querySelector('.cu-menu'), btn = bar.querySelector('.cu-menu-btn'), nav = bar.querySelector('.cu-cols');
      if (opts.home) nav.innerHTML = '<button type="button" class="cu-col" data-col="">' + esc(opts.home) + '</button>';
      cols.forEach((c) => { nav.insertAdjacentHTML('beforeend', '<button type="button" class="cu-col" data-col="' + esc(c.id) + '" title="' + esc(c.title) + '">' + esc(c.short) + '</button>'); });
      const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
      const setMenu = (open, focusBtn) => {
        if (open === isOpen()) { if (!open && focusBtn) btn.focus(); return; }
        btn.setAttribute('aria-expanded', String(open));
        if (nav.getAnimations) nav.getAnimations().forEach((a) => a.cancel());
        nav.hidden = !open;
        if (open) {
          const cur = nav.querySelector('.cu-col.on') || nav.querySelector('.cu-col'); if (cur) cur.focus();
          anim(nav, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 160, fill: 'none' });
        } else if (focusBtn) btn.focus();
      };
      closeMenu = (focusBtn) => setMenu(false, focusBtn);
      btn.addEventListener('click', () => setMenu(!isOpen(), false));
      nav.addEventListener('click', (e) => { const b = e.target.closest('.cu-col'); if (!b) return; setMenu(false, true); go(b.dataset.col || null); });
      /* a click anywhere else closes the menu and that click still does its own job */
      document.addEventListener('click', (e) => { if (isOpen() && !menu.contains(e.target)) setMenu(false, false); });
      menu.addEventListener('focusout', (e) => { if (isOpen() && e.relatedTarget && !menu.contains(e.relatedTarget)) setMenu(false, false); });
      /* capture phase on document: while open, these keys never reach the scene handler */
      document.addEventListener('keydown', (e) => {
        if (!isOpen()) return;
        const k = e.key, rows = [...nav.querySelectorAll('.cu-col')], i = rows.indexOf(document.activeElement);
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false, true); return; }
        if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
          e.preventDefault(); e.stopPropagation();
          const n = k === 'Home' ? 0 : k === 'End' ? rows.length - 1 : k === 'ArrowDown' ? (i + 1) % rows.length : i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length;
          rows[n].focus();
        } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'PageUp' || k === 'PageDown') e.stopPropagation();
      }, true);
      bar.querySelector('.cu-brand').addEventListener('click', (e) => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); go(defId); });
      return bar;
    },
    mark: (colId) => document.querySelectorAll('.cu-col').forEach((b) => { const on = b.dataset.col === (colId || ''); b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); })
  };

  /* ---------- tag filter ---------- */
  let activeTag = null;
  /* Renders tag chips for one collection. onChange(tag|null) lets the scene dim objects in place. */
  const mountTags = (host, col, onChange) => {
    activeTag = null;
    const chip = (t, label) => '<button type="button" class="cu-chip" aria-pressed="false" data-tag="' + esc(t) + '">' + esc(label) + '</button>';
    host.hidden = !col.tags.length;
    host.innerHTML = col.tags.length ? chip('', 'all') + col.tags.map((t) => chip(t, t)).join('') : '';
    const press = () => host.querySelectorAll('.cu-chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tag === (activeTag || ''))));
    host.onclick = (e) => {
      const b = e.target.closest('.cu-chip'); if (!b) return;
      const next = b.dataset.tag === activeTag ? null : b.dataset.tag || null;
      if (next === activeTag) return;
      activeTag = next; press(); onChange(activeTag);
    };
    press();
    onChange(null);
  };
  const matches = (item) => !activeTag || item.tags.includes(activeTag);

  /* horizontal swipe to change collection on touch screens */
  const swipe = (el, fn) => {
    let s = null;
    el.addEventListener('touchstart', (e) => { const t = e.touches[0]; s = { x: t.clientX, y: t.clientY }; }, { passive: true });
    el.addEventListener('touchend', (e) => { if (!s) return; const t = e.changedTouches[0]; const dx = t.clientX - s.x, dy = t.clientY - s.y; s = null; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) fn(dx < 0 ? 1 : -1); }, { passive: true });
  };

  /* the scene calls this once its first route is fully applied, so shots and tests can wait for it */
  const ready = () => { if (!root.dataset.ready) root.dataset.ready = '1'; };
  /* an unknown path becomes the home page in place, with no reload and no new history entry */
  const toHome = () => { history.replaceState(history.state, '', '/' + location.search); syncTitle(route()); };
  return { open, close, go, replace, toHome, onRoute, ready, route, mountTags, matches, anim, wait, dur, reduced, still, esc, hash, num, pick, visual, typeLabel, typeDot, chrome, swipe };
}

/* small dismissible note, announced to screen readers */
function note(app, text) {
  const el = document.createElement('div'); el.className = 'cu-note'; el.setAttribute('role', 'status');
  el.innerHTML = '<span>' + esc(text) + '</span><button type="button" aria-label="Dismiss this note">&times;</button>';
  el.querySelector('button').addEventListener('click', () => el.remove());
  app.appendChild(el);
}

async function boot() {
  const app = document.getElementById('app');
  const meta = document.querySelector('meta[name="curator-assets"]');
  const assets = meta ? meta.getAttribute('content') : '/';
  /* old hash links such as #/tools/uv become real paths before routing */
  const h = /^#\/([^?]*)/.exec(location.hash);
  if (h) {
    const parts = h[1].split('/').filter(Boolean);
    history.replaceState(history.state, '', '/' + parts.map((s) => encodeURIComponent(dec(s))).join('/') + (parts.length ? '/' : '') + location.search);
  }
  let site;
  try {
    const res = await fetch('/data/site.json');
    if (!res.ok) throw new Error('site.json answered ' + res.status);
    site = await res.json();
    if (!site.collections || !site.collections.length) throw new Error('site.json has no collections');
  } catch (e) {
    noteErr('load: ' + e.message);
    app.innerHTML = '<p style="padding:24px">This site could not be loaded.</p>';
    return;
  }
  prepare(site, /[?&]stress=1/.test(location.search));
  grain();
  const api = createApi(app, site);
  const lost = api.route().notFound;
  if (lost) api.toHome();
  const scene = await import(assets + 'scenes/' + site.scene.name + '/scene.js');
  await scene.mount(app, site, api);
  renderList(app, site, api.typeLabel);
  if (lost) note(app, 'Page not found.');
}

boot().catch((e) => noteErr('boot: ' + ((e && (e.stack || e.message)) || e)));
