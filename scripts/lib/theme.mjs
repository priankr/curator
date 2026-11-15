import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, mix, normalizeBrand } from '../../src/js/palette.js';

const CONFIG_NAME = 'curator.config.json';
const MIN_CONTRAST = 4.5;
const MIN_NON_TEXT = 3;
const BLACK = '#000000';
const WHITE = '#ffffff';
// Tokens the build computes from the brand, so config may not override them.
export const ROLE_TOKENS = [
  'button-visit-fill', 'button-visit-hover', 'button-visit-pressed', 'button-visit-text',
  'chrome-pill-on-fill', 'chrome-pill-on-text', 'chrome-focus', 'chrome-arrow-fill', 'chrome-arrow-icon',
];
const FONT_VARS = [
  ['display', '--f-serif', "'Iowan Old Style', Georgia, serif"],
  ['body', '--f-sans', "'Helvetica Neue', Arial, sans-serif"],
  ['mono', '--f-mono', 'ui-monospace, Menlo, monospace'],
  ['poster', '--f-poster', "'Helvetica Neue', Arial, sans-serif"],
  ['typewriter', '--f-type', "'Courier New', monospace"],
  ['handwriting', '--f-hand', "'Segoe Print', cursive"],
];

const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)%?';
const COLOR_FUNC = new RegExp(`^(?:rgba?|hsla?)\\((?:\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*(?:,\\s*${NUM}\\s*)?|\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s*(?:/\\s*${NUM}\\s*)?)\\)$`, 'i');
const COLOR_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// True for a hex colour, rgb(), rgba(), hsl(), hsla() with plain numbers, or transparent.
export function isColor(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return COLOR_HEX.test(v) || COLOR_FUNC.test(v) || v.toLowerCase() === 'transparent';
}

// Returns the colour tokens declared in :root blocks of the given CSS text, as { name, value, comment }.
export function tokensFromCss(css) {
  const out = [];
  const roots = css.matchAll(/:root\s*\{([^}]*)\}/g);
  for (const block of roots) {
    for (const m of block[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/g)) {
      const value = m[2].trim();
      if (isColor(value)) out.push({ name: m[1], value, comment: m[3] ?? '' });
    }
  }
  return out;
}

// Collects the tokens of base.css and the scene's scene.css, in file order.
export function collectTokens(srcDir, sceneName = 'lighttable') {
  const files = [join(srcDir, 'css', 'base.css'), join(srcDir, 'scenes', sceneName, 'scene.css')];
  return files.filter((f) => existsSync(f)).flatMap((f) => tokensFromCss(readFileSync(f, 'utf8')));
}

// Returns the error messages for advanced.scene.colors. Keys are token names without the leading dashes.
export function validateColors(colors, tokens) {
  const errors = [];
  const known = new Set(tokens.map((t) => t.name));
  for (const [name, value] of Object.entries(colors ?? {})) {
    if (!known.has(name) || ROLE_TOKENS.includes(name)) {
      errors.push(`${CONFIG_NAME}: advanced.scene.colors.${name} is not a scene colour token. See docs/CONFIG.md for the list.`);
    } else if (!isColor(value)) {
      errors.push(`${CONFIG_NAME}: advanced.scene.colors.${name} must be a colour such as #1d1b18 or rgba(0, 0, 0, 0.5).`);
    }
  }
  return errors;
}

// Resolves a type's dot role such as primary.1 against the brand, with the same fallback the front end always used.
export function roleColor(brand, role) {
  const parts = String(role).split('.');
  const list = brand[parts[0]];
  const i = parseInt(parts[1], 10);
  if (Array.isArray(list) && list.length) return (list[i] || list[0]).value;
  const first = brand.primary[0];
  return first ? first.value : brand.neutral.dark;
}

// Computes every brand-driven value: Visit and active collection item colours, the focus ring, the side arrows and one dot colour per type.
export function computeRoles(brandIn, types = []) {
  const brand = normalizeBrand(brandIn);
  const first = brand.primary[0] ? brand.primary[0].value : brand.neutral.dark;
  const fill = brand.accent[0] ? brand.accent[0].value : first;
  const { dark, light } = brand.neutral;
  const warnings = [];
  let text = contrast(dark, fill) >= contrast(light, fill) ? dark : light;
  let measured = contrast(text, fill);
  if (measured < MIN_CONTRAST) {
    const bw = contrast(BLACK, fill) >= contrast(WHITE, fill) ? BLACK : WHITE;
    warnings.push(`brand: the Visit button and active collection item text reaches only ${measured.toFixed(2)}:1 on accent 1 with the dark and light neutrals, so ${bw === BLACK ? 'black' : 'white'} is used instead (${contrast(bw, fill).toFixed(2)}:1). Choose a different accent 1 or neutral to restore the brand text colour.`);
    text = bw;
    measured = contrast(bw, fill);
  }
  const accent = fill;
  let icon = contrast(dark, accent) >= contrast(light, accent) ? dark : light;
  if (contrast(icon, accent) < MIN_NON_TEXT) {
    const bw = contrast(BLACK, accent) >= contrast(WHITE, accent) ? BLACK : WHITE;
    warnings.push(`brand: the side arrow icon reaches only ${contrast(icon, accent).toFixed(2)}:1 on accent 1 with the dark and light neutrals, so ${bw === BLACK ? 'black' : 'white'} is used instead (${contrast(bw, accent).toFixed(2)}:1). Choose a different accent 1 or neutral to restore the brand icon colour.`);
    icon = bw;
  }
  const dots = {};
  for (const t of types) dots[t.name] = roleColor(brand, t.dot);
  return {
    visit: { fill, hover: mix(fill, WHITE, 0.12), pressed: mix(fill, BLACK, 0.12), text, contrast: measured },
    pill: { fill, text },
    focus: accent,
    arrow: { fill: accent, icon },
    dots,
    warnings,
  };
}

// Quotes a configured family and appends the fallback stack. Characters that could end the declaration are dropped.
const stack = (family, fallback) => (family ? `'${String(family).replace(/['"\\;{}<>\r\n]/g, '')}', ` : '') + fallback;

// Returns the theme style block for every page head: roles, font variables and colour overrides.
export function themeStyle({ roles, fonts, colors, tokens }) {
  const decl = [];
  const set = (name, value) => decl.push(`--${name}:${value}`);
  set('button-visit-fill', roles.visit.fill);
  set('button-visit-hover', roles.visit.hover);
  set('button-visit-pressed', roles.visit.pressed);
  set('button-visit-text', roles.visit.text);
  set('chrome-pill-on-fill', roles.pill.fill);
  set('chrome-pill-on-text', roles.pill.text);
  set('chrome-focus', roles.focus);
  set('chrome-arrow-fill', roles.arrow.fill);
  set('chrome-arrow-icon', roles.arrow.icon);
  for (const [type, value] of Object.entries(roles.dots)) set(`dot-${type}`, value);
  for (const [role, name, fallback] of FONT_VARS) decl.push(`${name}:${stack(fonts?.[role], fallback)}`);
  // Only validated overrides are written, so a bad value can never reach the page.
  for (const [name, value] of Object.entries(colors ?? {})) if (!validateColors({ [name]: value }, tokens).length) set(name, String(value).trim());
  return `<style id="curator-theme">:root{${decl.join(';')}}</style>`;
}
