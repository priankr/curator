import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { imageSize } from '../scripts/lib/imagesize.mjs';

const NONE = { type: null, width: null, height: null };

function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  return b;
}

function gif(w, h) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

function sof(marker, w, h) {
  const b = Buffer.alloc(19);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(17, 2);
  b[4] = 8;
  b.writeUInt16BE(h, 5);
  b.writeUInt16BE(w, 7);
  b[9] = 3;
  return b;
}

function segment(marker, size) {
  const b = Buffer.alloc(2 + size);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(size, 2);
  return b;
}

const SOI = Buffer.from([0xff, 0xd8]);

function webpWrap(chunk, body) {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(12 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write(chunk, 12, 'latin1');
  head.writeUInt32LE(body.length, 16);
  return Buffer.concat([head, body]);
}

function webpLossy(w, h) {
  const body = Buffer.alloc(10);
  body.writeUInt8(0x9d, 3);
  body.writeUInt8(0x01, 4);
  body.writeUInt8(0x2a, 5);
  body.writeUInt16LE(w, 6);
  body.writeUInt16LE(h, 8);
  return webpWrap('VP8 ', body);
}

function webpLossless(w, h) {
  const body = Buffer.alloc(5);
  body[0] = 0x2f;
  body.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 1);
  return webpWrap('VP8L', body);
}

function webpExtended(w, h) {
  const body = Buffer.alloc(10);
  body.writeUIntLE(w - 1, 4, 3);
  body.writeUIntLE(h - 1, 7, 3);
  return webpWrap('VP8X', body);
}

const svg = (text) => Buffer.from(text, 'utf8');

test('png reads the header size', () => {
  assert.deepEqual(imageSize(png(640, 480)), { type: 'png', width: 640, height: 480 });
});

test('gif reads the logical screen size', () => {
  assert.deepEqual(imageSize(gif(320, 200)), { type: 'gif', width: 320, height: 200 });
});

test('jpeg reads the first start of frame marker', () => {
  assert.deepEqual(imageSize(Buffer.concat([SOI, sof(0xc0, 800, 600)])), { type: 'jpeg', width: 800, height: 600 });
  assert.deepEqual(imageSize(Buffer.concat([SOI, sof(0xc2, 1200, 630)])), { type: 'jpeg', width: 1200, height: 630 });
});

test('jpeg skips an EXIF segment before the frame', () => {
  const b = Buffer.concat([SOI, segment(0xe1, 300), segment(0xe0, 14), sof(0xc2, 1920, 1080)]);
  assert.deepEqual(imageSize(b), { type: 'jpeg', width: 1920, height: 1080 });
});

test('jpeg skips fill bytes and standalone markers, and ignores C4, C8 and CC', () => {
  const b = Buffer.concat([SOI, Buffer.from([0xff, 0xff, 0xff, 0x01, 0xff, 0xd0]), segment(0xc4, 20), segment(0xc8, 6), segment(0xcc, 6), sof(0xc1, 50, 40)]);
  assert.deepEqual(imageSize(b), { type: 'jpeg', width: 50, height: 40 });
});

test('webp reads lossy, lossless and extended chunks', () => {
  assert.deepEqual(imageSize(webpLossy(500, 300)), { type: 'webp', width: 500, height: 300 });
  assert.deepEqual(imageSize(webpLossless(1024, 513)), { type: 'webp', width: 1024, height: 513 });
  assert.deepEqual(imageSize(webpExtended(2000, 1001)), { type: 'webp', width: 2000, height: 1001 });
});

test('svg reads width and height', () => {
  assert.deepEqual(imageSize(svg('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>')), { type: 'svg', width: 120, height: 80 });
});

test('svg falls back to the viewBox', () => {
  assert.deepEqual(imageSize(svg('<svg viewBox="0 0 300.5 100"></svg>')), { type: 'svg', width: 300.5, height: 100 });
  assert.deepEqual(imageSize(svg("<svg width='50%' height='50%' viewBox='0,0,40,20'></svg>")), { type: 'svg', width: 40, height: 20 });
});

test('svg accepts px units but not other units', () => {
  assert.deepEqual(imageSize(svg('<svg width="64px" height="32px"></svg>')), { type: 'svg', width: 64, height: 32 });
  assert.deepEqual(imageSize(svg('<svg width="10em" height="5em" viewBox="0 0 20 10"></svg>')), { type: 'svg', width: 20, height: 10 });
});

test('svg with no size gives null dimensions', () => {
  assert.deepEqual(imageSize(svg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')), { type: 'svg', width: null, height: null });
});

test('svg may follow a BOM, declaration, comment and doctype', () => {
  const text = '\uFEFF<?xml version="1.0"?>\n<!-- note -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg width="10" height="20"></svg>';
  assert.deepEqual(imageSize(svg(text)), { type: 'svg', width: 10, height: 20 });
});

test('text that is not svg is not recognised', () => {
  assert.deepEqual(imageSize(svg('<html><body><svg width="1" height="1"></svg></body></html>')), NONE);
  assert.deepEqual(imageSize(svg('hello')), NONE);
});

test('truncated headers are not recognised', () => {
  const cases = [[png(10, 10), 24], [gif(10, 10), 10], [Buffer.concat([SOI, sof(0xc0, 10, 10)]), 11], [webpLossy(10, 10), 30], [webpLossless(10, 10), 25], [webpExtended(10, 10), 30]];
  for (const [full, min] of cases) {
    for (let n = 0; n < min; n++) assert.equal(imageSize(full.subarray(0, n)).type, null, `${n} of ${min}`);
    assert.notEqual(imageSize(full.subarray(0, min)).type, null);
  }
});

test('empty input and random bytes never throw', () => {
  assert.deepEqual(imageSize(Buffer.alloc(0)), NONE);
  for (let i = 0; i < 300; i++) {
    const out = imageSize(randomBytes(1 + (i % 64)));
    assert.ok(out.type === null || typeof out.type === 'string');
  }
  assert.deepEqual(imageSize(Buffer.from([0xff, 0xd8, 0xff])), NONE);
  assert.deepEqual(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00])), NONE);
});
