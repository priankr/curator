// The notes Markdown subset: paragraphs, emphasis, strong, code and http(s) links only, with raw HTML escaped.
const MARK = String.fromCharCode(0);
const CODE_RE = /`([^`]+)`/g;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const STRONG_RE = /\*\*([^*]+)\*\*/g;
const EM_RE = /\*([^*]+)\*/g;
const HOLD_RE = new RegExp(`${MARK}([0-9]+)${MARK}`, 'g');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Runs the inline rules with held spans, so code and link targets are never touched by emphasis.
function inline(text, make) {
  const held = [];
  const hold = (value) => `${MARK}${held.push(value) - 1}${MARK}`;
  let s = text.replace(CODE_RE, (_, code) => hold(make.code(code)));
  s = s.replace(LINK_RE, (_, label, href) => hold(make.link(label.replace(STRONG_RE, (_m, t) => make.strong(t)).replace(EM_RE, (_m, t) => make.em(t)), href)));
  s = s.replace(STRONG_RE, (_, t) => make.strong(t)).replace(EM_RE, (_, t) => make.em(t));
  // Links can hold code spans, so restore until nothing is left.
  for (let i = 0; i < 3 && s.includes(MARK); i++) s = s.replace(HOLD_RE, (_, n) => held[n]);
  return s;
}

const HTML = {
  code: (t) => `<code>${t}</code>`,
  link: (label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  strong: (t) => `<strong>${t}</strong>`,
  em: (t) => `<em>${t}</em>`,
};

const TEXT = { code: (t) => t, link: (label) => label, strong: (t) => t, em: (t) => t };

const clean = (md) => String(md ?? '').replaceAll(MARK, '').replace(/\r\n?/g, '\n');

// Returns the notes as HTML paragraphs. Raw HTML is escaped first, so it only ever shows as text.
export function renderNotes(md) {
  return clean(md)
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .map((p) => `<p>${inline(escapeHtml(p), HTML)}</p>`)
    .join('');
}

// Returns the notes as plain text with markup removed and whitespace collapsed.
export function notesText(md) {
  return inline(clean(md), TEXT).replace(/\s+/g, ' ').trim();
}

// Returns the text, or a cut at the last space that leaves room for the three dots.
export function excerpt(text, max = 160) {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(' ', max - 3);
  const cut = space > 0 ? text.slice(0, space) : text.slice(0, max - 3);
  return `${cut.trimEnd()}...`;
}
