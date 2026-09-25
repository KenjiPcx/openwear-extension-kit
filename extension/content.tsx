// Content script: runs on every website. It draws the "AI fitting room" launcher and the floating
// window, and hosts the fitting room (tabs/room.html) inside that window as an iframe.
//
// Drags that start on the shop page are caught here, in the page's own frame, because the browser
// won't reliably hand a page drag to a cross-origin iframe. The image URL and product name are then
// posted to the fitting room.

import { useEffect, useRef, useState } from "react"
import type { PlasmoCSConfig, PlasmoGetRootContainer } from "plasmo"
import styleText from "data-text:./style.css"
import { nameFromFile, parseDrop } from "./lib/drop"

export const config: PlasmoCSConfig = { matches: ["http://*/*", "https://*/*"], all_frames: false, run_at: "document_idle" }

// Mount into <body> once the page has settled (load, or 8s for pages whose load event drags on).
// Inserting during load breaks sites that hydrate the whole document with React, and SPA re-renders
// such as Pinterest's can wipe foreign nodes, so the host re-attaches itself whenever it is removed.
export const getRootContainer: PlasmoGetRootContainer = async () => {
  const loaded = document.readyState === "complete" ? Promise.resolve() : new Promise(resolve => window.addEventListener("load", resolve, { once: true }))
  await Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 8000))])
  await new Promise(resolve => setTimeout(resolve, 400))
  document.querySelectorAll("openwear-root").forEach(stale => stale.remove())
  const host = document.createElement("openwear-root")
  host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;"
  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = styleText
  const container = document.createElement("div")
  shadow.append(style, container)
  const attach = () => {
    if (host.isConnected || !(document.body || document.documentElement)) return
    ;(document.body || document.documentElement).append(host)
  }
  attach()
  // Observe the document itself so a replaced <html> or <body> is still noticed, with a slow poll as backup.
  new MutationObserver(attach).observe(document, { childList: true, subtree: true })
  setInterval(attach, 1000)
  return container
}

type Rect = { x: number; y: number; width: number; height: number }
type DraggedGarment = { url: string; name: string }

const ROOM_URL = chrome.runtime.getURL("tabs/room.html")
const ROOM_ORIGIN = new URL(ROOM_URL).origin
const HEADER = 52

function defaultRect(): Rect {
  const width = Math.min(520, window.innerWidth - 32)
  const height = Math.min(600, window.innerHeight - 48)
  return { x: window.innerWidth - width - 24, y: Math.max(16, (window.innerHeight - height) / 2), width, height }
}

function clampRect(rect: Rect): Rect {
  const width = Math.max(320, Math.min(rect.width, window.innerWidth - 16))
  const height = Math.max(380, Math.min(rect.height, window.innerHeight - 16))
  return { width, height, x: Math.max(8, Math.min(rect.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(rect.y, window.innerHeight - height - 8)) }
}

/** Keeps short, descriptive text; drops empty or generic labels like "image" or Pinterest's "Pin". */
const usefulText = (value?: string | null) => {
  const text = value?.replace(/\s+/g, " ").trim() || ""
  return text.length >= 3 && text.length <= 160 && !/^(image|photo|picture|product|thumbnail|img|pin)\b/i.test(text) ? text : ""
}

/** Best-effort product name for a dragged image: alt text, the nearest product-card title, then the page title. */
function productName(image: HTMLImageElement | null, link: HTMLAnchorElement | null) {
  const alt = usefulText(image?.alt) || usefulText(image?.title)
  if (alt) return alt
  let node: Element | null = image || link
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const title = node.querySelector?.("h1, h2, h3, h4, [class*='name' i], [class*='title' i], [data-testid*='name' i]")
    const text = usefulText(title?.textContent)
    if (text) return text
  }
  const large = image && image.getBoundingClientRect().width > 280
  if (large) return usefulText(document.querySelector("h1")?.textContent) || usefulText(document.querySelector<HTMLMetaElement>("meta[property='og:title']")?.content)
  return usefulText(link?.textContent)
}

/** The sharpest version of an image: its largest srcset candidate, and Pinterest's 736px rendition instead of grid thumbnails. */
function bestImageUrl(image: HTMLImageElement) {
  const candidates = image.srcset.split(",").map(entry => entry.trim().split(/\s+/)).filter(([url]) => url)
    .map(([url, size]) => ({ url, size: parseFloat(size) || 0 })).sort((a, b) => b.size - a.size)
  let url = candidates[0]?.url || image.currentSrc || image.src
  try { url = new URL(url, document.baseURI).href } catch { return "" }
  return url.replace(/^(https:\/\/i\.pinimg\.com\/)(\d+x\d*|\d+x)\//, "$1736x/")
}

function OpenWearShell() {
  const [open, setOpen] = useState(false)
  const [minimizedLauncher, setMinimizedLauncher] = useState(false)
  const [rect, setRect] = useState<Rect>(defaultRect)
  const [dragActive, setDragActive] = useState(false)
  const [moving, setMoving] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const draggedRef = useRef<DraggedGarment | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  // Messages to the fitting room are addressed to the extension origin, so no other frame can read them.
  const toRoom = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(message, ROOM_ORIGIN)

  // The toolbar popup opens the room by messaging this script.
  useEffect(() => {
    const listener = (message: { type?: string }, _sender: chrome.runtime.MessageSender, sendResponse: (response: { ok: boolean }) => void) => {
      if (message.type === "openwear:open") { setMinimizedLauncher(false); setOpen(true) }
      if (message.type?.startsWith("openwear:")) sendResponse({ ok: true })
    }
    chrome.runtime.onMessage.addListener(listener)
    const onResize = () => setRect(current => clampRect(current))
    window.addEventListener("resize", onResize)
    return () => { chrome.runtime.onMessage.removeListener(listener); window.removeEventListener("resize", onResize) }
  }, [])

  // Record what is being dragged on the page so the drop target can forward a clean image URL and name.
  useEffect(() => {
    const onDragStart = (event: DragEvent) => {
      if (!openRef.current) return
      const path = event.composedPath()
      const target = event.target as Element | null
      const link = (path.find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined) || null
      const image = (path.find(node => node instanceof HTMLImageElement) as HTMLImageElement | undefined)
        || (target instanceof Element ? target.querySelector("img") : null)
      const url = (image && bestImageUrl(image)) || link?.href || ""
      draggedRef.current = /^https?:\/\//.test(url) ? { url, name: productName(image || null, link) } : null
      setDragActive(true)
      toRoom({ type: "openwear:drag", active: true })
    }
    const onDragEnd = () => { setDragActive(false); toRoom({ type: "openwear:drag", active: false }) }
    document.addEventListener("dragstart", onDragStart, true)
    document.addEventListener("dragend", onDragEnd, true)
    return () => { document.removeEventListener("dragstart", onDragStart, true); document.removeEventListener("dragend", onDragEnd, true) }
  }, [])

  // A transparent layer over the iframe during page drags, so the drop lands in this frame.
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)
    toRoom({ type: "openwear:drag", active: false })
    const file = [...event.dataTransfer.files].find(item => item.type.startsWith("image/"))
    if (file) { toRoom({ type: "openwear:garment", file, name: nameFromFile(file) }); return }
    // Prefer what dragstart recorded (sharpest image URL + product name), else read the drop data.
    const dragged = draggedRef.current
    draggedRef.current = null
    const incoming = dragged || parseDrop(event.dataTransfer)
    if (incoming?.url) toRoom({ type: "openwear:garment", url: incoming.url, name: usefulText(incoming.name) })
  }

  // Drag the window by its header; resize from the bottom-left corner (the window hugs the right edge).
  const startMove = (event: React.PointerEvent) => {
    if ((event.target as Element).closest("button")) return
    event.preventDefault()
    const startX = event.clientX, startY = event.clientY, origin = rect
    setMoving(true)
    const move = (next: PointerEvent) => setRect(clampRect({ ...origin, x: origin.x + next.clientX - startX, y: origin.y + next.clientY - startY }))
    const end = () => { setMoving(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end) }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end)
  }

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX, startY = event.clientY, origin = rect
    setMoving(true)
    const move = (next: PointerEvent) => setRect(clampRect({ ...origin, x: origin.x + (next.clientX - startX), width: origin.width - (next.clientX - startX), height: origin.height + next.clientY - startY }))
    const end = () => { setMoving(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end) }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end)
  }

  return <div className="ow-root">
    {!open && !minimizedLauncher && <div className="ow-launcher">
      <button className="ow-launcher-main" onClick={() => setOpen(true)} aria-label="Open AI fitting room">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></svg>
        <span>AI fitting room</span>
      </button>
      <button className="ow-launcher-close" onClick={() => setMinimizedLauncher(true)} aria-label="Hide fitting-room button">×</button>
    </div>}

    {open && <section className={`ow-window ${moving ? "is-moving" : ""}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-label="OpenWear fitting room">
      <header className="ow-header" onPointerDown={startMove}>
        <strong>Try-On <span aria-hidden="true">✦</span> OpenWear</strong>
        <button onClick={() => setOpen(false)} title="Close fitting room" aria-label="Close fitting room">−</button>
      </header>
      <div className="ow-body" style={{ height: rect.height - HEADER }}>
        <iframe ref={frameRef} src={ROOM_URL} allow="camera; autoplay; clipboard-write" title="OpenWear fitting room" />
        {dragActive && <div className="ow-drop-catcher" onDragEnter={e => e.preventDefault()} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy" }} onDrop={onDrop} />}
      </div>
      <div className="ow-resize" onPointerDown={startResize} title="Drag to resize" />
    </section>}
  </div>
}

export default OpenWearShell
