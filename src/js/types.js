// Shared by browser and Node: this module must stay DOM free.

const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com'];
const REPO_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org'];
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg)$/i;

// Exact match or dot-suffix match, never substring.
function hostIn(hostname, hosts) {
  const h = hostname.toLowerCase();
  return hosts.some((d) => h === d || h.endsWith('.' + d));
}

export const TYPES = [
  {
    name: 'video',
    label: 'Video',
    dot: 'primary.1',
    match: (url) => hostIn(url.hostname, VIDEO_HOSTS),
  },
  {
    name: 'repo',
    label: 'Repository',
    dot: 'secondary.0',
    match: (url) =>
      hostIn(url.hostname, REPO_HOSTS) && url.pathname.split('/').filter(Boolean).length >= 2,
  },
  {
    name: 'image',
    label: 'Image',
    dot: 'accent.0',
    match: (url) => IMAGE_EXT.test(url.pathname),
  },
  {
    name: 'article',
    label: 'Article',
    dot: 'primary.2',
    match: () => false, // opt in only, through type: article
  },
  {
    name: 'webpage',
    label: 'Webpage',
    dot: 'primary.0',
    match: () => true, // the fallback, so it must stay last
  },
];

export function typeNames() {
  return TYPES.map((t) => t.name);
}

export function getType(name) {
  return TYPES.find((t) => t.name === name) || null;
}

export function inferType(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return 'webpage';
  }
  return TYPES.find((t) => t.match(url)).name;
}
