import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIPv4, pinnedLookup, previewImageUrl, publicImageUrl, resolveProductImage } from '../product-image.mjs';
import { createApp } from '../server.mjs';

test('rejects local addresses and non-HTTPS links', () => {
  for (const address of ['http://shop.example/item', 'https://127.0.0.1/item', 'https://localhost/item', 'https://user:pass@shop.example/item']) {
    assert.throws(() => publicImageUrl(address));
  }
  assert.equal(isPublicIPv4('8.8.8.8'), true);
  for (const address of ['127.0.0.1','10.1.2.3','169.254.1.1','192.168.1.2','100.64.0.1']) assert.equal(isPublicIPv4(address), false);
});

test('pinned DNS lookup supports both Node connection lookup modes', () => {
  const run = pinnedLookup('8.8.8.8');
  run('ignored.example', { all: true }, (_error, addresses) => assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]));
  run('ignored.example', {}, (_error, address, family) => { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
});

test('extracts public preview image from a product page', async () => {
  const image = 'https://cdn.example.net/top.jpg';
  const page = `<html><head><meta property="og:image" content="${image}"></head></html>`;
  const calls = [];
  const output = await resolveProductImage('https://shop.example/top', { request: async url => {
    calls.push(url.href);
    return url.href.includes('shop.example') ? { contentType: 'text/html', body: Buffer.from(page) } :
      { contentType: 'image/jpeg', body: Buffer.from([0xff,0xd8,0xff,0x00]) };
  }});
  assert.deepEqual(calls, ['https://shop.example/top', image]);
  assert.equal(output, 'data:image/jpeg;base64,/9j/AA==');
  assert.equal(previewImageUrl('<meta content="https://a.example/x.jpg?a=1&amp;b=2" property="og:image">', 'https://shop.example'), 'https://a.example/x.jpg?a=1&b=2');
});

test('refuses private preview targets and spoofed image bytes', async () => {
  await assert.rejects(resolveProductImage('https://shop.example/top', { request: async () =>
    ({ contentType: 'text/html', body: Buffer.from('<meta property="og:image" content="http://localhost/admin">') }) }));
  await assert.rejects(resolveProductImage('https://shop.example/top.jpg', { request: async () =>
    ({ contentType: 'image/jpeg', body: Buffer.from('<svg/>') }) }), /JPG, PNG or WebP/);
});

test('product-image endpoint scopes origin and rate-limits lookups', async t => {
  let calls = 0;
  const server = createApp({ getSettings: () => ({ key: '', code: '', seconds: 120 }), resolveImage: async () => { calls++; return 'data:image/jpeg;base64,/9j/'; } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = origin => fetch(`${base}/api/product-image`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({url:'https://shop.example/top'}) });
  assert.equal((await post('https://other.example')).status, 403);
  for (let index = 0; index < 12; index++) assert.equal((await post(base)).status, 200);
  assert.equal((await post(base)).status, 429);
  assert.equal(calls, 12);
});
