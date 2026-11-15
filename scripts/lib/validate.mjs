import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { readCollections, KNOWN_FIELDS } from './parse.mjs';
import { typeNames } from '../../src/js/types.js';
import { checkFonts } from './fonts.mjs';
import { imageSize } from './imagesize.mjs';
import { computeRoles, collectTokens, validateColors } from './theme.mjs';

const FILE_ID_RE = /^[a-z0-9-]+$/;
const KNOWN_META = ['title', 'short', 'description'];
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const CONFIG_NAME = 'curator.config.json';
const MAX_ITEMS = 100;
const REPO_SRC = fileURLToPath(new URL('../../src/', import.meta.url));

// Plain Levenshtein distance, used only for typo suggestions.
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function suggestField(key) {
  let best = null;
  let bestDistance = 3;
  for (const field of KNOWN_FIELDS) {
    const d = distance(key, field);
    if (d <= 2 && d < bestDistance) {
      best = field;
      bestDistance = d;
    }
  }
  return best;
}

function badUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol !== 'http:' && protocol !== 'https:';
  } catch {
    return true;
  }
}

const MAX_SVG_BYTES = 102400;
const SOCIAL_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

// Reads an image file and returns its problem as a sentence that starts with label, or null.
function fileProblem(full, label, { allowSvg }) {
  let bytes;
  try {
    bytes = readFileSync(full);
  } catch {
    return `${label} could not be read. Check that the file exists and can be opened.`;
  }
  const { type } = imageSize(bytes);
  if (!type) return `${label} is not a ${allowSvg ? 'png, jpeg, gif, webp or svg' : 'png, jpeg, gif or webp'} image. Replace it with a real image file.`;
  const ext = extname(full).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const article = (word) => (/^(svg|[aeiou])/.test(word) ? 'an' : 'a');
  if (type !== ext) return `${label} holds ${article(type)} ${type} image, not ${article(ext)} ${ext}. Rename it to match or replace it with a real ${ext}.`;
  if (type === 'svg' && !allowSvg) return `${label} is an svg image, which is not allowed here. Use a png, jpeg, gif or webp image.`;
  if (type === 'svg' && bytes.length > MAX_SVG_BYTES) return `${label} is larger than 100 KB. Shrink the svg or use a png.`;
  return null;
}

// Returns the first image problem for an item, or null.
function imageProblem(value, contentDir) {
  const lower = value.toLowerCase();
  if (lower === 'auto' || lower === 'none') return null;
  if (/^[a-z]+:/i.test(value)) return 'image must be auto, none or a path to a file in content/, not a web address.';
  const full = resolve(contentDir, value);
  const rel = relative(contentDir, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return `image path "${value}" must stay inside the content folder.`;
  if (!IMAGE_EXT_RE.test(value)) return `image "${value}" must be a .png, .jpg, .jpeg, .gif, .webp or .svg file.`;
  if (!existsSync(full) || !statSync(full).isFile()) return `image file "${value}" was not found in the content folder.`;
  return fileProblem(full, `image "${value}"`, { allowSvg: true });
}

export function validateSite({ config, collections, root, srcDir = REPO_SRC }) {
  const errors = [];
  const warnings = [];
  const contentDir = resolve(root, 'content');
  const types = typeNames();
  // The fallback type leads the list so the message reads from the most common type.
  const typeList = ['webpage', ...types.filter((n) => n !== 'webpage')].join(', ');

  if (collections.length === 0) {
    errors.push('content: there are no collections yet. Add a Markdown file such as content/links.md.');
  }

  for (const c of collections) {
    const file = `content/${c.id}.md`;
    if (!FILE_ID_RE.test(c.id)) {
      errors.push(`${file}: the file name must use lowercase letters, digits and hyphens only, such as tools.md.`);
    }
    if (!c.hasFrontMatter || !c.title) {
      errors.push(`${file}: the collection has no title. Add a title line to the front matter at the top of the file.`);
    }
    if (c.items.length > MAX_ITEMS) {
      warnings.push(`${file}: the collection has ${c.items.length} items. Past about 100 items it is a library, not a collection. Consider splitting it.`);
    }
    if (c.items.length === 0 && c.title) {
      warnings.push(`${file}: the collection has no items yet. Each item starts with a ## heading.`);
    }
    for (const key of Object.keys(c.meta)) {
      if (!KNOWN_META.includes(key)) {
        warnings.push(`${file}: unknown front matter key "${key}". Known keys are title, short and description.`);
      }
    }
    if (c.preamble) warnings.push(`${file}: text before the first ## heading is ignored.`);

    for (const item of c.items) {
      if (!item.title) {
        errors.push(`${file} (line ${item.line}): an item heading has no title.`);
        continue;
      }
      const prefix = `${file}, "${item.title}" (line ${item.line}): `;
      if (!item.url) {
        errors.push(`${prefix}url is missing. Add a line such as url: https://example.com/page under the heading.`);
      } else if (badUrl(item.url)) {
        errors.push(`${prefix}url "${item.url}" must be an absolute http or https address, such as https://example.com/page.`);
      }
      if (!item.typeInferred && !types.includes(item.type)) {
        errors.push(`${prefix}type "${item.type}" is not a known type. Use one of ${typeList}.`);
      }
      const problem = imageProblem(item.image, contentDir);
      if (problem) errors.push(`${prefix}${problem}`);

      const dup = c.duplicates.find((d) => d.line === item.line);
      if (dup) warnings.push(`${prefix}another item has the same link name, so this one becomes ${dup.id}. Rename it to give it a link of its own.`);
      for (const key of item.unknownFields) {
        const near = suggestField(key);
        const hint = near ? ` Did you mean ${near}?` : '';
        warnings.push(`${prefix}unknown field "${key}" on line ${item.fieldLines[key]}. Known fields are url, type, tags and image.${hint}`);
      }
      for (const key of item.repeatedFields) {
        warnings.push(`${prefix}field "${key}" appears more than once. The first value is used.`);
      }
      if (item.tags.some((t) => t.toLowerCase() === 'all')) {
        warnings.push(`${prefix}the tag "all" on line ${item.fieldLines.tags} shows as a second all chip, because the all chip already clears the filter. Rename the tag.`);
      }
    }
  }

  const ids = new Set(collections.map((c) => c.id));
  const order = config?.basic?.collections?.order ?? [];
  const missingOrder = new Set();
  const seenOrder = new Set();
  const repeatedOrder = new Set();
  for (const id of order) {
    if (!ids.has(id) && !missingOrder.has(id)) {
      missingOrder.add(id);
      errors.push(`${CONFIG_NAME}: basic.collections.order names "${id}", but there is no content/${id}.md.`);
    }
    if (seenOrder.has(id) && !repeatedOrder.has(id)) {
      repeatedOrder.add(id);
      warnings.push(`${CONFIG_NAME}: basic.collections.order lists "${id}" more than once.`);
    }
    seenOrder.add(id);
  }
  const def = config?.basic?.collections?.default;
  if (def && !ids.has(def)) {
    errors.push(`${CONFIG_NAME}: basic.collections.default is "${def}", but there is no content/${def}.md.`);
  }
  for (const key of Object.keys(config?.advanced?.types ?? {})) {
    if (!types.includes(key)) errors.push(`${CONFIG_NAME}: advanced.types.${key} is not a known type. Use one of ${typeList}.`);
    const dot = config.advanced.types[key]?.dot;
    const m = typeof dot === 'string' ? /^(primary|secondary|accent)[.]([0-9]+)$/.exec(dot) : null;
    const count = m ? (config?.basic?.brand?.[m[1]] ?? []).length : 0;
    if (m && Number(m[2]) >= count) {
      const fallback = count ? `${m[1]}.0` : 'primary.0';
      warnings.push(`${CONFIG_NAME}: advanced.types.${key}.dot is ${dot}, but the brand has only ${count} ${m[1]} ${count === 1 ? 'colour' : 'colours'}. ${fallback} is used instead.`);
    }
  }
  const colors = config?.advanced?.scene?.colors;
  if (colors && typeof colors === 'object') {
    errors.push(...validateColors(colors, collectTokens(srcDir, config.advanced.scene.name || 'lighttable')));
  }
  if (config?.basic?.brand) warnings.push(...computeRoles(config.basic.brand).warnings);
  const social = config?.basic?.site?.socialImage;
  if (social) {
    const full = resolve(root, social);
    const label = `${CONFIG_NAME}: basic.site.socialImage "${social}"`;
    const rel = relative(resolve(root), full);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      errors.push(`${label} must stay inside the project folder.`);
    } else if (!SOCIAL_EXT_RE.test(social)) {
      errors.push(`${label} must be a .png, .jpg, .jpeg, .gif or .webp file.`);
    } else if (!existsSync(full) || !statSync(full).isFile()) {
      errors.push(`${label} was not found.`);
    } else {
      const problem = fileProblem(full, label, { allowSvg: false });
      if (problem) errors.push(problem);
    }
  }

  return { errors, warnings };
}

function configMessage(text) {
  const prefixed = text.startsWith(`${CONFIG_NAME} `) ? text : `${CONFIG_NAME}: ${text}`;
  return prefixed.endsWith('.') ? prefixed : `${prefixed}.`;
}

export function checkSite(root, { srcDir = REPO_SRC } = {}) {
  const base = resolve(root);
  const { config, errors: configErrors } = loadConfig(join(base, CONFIG_NAME));
  if (configErrors.length) {
    return { errors: configErrors.map(configMessage), warnings: [], collections: [], itemCount: 0, configFailed: true };
  }
  const contentDir = join(base, 'content');
  const collections = existsSync(contentDir) ? readCollections(contentDir) : [];
  const { errors, warnings } = validateSite({ config, collections, root: base, srcDir });
  const itemCount = collections.reduce((n, c) => n + c.items.length, 0);
  return { errors, warnings, collections, itemCount, configFailed: false };
}

// The same check plus the Google family check, which needs the network unless offline is set or the cache answers.
export async function checkSiteWithFonts(root, { srcDir = REPO_SRC, offline = false, fetchImpl = fetch, lookup } = {}) {
  const result = checkSite(root, { srcDir });
  if (result.configFailed) return result;
  const base = resolve(root);
  const { config } = loadConfig(join(base, CONFIG_NAME));
  const fonts = await checkFonts({ config, root: base, offline, fetchImpl, lookup });
  return { ...result, errors: result.errors.concat(fonts.errors), warnings: result.warnings.concat(fonts.warnings) };
}
