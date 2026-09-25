import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

let listener
globalThis.chrome = {
  storage: { local: { get: async () => ({}) } },
  runtime: { id: "ext", getURL: path => `chrome-extension://ext/${path}`, onMessage: { addListener: callback => { listener = callback } }, onInstalled: { addListener() {} }, onMessageExternal: { addListener() {} } }
}

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../background.ts", import.meta.url))], bundle: true, format: "esm", write: false })
await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)

function requestImage(url) {
  return new Promise(resolve => {
    listener({ type: "image", url }, { id: "ext", url: "chrome-extension://ext/tabs/room.html" }, resolve)
  })
}

test("a large Pinterest-style pin page resolves its public preview image", async () => {
  const page = "https://www.pinterest.com/pin/123/"
  const image = "https://i.pinimg.com/736x/test.jpg?width=736&quality=90"
  const html = `<html><head><meta content="${image.replaceAll("&", "&amp;")}" property="og:image"/><\/head><body>${"x".repeat(1_200_000)}</body></html>`
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url === page) return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-length": String(html.length) } })
    if (url === image) return new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } })
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    const reply = await requestImage(page)
    assert.equal(reply.ok, true)
    assert.equal(reply.data, "data:image/jpeg;base64,/9j/")
    assert.deepEqual(calls.map(call => call.url), [page, image])
    assert.ok(calls.every(call => call.options.credentials === "omit" && call.options.redirect === "follow"))
  } finally { globalThis.fetch = originalFetch }
})

test("a page without an image returns a useful link-specific error", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("<html><head></head></html>", { headers: { "content-type": "text/html" } })
  try {
    const reply = await requestImage("https://example.com/product")
    assert.equal(reply.ok, false)
    assert.match(reply.error, /no public product image/i)
  } finally { globalThis.fetch = originalFetch }
})

test("an optional live public product-page link resolves to an image", { skip: !process.env.OPENWEAR_LIVE_PIN_URL }, async () => {
  const reply = await requestImage(process.env.OPENWEAR_LIVE_PIN_URL)
  assert.equal(reply.ok, true, reply.error)
  assert.match(reply.data, /^data:image\/(jpeg|png|webp);base64,/)
})
