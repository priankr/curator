// Shared by tableheight.html and tableheight4.html: every table is the height of a full page, in every layout.
async function tableHeightChecks(t) {
  const site = await t.site(), size = site.scene.pageSize, cols = site.collections;
  const big = cols.reduce((a, c) => (c.items.length > a.items.length ? c : a)), small = cols.reduce((a, c) => (c.items.length < a.items.length ? c : a));
  t.check('a collection has more than one page and another has fewer slides', big.items.length > size && small.items.length < big.items.length, big.items.length + ' and ' + small.items.length + ' at page size ' + size);
  const boxes = (c) => c.$$('.table .slides').map((s) => s.getBoundingClientRect().height);
  const same = (a) => a.every((h) => Math.abs(h - a[0]) < 0.5);
  // The natural height of a full page: the lowest slide edge plus the bottom padding.
  const natural = (c) => { const sl = c.$('.table.on .slides'), v = c.visibleSlides(); return Math.max(...v.map((s) => s.offsetTop + s.offsetHeight)) + parseFloat(c.w.getComputedStyle(sl).paddingBottom); };
  const railH = (c) => c.$('#rail').getBoundingClientRect().height;

  for (const [width, phone] of [[1440, false], [390, true], [360, true]]) {
    const label = width + 'px: ';
    const c = await t.load('/' + big.id + '/?still=1', width, 844);
    await c.d.fonts.ready; await t.sleep(300);
    const h = boxes(c), full = natural(c);
    t.check(label + 'the current table shows a full page', c.visibleSlides().length === size, c.visibleSlides().length);
    t.check(label + 'every table has the same height', same(h), h.map(Math.round).join(', '));
    t.check(label + 'that height is the height of a full page of ' + big.id, Math.abs(h[0] - full) < 1.5, h[0] + ' vs ' + full);
    const tb = c.$$('.table')[cols.indexOf(small)].querySelector('.slides').getBoundingClientRect().height;
    t.check(label + small.id + ' with ' + small.items.length + ' slides is as tall as ' + big.id, Math.abs(tb - h[0]) < 0.5, tb + ' vs ' + h[0]);
    const rail = railH(c), tableH = c.$('.table.on').getBoundingClientRect().height;
    t.check(label + 'the rail is as tall as the current table', Math.abs(rail - tableH) < 1, rail + ' vs ' + tableH);

    c.$('.table.on .tb-pg[data-d="1"]').click();
    await t.waitFor(() => c.range().indexOf(String(size + 1)) === 0, 5000); await t.sleep(300);
    t.check(label + 'paging keeps the height', same(boxes(c)) && Math.abs(boxes(c)[0] - h[0]) < 0.5 && Math.abs(railH(c) - rail) < 0.5, boxes(c)[0] + ' vs ' + h[0] + ', rail ' + railH(c) + ' vs ' + rail);

    // Switch tables with the side arrows and keep checking.
    let ok = true, detail = '';
    for (let i = 0; i < cols.length - 1; i++) {
      const before = c.$('#h-title').textContent;
      c.$('#next-col').click();
      await t.waitFor(() => c.$('#h-title').textContent !== before, 5000); await t.sleep(300);
      const r = railH(c), hh = boxes(c);
      if (!same(hh) || Math.abs(hh[0] - h[0]) >= 0.5 || Math.abs(r - rail) >= 1.5) { ok = false; detail += c.$('#h-title').textContent + ': box ' + hh[0] + ' rail ' + r + ' '; }
    }
    t.check(label + 'switching tables keeps the table and rail height', ok, detail + 'rail ' + rail);

    if (phone) {
      await t.sleep(1200);
      const tb2 = c.$('.table.on').getBoundingClientRect(), mid = tb2.left + tb2.width / 2, fw = c.w.innerWidth;
      t.check(label + 'the current table is centred in the frame', Math.abs(mid - fw / 2) < 4 && tb2.left >= 0 && tb2.right <= fw, 'centre ' + mid + ' of ' + fw + ', left ' + tb2.left + ', right ' + tb2.right);
      for (const id of ['#prev-col', '#next-col']) {
        const a = c.$(id).getBoundingClientRect(), fh = c.w.innerHeight;
        t.check(label + id + ' sits at the bottom of the screen', a.top > fh * 0.8 && a.bottom <= fh, 'top ' + a.top + ' bottom ' + a.bottom + ' of ' + fh);
      }
    }
  }
}
