// Contrast scan for one loaded frame. window.scanContrast(w) returns one row per distinct text style and background.
(function () {
  const parse = (s) => { if (/^#[0-9a-f]{6}$/i.test(s)) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)).concat(1); const m = /rgba?\(([^)]*)\)/.exec(s); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  // Composites top over bottom, both [r, g, b, a].
  const over = (top, bottom) => { const a = top[3] + bottom[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a); };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('') + (c[3] < 0.995 ? '@' + c[3].toFixed(2) : '');
  const sel = (el) => el.tagName.toLowerCase() + [...el.classList].filter((c) => !/^(on|dim|gone|off)$/.test(c)).map((c) => '.' + c).join('') + (el.id ? '#' + el.id : '');

  window.contrastMath = { parse, over, ratio };
  window.scanContrast = function (w) {
    const d = w.document, rows = new Map();
    const open = !d.getElementById('booth').hidden;
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el) || el.closest('svg, .sr-only, [hidden], script, style, noscript, pre') || el.closest('.table:not(.on)') || (open && el.closest('[inert]'))) continue;
      seen.add(el);
      const s = w.getComputedStyle(el);
      if (!el.getClientRects().length || s.visibility === 'hidden' || s.display === 'none') continue;
      // Walk up for the first opaque background, noting opacity on the way and any image or gradient layer.
      let fg = parse(s.color), opacity = 1, manual = null;
      const layers = [], grads = [];
      let reachedOpaque = false;
      for (let a = el; a; a = a.parentElement) {
        const as = w.getComputedStyle(a);
        const bg = parse(as.backgroundColor);
        if (as.backgroundImage !== 'none' && !reachedOpaque) { manual = manual || 'a gradient or image sits behind it on ' + sel(a); grads.push((as.backgroundImage.match(/rgba?\([^)]*\)/g) || []).map(parse)); }
        if (bg[3] > 0) { layers.push(bg); if (bg[3] >= 0.995) reachedOpaque = true; }
        const o = Number(as.opacity);
        if (o < 1) { if (reachedOpaque || layers.length) manual = manual || 'opacity ' + o + ' on the background element ' + sel(a); else opacity *= o; }
        if (reachedOpaque) break;
      }
      if (!reachedOpaque) layers.push([255, 255, 255, 1]);
      if (opacity <= 0.01) continue;
      let bgc = layers[layers.length - 1];
      for (let i = layers.length - 2; i >= 0; i--) bgc = over(layers[i], bgc);
      // With a gradient behind the text the row is a manual check. The ratio reported is the lowest against the base colour and every gradient stop, which bounds the real value.
      const cands = grads.length && grads.every((g) => g.length && g.every((c) => c[3] >= 0.995)) ? [] : [bgc];
      grads.forEach((g) => g.forEach((c) => cands.push(over(c, bgc))));
      if (!cands.length) cands.push(bgc);
      const fgc = fg;
      const at = (b) => ratio(over([fgc[0], fgc[1], fgc[2], fgc[3] * opacity], b), b);
      bgc = cands.reduce((worst, b) => (at(b) < at(worst) ? b : worst), cands[0]);
      fg = over([fgc[0], fgc[1], fgc[2], fgc[3] * opacity], bgc);
      const px = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700, large = px >= 24 || (px >= 18.66 && bold);
      const r = ratio(fg, bgc);
      const key = [sel(el), el.parentElement ? sel(el.parentElement) : '', hex(fg), hex(bgc), manual || ''].join('|');
      if (!rows.has(key)) rows.set(key, { el: sel(el), parent: el.parentElement ? sel(el.parentElement) : '', text: n.nodeValue.trim().slice(0, 24), fg: hex(fg), bg: hex(bgc), ratio: Math.round(r * 100) / 100, large, need: large ? 3 : 4.5, manual, count: 0 });
      rows.get(key).count++;
    }
    return [...rows.values()];
  };
})();
