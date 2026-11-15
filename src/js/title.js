// Shared by the browser and Node: the page title for each kind of route, with no DOM and no globals.

const DOT = '\u00b7';

// kind is home, collection, item or 404. The collection and item objects need title and short.
export function pageTitle({ siteTitle, kind, collection, item }) {
  if (kind === 'collection') return `${collection.title} ${DOT} ${siteTitle}`;
  if (kind === 'item') return `${item.title} ${DOT} ${collection.short}`;
  if (kind === '404') return `Not found ${DOT} ${siteTitle}`;
  return siteTitle;
}
