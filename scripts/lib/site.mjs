import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { buildPalette, normalizeBrand } from '../../src/js/palette.js';
import { assignPosters } from '../../src/js/kit.js';
import { TYPES } from '../../src/js/types.js';
import { notesText, renderNotes } from './markdown.mjs';

const EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', svg: 'svg' };

// Names an image after the first 16 hex of its content hash.
function hashedName(bytes, ext) {
  return `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
}

// Returns the collections in display order: the configured order first, then the rest by id.
function orderCollections(collections, order) {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const out = [];
  for (const id of order) {
    if (byId.has(id) && !out.includes(byId.get(id))) out.push(byId.get(id));
  }
  const rest = collections.filter((c) => !out.includes(c)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.concat(rest);
}

// Builds the site.json object and the list of image files to copy.
export function buildSiteData({ config, collections, images, root }) {
  const basic = config.basic;
  const advanced = config.advanced;
  const assets = new Map();

  function addAsset(file, ext) {
    const name = hashedName(readFileSync(file), ext);
    assets.set(`/images/${name}`, { from: file, to: `/images/${name}` });
    return `/images/${name}`;
  }

  // An SVG is embedded so that no standalone .svg file is published.
  function imageSrc(image) {
    if (image.type !== 'svg') return addAsset(image.file, EXT[image.type] ?? image.type);
    return `data:image/svg+xml;base64,${readFileSync(image.file).toString('base64')}`;
  }

  const brand = normalizeBrand(basic.brand);
  const palette = buildPalette(brand, advanced.posters);
  const ordered = orderCollections(collections, basic.collections.order ?? []);

  const outCollections = ordered.map((c) => {
    const entries = c.items.map((item) => ({ item, image: images.get(`${c.id}/${item.id}`) ?? null }));
    const posterItems = entries.filter((e) => !e.image);
    const variants = assignPosters(posterItems.map((e) => e.item.title), advanced.posters.compositions);
    const variantOf = new Map(posterItems.map((e, i) => [e, variants[i]]));
    const items = entries.map((e, i) => {
      const { item, image } = e;
      let poster = null;
      if (!image) {
        const p = palette.palette(item.title);
        poster = { v: variantOf.get(e), set: p.set, paper: p.paper, inks: p.inks, band: p.band };
      }
      return {
        id: item.id,
        key: item.title,
        no: String(i + 1).padStart(2, '0'),
        title: item.title,
        url: item.url,
        domain: item.domain,
        type: item.type,
        tags: item.tags,
        notesHtml: renderNotes(item.notes),
        notesText: notesText(item.notes),
        image: image ? { src: imageSrc(image), width: image.width, height: image.height, fit: image.fit } : null,
        poster,
      };
    });
    const tags = [...new Set(c.items.flatMap((item) => item.tags))].sort();
    return { id: c.id, title: c.title, short: c.short, description: c.description, tags, items };
  });

  let socialImage = null;
  if (basic.site.socialImage) {
    const file = resolve(root, basic.site.socialImage);
    const ext = extname(file).slice(1).toLowerCase();
    socialImage = addAsset(file, EXT[ext] ?? ext);
  }

  const overrides = advanced.types ?? {};
  const fonts = {
    display: basic.fonts.display,
    body: basic.fonts.body,
    mono: basic.fonts.mono,
    poster: basic.fonts.poster,
    typewriter: advanced.fonts.typewriter,
    handwriting: advanced.fonts.handwriting,
  };
  const scene = advanced.scene;

  const data = {
    version: 1,
    site: {
      title: basic.site.title,
      description: basic.site.description,
      url: basic.site.url.replace(/\/+$/, ''),
      language: basic.site.language,
      socialImage,
    },
    scene: { name: scene.name, pageSize: scene.pageSize, motion: scene.motion, colors: scene.colors },
    fonts,
    brand,
    types: TYPES.map((t) => ({ name: t.name, label: overrides[t.name]?.label ?? t.label, dot: overrides[t.name]?.dot ?? t.dot })),
    defaultCollection: basic.collections.default ?? outCollections[0]?.id ?? null,
    collections: outCollections,
  };
  return { data, assets: [...assets.values()] };
}
