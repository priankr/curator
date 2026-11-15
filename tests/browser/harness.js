/* Browser test harness: one same-origin iframe, setTimeout based waits, checks and one JSON result in #R. */
(function () {
  const R = document.getElementById('R');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Polls until fn returns something truthy, or gives up after limit ms and returns false.
  async function waitFor(fn, limit = 12000, step = 50) {
    const end = Date.now() + limit;
    for (;;) {
      let v = false;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return v;
      if (Date.now() > end) return false;
      await sleep(step);
    }
  }

  async function loadFrame(src, width, height) {
    const old = document.getElementById('f');
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'f';
    f.style.cssText = 'width:' + width + 'px;height:' + height + 'px;border:0;display:block';
    const loaded = new Promise((r) => { f.onload = r; });
    f.src = src;
    document.body.appendChild(f);
    await loaded;
    const w = f.contentWindow, d = w.document;
    // Boot is done when the table is mounted (or the load failed, which the error check reports).
    // The dev theme page has no table. Its body carries .tp and it sets data-ready when drawn.
    await waitFor(() => d.querySelector('.table.on') || d.documentElement.getAttribute('data-errors') || (d.body.classList.contains('tp') && d.documentElement.dataset.ready === '1'), 15000);
    await sleep(300);
    return makeCtx(f, w, d);
  }

  function makeCtx(f, w, d) {
    const $ = (s, r) => (r || d).querySelector(s);
    const $$ = (s, r) => [...(r || d).querySelectorAll(s)];
    const ctx = {
      f, w, d, $, $$,
      path: () => w.location.pathname,
      booth: () => d.getElementById('booth'),
      isOpen: () => { const b = d.getElementById('booth'); return !b.hidden && b.classList.contains('open'); },
      isClosed: () => d.getElementById('booth').hidden,
      title: () => (d.getElementById('cp-title') || {}).textContent,
      focusName: () => { const a = d.activeElement; return a ? (a.id || a.getAttribute('aria-label') || a.className || a.tagName) : 'none'; },
      slides: () => $$('.table.on .slide'),
      visibleSlides: () => $$('.table.on .slide:not(.off)'),
      range: () => $('.table.on .tb-rng').textContent,
      pageDisabled: () => $$('.table.on .tb-pg').map((b) => b.getAttribute('aria-disabled')).join(','),
      // Dispatches a key on the focused element, which bubbles to the document like a real key press.
      key: (key, opts) => {
        const target = (opts && opts.on) || (d.activeElement && d.activeElement !== d.body ? d.activeElement : d.body);
        const e = new w.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, opts && opts.init));
        target.dispatchEvent(e);
        return e;
      },
      isShown: (el) => { const s = w.getComputedStyle(el), r = el.getBoundingClientRect(); return !el.classList.contains('off') && !el.classList.contains('gone') && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0; },
      // A short name for an element in failure messages.
      name: (el) => (el ? (el.id ? '#' + el.id : (el.getAttribute('aria-label') || el.className || el.tagName) + '') : 'none'),
      // True when the focused element shows an outline with a width and colour, or a box-shadow that differs from before (its value while not focused).
      ringed: (el, before) => {
        const s = w.getComputedStyle(el);
        const a = (s.outlineColor.match(/rgba?\(([^)]*)\)/) || [0, ''])[1].split(',').map(Number);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && (a.length < 4 || a[3] > 0);
        return outline || s.boxShadow !== before;
      },
      // Every element a Tab press can reach in the current view, in document order.
      tabbable: () => $$('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').filter((e) => !e.closest('[inert]') && !e.closest('[hidden]') && e.getAttribute('tabindex') !== '-1' && e.getClientRects().length > 0 && w.getComputedStyle(e).visibility !== 'hidden'),
      load: (src, width, height) => loadFrame(src, width || 1440, height || 900),
      loadFrame
    };
    return ctx;
  }

  // Item ids and titles follow the stress rule in core.js: copies of the base items up to 80, with the id suffixed by the pass.
  function stressItem(col, idx) {
    const n = col.items.length;
    if (idx < n) return col.items[idx];
    const k = Math.floor((idx - n) / n) + 1, base = col.items[(idx - n) % n];
    return { id: base.id + '-' + (k + 1), title: base.title };
  }

  // Real input and DevTools calls: the page queues a request, the runner (scripts/browser.mjs) polls H.take, runs it and answers through H.give.
  const bridge = { seq: 0, queue: [], waiting: new Map() };
  const take = () => bridge.queue.splice(0);
  const give = (id, json) => {
    const w = bridge.waiting.get(id);
    if (!w) return;
    bridge.waiting.delete(id);
    const r = JSON.parse(json);
    if (r.error) w.rej(new Error(r.error)); else w.res(r.result);
  };
  // method is a DevTools method the runner allows, or press. With frame set, the runner adds the frameId of the first iframe.
  const cdp = (method, params, frame) => new Promise((res, rej) => {
    const id = ++bridge.seq;
    bridge.waiting.set(id, { res, rej });
    bridge.queue.push({ id, method, params: params || {}, frame: !!frame });
  });

  async function run(name, body, opts) {
    const checks = [];
    const t = {
      sleep, waitFor, stressItem,
      check: (n, pass, detail) => { checks.push({ name: n, pass: !!pass, detail: detail === undefined ? '' : String(detail) }); return !!pass; },
      site: async () => (await fetch('/data/site.json')).json()
    };
    const frames = [];
    t.load = async (src, width, height) => { const c = await loadFrame(src, width || 1440, height || 900); frames.push(c); return c; };
    t.cdp = cdp;
    // One real key press in the last loaded frame. Focus really moves, unlike a synthetic DOM event.
    t.press = async (key, o) => { frames[frames.length - 1].w.focus(); await cdp('press', Object.assign({ key }, o)); };
    t.axTree = async () => (await cdp('Accessibility.getFullAXTree', {}, true)).nodes;
    try {
      await body(t, opts || {});
    } catch (e) {
      checks.push({ name: 'no thrown error', pass: false, detail: String((e && e.stack) || e) });
    }
    for (const c of frames) {
      let errs = '';
      try { errs = c.d.documentElement.getAttribute('data-errors') || ''; } catch (e) { errs = 'frame unreadable: ' + e; }
      checks.push({ name: 'no front end errors', pass: errs === '', detail: errs });
    }
    const result = { name, pass: checks.length > 0 && checks.every((c) => c.pass), checks };
    R.textContent = JSON.stringify(result);
  }

  window.addEventListener('error', (e) => { R.textContent = JSON.stringify({ name: document.title, pass: false, checks: [{ name: 'page error', pass: false, detail: e.message }] }); });
  window.H = { run, sleep, waitFor, take, give };
})();
