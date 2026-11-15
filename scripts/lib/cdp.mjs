import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Encodes one WebSocket frame. Client frames must be masked.
export function encodeFrame(opcode, payload, { mask = true, fin = true } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '');
  const len = body.length;
  const head = [(fin ? 0x80 : 0) | opcode];
  const maskBit = mask ? 0x80 : 0;
  let ext = Buffer.alloc(0);
  if (len < 126) head.push(maskBit | len);
  else if (len < 65536) { head.push(maskBit | 126); ext = Buffer.alloc(2); ext.writeUInt16BE(len); }
  else { head.push(maskBit | 127); ext = Buffer.alloc(8); ext.writeBigUInt64BE(BigInt(len)); }
  const parts = [Buffer.from(head), ext];
  if (mask) {
    const key = randomBytes(4);
    const out = Buffer.from(body);
    for (let i = 0; i < len; i++) out[i] ^= key[i & 3];
    parts.push(key, out);
  } else parts.push(body);
  return Buffer.concat(parts);
}

// Incremental frame decoder. Calls onMessage(text or Buffer), onPing(payload) and onClose(code).
export class FrameDecoder {
  constructor({ onMessage, onPing, onClose }) {
    this.onMessage = onMessage;
    this.onPing = onPing ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.kind = 0;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        at = 10;
      }
      const keyAt = at;
      if (masked) at += 4;
      if (b.length < at + len) return;
      let payload = b.subarray(at, at + len);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < len; i++) payload[i] ^= b[keyAt + (i & 3)];
      }
      this.buf = b.subarray(at + len);
      this.frame(fin, opcode, payload);
    }
  }

  frame(fin, opcode, payload) {
    if (opcode === 0x9) return this.onPing(payload);
    if (opcode === 0xa) return;
    if (opcode === 0x8) return this.onClose(payload.length >= 2 ? payload.readUInt16BE(0) : 1005);
    if (opcode === 0x1 || opcode === 0x2) { this.kind = opcode; this.parts = []; }
    this.parts.push(payload);
    if (!fin) return;
    const all = Buffer.concat(this.parts);
    this.parts = [];
    this.onMessage(this.kind === 0x1 ? all.toString('utf8') : all);
  }
}

// Opens a WebSocket over an http upgrade. Resolves { send(text), close(), onmessage, onclose }.
export function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const req = request(url.replace(/^ws:/, 'http:'), { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.once('error', reject);
    req.once('response', (res) => reject(new Error(`WebSocket upgrade refused with status ${res.statusCode}`)));
    req.once('upgrade', (res, socket, head) => {
      const expected = createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expected) {
        socket.destroy();
        return reject(new Error('WebSocket accept header mismatch'));
      }
      const ws = { onmessage: null, onclose: null };
      let closed = false;
      const finish = () => { if (!closed) { closed = true; ws.onclose?.(); } };
      const decoder = new FrameDecoder({
        onMessage: (m) => ws.onmessage?.(m),
        onPing: (p) => { if (!socket.destroyed) socket.write(encodeFrame(0xa, p)); },
        onClose: () => { if (!socket.destroyed) socket.end(encodeFrame(0x8, Buffer.alloc(0))); finish(); },
      });
      ws.send = (text) => { if (!socket.destroyed) socket.write(encodeFrame(0x1, text)); };
      ws.close = () => { if (!socket.destroyed) socket.end(encodeFrame(0x8, Buffer.alloc(0))); };
      socket.on('data', (d) => decoder.push(d));
      socket.on('close', finish);
      socket.on('error', finish);
      if (head?.length) decoder.push(head);
      resolve(ws);
    });
    req.end();
  });
}

const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

// Returns the two Input.dispatchKeyEvent parameter sets for one real key press. Enter and Space carry text, so a focused button activates.
export function keyEvents(key, { shift = false, ctrl = false, alt = false } = {}) {
  const code = KEY_CODES[key];
  if (code === undefined) throw new Error(`unsupported key "${key}"`);
  const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const text = key === 'Enter' ? String.fromCharCode(13) : key === ' ' ? ' ' : undefined;
  const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
  return [text ? { ...base, type: 'keyDown', text } : { ...base, type: 'rawKeyDown' }, { ...base, type: 'keyUp' }];
}

const live = new Set();

const killTree = (child) => {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }
};

// Helper processes can still write into the profile after the main one exits, so it must stay gone for three checks in a row.
const removeDir = async (dir) => {
  let gone = 0;
  for (let i = 0; i < 40 && gone < 3; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* EBUSY while the browser lets go */ }
    gone = existsSync(dir) ? 0 : gone + 1;
    await sleep(250);
  }
  if (gone < 3 && existsSync(dir)) console.error(`warning: could not remove the browser profile ${dir}`);
};

// Last resort for a crash or Ctrl+C: kill every browser still alive and drop its profile.
const sweep = () => {
  for (const { child, profile } of live) {
    killTree(child);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  live.clear();
};
process.on('exit', sweep);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { sweep(); process.exit(130); });

const fmtArg = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? a.type));

// Starts a headless browser with a private profile and connects to it over DevTools. Resolves { newPage, close }.
export async function launch(browserPath, { args = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'curator-browser-'));
  const full = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...args];
  const child = spawn(browserPath, full, { stdio: 'ignore', detached: process.platform !== 'win32' });
  const entry = { child, profile };
  live.add(entry);
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', () => { exited = true; });
  let ws = null;
  let closing = null;
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  const send = (method, params = {}, sessionId, timeoutMs = 30000) => new Promise((resolve, reject) => {
    if (!ws) return reject(new Error(`${method}: not connected`));
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
  const on = (sessionId, event, fn) => {
    const key = `${sessionId}|${event}`;
    if (!handlers.has(key)) handlers.set(key, new Set());
    handlers.get(key).add(fn);
    return () => handlers.get(key).delete(fn);
  };
  const shutdown = async () => {
    try { await send('Browser.close', {}, undefined, 3000); } catch { /* the socket may drop first */ }
    for (let i = 0; i < 30 && !exited; i++) await sleep(100);
    killTree(child);
    try { ws?.close(); } catch { /* already closed */ }
    await removeDir(profile);
    live.delete(entry);
  };
  const close = () => (closing ??= shutdown());

  try {
    const portFile = join(profile, 'DevToolsActivePort');
    const end = Date.now() + 15000;
    let port = null;
    while (port === null) {
      if (exited) throw new Error('the browser exited before it opened a DevTools port');
      if (Date.now() > end) throw new Error('the browser did not report a DevTools port within 15s');
      if (existsSync(portFile)) {
        const first = readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
        if (/^\d+$/.test(first)) port = Number(first);
      }
      if (port === null) await sleep(50);
    }
    const info = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/json/version', timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('/json/version timed out')));
      req.end();
    });
    ws = await connectWebSocket(info.webSocketDebuggerUrl);
  } catch (e) {
    await close();
    throw e;
  }
  ws.onmessage = (text) => {
    const msg = JSON.parse(text);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method} failed: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of handlers.get(`${msg.sessionId ?? ''}|${msg.method}`) ?? []) fn(msg.params);
    }
  };
  ws.onclose = () => {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(`${p.method}: connection closed`)); pending.delete(id); }
  };

  const newPage = async ({ width = 1280, height = 800 } = {}) => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params, timeoutMs) => send(method, params, sessionId, timeoutMs);
    const logs = [];
    const errors = [];
    on(sessionId, 'Runtime.consoleAPICalled', (p) => logs.push(`${p.type}: ${p.args.map(fmtArg).join(' ')}`));
    on(sessionId, 'Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression, { awaitPromise = false, timeoutMs = 30000 } = {}) => {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, timeoutMs);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    return {
      logs,
      errors,
      evaluate,
      send: (method, params, timeoutMs) => call(method, params, timeoutMs),
      // Presses and releases one real key in the focused frame.
      async press(key, opts) {
        for (const params of keyEvents(key, opts)) await call('Input.dispatchKeyEvent', params);
      },
      on: (event, fn) => on(sessionId, event, fn),
      async goto(url, timeoutMs = 30000) {
        let off;
        const loaded = new Promise((resolve) => { off = on(sessionId, 'Page.loadEventFired', resolve); });
        let timer;
        try {
          const nav = await call('Page.navigate', { url }, timeoutMs);
          if (nav.errorText) throw new Error(`navigation to ${url} failed: ${nav.errorText}`);
          const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`load of ${url} timed out after ${timeoutMs}ms`)), timeoutMs); });
          await Promise.race([loaded, limit]);
        } finally {
          clearTimeout(timer);
          off();
        }
      },
      async waitFor(expression, timeoutMs = 30000) {
        const end = Date.now() + timeoutMs;
        let last = '';
        for (;;) {
          try {
            if (await evaluate(expression, { timeoutMs: 10000 })) return;
          } catch (e) { last = e.message; }
          if (Date.now() > end) throw new Error(`waitFor timed out after ${timeoutMs}ms${last ? ` (last error: ${last})` : ''}`);
          await sleep(100);
        }
      },
      async screenshot(file) {
        const r = await call('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
      },
      async close() {
        try { await send('Target.closeTarget', { targetId }, undefined, 5000); } catch { /* the browser may be gone */ }
      },
    };
  };

  return { newPage, close };
}
