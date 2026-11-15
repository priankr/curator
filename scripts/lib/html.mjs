import { escapeHtml, excerpt } from './markdown.mjs';
import { pageTitle } from '../../src/js/title.js';

const slash = (path) => (path.endsWith('/') ? path : `${path}/`);

const meta = (attr, name, value) => `<meta ${attr}="${name}" content="${escapeHtml(value)}">`;

// Returns the head metadata for one page. Every value is escaped.
export function pageHead({ site, kind, collection, item, path = '/', image }) {
  const siteTitle = site.title;
  const title = pageTitle({ siteTitle, kind, collection, item });
  let description = site.description;
  if (kind === 'collection') {
    description = collection.description || site.description;
  } else if (kind === 'item') {
    description = excerpt(item.notesText) || collection.description || site.description;
  }

  const lines = [`<title>${escapeHtml(title)}</title>`, meta('name', 'description', description)];
  if (kind === '404') {
    lines.push('<meta name="robots" content="noindex">');
    return lines.join('\n    ');
  }

  const url = site.url + slash(path);
  const own = item?.image?.src;
  const picture = image || (own && !own.startsWith('data:') ? own : null) || site.socialImage || null;
  const imageUrl = picture ? site.url + picture : null;
  lines.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  lines.push(meta('property', 'og:site_name', siteTitle));
  lines.push(meta('property', 'og:title', title));
  lines.push(meta('property', 'og:description', description));
  lines.push(meta('property', 'og:url', url));
  lines.push(meta('property', 'og:type', kind === 'item' ? 'article' : 'website'));
  if (imageUrl) lines.push(meta('property', 'og:image', imageUrl));
  lines.push(meta('name', 'twitter:card', imageUrl ? 'summary_large_image' : 'summary'));
  lines.push(meta('name', 'twitter:title', title));
  lines.push(meta('name', 'twitter:description', description));
  if (imageUrl) lines.push(meta('name', 'twitter:image', imageUrl));
  return lines.join('\n    ');
}
