import { launch } from './lib/cdp.mjs';
import { argValue, openSite, requireBrowser } from './lib/headless.mjs';

// --only <name> runs one page. A page listed in OWN_SITE runs on its own temp build: of tests/fixtures/<fixture> when set, else of the repo, with advanced merged in.
const ALL = ['focus', 'disabled', 'dialog', 'srlist', 'reduced', 'motionoff', 'title', 'contrast', 'taptargets', 'click', 'projector', 'power', 'tablepage', 'deeplink', 'filter', 'back', 'keyboard', 'routes', 'types', 'headh', 'tableheight', 'tableheight4', 'onetable', 'theme', 'menu'];
const OWN_SITE = {
  motionoff: { advanced: { scene: { motion: 'off' } } },
  types: { advanced: { types: { repo: { label: 'Project', dot: 'accent.1' } } } },
  // Table heights need one collection longer than a page and one shorter, whatever the repo content holds.
  tableheight: { fixture: 'tables' },
  tableheight4: { fixture: 'tables', advanced: { scene: { pageSize: 4 } } },
};
const TIMEOUT_MS = 60000;
// DevTools methods a test page may request through the harness bridge, plus press for real key presses.
const ALLOWED = new Set(['Accessibility.getFullAXTree', 'Emulation.setEmulatedMedia']);
const PROBE = `(() => { const r = document.getElementById('R'); return JSON.stringify({ done: !!r && r.textContent.trim() !== 'pending', reqs: window.H && window.H.take ? window.H.take() : [] }); })()`;

// Runs one bridge request from the page and answers it.
async function serve(page, req) {
  let reply;
  try {
    if (req.method === 'press') {
      await page.press(req.params.key, req.params);
      reply = { result: null };
    } else if (ALLOWED.has(req.method)) {
      const params = { ...req.params };
      if (req.frame) params.frameId = (await page.send('Page.getFrameTree')).frameTree.childFrames[0].frame.id;
      reply = { result: await page.send(req.method, params) };
    } else reply = { error: `method ${req.method} is not allowed` };
  } catch (e) {
    reply = { error: e.message };
  }
  await page.evaluate(`window.H.give(${req.id}, ${JSON.stringify(JSON.stringify(reply))})`);
}

const args = process.argv.slice(2);
const only = argValue(args, '--only');
const PAGES = only ? ALL.filter((n) => n === only) : ALL;
const browserPath = requireBrowser();
const site = await openSite(argValue(args, '--url'));

const fail = (name, check, detail) => ({ name, pass: false, checks: [{ name: check, pass: false, detail }] });

// Loads one test page in real time and reads the JSON it wrote into <pre id="R">.
async function runPage(browser, name, site) {
  const page = await browser.newPage({ width: 1600, height: 1000 });
  try {
    await page.goto(`${site.base}/__tests/${name}.html`);
    try {
      const end = Date.now() + TIMEOUT_MS;
      for (;;) {
        const probe = JSON.parse(await page.evaluate(PROBE));
        if (probe.done) break;
        if (Date.now() > end) throw new Error('timed out');
        for (const req of probe.reqs) await serve(page, req);
        if (!probe.reqs.length) await new Promise((r) => setTimeout(r, 30));
      }
    } catch {
      const tail = page.logs.slice(-20).map((l) => `console ${l}`);
      const errs = page.errors.map((e) => `exception ${e.split('\n')[0]}`);
      return fail(name, 'page finished', `no result after ${TIMEOUT_MS / 1000}s${[...tail, ...errs].map((l) => `\n         ${l}`).join('')}`);
    }
    const text = String(await page.evaluate(`document.getElementById('R').textContent`)).trim();
    try {
      return JSON.parse(text);
    } catch {
      return fail(name, 'result is JSON', text.slice(0, 200));
    }
  } catch (e) {
    return fail(name, 'page ran', e.message);
  } finally {
    await page.close();
  }
}

let failed = 0;
let browser = null;
try {
  // Outside hosts never resolve, so a slow font request cannot hold a page back.
  browser = await launch(browserPath, { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  for (const name of PAGES) {
    let own = null;
    let result;
    try {
      if (OWN_SITE[name] && !argValue(args, '--url')) own = await openSite(null, OWN_SITE[name]);
      result = await runPage(browser, name, own || site);
    } finally {
      await own?.close();
    }
    console.log(`${result.pass ? 'ok  ' : 'FAIL'} ${name}`);
    if (!result.pass) {
      failed++;
      for (const c of result.checks.filter((x) => !x.pass)) console.log(`       - ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
    }
  }
} catch (e) {
  failed = PAGES.length;
  console.log(`FAIL browser: ${e.message}`);
} finally {
  await browser?.close();
  await site.close();
}
console.log(failed ? `${failed} of ${PAGES.length} browser tests failed.` : `All ${PAGES.length} browser tests passed.`);
process.exit(failed ? 1 : 0);
