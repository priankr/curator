import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ROLE_TOKENS, collectTokens } from './lib/theme.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = resolve(ROOT, 'src');
const OUT = resolve(ROOT, 'docs', 'CONFIG.md');
const GROUPS = ['page', 'chrome', 'button', 'table', 'glass', 'mount', 'label', 'screen', 'caption', 'beam', 'projector'];
const LONG_DEFAULT = 40;

const cell = (s) => String(s).replace(/\|/g, '\\|');
const code = (s) => '`' + s + '`';
const stripMust = (m) => m.replace(/^must be /, '');

// Plain-words type for a schema node. The schema's own message wins for patterns, lists and unions.
function typeWords(n) {
  if (n.message && n.message.startsWith('must be ') && (n.pattern || n.type === 'array' || n.type === 'object' || n.anyOf)) return stripMust(n.message);
  if (n.enum) return n.enum.map((v) => code(JSON.stringify(v))).join(' or ');
  const types = [].concat(n.type ?? []);
  const nullable = types.includes('null');
  const t = types.find((x) => x !== 'null');
  let w;
  if (t === 'string') w = n.minLength ? 'non-empty text' : 'text';
  else if (t === 'boolean') w = 'true or false';
  else if (t === 'integer' || t === 'number') {
    w = t === 'integer' ? 'whole number' : 'number';
    if (n.minimum !== undefined && n.maximum !== undefined) w += ` from ${n.minimum} to ${n.maximum}`;
    else if (n.minimum !== undefined) w += ` of at least ${n.minimum}`;
  } else if (t === 'array') {
    const items = n.items ?? {};
    if (n.minItems && n.minItems === n.maxItems) w = `${n.minItems === 2 ? 'pair' : n.minItems} of ${typeWords(items)}`;
    else w = `list of ${items.type === 'object' && items.properties ? `{ ${Object.keys(items.properties).join(', ')} } objects` : typeWords(items)}` + (n.minItems ? `, at least ${n.minItems}` : '');
  } else if (t === 'object') {
    w = n.additionalProperties && typeof n.additionalProperties === 'object' ? `object keyed by name, each ${typeWords(n.additionalProperties)}` : 'object';
  } else w = 'any value';
  return nullable ? `${w} or null` : w;
}

// Default as JSON, with long values pointed at the fuller example.
function defaultWords(n, required) {
  if (required) return 'required';
  if (n.default === undefined) return 'none';
  const json = JSON.stringify(n.default);
  return json.length > LONG_DEFAULT ? `${n.default.length} entries, see the fuller example` : code(json);
}

// One table per object that owns leaf settings, in schema order.
function tablesFor(section, name) {
  const found = [];
  const walk = (node, path) => {
    const rows = [];
    const required = node.required ?? [];
    const nested = [];
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const full = `${path}.${key}`;
      if (child.type === 'object' && child.properties) nested.push([child, full]);
      else rows.push({ key: full, type: typeWords(child), def: defaultWords(child, required.includes(key)), meaning: child.description ?? '' });
    }
    if (rows.length) found.push({ path, description: node.description, rows });
    nested.forEach(([c, p]) => walk(c, p));
  };
  walk(section, name);
  return found;
}

const renderTable = (t) => [
  `### ${code(t.path)}`, '', `${t.description}.`, '',
  '| Key | Type and allowed values | Default | Meaning |', '|-----|-------------------------|---------|---------|',
  ...t.rows.map((r) => `| ${code(r.key)} | ${cell(r.type)} | ${cell(r.def)} | ${cell(r.meaning)} |`), '',
].join('\n');

// Pretty JSON with colour objects kept on one line.
const json = (v) => JSON.stringify(v, null, 2)
  .replace(/\{\n\s+("name": [^\n]*),\n\s+("value": [^\n]*)\n\s+\}/g, '{ $1, $2 }');
const fence = (v) => ['```json', json(v), '```', ''].join('\n');

function tokenTables(tokens) {
  const by = new Map();
  for (const t of tokens) {
    const g = t.name.split('-')[0];
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(t);
  }
  const order = [...GROUPS.filter((g) => by.has(g)), ...[...by.keys()].filter((g) => !GROUPS.includes(g))];
  return order.map((g) => [
    `### ${code(g)}`, '',
    '| Token | Default | Colours |', '|-------|---------|---------|',
    ...by.get(g).map((t) => `| ${code(t.name)}${ROLE_TOKENS.includes(t.name) ? ' (brand-driven)' : ''} | ${code(t.value)} | ${cell(t.comment)} |`), '',
  ].join('\n'));
}

export function generate() {
  const schema = JSON.parse(readFileSync(resolve(SRC, 'config.schema.json'), 'utf8'));
  const { basic, advanced } = schema.properties;
  const tokens = collectTokens(SRC);
  const brand = basic.properties.brand.properties;
  const fonts = basic.properties.fonts.properties;
  const defaults = (props) => Object.fromEntries(Object.entries(props).filter(([, v]) => v.default !== undefined).map(([k, v]) => [k, v.default]));
  const neutral = defaults(brand.neutral.properties);
  const fuller = {
    basic: {
      site: { title: 'Sample brand', description: 'Links worth keeping, with notes on why.', url: 'https://links.example.com', language: 'en', socialImage: './content/images/social.png' },
      collections: { order: ['product', 'repos', 'visuals'], default: 'product' },
      brand: { primary: brand.primary.default, secondary: brand.secondary.default, accent: brand.accent.default, neutral },
      fonts: defaults(fonts),
    },
    advanced: {},
  };
  const nonRole = tokens.filter((t) => !ROLE_TOKENS.includes(t.name));
  const pick = (n) => (nonRole.find((t) => t.name === n) ?? nonRole[0]).name;
  const override = { advanced: { scene: { colors: { [pick('page-room')]: '#d8d4c2', [pick('glass-center')]: 'rgba(255, 255, 255, 0.9)' } } } };
  const bigTypes = { advanced: { types: { repo: { label: 'Project', dot: 'accent.1' } } } };

  const out = [];
  const add = (...s) => out.push(...s);
  add('# Curator Configuration', '',
    'Everything is set in one file, `curator.config.json`, at the repo root. It has two sections: `basic` holds what most people change, and `advanced` holds everything else, which defaults to the Curator design.', '',
    'Only `basic.site.title` and `basic.site.url` are required. Every other key is optional. Run `npm run check` to validate the file without building. It names bad keys and bad values by path, for example `advanced.posters.minContrast must be a number from 1 to 21`.', '',
    'This page is generated from `src/config.schema.json` and the colour tokens in the CSS by `npm run docs`. Do not edit it by hand. Change the schema or the CSS and run `npm run docs` again.', '',
    '## Examples', '',
    'The smallest working config:', '',
    fence({ basic: { site: { title: 'Sample brand', url: 'https://links.example.com' } } }),
    'A fuller config with a brand. The brand and font values here are the Curator defaults:', '',
    fence(fuller),
    '## Basic Settings', '');
  add(...tablesFor(basic, 'basic').map(renderTable));
  add('## Advanced Settings', '');
  add(...tablesFor(advanced, 'advanced').map(renderTable));
  add('## Brand Colours', '',
    'The brand has three lists of named colours, `primary`, `secondary` and `accent`, plus a `neutral` object. The lists can be any length, so lean and large brands both work. The repo ships the Curator default brand, and `docs/examples/sample-brand.json` as a second, lean example with one secondary and one accent.', '',
    '**Poster inks and paper.** Items without an image get a generated poster. Light posters use the light neutral (or surface) as paper with three brand inks. Inverse posters use a primary or the dark neutral as paper, and about `advanced.posters.inverseShare` of posters are inverse. Each poster has at least one primary ink, three distinct inks, no `avoidPairs` pair together and every ink at least `advanced.posters.minContrast` against the paper. Across a collection, primaries make up about `advanced.posters.primaryShare` of ink use. The title band uses whichever ink reaches 4.5:1 on the paper, else the dark or light neutral.', '',
    '**Avoiding and excluding colours.** `advanced.posters.avoidPairs` lists pairs of colour names that never share a poster. `advanced.posters.excludeFromPosters` lists colours that are never used as poster ink or paper. Both use the `name` of a brand colour.', '',
    '**Scene roles.** A few colours in the scene follow the brand and cannot be overridden in `advanced.scene.colors`, because the build computes them from the brand and keeps their contrast readable.', '',
    '- The Visit button fill and the active collection menu item fill are accent 1, else primary 1. Hover and pressed shades of the Visit button are derived from it.',
    '- The text on both is the dark or light neutral, whichever contrasts more with primary 1. When neither reaches 4.5:1, the text is black or white and the build warns.',
    '- The keyboard focus ring is accent 1, else primary 1.',
    '- Each content type has a dot colour, set by role. See Type overrides.', '',
    '## Type Overrides', '',
    '`advanced.types` changes the label and dot colour of a content type, keyed by type name. The types are `webpage` (the fallback for any other link), `video`, `repo`, `image` and `article` (only for items that set `type: article`):', '',
    fence(bigTypes),
    'The `dot` is a colour role written as a tier and a zero based index. `primary.0` is primary 1, `secondary.0` is secondary 1 and `accent.1` is accent 2. A role beyond the brand\'s list for that tier is still valid. The first colour of that tier is used instead, and `npm run check` warns. The label is used on the slide, the open screen, the slide\'s accessible name and the screen reader list.', '',
    '## Fonts', '',
    'There are six font roles, all configurable. `display` sets titles and the wordmark, `body` the UI text, `mono` labels and counters, `poster` the poster title band and poster type, `typewriter` typed slide labels and `handwriting` handwritten slide labels. The first four live under `basic.fonts` and the last two under `advanced.fonts`. Each role takes a family that Google Fonts offers, and several roles may share one. Every role has a fallback stack.', '',
    'With `advanced.fonts.source` set to `google` (the default), the build generates one Google Fonts URL for the configured families. Set `advanced.fonts.googleFontsUrl` to replace that URL, for custom weights or axes. With `source` set to `self`, the build downloads the same Google Fonts files at build time and serves them from `dist/fonts/`, so visitors make no third-party requests.', '',
    'Unless `googleFontsUrl` is set, the build checks each family against Google Fonts. A family it cannot find is reported as an error naming the family, so check the spelling. `npm run check` runs the same check, and skips it when `source` is `self`.', '',
    '## Scene Colour Tokens', '',
    'Every colour in the light table scene is a token with a default. Override any token in `advanced.scene.colors`, keyed by the token name without the leading dashes:', '',
    fence(override),
    'A value can be a hex colour (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`), an `rgb()`, `rgba()`, `hsl()` or `hsla()` colour written with plain numbers and percentages, or `transparent`. Named colours and `var()` are not accepted. An unknown token or a bad value is reported by `npm run check`.', '',
    'Tokens marked brand-driven cannot be overridden. They follow `basic.brand` so the Visit button, the active collection menu item and the focus ring always match the brand and stay readable. Change the brand instead.', '',
    ...tokenTables(tokens),
    '## More', '',
    'For how tokens, role colours, fonts and posters work in the code, see [Design Values in ARCHITECTURE.md](ARCHITECTURE.md#9-design-values).', '');
  return out.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  writeFileSync(OUT, generate());
  console.log('Wrote docs/CONFIG.md');
}
