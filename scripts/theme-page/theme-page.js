/* Dev only theme page. Draws the brand, posters, fonts and scene colours from live data and the site's own shared modules. */
import { buildPalette, contrast, normalizeBrand } from './js/palette.js';
import { NAMES, poster } from './js/kit.js';
import { rng } from './js/seed.js';

const root = document.documentElement;
const errs = [];
function noteErr(m) { errs.push(String(m)); root.setAttribute('data-errors', errs.join(' | ')); }
window.addEventListener('error', (e) => noteErr(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => noteErr('rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const up = (h) => String(h).toUpperCase();
const pad = (n) => String(n + 1).padStart(2, '0');
const pct = (v) => Math.round(v * 100) + '%';
const stack = (family, fallback) => (family ? "'" + String(family).replace(/['"\\;{}<>]/g, '') + "', " : '') + fallback;

/* the same noise tile and kit-grain pattern that core.js defines, which cannot be imported because it boots the site */
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
  document.body.insertAdjacentHTML('afterbegin', '<svg id="kit-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><pattern id="kit-grain" width="128" height="128" patternUnits="userSpaceOnUse"><image href="' + url + '" width="128" height="128"/></pattern></defs></svg>');
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return res.json();
}

/* the site's own head: font links, base.css and the theme block come from the built home page */
async function adopt() {
  const res = await fetch('/');
  if (!res.ok) throw new Error('the home page answered ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const mine = $('tp-css');
  doc.head.querySelectorAll('link[rel="preconnect"], link[rel="stylesheet"], style#curator-theme').forEach((el) => {
    const href = el.getAttribute('href') || '';
    if (/\/scenes\//.test(href)) return;
    const copy = document.createElement(el.tagName.toLowerCase());
    for (const a of el.attributes) copy.setAttribute(a.name, a.value);
    copy.textContent = el.textContent;
    document.head.insertBefore(copy, mine);
  });
}

function main(site, data) {
  const which = new URLSearchParams(location.search).get('brand') === 'sample' ? 'sample' : 'configured';
  const active = data.brands[which];
  const brand = normalizeBrand(active.brand), N = brand.neutral, R = active.roles, posters = active.posters;
  const types = site.types;
  $('tp-title').textContent = site.site.title;

  /* brand-driven variables for the chosen brand, named exactly as the build names them */
  const decl = ['button-visit-fill:' + R.visit.fill, 'button-visit-hover:' + R.visit.hover, 'button-visit-pressed:' + R.visit.pressed, 'button-visit-text:' + R.visit.text, 'chrome-pill-on-fill:' + R.pill.fill, 'chrome-pill-on-text:' + R.pill.text, 'chrome-focus:' + R.focus, 'chrome-arrow-fill:' + R.arrow.fill, 'chrome-arrow-icon:' + R.arrow.icon]
    .concat(Object.entries(R.dots).map(([t, v]) => 'dot-' + t + ':' + v));
  const style = document.createElement('style');
  style.textContent = ':root{' + decl.map((d) => '--' + d).join(';') + '}';
  document.head.appendChild(style);

  /* brand switch */
  $('switch').innerHTML = [['configured', '', data.brands.configured.name], ['sample', '?brand=sample', data.brands.sample.name]]
    .map((b) => '<a href="' + b[1] + (b[1] ? '' : '?brand=configured') + '"' + (b[0] === which ? ' aria-current="true"' : '') + '>' + esc(b[2]) + '</a>').join('');
  $('active').textContent = 'Showing: ' + active.name + (which === 'sample' ? ', from docs/examples/sample-brand.json.' : ', from the brand in curator.config.json.');

  /* brand tokens */
  const sw = (name, meta, value) => '<div class="sw"><i style="background:' + value + '"></i><span><b>' + esc(name) + '</b>' + esc(meta) + ' <em>' + up(value) + '</em></span></div>';
  $('brandnote').textContent = active.name + ' has ' + brand.primary.length + ' primary, ' + brand.secondary.length + ' secondary and ' + brand.accent.length + ' accent colours, plus light and dark neutrals. Surface and muted are derived from the neutrals when the config leaves them out.';
  $('brand').innerHTML = brand.primary.map((e) => sw(e.name, 'Primary', e.value))
    .concat(brand.secondary.map((e) => sw(e.name, 'Secondary', e.value)), brand.accent.map((e) => sw(e.name, 'Accent', e.value)), ['light', 'dark', 'surface', 'muted'].map((n) => sw(n.charAt(0).toUpperCase() + n.slice(1), 'Neutral', N[n]))).join('');
  const pairs = posters.avoidPairs || [], excl = posters.excludeFromPosters || [];
  $('rules').textContent = 'Avoid pairs: ' + (pairs.length ? pairs.map((p) => p.join(' with ')).join(', ') : 'none') + '. Kept out of posters: ' + (excl.length ? excl.join(', ') : 'none') + '.';

  /* scene roles */
  const ratio = (a, b) => contrast(a, b).toFixed(2) + ' to 1';
  const chip = (v) => '<i class="ring" style="background:' + v + '"></i>';
  const roleCards = [
    '<div class="role"><h4>Visit button</h4><span class="demo" style="background:' + R.visit.fill + ';color:' + R.visit.text + '">Visit link</span><br>Fill ' + up(R.visit.fill) + ', text ' + up(R.visit.text) + '<br>Contrast <span class="ratio">' + R.visit.contrast.toFixed(2) + ' to 1</span><br>Hover ' + up(R.visit.hover) + ', pressed ' + up(R.visit.pressed) + '</div>',
    '<div class="role"><h4>Active collection item</h4><span class="demo" style="background:' + R.pill.fill + ';color:' + R.pill.text + '">Collection</span><br>Fill ' + up(R.pill.fill) + ', text ' + up(R.pill.text) + '<br>Contrast <span class="ratio">' + ratio(R.pill.text, R.pill.fill) + '</span><br>The first accent, else primary 1</div>',
    '<div class="role"><h4>Focus ring</h4>' + chip(R.focus) + '<br>' + up(R.focus) + ', the first accent, else primary 1</div>',
    '<div class="role"><h4>Type dots</h4><div class="dots">' + types.map((t) => '<span><u style="background:' + R.dots[t.name] + '"></u>' + esc(t.label) + ' ' + up(R.dots[t.name]) + '</span>').join('') + '</div></div>',
  ];
  $('roles').innerHTML = roleCards.join('') + R.warnings.map((w) => '<div class="role"><h4>Warning</h4>' + esc(w) + '</div>').join('');

  /* posters */
  const items = site.collections.flatMap((c) => c.items);
  const pal = buildPalette(brand, posters);
  const fonts = { band: stack(site.fonts.poster, "'Helvetica Neue', Arial, sans-serif"), mono: stack(site.fonts.mono, 'ui-monospace, monospace') };
  const fig = (item, v, w, h, P, label, extra) => '<figure><div class="frame">' + poster(item, w, h, P, { v, fonts }) + '</div><figcaption><b><i>' + pad(v) + '</i>' + esc(label) + '</b><span>' + esc(extra) + '</span></figcaption></figure>';
  const dots = (list) => '<div class="dots">' + list.map((e) => '<span><u style="background:' + e.value + '"></u>' + esc(e.name) + '</span>').join('') + '</div>';
  const sets = [['light', 'Light set', 'Paper is the light or surface neutral. Inks come from every brand colour and the dark neutral.'], ['inverse', 'Inverse set', 'Paper is the dark neutral or a primary. Inks come from the brand colours, the dark neutral and the light neutral, wherever they read on that paper.']];
  $('sets').innerHTML = sets.map((s) => {
    const S = pal.inkSets[s[0]];
    return '<div class="set" id="set-' + s[0] + '"><h3>' + s[1] + '</h3><p>' + s[2] + '</p><div class="papers">' + S.papers.map((p, i) => '<div class="paper"><i style="background:' + p.value + '"></i><div><b>Paper: ' + esc(p.name) + ' ' + up(p.value) + '</b>Inks that read on it:' + dots(S.pool[i]) + '</div></div>').join('') + '</div><div class="grid4" id="ex-' + s[0] + '"></div></div>';
  }).join('');
  sets.forEach((s, i) => {
    const picks = items.filter((it) => pal.palette(it.key).set === s[0]).slice(0, 4);
    $('ex-' + s[0]).innerHTML = picks.map((it) => { const P = pal.palette(it.key); return fig(it, (i * 4 + picks.indexOf(it)) % NAMES.length, 600, 400, P, P.names[0] + ' paper', P.names.slice(1).join(', ')); }).join('') || '<p class="note">No poster in the current content uses this set.</p>';
  });

  /* stats against targets */
  const st = pal.stats(items.map((it) => it.key));
  const target = { primary: posters.primaryShare, inverse: posters.inverseShare, min: posters.minContrast };
  const row = (name, measured, goal, ok) => '<tr><td>' + name + '</td><td>' + measured + '</td><td>' + goal + '</td><td class="' + (ok === null ? '' : ok ? 'ok' : 'bad') + '">' + (ok === null ? 'close is fine' : ok ? 'met' : 'missed') + '</td></tr>';
  $('stats').innerHTML = '<table class="stats"><thead><tr><th>Measure</th><th>Measured</th><th>Target</th><th>Result</th></tr></thead><tbody>'
    + row('Primary share of colour use', pct(st.primaryShare), pct(target.primary), null)
    + row('Posters on the inverse set', pct(st.inverseShare), pct(target.inverse), null)
    + row('Lowest ink to paper contrast', st.minContrast.toFixed(2) + ' to 1', 'at least ' + target.min + ' to 1', st.minContrast >= target.min)
    + row('Avoided pairs together', String(st.violations), '0', st.violations === 0)
    + '</tbody></table><p class="note" id="stats-line">Across the ' + st.items + ' item titles in the content folder, ' + st.noPrimary + ' posters have no primary colour. Both shares are calibrated to land near their targets over many items, so a small collection can sit a little off.</p>';

  /* fonts */
  const rootCss = getComputedStyle(root);
  const FONTS = [
    ['display', '--f-serif', 'Titles, the wordmark and body copy on this page'],
    ['body', '--f-sans', 'Interface text'],
    ['mono', '--f-mono', 'Labels, numbers and the poster domain line'],
    ['poster', '--f-poster', 'Poster title band and the headlines on this page'],
    ['typewriter', '--f-type', 'Typed captions on the light table slides'],
    ['handwriting', '--f-hand', 'Handwritten captions on the light table slides'],
  ];
  $('fonts').innerHTML = FONTS.map((f) => '<div class="font"><p class="spec" style="font-family:var(' + f[1] + ')">Sphinx of black quartz, judge my vow 0123456789</p><div class="fam">' + esc(f[0]) + ': ' + esc(site.fonts[f[0]]) + '</div><div class="use">' + esc(f[2]) + ' <br>' + esc(rootCss.getPropertyValue(f[1]).trim()) + '</div></div>').join('');

  /* scene colours: role tokens take the active brand's computed value */
  const roleValue = { 'button-visit-fill': R.visit.fill, 'button-visit-hover': R.visit.hover, 'button-visit-pressed': R.visit.pressed, 'button-visit-text': R.visit.text, 'chrome-pill-on-fill': R.pill.fill, 'chrome-pill-on-text': R.pill.text, 'chrome-focus': R.focus, 'chrome-arrow-fill': R.arrow.fill, 'chrome-arrow-icon': R.arrow.icon };
  const groups = new Map();
  data.tokens.forEach((t) => { const g = t.name.split('-')[0]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); });
  $('scene').innerHTML = [...groups].map(([g, list]) => '<h3>' + esc(g.charAt(0).toUpperCase() + g.slice(1)) + '</h3>' + list.map((t) => {
    const isRole = data.roleTokens.includes(t.name), over = which === 'configured' && Object.prototype.hasOwnProperty.call(data.overrides, t.name);
    const value = isRole ? roleValue[t.name] : over ? data.overrides[t.name] : t.value;
    return '<div class="row' + (isRole ? ' is-role' : '') + (over ? ' is-over' : '') + '"><div class="chips"><i style="background:' + esc(value) + '"></i></div><div><b>--' + esc(t.name) + (isRole ? '<span class="tag">role</span>' : '') + (over ? '<span class="tag">overridden</span>' : '') + '</b><small>' + esc(t.comment) + '</small></div><div>' + esc(value) + (over ? ' <s>default ' + esc(t.value) + '</s>' : '') + '</div></div>';
  }).join('')).join('');

  /* the sixteen, then one item in every composition */
  const itemP = (it) => pal.palette(it.key);
  $('all').innerHTML = NAMES.map((n, v) => { const it = items[v % items.length]; return fig(it, v, 600, 400, itemP(it), n, it.title); }).join('');
  const one = items.find((it) => !it.image) || items[0];
  $('mixnote').textContent = 'The same link, "' + one.title + '", drawn in every composition. The inks stay the same, only the arrangement changes.';
  $('mix-slide').innerHTML = NAMES.map((n, v) => fig(one, v, 300, 200, itemP(one), n, one.title)).join('');}

(async () => {
  try {
    const [site, data] = await Promise.all([getJson('/data/site.json'), getJson('./data.json'), adopt()]).then((r) => [r[0], r[1]]);
    grain();
    main(site, data);
    await document.fonts.ready;
    root.dataset.ready = '1';
  } catch (e) {
    noteErr('load: ' + ((e && e.message) || e));
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<p class="note">The theme page could not load: ' + esc((e && e.message) || e) + '</p>');
  }
})();
