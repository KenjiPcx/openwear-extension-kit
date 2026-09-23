import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const PAGE_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const blocked = new BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(subnet, prefix, 'ipv4');

export function publicImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Use a shorter public product link.');
  let url;
  try { url = new URL(value); } catch { throw Error('Enter a valid HTTPS product or image link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname) ||
      url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')) {
    throw Error('Only public HTTPS product and image links are supported.');
  }
  url.hash = '';
  return url;
}

export function isPublicIPv4(address) {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

async function pinnedPublicAddress(hostname) {
  const records = await lookup(hostname, { all: true, family: 4 });
  if (!records.length || records.some(record => !isPublicIPv4(record.address))) throw Error('This link does not resolve to a public image host.');
  return records[0].address;
}

export function pinnedLookup(address) {
  return (_host, options, callback) => options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4);
}

async function requestPublic(url, limit) {
  const pinned = await pinnedPublicAddress(url.hostname);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      agent: false,
      headers: { 'Accept': 'image/avif,image/webp,image/png,image/jpeg,text/html;q=0.7', 'Accept-Encoding': 'identity', 'User-Agent': 'CartroomPreview/1.0' },
      lookup: pinnedLookup(pinned),
      timeout: 10000,
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(Error('This page or image is not publicly accessible.')); return; }
      const contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (!IMAGE_TYPES.has(contentType) && contentType !== 'text/html') { response.destroy(); reject(Error('This link does not provide a supported image or product page.')); return; }
      if (Number(response.headers['content-length']) > limit) { response.destroy(); reject(Error('This image or page is too large.')); return; }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) { response.destroy(); reject(Error('This image or page is too large.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ contentType, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Error('The image host took too long to respond.')));
    request.on('error', reject);
    request.end();
  });
}

export function previewImageUrl(html, pageUrl) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map(match => [match[1].toLowerCase(), match[2] || match[3] || match[4]]));
    const name = (attributes.property || attributes.name || '').toLowerCase();
    if (!['og:image', 'og:image:secure_url', 'twitter:image'].includes(name) || !attributes.content) continue;
    const decoded = attributes.content.replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
    try { return new URL(decoded, pageUrl).href; } catch { /* Continue to next preview meta tag. */ }
  }
  return null;
}

function isImage(body, contentType) {
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === 'image/png') return body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (contentType === 'image/webp') return body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export async function resolveProductImage(input, { request = requestPublic } = {}) {
  const original = publicImageUrl(input);
  const first = await request(original, IMAGE_LIMIT);
  let result = first;
  if (first.contentType === 'text/html') {
    if (first.body.length > PAGE_LIMIT) throw Error('This product page is too large to inspect. Drag the image itself or upload a file.');
    const preview = previewImageUrl(first.body.toString('utf8'), original);
    if (!preview) throw Error('This product page has no public image. Drag the image itself or upload a file.');
    result = await request(publicImageUrl(preview), IMAGE_LIMIT);
  }
  if (!IMAGE_TYPES.has(result.contentType) || !isImage(result.body, result.contentType)) throw Error('Use a JPG, PNG or WebP product image.');
  if (result.body.length > IMAGE_LIMIT) throw Error('Image exceeds 4 MB.');
  return `data:${result.contentType};base64,${result.body.toString('base64')}`;
}
