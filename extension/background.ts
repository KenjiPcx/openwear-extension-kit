const DEFAULT_SERVER = "http://127.0.0.1:4317"
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"])

type OpenWearRequest = { type: "config" | "catalog" | "token" | "image"; url?: string; code?: string }

function serverUrl(value: unknown) {
  const url = new URL(typeof value === "string" ? value : DEFAULT_SERVER)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use a local OpenWear URL such as http://127.0.0.1:4317")
  }
  return url.origin
}

async function getServer() {
  const saved = await chrome.storage.local.get("serverUrl")
  return serverUrl(saved.serverUrl)
}

async function api(path: string, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(`${await getServer()}${path}`, { ...init, signal: controller.signal })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error || `OpenWear returned ${response.status}`)
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function imageUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid image URL")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Drag a web image or upload a file")
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "0.0.0.0") {
    throw new Error("Private-network image URLs are not supported")
  }
  return url.href
}

async function getImage(url: string) {
  const server = await getServer()
  if (url.startsWith("starter:")) {
    const id = url.slice(8)
    if (!/^[a-z-]+$/.test(id)) throw new Error("Invalid starter garment")
    url = `${server}/static/garments/${id}.svg`
  } else {
    url = imageUrl(url)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetchPublic(url, controller.signal)
    const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || ""
    if (mime === "text/html") {
      const page = new TextDecoder().decode(await readPagePreview(response))
      const preview = previewImageUrl(page, url)
      if (!preview) throw new Error("This link has no public product image. Drag the photo itself or upload a file")
      const image = await fetchPublic(imageUrl(preview), controller.signal)
      return imageDataUrl(image)
    }
    return imageDataUrl(response)
  } finally { clearTimeout(timeout) }
}

async function fetchPublic(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal })
  if (!response.ok) throw new Error(`Image or page returned ${response.status}`)
  return response
}

async function readLimited(response: Response, limit: number, error: string) {
  if (Number(response.headers.get("content-length")) > limit) throw new Error(error)
  if (!response.body) throw new Error("Image or page could not be read")
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) { await reader.cancel(); throw new Error(error) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

async function readPagePreview(response: Response) {
  if (!response.body) throw new Error("Page could not be read")
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    const part = value.subarray(0, MAX_PAGE_BYTES - total)
    chunks.push(part); total += part.length
    if (total === MAX_PAGE_BYTES) { await reader.cancel(); break }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

function previewImageUrl(html: string, pageUrl: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), match[2] || match[3] || match[4]]))
    const name = (attributes.property || attributes.name || "").toLowerCase()
    if (!["og:image", "og:image:secure_url", "twitter:image"].includes(name) || !attributes.content) continue
    const decoded = attributes.content.replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    try { return new URL(decoded, pageUrl).href } catch { /* Try the next tag. */ }
  }
  return null
}

async function imageDataUrl(response: Response) {
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || ""
  if (!IMAGE_TYPES.has(mime)) throw new Error("Use a JPG, PNG or WebP image")
  const bytes = await readLimited(response, MAX_IMAGE_BYTES, "Image exceeds 4 MB")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

chrome.runtime.onMessage.addListener((message: OpenWearRequest, sender, sendResponse) => {
  if (!sender.tab || !sender.url || !/^https?:\/\//.test(sender.url)) return false
  const run = async () => {
    switch (message?.type) {
      case "config": return api("/api/config")
      case "catalog": return api("/api/garments")
      case "token": return api("/api/extension-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: message.code || "", pageOrigin: new URL(sender.url).origin }) })
      case "image": return getImage(message.url || "")
      default: throw new Error("Unknown OpenWear request")
    }
  }
  run().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: String(error?.message || error) }))
  return true
})
