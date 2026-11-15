import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { escapeHtml } from './markdown.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const typeOf = (file) => {
  const dot = file.lastIndexOf('.');
  return (dot === -1 ? null : TYPES[file.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
};

const isFile = async (file) => {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
};

const isDir = async (file) => {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
};

function errorPage(messages) {
  const items = messages.map((m) => `<li>${escapeHtml(String(m))}</li>`).join('');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Build failed</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:system-ui,sans-serif;max-width:48rem;margin:3rem auto;padding:0 1rem"><h1>Build failed</h1><p>Fix these problems and save. The site rebuilds on its own.</p><ul>${items}</ul></body></html>\n`;
}

// Serves dir like a static host: directory index files, 301 for folders, 404.html for misses. mounts maps a URL prefix to another folder, longest prefix first. routes maps an exact path to a function returning { status, body } as JSON.
export function startServer({ dir, port = 4321, host = 'localhost', getError = () => null, mounts = {}, routes = {} }) {
  const root = resolve(dir);
  const mountList = Object.entries(mounts).map(([prefix, folder]) => [`/${prefix.split('/').filter(Boolean).join('/')}/`.replace('//', '/'), resolve(folder)]).sort((a, b) => b[0].length - a[0].length);

  async function handle(req, res) {
    const send = (status, type, body, extra = {}) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...extra });
      res.end(req.method === 'HEAD' ? undefined : buf);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(405, 'text/plain; charset=utf-8', 'Method not allowed', { Allow: 'GET, HEAD' });
    }

    const errors = getError();
    const broken = Array.isArray(errors) && errors.length > 0;
    const html = 'text/html; charset=utf-8';
    const missing = async () => {
      if (broken) return send(500, html, errorPage(errors));
      const page = join(root, '404.html');
      return (await isFile(page)) ? send(404, html, await readFile(page)) : send(404, 'text/plain; charset=utf-8', 'Not found');
    };

    const raw = req.url ?? '/';
    const cut = raw.search(/[?#]/);
    const rawPath = cut === -1 ? raw : raw.slice(0, cut);
    const search = raw[cut] === '?' ? raw.slice(cut).split('#')[0] : '';
    let path;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return missing();
    }
    if (!path.startsWith('/') || path.includes('\0') || path.includes(String.fromCharCode(92))) return missing();

    const route = routes[path];
    if (route) {
      const out = await route();
      return send(out.status, TYPES['.json'], out.body);
    }

    let base = root;
    let rel = path;
    for (const [prefix, folder] of mountList) {
      if (path.startsWith(prefix)) {
        base = folder;
        rel = '/' + path.slice(prefix.length);
        break;
      }
    }
    let file = resolve(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) return missing();

    if (await isDir(file)) {
      if (!path.endsWith('/')) {
        return send(301, 'text/plain; charset=utf-8', '', { Location: `/${rawPath.replace(/^\/+/, '')}/${search}` });
      }
      file = join(file, 'index.html');
    }
    if (!(await isFile(file))) return missing();

    const type = typeOf(file);
    if (broken && type === html) return send(500, html, errorPage(errors));
    return send(200, type, await readFile(file));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' });
      res.end();
    });
  });
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveStart(server);
    });
  });
}
