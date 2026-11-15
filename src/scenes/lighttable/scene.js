/* Curator scene: light table and projector. Slides on glowing tables, one projector, one pull-down screen. */
const MARKUP = `<div class="lt-room" id="room">
  <div class="lt-rail" id="rail"></div>
</div>
<div class="lt-scrim"></div>
<div class="cu-head" id="head">
  <h1 id="h-title"></h1>
  <p id="h-desc"></p>
  <div class="cu-chips" id="chips" role="group" aria-label="Filter by tag"></div>
</div>
<button type="button" class="cu-arrow side side-l" id="prev-col" aria-label="Previous table" aria-disabled="false"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
<button type="button" class="cu-arrow side side-r" id="next-col" aria-label="Next table" aria-disabled="false"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
<div class="booth" id="booth" role="dialog" aria-modal="true" aria-labelledby="cp-title" hidden>
  <div class="sr-only" id="cp-live" role="status" aria-live="polite" aria-atomic="true"></div>
  <div class="bt-dark" id="bt-dark"></div>
  <div class="beam" id="beam"></div>
  <div class="scr-wrap" id="scr-wrap">
    <div class="roller"></div>
    <div class="scr-clip">
      <div class="screen" id="screen">
        <div class="scr-body" id="scr-body" tabindex="-1">
          <div class="cap" id="cap"></div>
          <div class="proj" id="proj"></div>
        </div>
        <div class="scr-bar"><i></i></div>
      </div>
    </div>
  </div>
  <div class="projector" id="projector"><div class="pj-slot" id="pj-slot"></div><div class="pj-vent"></div><div class="pj-lamp"></div><div class="pj-pad"><button type="button" class="pj-btn" id="pj-prev" aria-label="Previous slide"><i aria-hidden="true"></i></button><button type="button" class="pj-btn pj-next" id="pj-next" aria-label="Next slide"><i aria-hidden="true"></i></button></div><button type="button" class="pj-knob" id="pj-power" aria-label="Turn off the projector"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 6.3a8 8 0 1 0 9.6 0M12 3.5v8"/></svg></button><div class="pj-name">Curator 35</div></div>
  <div class="fly" id="fly"></div>
  <button type="button" class="cu-close bt-close" id="bt-close">Back to the table <kbd>Esc</kbd></button>
</div>`;

export async function mount(app, site, C) {
  const esc = C.esc, $ = (s, r) => (r || document).querySelector(s);
  const cols = site.collections, colOf = (id) => cols.find((c) => c.id === id) || null;
  const itemOf = (col, id) => col.items.find((i) => i.id === id) || null;
  document.body.classList.add('lt-page');
  app.insertAdjacentHTML('beforeend', MARKUP);
  const room = $('#room'), rail = $('#rail'), head = $('#head'), chips = $('#chips');
  C.chrome.mount();

  /* ---------- slides ---------- */
  const PAGE_SIZE = site.scene.pageSize;
  // Label limits in characters, measured on the shipped fonts with a margin. The full title stays in the aria-label and on the screen.
  const LABEL_MAX = { hand: 36, typed: 45, 'grey-hand': 45, 'grey-typed': 32 };
  const ENDS = /(?:[\s:;,.(–—-]|\s(?:a|an|and|at|by|for|in|of|on|or|the|to|with))+$/i;
  function labelText(title, max) {
    if (title.length <= max) return title;
    const space = title.lastIndexOf(' ', max);
    return (space > 0 ? title.slice(0, space) : title.slice(0, max)).replace(ENDS, '');
  }
  function slideHTML(item) {
    const h = (s, n) => C.hash(item.key + '|' + s) % n;
    const mounts = { webpage: ['card', 'card', 'cream'], article: ['card', 'card', 'cream'], video: ['card', 'black', 'cream'], repo: ['grey', 'black', 'grey'], image: ['white', 'black', 'white'] }[item.type] || ['card'];
    const m = mounts[h('mt', mounts.length)], hand = h('hw', 2) === 0 || m === 'black';
    return '<span class="mt m-' + m + ' o-l' + '"><span class="lb-top"><b>' + esc(C.typeLabel(item.type)) + '</b><i>' + item.no + '</i></span>' +
      '<span class="win">' + C.visual(item, 300, 200) + '<i class="glare"></i></span>' +
      '<span class="lb-bot' + (hand ? ' hand' : '') + '">' + esc(labelText(item.title, LABEL_MAX[(m === 'grey' ? 'grey-' : '') + (hand ? 'hand' : 'typed')])) + '</span><i class="dot" style="background:' + C.typeDot(item.type) + '"></i></span>';
  }
  /* images of tables other than the current one wait in data-src until visible, because the browser's lazy loading also fetches images up to 1250px off screen */
  const start = colOf(C.route().col).index, defer = (html, ci) => (ci === start ? html : html.replace(/<img([^>]*?) src="/g, '<img$1 data-src="'));
  const wake = (im) => { if (im.dataset.src) { im.src = im.dataset.src; im.removeAttribute('data-src'); } };
  const seen = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { wake(e.target); seen.unobserve(e.target); } })) : null;
  rail.innerHTML = cols.map((col, ci) => '<section class="table" data-col="' + col.id + '" aria-label="' + esc(col.title) + '"><div class="tb-frame"><i class="screw a"></i><i class="screw b"></i><i class="screw c"></i><i class="screw d"></i><div class="tb-glass"><div class="slides">' +
    col.items.map((it, i) => '<button type="button" class="slide t-' + it.type + '" data-i="' + i + '" style="--r:' + C.num(it, 'rot', -4.5, 4.5).toFixed(2) + 'deg;--dx:' + C.num(it, 'dx', -7, 7).toFixed(1) + 'px;--dy:' + C.num(it, 'dy', -7, 7).toFixed(1) + 'px" aria-label="' + esc(it.title) + ', ' + esc(C.typeLabel(it.type).toLowerCase()) + ' from ' + esc(it.domain) + '">' + defer(slideHTML(it), ci) + '</button>').join('') +
    '</div></div><div class="tb-plate"><span class="tb-name"><b>' + esc(col.short) + '</b><span class="tb-rng"></span></span><span class="tb-pager"><button type="button" class="pj-btn tb-pg" data-d="-1" aria-label="Previous page of slides"><i aria-hidden="true"></i></button><button type="button" class="pj-btn pj-next tb-pg" data-d="1" aria-label="Next page of slides"><i aria-hidden="true"></i></button></span></div></div></section>').join('');
  const tables = [...rail.querySelectorAll('.table')], slides = tables.map((t) => [...t.querySelectorAll('.slide')]);
  rail.querySelectorAll('img[data-src]').forEach((im) => (seen ? seen.observe(im) : wake(im)));

  /* ---------- pages: a table shows PAGE_SIZE slides at a time. Slides keep their place in slides[ci], the others are hidden. ---------- */
  const pageOf = cols.map(() => 0), pageCount = (ci) => Math.max(1, Math.ceil(cols[ci].items.length / PAGE_SIZE)), pageFor = (item) => Math.floor(item.index / PAGE_SIZE);
  let paging = false;
  function showPage(ci, p) {
    pageOf[ci] = p; const lo = p * PAGE_SIZE, hi = lo + PAGE_SIZE, n = cols[ci].items.length, t = tables[ci];
    slides[ci].forEach((s, i) => s.classList.toggle('off', i < lo || i >= hi));
    t.querySelector('.tb-rng').textContent = pageCount(ci) > 1 ? (lo + 1) + ' to ' + Math.min(hi, n) + ' of ' + n : n + ' slides';
    t.querySelectorAll('.tb-pg').forEach((b) => b.setAttribute('aria-disabled', String(b.dataset.d < 0 ? p === 0 : p >= pageCount(ci) - 1)));
  }
  /* every glass gets the height of a full page at this layout, from a real slide box, the grid gaps and the column count */
  function fitPages() {
    const pick = tables.map((t) => t.querySelector('.slide:not(.off)')).find(Boolean); if (!pick) return;
    const sl = pick.parentElement, cs = getComputedStyle(sl), cols = Math.max(1, cs.gridTemplateColumns.split(' ').length), rows = Math.ceil(PAGE_SIZE / cols);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), box = cs.boxSizing === 'border-box';
    const h = rows * pick.offsetHeight + (rows - 1) * (parseFloat(cs.rowGap) || 0) + (box ? pad : 0);
    tables.forEach((t) => { t.querySelector('.slides').style.minHeight = h + 'px'; });
  }
  async function changePage(ci, p) {
    if (paging || p === pageOf[ci] || p < 0 || p >= pageCount(ci)) return;
    paging = true; const dir = p > pageOf[ci] ? 1 : -1, sl = tables[ci].querySelector('.slides');
    if (!C.reduced) await C.anim(sl, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(' + (-6 * dir) + '%)', opacity: 0 }], { duration: 170, easing: 'ease-in' });
    showPage(ci, p);
    if (!C.reduced) { await C.anim(sl, [{ transform: 'translateX(' + (6 * dir) + '%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 230 }); sl.getAnimations().forEach((a) => a.cancel()); }
    paging = false;
  }
  tables.forEach((t, ci) => showPage(ci, 0));

  let cur = colOf(C.route().col).index;
  /* top plus height, so a transient transform or the scroll position cannot move it */
  const headBottom = () => (parseFloat(getComputedStyle(head).top) || 0) + head.getBoundingClientRect().height;
  function layout() {
    fitPages();
    const headH = headBottom(), tw = tables[0].offsetWidth + (parseFloat(getComputedStyle(rail).columnGap) || 0);
    document.documentElement.style.setProperty('--headH', headH + 'px');
    rail.style.setProperty('--rx', -cur * tw + 'px');
    rail.style.height = tables[cur].offsetHeight + 'px';
  }
  function setTable(ci, instant) {
    cur = ci; const col = cols[ci];
    tables[ci].querySelectorAll('img[data-src]').forEach(wake);
    tables.forEach((t, i) => { t.classList.toggle('on', i === ci); t.querySelector('.slides').inert = i !== ci; t.querySelector('.tb-plate').inert = i !== ci; });
    if (instant) { rail.classList.add('no-anim'); requestAnimationFrame(() => requestAnimationFrame(() => rail.classList.remove('no-anim'))); }
    $('#h-title').textContent = col.title; $('#h-desc').textContent = col.description;
    C.mountTags(chips, col, () => slides[ci].forEach((s, i) => s.classList.toggle('dim', !C.matches(col.items[i]))));
    C.chrome.mark(col.id); $('#prev-col').setAttribute('aria-disabled', String(ci === 0)); $('#next-col').setAttribute('aria-disabled', String(ci === cols.length - 1));
    room.scrollTo({ top: 0, behavior: instant || C.reduced ? 'auto' : 'smooth' });
    layout();
  }

  /* ---------- projector ---------- */
  const scrWrap = $('#scr-wrap'), booth = $('#booth'), dark = $('#bt-dark'), screen = $('#screen'), proj = $('#proj'), cap = $('#cap'), fly = $('#fly'), pj = $('#projector'), beam = $('#beam');
  let opened = null, busy = Promise.resolve();
  /* while the screen is open everything outside the booth is inert, so Tab cannot reach it */
  const outside = () => [...app.children].filter((e) => e !== booth);
  const tabStops = () => [...booth.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')].filter((e) => !e.inert && e.getClientRects().length > 0);
  function placeBeam() {
    const p = pj.getBoundingClientRect(), s = scrWrap.getBoundingClientRect(), top = Math.min(s.bottom - 4, p.top), hgt = Math.max(0, p.top + 26 - top);
    beam.style.cssText = 'left:' + s.left + 'px;width:' + s.width + 'px;top:' + top + 'px;height:' + hgt + 'px;--lens:' + ((p.left + p.width / 2 - s.left) / s.width * 100).toFixed(1) + '%';
  }
  function fill(item, ci) {
    proj.innerHTML = C.visual(item, 900, 600);
    cap.innerHTML = '<div class="cp-text"><p class="cp-kick">' + esc(C.typeLabel(item.type)) + '</p><h2 id="cp-title">' + esc(item.title) + '</h2><div class="cp-notes">' + item.notesHtml + '</div>' +
      '<div class="cp-tags">' + item.tags.map((t) => '<span class="cu-tag">' + esc(t) + '</span>').join('') + '</div><a class="cu-visit" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">Visit link <span aria-hidden="true">&#8599;</span></a></div>' +
      '<p class="cp-count">Slide ' + item.no + ' of ' + cols[ci].items.length + '</p>';
    $('#pj-prev').setAttribute('aria-disabled', item.index === 0 ? 'true' : 'false');
    $('#pj-next').setAttribute('aria-disabled', item.index === cols[ci].items.length - 1 ? 'true' : 'false');
  }
  function geom(el) {
    const r = el.getBoundingClientRect(); fly.innerHTML = el.innerHTML; fly.className = 'fly ' + el.className; fly.classList.remove('dim', 'gone', 'off');
    fly.style.cssText = 'left:' + (r.left + r.width / 2 - el.offsetWidth / 2) + 'px;top:' + (r.top + r.height / 2 - el.offsetHeight / 2) + 'px;width:' + el.offsetWidth + 'px;height:' + el.offsetHeight + 'px;';
    const slot = $('#pj-slot').getBoundingClientRect(), k = Math.min(0.5, 64 / el.offsetWidth);
    const fx = r.left + r.width / 2, fy = r.top + r.height / 2, tx = slot.left + slot.width / 2 - fx, ty = slot.top - el.offsetHeight * k / 2 - 10 - fy;
    return { el, from: 'translate(0px,0px) rotate(' + getComputedStyle(el).getPropertyValue('--r').trim() + ') scale(1)', lifted: 'translate(0px,-14px) rotate(0deg) scale(1.12)', above: 'translate(' + tx + 'px,' + ty + 'px) rotate(0deg) scale(' + k + ')', inside: 'translate(' + tx + 'px,' + (ty + el.offsetHeight * k + 24) + 'px) rotate(0deg) scale(' + k + ')' };
  }
  async function openSlide(item) {
    const ci = colOf(item.col).index, el = slides[ci][item.index]; if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    fill(item, ci);
    booth.hidden = false; outside().forEach((e) => { e.inert = true; }); document.body.classList.add('showing'); booth.classList.remove('lit', 'open');
    const g = geom(el), { from, lifted, above, inside } = g;
    opened = Object.assign({ item }, g); el.classList.add('gone');
    C.anim(dark, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease' });
    C.anim(pj, [{ transform: 'translate(-50%,120%)' }, { transform: 'translate(-50%,0%)' }], { duration: 520 });
    await C.anim(fly, [{ transform: from }, { transform: lifted }], { duration: 240 });
    C.anim(screen, [{ transform: 'translateY(-102%)' }, { transform: 'translateY(0%)' }], { duration: 820, delay: 260, easing: 'cubic-bezier(.3,.9,.3,1)' });
    await C.anim(fly, [{ transform: lifted }, { transform: above }], { duration: 640, easing: 'cubic-bezier(.6,0,.2,1)' });
    await C.anim(fly, [{ transform: above, opacity: 1 }, { transform: inside, opacity: 1 }], { duration: 210, easing: 'cubic-bezier(.5,0,1,.6)' });
    fly.style.visibility = 'hidden';
    C.anim(pj, [{ transform: 'translate(-50%,0%)' }, { transform: 'translate(-50%,5px)' }, { transform: 'translate(-50%,0%)' }], { duration: 180, easing: 'ease-out' });
    await C.wait(260); placeBeam(); booth.classList.add('lit');
    await C.wait(520); booth.classList.add('open'); $('#scr-body').focus({ preventScroll: true });
  }
  /* carousel advance: the lamp dips, the slide changes in place, the lamp flickers back on. About 450ms. */
  let want = null;
  async function swapSlide(item, dir) {
    const ci = colOf(item.col).index, el = slides[ci][item.index]; if (!el || !opened) return;
    const old = opened.el; el.scrollIntoView({ block: 'nearest' });
    if (!C.reduced) await C.anim(proj, [{ opacity: 1, transform: 'translateX(0)', filter: 'brightness(1)' }, { opacity: .05, transform: 'translateX(' + (-4 * dir) + '%)', filter: 'brightness(.3) blur(3px)' }], { duration: 150, easing: 'ease-in' });
    fill(item, ci); $('#cp-live').textContent = item.title + ', slide ' + item.no + ' of ' + cols[ci].items.length; old.classList.remove('gone'); el.classList.add('gone');
    Object.assign(opened, geom(el), { item }); fly.style.visibility = 'hidden'; placeBeam();
    if (!C.reduced) {
      [...cap.children].forEach((c) => C.anim(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' }));
      await C.anim(proj, [{ opacity: .1, transform: 'translateX(' + (4 * dir) + '%)', filter: 'brightness(1.8) blur(10px)' }, { opacity: 1, transform: 'translateX(0)', filter: 'brightness(1) blur(0)' }], { duration: 300, easing: 'cubic-bezier(.3,.7,.2,1)' });
      [proj, ...cap.children].forEach((e) => e.getAnimations().forEach((x) => x.cancel()));
    }
    if (want === item) want = null;
  }
  function pressed(q) { const b = $(q); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), C.reduced ? 0 : 160); }
  function page(d) {
    if (!opened) return;
    const base = want || opened.item, n = cols[colOf(base.col).index].items[base.index + d];
    if (!n) return;
    pressed(d < 0 ? '#pj-prev' : '#pj-next'); want = n; C.replace(n);
  }
  async function closeSlide() {
    const st = opened; if (!st) return; opened = null; want = null;
    const sci = colOf(st.item.col).index, sp = pageFor(st.item);
    if (pageOf[sci] !== sp || st.el.classList.contains('off')) { /* the projector paged past the table's page: show the page that holds this slide first */
      showPage(sci, sp); st.el.scrollIntoView({ block: 'nearest' }); Object.assign(st, geom(st.el)); fly.style.visibility = 'hidden';
    }
    booth.classList.remove('open', 'lit'); await C.wait(200);
    C.anim(screen, [{ transform: 'translateY(0%)' }, { transform: 'translateY(-102%)' }], { duration: 520, easing: 'cubic-bezier(.6,0,.6,1)' });
    fly.style.visibility = '';
    await C.anim(fly, [{ transform: st.inside }, { transform: st.above }], { duration: 200, easing: 'ease-out' });
    C.anim(dark, [{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'ease' });
    C.anim(pj, [{ transform: 'translate(-50%,0%)' }, { transform: 'translate(-50%,120%)' }], { duration: 520, delay: 200, easing: 'ease-in' });
    await C.anim(fly, [{ transform: st.above }, { transform: st.lifted }], { duration: 560, easing: 'cubic-bezier(.6,0,.2,1)' });
    await C.anim(fly, [{ transform: st.lifted }, { transform: st.from }], { duration: 200 });
    st.el.classList.remove('gone'); booth.hidden = true; outside().forEach((e) => { e.inert = false; }); $('#cp-live').textContent = ''; document.body.classList.remove('showing');
    [fly, dark, pj, screen].forEach((e) => { e.getAnimations().forEach((a) => a.cancel()); e.style.transform = ''; e.style.opacity = ''; });
    st.el.focus({ preventScroll: true });
  }

  function onRoute(r, first) {
    const col = colOf(r.col), item = r.item ? itemOf(col, r.item) : null;
    busy = busy.then(async () => {
      if (opened && item && opened.item !== item && item.col === opened.item.col) { await swapSlide(item, item.index > opened.item.index ? 1 : -1); return; }
      if (opened && (!item || opened.item !== item)) await closeSlide();
      const moved = col.index !== cur || first;
      if (moved) setTable(col.index, first);
      if (item && !opened) { if (pageOf[col.index] !== pageFor(item)) showPage(col.index, pageFor(item)); await C.wait(first ? 450 : moved ? 950 : 0); await openSlide(item); }
    });
    return busy;
  }
  C.onRoute((r) => { onRoute(r, false); });

  rail.addEventListener('click', (e) => {
    const t = e.target.closest('.table'); if (!t) return;
    const ci = tables.indexOf(t); if (ci !== cur) { C.go(cols[ci].id); return; }
    const pg = e.target.closest('.tb-pg');
    if (pg) { if (pg.getAttribute('aria-disabled') !== 'true') changePage(ci, pageOf[ci] + (+pg.dataset.d)); return; }
    const s = e.target.closest('.slide'); if (s) C.open(cols[cur].items[+s.dataset.i]);
  });
  const shift = (d) => { const n = cols[cur + d]; if (n) C.go(n.id); };
  $('#prev-col').onclick = () => shift(-1); $('#next-col').onclick = () => shift(1);
  $('#pj-prev').onclick = () => page(-1); $('#pj-next').onclick = () => page(1);
  $('#bt-close').onclick = () => C.close(); $('#pj-power').onclick = () => C.close(); dark.onclick = () => C.close();
  C.swipe(room, (d) => { if (!opened) shift(d); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { C.close(); return; }
    if (opened && e.key === 'Tab') { /* cycle inside the booth, including from the screen body, which is not a tab stop */
      const f = tabStops(), i = f.indexOf(document.activeElement);
      if (!f.length) { e.preventDefault(); return; }
      if (e.shiftKey ? i <= 0 : i < 0 || i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
      return;
    }
    if (opened) { if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); page(e.key === 'ArrowRight' ? 1 : -1); } return; }
    if (e.target instanceof Element && e.target.closest('.cu-top, .cu-chips, .tb-pager')) return;
    const k = e.key, list = slides[cur].filter((s) => !s.classList.contains('off')), i = list.indexOf(document.activeElement);
    if (k === 'PageUp' || k === 'PageDown' || ((k === 'ArrowLeft' || k === 'ArrowRight') && (e.shiftKey || i < 0))) { e.preventDefault(); shift(k === 'ArrowRight' || k === 'PageDown' ? 1 : -1); return; }
    if (i < 0) return;
    let n = -1;
    if (k === 'ArrowRight') n = i + 1; else if (k === 'ArrowLeft') n = i - 1;
    else if (k === 'ArrowDown' || k === 'ArrowUp') { /* nearest slide in the next row */
      const r = list[i].getBoundingClientRect(), cx = r.left + r.width / 2, dir = k === 'ArrowDown' ? 1 : -1; let best = Infinity;
      list.forEach((s, j) => { const q = s.getBoundingClientRect(), dy = (q.top - r.top) * dir; if (dy > 20) { const sc = dy * 3 + Math.abs(q.left + q.width / 2 - cx); if (sc < best) { best = sc; n = j; } } });
    }
    if (n >= 0 && list[n]) { e.preventDefault(); list[n].focus(); }
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { layout(); if (opened) placeBeam(); }, 80); });
  onRoute(C.route(), true).catch(() => {}).then(C.ready);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.addEventListener('load', layout);
  if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(headBottom() - (parseFloat(document.documentElement.style.getPropertyValue('--headH')) || 0)) > 0.01) layout(); }).observe(head);
}
