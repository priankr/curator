// Only the current table is ever on screen, at rest, at every width.
async function oneTableChecks(t) {
  const site = await t.site(), n = site.collections.length;
  t.check('there are at least two collections', n >= 2, n);
  const rest = (c, label) => {
    const w = c.w.innerWidth, bad = [];
    c.$$('.table').forEach((el) => { if (el.classList.contains('on')) return; const r = el.getBoundingClientRect(); if (!(r.right <= 0 || r.left >= w)) bad.push(Math.round(r.left) + '..' + Math.round(r.right)); });
    t.check(label + 'no neighbour table is on screen', bad.length === 0 && c.$$('.table.on').length === 1, bad.join(', ') + ' of ' + w);
    const root = c.d.documentElement;
    t.check(label + 'the page does not scroll sideways', root.scrollWidth <= w && c.d.body.scrollWidth <= w, root.scrollWidth + ' of ' + w);
  };
  for (const width of [1440, 1024, 390]) {
    const label = width + 'px: ';
    const c = await t.load('/?still=1', width, 844);
    await c.d.fonts.ready; await t.sleep(300);
    rest(c, label + 'on load, ');
    for (let i = 0; i < n - 1; i++) {
      const before = c.$('#h-title').textContent;
      c.$('#next-col').click();
      await t.waitFor(() => c.$('#h-title').textContent !== before, 5000); await t.sleep(1300);
      rest(c, label + 'after next ' + (i + 1) + ', ');
    }
    for (let i = 0; i < n - 1; i++) {
      const before = c.$('#h-title').textContent;
      c.$('#prev-col').click();
      await t.waitFor(() => c.$('#h-title').textContent !== before, 5000); await t.sleep(1300);
      rest(c, label + 'after prev ' + (i + 1) + ', ');
    }
  }
}
