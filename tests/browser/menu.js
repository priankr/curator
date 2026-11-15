// The collections menu: closed on load, opens on click, chooses, and closes on Escape, an outside click and Tab, at desktop and phone width.
async function menuChecks(t) {
  const site = await t.site();
  const def = site.collections.find((c) => c.id === site.defaultCollection), other = site.collections.find((c) => c.id !== def.id);
  t.check('there are at least two collections', site.collections.length >= 2, site.collections.length);
  const built = async (path) => new DOMParser().parseFromString(await (await fetch(path)).text(), 'text/html').title;
  const c = await t.load('/?still=1', 1440, 900);
  const btn = c.$('.cu-menu-btn'), panel = c.$('#cu-menu-panel');
  const open = () => btn.getAttribute('aria-expanded') === 'true' && !panel.hidden;
  t.check('the menu button is labelled and points at the panel', !!btn && btn.getAttribute('aria-label') === 'Collections' && btn.getAttribute('aria-controls') === 'cu-menu-panel', '');
  t.check('closed on load', panel.hidden && btn.getAttribute('aria-expanded') === 'false', 'hidden=' + panel.hidden);
  t.check('every collection is a row', c.$$('.cu-col', panel).length === site.collections.length, c.$$('.cu-col', panel).length);

  btn.click(); await t.sleep(250);
  t.check('click opens the panel', open(), btn.getAttribute('aria-expanded'));
  const cur = c.$('.cu-col.on', panel);
  t.check('the current item has aria-current', !!cur && cur.dataset.col === def.id && cur.getAttribute('aria-current') === 'true', cur && cur.dataset.col);
  t.check('opening focuses the current item', c.d.activeElement === cur, c.name(c.d.activeElement));
  const r = panel.getBoundingClientRect(), br = btn.getBoundingClientRect();
  t.check('the panel sits under the button and right aligned', r.top >= br.bottom && Math.abs(r.right - br.right) <= 2, Math.round(r.top) + ' vs ' + Math.round(br.bottom) + ', right ' + Math.round(r.right) + ' vs ' + Math.round(br.right));
  btn.click(); await t.sleep(100);
  t.check('clicking the button again closes', !open() && panel.hidden, '');

  btn.click(); await t.sleep(250);
  await t.press('ArrowDown');
  const rows = c.$$('.cu-col', panel), i = rows.indexOf(cur);
  t.check('ArrowDown moves focus to the next row', c.d.activeElement === rows[(i + 1) % rows.length], c.name(c.d.activeElement));
  await t.press('ArrowUp');
  t.check('ArrowUp moves focus back', c.d.activeElement === cur, c.name(c.d.activeElement));
  const before = c.path(), table = c.$('.table.on').dataset.col;
  await t.press('ArrowRight');
  await t.sleep(400);
  t.check('Left and Right do not switch tables while the menu is open', c.path() === before && c.$('.table.on').dataset.col === table && open(), c.path());

  await t.press('Escape'); await t.sleep(200);
  t.check('Escape closes the menu', !open(), '');
  t.check('Escape returns focus to the button', c.d.activeElement === btn, c.name(c.d.activeElement));
  t.check('Escape changes no route and closes nothing else', c.path() === before && c.isClosed(), c.path() + ' booth hidden=' + c.booth().hidden);

  btn.click(); await t.sleep(250);
  c.$('.cu-head').click(); await t.sleep(150);
  t.check('an outside click closes the menu', !open(), '');

  btn.click(); await t.sleep(250);
  for (let k = 0; k < rows.length + 1 && open(); k++) await t.press('Tab');
  t.check('tabbing out of the panel closes it', !open(), c.name(c.d.activeElement));

  btn.click(); await t.sleep(250);
  c.$('.cu-col[data-col="' + other.id + '"]', panel).click();
  await t.waitFor(() => c.path() === '/' + other.id + '/', 5000);
  await t.sleep(300);
  const want = await built(c.path());
  t.check('choosing a collection navigates and sets the title', c.path() === '/' + other.id + '/' && c.d.title === want, c.path() + ' ' + c.d.title);
  t.check('choosing closes the menu and focuses the button', !open() && c.d.activeElement === btn, c.name(c.d.activeElement));
  btn.click(); await t.sleep(250);
  t.check('the new current item is marked', c.$('.cu-col.on', panel).dataset.col === other.id && c.d.activeElement === c.$('.cu-col.on', panel), c.name(c.d.activeElement));
  c.w.history.back();
  await t.waitFor(() => c.path() === '/', 5000);
  t.check('a route change closes the menu', !open(), c.path());

  const p = await t.load('/?still=1', 390, 844);
  const pb = p.$('.cu-menu-btn');
  pb.click(); await t.sleep(250);
  const pr = p.$('#cu-menu-panel').getBoundingClientRect(), pw = p.w.innerWidth;
  t.check('390px: the panel fits inside the viewport', pr.left >= 0 && pr.right <= pw, Math.round(pr.left) + '..' + Math.round(pr.right) + ' of ' + pw);
  const short = p.$$('#cu-menu-panel .cu-col').filter((e) => e.getBoundingClientRect().height < 40).map(p.name);
  t.check('390px: every row is at least 40px tall', short.length === 0, short.join(', '));
  const bb = pb.getBoundingClientRect();
  t.check('390px: the button is at least 40px', bb.width >= 40 && bb.height >= 40, bb.width + 'x' + bb.height);
}
