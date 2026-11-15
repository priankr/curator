import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferType } from '../../src/js/types.js';

export const KNOWN_FIELDS = ['url', 'type', 'tags', 'image'];
const FIELD_RE = /^([A-Za-z][\w-]*):\s*(.*)$/;
const HEADING_RE = /^## +(.*)$/;
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function slugify(title) {
  const slug = String(title)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// The auto and none keywords are stored lowercase, paths are kept as written.
function normalizeImage(value) {
  if (!value) return 'auto';
  const lower = value.toLowerCase();
  return lower === 'auto' || lower === 'none' ? lower : value;
}

function splitTags(value) {
  const out = [];
  for (const part of (value || '').split(',')) {
    const tag = part.trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

// Lenient: records what it finds and never throws on bad content.
function parseItem(lines, start, end) {
  const title = HEADING_RE.exec(lines[start])[1].trim();
  const fields = {};
  const fieldLines = {};
  const repeatedFields = [];
  let i = start + 1;
  for (; i < end; i++) {
    const m = FIELD_RE.exec(lines[i]);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (key in fields) {
      if (!repeatedFields.includes(key)) repeatedFields.push(key);
    } else {
      fields[key] = m[2].trim();
      fieldLines[key] = i + 1;
    }
  }
  const notes = lines.slice(i, end).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  const url = fields.url || '';
  const explicitType = (fields.type || '').toLowerCase();
  return {
    id: '',
    title,
    line: start + 1,
    url,
    type: explicitType || inferType(url),
    typeInferred: !explicitType,
    tags: splitTags(fields.tags),
    image: normalizeImage(fields.image),
    domain: domainOf(url),
    notes,
    fields,
    fieldLines,
    unknownFields: Object.keys(fields).filter((k) => !KNOWN_FIELDS.includes(k)),
    repeatedFields,
  };
}

function assignIds(items) {
  const used = new Set();
  const duplicates = [];
  for (const item of items) {
    const base = slugify(item.title);
    let id = base;
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
      duplicates.push({ title: item.title, line: item.line, id, base });
    }
    used.add(id);
    item.id = id;
  }
  return duplicates;
}

export function parseCollection(text, { id = '', file = '' } = {}) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

  const meta = {};
  let hasFrontMatter = false;
  let bodyStart = 0;
  if (lines[0].trimEnd() === '---') {
    const close = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
    if (close > 0) {
      hasFrontMatter = true;
      bodyStart = close + 1;
      for (let i = 1; i < close; i++) {
        const m = FIELD_RE.exec(lines[i]);
        if (m && !(m[1].toLowerCase() in meta)) meta[m[1].toLowerCase()] = m[2].trim();
      }
    }
  }

  const headings = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) headings.push(i);
  }
  const preambleEnd = headings.length ? headings[0] : lines.length;
  const preamble = lines.slice(bodyStart, preambleEnd).join('\n').trim();

  const items = headings.map((h, n) =>
    parseItem(lines, h, n + 1 < headings.length ? headings[n + 1] : lines.length),
  );
  const duplicates = assignIds(items);

  const title = meta.title || '';
  return {
    id,
    file,
    title,
    short: meta.short || title,
    description: meta.description || '',
    meta,
    hasFrontMatter,
    preamble,
    items,
    duplicates,
  };
}

export function readCollections(contentDir) {
  const dir = resolve(contentDir);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const full = join(dir, name);
      return parseCollection(readFileSync(full, 'utf8'), {
        id: name.slice(0, -3),
        file: relative(REPO_ROOT, full).split(sep).join('/'),
      });
    });
}
