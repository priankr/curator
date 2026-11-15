// Shared by reduced.html and motionoff.html: with motion off, open, page and close are instant and nothing keeps animating.
H.run(document.title, async (t) => {
  const emulated = document.title === 'reduced';
  const site = await t.site();
  if (emulated) await t.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  else t.check('the build has advanced.scene.motion off', site.scene.motion === 'off', site.scene.motion);
  const col = site.collections.find((x) => x.id === site.defaultCollection);
  const c = await t.load('/');
  if (emulated) t.check('the page sees prefers-reduced-motion', c.w.matchMedia('(prefers-reduced-motion: reduce)').matches, '');
  const running = () => c.d.getAnimations().filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty || 'animation') + '@' + (a.effect && a.effect.target ? c.name(a.effect.target) : '?'));

  const slide = c.slides()[6];
  const began = performance.now();
  slide.click();
  const opened = await t.waitFor(c.isOpen, 500, 10);
  t.check('the booth is open within 500 ms of the click', opened, 'after ' + Math.round(performance.now() - began) + ' ms');
  t.check('the path is the item path', c.path() === '/' + col.id + '/' + col.items[6].id + '/', c.path());
  t.check('focus is on the screen body', c.d.activeElement && c.d.activeElement.id === 'scr-body', c.focusName());
  await t.sleep(100);
  t.check('no animation is running while open', running().length === 0, running().join(', '));
  t.check('the caption is fully shown', Number(c.w.getComputedStyle(c.$('.cp-text')).opacity) === 1, c.w.getComputedStyle(c.$('.cp-text')).opacity);

  await t.press('ArrowRight');
  const paged = performance.now();
  const swapped = await t.waitFor(() => c.title() === col.items[7].title, 300, 10);
  t.check('real ArrowRight pages at once', swapped, 'after ' + Math.round(performance.now() - paged) + ' ms');
  t.check('no animation runs after paging', running().length === 0, running().join(', '));
  t.check('the projected picture is fully shown after paging', Number(c.w.getComputedStyle(c.$('#proj')).opacity) === 1 && !c.$('#proj').getAnimations().length, c.w.getComputedStyle(c.$('#proj')).opacity);

  await t.press('Escape');
  const closing = performance.now();
  const closed = await t.waitFor(c.isClosed, 400, 10);
  t.check('the booth closes at once', closed, 'after ' + Math.round(performance.now() - closing) + ' ms');
  await t.sleep(100);
  const back = c.slides()[7];
  t.check('focus returns to the slide', c.d.activeElement === back, c.focusName());
  t.check('the slide is visible again', c.isShown(back), '');
  t.check('no animation is running after close', running().length === 0, running().join(', '));
});
