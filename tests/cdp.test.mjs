import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { FrameDecoder, connectWebSocket, encodeFrame, keyEvents } from '../scripts/lib/cdp.mjs';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const decodeAll = (buf) => {
  const got = { messages: [], pings: [], closes: [] };
  new FrameDecoder({ onMessage: (m) => got.messages.push(m), onPing: (p) => got.pings.push(p), onClose: (c) => got.closes.push(c) }).push(buf);
  return got;
};

for (const size of [0, 125, 126, 65535, 65536]) {
  test(`round trip of a ${size} byte payload, masked and unmasked`, () => {
    const text = 'a'.repeat(size);
    for (const mask of [false, true]) {
      const frame = encodeFrame(0x1, text, { mask });
      assert.equal(frame[1] & 0x80, mask ? 0x80 : 0);
      assert.deepEqual(decodeAll(frame).messages, [text]);
    }
  });
}

test('length field uses 7, 16 and 64 bit forms', () => {
  assert.equal(encodeFrame(0x1, 'x'.repeat(125), { mask: false })[1], 125);
  assert.equal(encodeFrame(0x1, 'x'.repeat(126), { mask: false })[1], 126);
  assert.equal(encodeFrame(0x1, 'x'.repeat(65535), { mask: false })[1], 126);
  assert.equal(encodeFrame(0x1, 'x'.repeat(65536), { mask: false })[1], 127);
});

test('masking changes the bytes on the wire but not the decoded text', () => {
  const frame = encodeFrame(0x1, 'hello world, hello world', { mask: true });
  assert.ok(!frame.includes(Buffer.from('hello world')));
  assert.deepEqual(decodeAll(frame).messages, ['hello world, hello world']);
});

test('fragmented messages are reassembled, even when split across chunks', () => {
  const frames = Buffer.concat([
    encodeFrame(0x1, 'one ', { mask: false, fin: false }),
    encodeFrame(0x0, 'two ', { mask: true, fin: false }),
    encodeFrame(0x0, 'three', { mask: false, fin: true }),
  ]);
  const messages = [];
  const decoder = new FrameDecoder({ onMessage: (m) => messages.push(m) });
  for (let i = 0; i < frames.length; i += 3) decoder.push(frames.subarray(i, i + 3));
  assert.deepEqual(messages, ['one two three']);
});

test('a ping between fragments is reported and does not break the message', () => {
  const got = decodeAll(Buffer.concat([
    encodeFrame(0x1, 'ab', { mask: false, fin: false }),
    encodeFrame(0x9, 'hi', { mask: false }),
    encodeFrame(0x0, 'cd', { mask: false }),
  ]));
  assert.deepEqual(got.messages, ['abcd']);
  assert.equal(got.pings[0].toString(), 'hi');
});

test('close frames report their status code', () => {
  const code = Buffer.alloc(2);
  code.writeUInt16BE(1000);
  assert.deepEqual(decodeAll(encodeFrame(0x8, code, { mask: false })).closes, [1000]);
});

// A tiny server that completes the handshake, then runs the given handler on the socket.
const withServer = async (onSocket, run) => {
  const server = createServer();
  const sockets = [];
  server.on('upgrade', (req, socket) => {
    sockets.push(socket);
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    onSocket(socket);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await run(`ws://127.0.0.1:${server.address().port}/`);
  } finally {
    for (const s of sockets) s.destroy();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
};

test('client handshake, masked sends, large frames and pong over a real socket', async () => {
  const big = 'x'.repeat(200000);
  let sawPong = null;
  await withServer((socket) => {
    const decoder = new FrameDecoder({
      onMessage: (m) => {
        // The server echoes the masked client text back unmasked, then pings.
        socket.write(encodeFrame(0x1, m, { mask: false }));
        socket.write(encodeFrame(0x9, 'p', { mask: false }));
      },
      onClose: () => socket.end(),
    });
    socket.on('data', (d) => {
      // A raw check that the pong from the client arrives masked.
      if ((d[0] & 0x0f) === 0xa) sawPong = d;
      decoder.push(d);
    });
  }, async (url) => {
    const ws = await connectWebSocket(url);
    const echoed = new Promise((r) => { ws.onmessage = r; });
    ws.send(big);
    assert.equal(await echoed, big);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(sawPong, 'the client answered the ping');
    assert.equal(sawPong[1] & 0x80, 0x80);
    const closed = new Promise((r) => { ws.onclose = r; });
    ws.close();
    await closed;
  });
});

test('a wrong accept header is rejected', async () => {
  const server = createServer();
  const sockets = [];
  server.on('upgrade', (req, socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: nope\r\n\r\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(connectWebSocket(`ws://127.0.0.1:${server.address().port}/`), /accept/);
  } finally {
    for (const s of sockets) s.destroy();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('keyEvents builds a raw key down and a key up, with the shift modifier for Shift+Tab', () => {
  const [down, up] = keyEvents('Tab', { shift: true });
  assert.deepEqual([down.type, up.type], ['rawKeyDown', 'keyUp']);
  assert.equal(down.windowsVirtualKeyCode, 9);
  assert.equal(down.modifiers, 8);
  assert.equal(keyEvents('Tab')[0].modifiers, 0);
  assert.throws(() => keyEvents('F13'), /unsupported key/);
});

test('keyEvents gives Enter and Space text so a focused button activates', () => {
  assert.equal(keyEvents('Enter')[0].type, 'keyDown');
  assert.equal(keyEvents('Enter')[0].text.charCodeAt(0), 13);
  assert.equal(keyEvents(' ')[0].code, 'Space');
});
