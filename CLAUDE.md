# Curator: Agent Instructions

Curator turns Markdown files of links and notes into a static site where each link is a 35mm slide on a light table, opened on a projector screen. Read `docs/ARCHITECTURE.md` for how the code is built before any feature work.

---

## Commands

| Command | Use |
|---------|-----|
| `npm run dev` | Build, serve on `http://localhost:4321` and rebuild on change |
| `npm run build` | Production build into `dist/` |
| `npm run check` | Validate config and content without writing output |
| `npm test` | Unit tests (`node --test`) |
| `npm run test:browser` | Browser tests in headless Chrome or Edge (see the testing section of `docs/ARCHITECTURE.md`). `--only <name>` runs one page, `--url <base>` tests a running server |
| `npm run shots` | Screenshots into `.cache/shots/` (`--out <dir>` to change) |
| `npm run perf` | Measure the performance requirements in `docs/ARCHITECTURE.md` |
| `npm run docs` | Regenerate `docs/CONFIG.md` from the schema and the colour tokens |

`check` and `build` take `--offline` to use the image and font caches only. The browser tests, shots and perf build offline.

Node 20 or newer. Never add runtime dependencies. Dev dependencies need a clear reason, stated in the PR.

---

## Where Things Live

| Path | Contents |
|------|----------|
| `curator.config.json` | All settings, split into `basic` and `advanced` |
| `content/` | Collections, one Markdown file each, plus uploaded images |
| `src/js/` | Front end core, type registry, palette and poster kit |
| `src/scenes/lighttable/` | The light table scene |
| `scripts/` | Build, dev server and their helpers |
| `tests/` | Unit tests, fixtures and the browser test pages (`tests/browser/`) |
| `docs/` | INDEX, GETTING-STARTED, CONFIG, DEPLOY, ARCHITECTURE and examples |

---

## Rules

- **Plain JavaScript:** ES modules only, with no framework, bundler or TypeScript.
- **Shared modules:** `src/js/types.js`, `seed.js`, `palette.js`, `kit.js` and `title.js` run in both the browser and Node, so they must not touch the DOM or import `node:` modules.
- **Design values:** every colour, font and timing comes from config or a CSS custom property with a default. Never hard-code a new colour in a component.
- **Brand neutrality:** never name a real company or brand in code, tests or docs. Example brands are called "Sample brand".
- **Copy:** visible text and documentation never use em dashes, en dashes or semicolons. Use commas, colons or separate sentences.
- **Markdown docs:** softwrap them, with each paragraph as one line.
- **Cross references:** when a link points to a section of another doc, name the section in the link text, for example [Domains in DEPLOY.md](docs/DEPLOY.md#domains). Never link the same file twice with bare file names.
- **Doc readability:** tell the reader what to do. Leave out what they do not need to do. Keep requirements, steps and reference in their own sections. Write for a person and their agent alike, with no section addressed to agents only.
- **Comments:** keep them to one line, stating a constraint at the point of use. Reasoning belongs in `docs/`.
- **Behaviour changes:** when behaviour changes, update `docs/ARCHITECTURE.md` in the same change. Run `npm run docs` when the schema or colour tokens change.
- **Commits:** do not commit or push unless asked.

---

## Verifying Changes

For a change to `content/` or `curator.config.json` only, run `npm run check` and look at the result on `npm run dev`.

For a change to code, styles, the build or the schema:

1. Run `npm test` and `npm run check`.
2. Run `npm run test:browser` (see the testing section of `docs/ARCHITECTURE.md`). Every page must pass, including click, Escape, projector paging and table paging.
3. Run `npm run shots` and look at the table and an open item at 1440x900 and 1280x720, and the phone page.

Know these headless browser quirks before trusting a result:

- **Animations:** they never finish in headless mode. Use `?still=1` for screenshots. Every animation in code has a timer fallback, so functional tests still complete.
- **Phone width:** headless Chromium and Edge will not lay out narrower than about 500px. Check phone layouts through a page that embeds the site in a 390px iframe.
- **Readiness:** the scene builds after fetching `site.json`, so the load event fires before any slide, image or web font exists. Wait for `html[data-ready="1"]`, which the scene sets once its first route has settled, then for fonts and images. `npm run shots` does this. A blank or broken image after that is a real failure, not server noise.
- **Virtual time:** never use `--virtual-time-budget`. It stalled at random and hung tests. The runner drives Chrome in real time over the DevTools Protocol (`scripts/lib/cdp.mjs`).
- **Screenshot noise:** the open screen at 1280 can differ by a few thousand pixels inside the projector beam between runs, from Chromium compositing its blend mode. Everything else should diff to 0.
- **Clicks:** test them with real `.click()` calls, not only deep links. Deep links skip the click path and have hidden broken click handling before.

Report what you verified and what you could not, especially motion, which only a real browser shows.
