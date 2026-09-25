// Background service worker. It is the only code that reads the permanent Decart API key.
//
// The fitting room asks it to:
//   token     → mint a short-lived Decart client token (the room never sees the real key)
//   image     → download a dragged image or product-page link without site cookies
//   status    → report whether a key is saved
//   test-key  → check a key from the settings page before saving it

import { loadSettings } from "./lib/settings"

const DECART_API = "https://api.decart.ai"
const MODEL = "lucy-vton-latest"
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"])

type OpenWearRequest =
  | { type: "image"; url?: string }
  | { type: "token" }
  | { type: "status" }
  | { type: "test-key"; apiKey?: string }

/** The saved key, or the one being tested. "NO_KEY" is translated into a friendly message by the room. */
async function apiKey(override?: string) {
  const key = (override ?? (await loadSettings()).apiKey).trim()
  if (!key) throw new Error("NO_KEY")
  return key
}

/** Calls the Decart REST API with a timeout and readable errors ("KEY_REJECTED" for bad keys). */
async function decart(path: string, key: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${DECART_API}${path}`, { ...init, headers: { ...init.headers, "X-API-KEY": key }, signal: controller.signal })
    if (response.status === 401 || response.status === 403) throw new Error("KEY_REJECTED")
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      let detail = text
      try { detail = JSON.parse(text).detail || text } catch { /* Plain-text error body. */ }
      throw new Error(`Decart returned ${response.status}${detail ? `: ${String(detail).slice(0, 160)}` : ""}`)
    }
    return response
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("Decart took too long to respond")
    throw error
  } finally { clearTimeout(timeout) }
}

/** Mints a 60-second client token scoped to Lucy VTON, per Decart's client-token guidance.
 *  maxSessionDuration makes Decart itself end the session at the user's limit. */
async function createToken(override?: string) {
  const [key, settings] = await Promise.all([apiKey(override), loadSettings()])
  const response = await decart("/v1/client/tokens", key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60, allowedModels: [MODEL], constraints: { realtime: { maxSessionDuration: Math.round(settings.sessionMinutes * 60) } } })
  }, 15000)
  const token = await response.json()
  return { apiKey: token.apiKey as string, fastMode: settings.fastMode, sessionSeconds: Math.round(settings.sessionMinutes * 60) }
}

// ---------- Image download ----------

/** Only public http(s) URLs: never localhost or private-network addresses. */
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

/** Returns a dragged image as a data URL. A product-page link resolves to its og:image / twitter:image. */
async function getImage(url: string) {
  url = imageUrl(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetchPublic(url, controller.signal)
    const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || ""
    if (mime === "text/html") {
      const page = new TextDecoder().decode(await readBytes(response, MAX_PAGE_BYTES, { truncate: true }))
      const preview = previewImageUrl(page, url)
      if (!preview) throw new Error("This link has no public product image. Drag the photo itself or upload a file")
      const image = await fetchPublic(imageUrl(preview), controller.signal)
      return imageDataUrl(image)
    }
    return imageDataUrl(response)
  } finally { clearTimeout(timeout) }
}

/** credentials: "omit" so the shop never sees the request as coming from the logged-in user. */
async function fetchPublic(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "omit", redirect: "follow", signal })
  if (!response.ok) throw new Error(`Image or page returned ${response.status}`)
  return response
}

/** Reads a response body up to `limit` bytes. Pages are truncated (preview tags live in <head>);
 *  images over the limit are rejected. */
async function readBytes(response: Response, limit: number, { truncate = false } = {}) {
  if (!truncate && Number(response.headers.get("content-length")) > limit) throw new Error("Image exceeds 8 MB")
  if (!response.body) throw new Error("Image or page could not be read")
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  while (total < limit) {
    const { done, value } = await reader.read()
    if (done) break
    if (!truncate && total + value.length > limit) { await reader.cancel(); throw new Error("Image exceeds 8 MB") }
    const part = value.subarray(0, limit - total)
    chunks.push(part); total += part.length
  }
  if (total >= limit) await reader.cancel()
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

/** Finds the page's share image in its <meta property="og:image"> style tags. */
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
  const bytes = await readBytes(response, MAX_IMAGE_BYTES)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

// ---------- Message handling ----------

chrome.runtime.onMessage.addListener((message: OpenWearRequest, sender, sendResponse) => {
  // Only OpenWear's own pages (fitting room, settings) may use the key; content scripts on shops may not.
  const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""))
  if (!fromExtensionPage) return false
  const run = async () => {
    switch (message?.type) {
      case "image": return getImage(message.url || "")
      case "token": return createToken()
      case "status": return { hasKey: !!(await loadSettings()).apiKey.trim() }
      case "test-key": { await createToken(message.apiKey); return { ok: true } }
      default: throw new Error("Unknown OpenWear request")
    }
  }
  run().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: String(error?.message || error) }))
  return true
})

// First install opens settings so the user can paste their key.
chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === "install" && !(await loadSettings()).apiKey) chrome.runtime.openOptionsPage()
  // Content scripts only run on pages loaded after install; add the launcher to tabs that are already open.
  const script = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0]
  if (!script) return
  for (const tab of await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] })) {
    if (tab.id) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [script] }).catch(() => {})
  }
})

// Dev-only: an unpacked install can be reloaded from a localhost page, so new builds can be picked
// up without visiting the extensions page. Packed (store) installs ignore this.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== "dev-reload" || !/^http:\/\/localhost(:\d+)?\//.test(sender.url || "")) return false
  chrome.management.getSelf().then(self => {
    if (self.installType !== "development") return sendResponse({ ok: false })
    sendResponse({ ok: true })
    setTimeout(() => chrome.runtime.reload(), 100)
  })
  return true
})
