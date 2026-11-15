import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubLookup } from './stub-lookup.mjs';
import { checkTarget, guardedFetch, isPublicAddress, NetRefusal } from '../scripts/lib/net.mjs';

test('private and reserved IPv4 ranges are not public', () => {
  for (const ip of ['0.0.0.0', '0.1.2.3', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.5', '192.168.1.1', '198.18.0.1', '198.19.255.255', '198.51.100.9', '203.0.113.9', '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('private and reserved IPv6 ranges are not public', () => {
  for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1','ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '0:0:0:0:0:0:0:1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('public addresses pass, including the edges of blocked ranges', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '198.17.255.255', '198.20.0.1', '2606:4700::1', '::ffff:93.184.216.34', '64:ff9b::5db8:d822']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  assert.equal(isPublicAddress('not an address'), false);
});

const refused = (url, lookup) => assert.rejects(checkTarget(url, lookup), NetRefusal, url);

test('checkTarget refuses local hosts, literal private addresses and odd schemes', async () => {
  for (const url of ['http://localhost/', 'http://a.localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://169.254.169.254/', 'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'file:///etc/passwd', 'ftp://example.com/']) {
    await refused(url);
  }
});

test('checkTarget uses the lookup answers when one is given', async () => {
  await refused('https://example.com/', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
  await checkTarget('https://example.com/', async () => [{ address: '93.184.216.34', family: 4 }]);
});

test('checkTarget refuses when the lookup fails, rather than fetching unchecked', async () => {
  await refused('https://example.com/', async () => { throw new Error('ENOTFOUND'); });
});

const reply = (status, headers = {}) => new Response(null, { status, headers });

test('guardedFetch follows public redirects, resolves relative ones and returns the final address', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.redirect);
    if (url === 'https://a.example.com/start') return reply(301, { Location: 'https://b.example.com/mid' });
    if (url === 'https://b.example.com/mid') return reply(302, { Location: '/dir/end' });
    return reply(200);
  };
  const { res, url } = await guardedFetch(fetchImpl, 'https://a.example.com/start', {}, { lookup: stubLookup });
  assert.equal(res.status, 200);
  assert.equal(url, 'https://b.example.com/dir/end');
  assert.deepEqual(seen, ['manual', 'manual', 'manual']);
});

test('guardedFetch refuses a redirect to a private address and makes no request to it', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return reply(302, { Location: 'http://127.0.0.1/' });
  };
  await assert.rejects(guardedFetch(fetchImpl, 'https://example.com/', {}, { lookup: stubLookup }), NetRefusal);
  assert.deepEqual(seen, ['https://example.com/']);
});

test('guardedFetch allows five redirects and refuses a sixth', async () => {
  const chain = (n) => async (url) => {
    const i = Number(new URL(url).pathname.slice(1) || 0);
    return i < n ? reply(302, { Location: `/${i + 1}` }) : reply(200);
  };
  const ok = await guardedFetch(chain(5), 'https://example.com/', {}, { lookup: stubLookup });
  assert.equal(ok.url, 'https://example.com/5');
  await assert.rejects(guardedFetch(chain(6), 'https://example.com/', {}, { lookup: stubLookup }), /too many redirects/);
});

test('checkTarget refuses a host when the lookup is null or not a function', async () => {
  await refused('https://example.com/', null);
  await refused('https://example.com/', 'nope');
});

test('guardedFetch refuses a null lookup and never calls fetchImpl', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return reply(200); };
  await assert.rejects(guardedFetch(fetchImpl, 'https://example.com/', {}, { lookup: null }), /could not be checked/);
  assert.equal(calls, 0);
});

test('a literal public address needs no lookup', async () => {
  await checkTarget('https://93.184.216.34/', null);
  const { res } = await guardedFetch(async () => reply(200), 'https://93.184.216.34/', {}, { lookup: null });
  assert.equal(res.status, 200);
});
