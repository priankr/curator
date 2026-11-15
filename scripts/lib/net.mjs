import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// Address and prefix length pairs that are never public.
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export class NetRefusal extends Error {}

const v4Number = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);

function inV4(n, [base, bits]) {
  const start = v4Number(base);
  return n >= start && n < start + 2 ** (32 - bits);
}

// Returns the eight 16-bit groups of an IPv6 address, or null.
function v6Groups(ip) {
  let text = ip.split('%')[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const n = v4Number(dotted[1]);
    text = `${text.slice(0, -dotted[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const groups = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN));
  return groups.length === 8 && groups.every((g) => g >= 0) ? groups : null;
}

const embeddedV4 = (g) => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;

// Returns true only for a public unicast address. Anything unparseable is not public.
export function isPublicAddress(ip) {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4Number(ip);
    return !V4_BLOCKED.some((range) => inV4(n, range));
  }
  if (kind !== 6) return false;
  const g = v6Groups(ip);
  if (!g) return false;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return false;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicAddress(embeddedV4(g));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicAddress(embeddedV4(g));
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;
  return true;
}

// Throws NetRefusal unless the address is http or https and names only public hosts.
export async function checkTarget(url, lookup = dnsLookup) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new NetRefusal('the address is not valid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new NetRefusal('the address is not http or https');
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new NetRefusal('the address is not public');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new NetRefusal('the address is not public');
    return;
  }
  if (typeof lookup !== 'function') throw new NetRefusal('the address could not be checked');
  let answers;
  try {
    answers = await lookup(host, { all: true });
  } catch {
    throw new NetRefusal('the address could not be checked');
  }
  if (!Array.isArray(answers)) answers = [answers];
  if (answers.some((a) => !isPublicAddress(a?.address ?? a))) throw new NetRefusal('the address is not public');
}

// Fetches with every redirect hop checked first. Returns { res, url } where url is the final address.
export async function guardedFetch(fetchImpl, url, init, { lookup = dnsLookup, maxRedirects = 5 } = {}) {
  let current = url;
  for (let hops = 0; ; hops++) {
    await checkTarget(current, lookup);
    const res = await fetchImpl(current, { ...init, redirect: 'manual' });
    const location = REDIRECTS.has(res.status) ? res.headers.get('location') : null;
    if (!location) return { res, url: current };
    res.body?.cancel?.().catch(() => {});
    if (hops >= maxRedirects) throw new NetRefusal('too many redirects');
    try {
      current = new URL(location, current).href;
    } catch {
      throw new NetRefusal('the redirect address is not valid');
    }
  }
}
