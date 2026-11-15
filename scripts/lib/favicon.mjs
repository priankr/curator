import { escapeHtml } from './markdown.mjs';

// Returns the site icon as SVG text: a slide mount in the first primary colour with a window in the light neutral.
export function faviconSvg(brand) {
  const mount = escapeHtml(brand.primary[0].value);
  const light = escapeHtml(brand.neutral.light);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="2" y="4" width="28" height="24" rx="3" fill="${mount}"/><rect x="7" y="9" width="18" height="12" rx="1.5" fill="${light}"/></svg>\n`;
}
