// The fitting room: camera, body-framing guide, Decart live try-on and the laser-scan effect.
//
// It runs as an extension page (tabs/room.html) inside an iframe that content.tsx places on the shop.
// Keeping it on the extension's own origin isolates the camera, the Decart session and the MediaPipe
// runtime from the shop's scripts and security policy.
//
// Flow: Enable camera → framing guide (head + shoulders in the outline) → garment dropped →
//       connect to Decart with that garment → laser scan while it applies → reveal the AI video.
//       Later garments reuse the same connection via set().

import { createDecartClient, models } from "../vendor/decart-sdk.mjs"
import { useCallback, useEffect, useRef, useState } from "react"
import { nameFromFile, parseDrop, type Incoming } from "../lib/drop"
import { buildPrompt, cleanName, normalizeImage } from "../lib/garment"
import { createPoseTracker, coverRect, guide, silhouetteBox, SILHOUETTE, type Point } from "../lib/vision"
import "./room.css"

type Reply<T> = { ok: true; data: T } | { ok: false; error: string }
type Phase = "idle" | "starting" | "framing" | "ready"
type GarmentStatus = "reading" | "waiting" | "fitting" | "live" | "failed"
type Garment = { id: number; name: string; preview: string; status: GarmentStatus }
type Token = { apiKey: string; fastMode: boolean; sessionSeconds: number }
type Notice = { message: string; action?: "settings" | "grant" | "restart" }

const model = models.realtime("lucy-vton-latest")
const SCAN_REVEAL_MS = 1300 // final top-to-bottom sweep that reveals the AI video
const SETTLE_MS = 900 // Decart needs a moment after set() before frames show the new garment
const HOLD_MS = 900 // how long the user must stay in the outline before framing completes
// The same page doubles as a full-tab "allow camera" screen when opened with ?grant (see GrantPage).
const isGrantPage = new URLSearchParams(location.search).has("grant")

/** Sends a request to background.ts, which holds the API key and fetches images. */
async function background<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  const response: Reply<T> = await chrome.runtime.sendMessage({ type, ...fields })
  if (!response?.ok) throw new Error((response as { error?: string })?.error || "OpenWear is unavailable")
  return response.data
}

/** Maps camera, key and network failures to a message plus the one action that fixes it. */
function friendly(error: any): Notice {
  const message = String(error?.message || error || "")
  if (message === "NO_KEY") return { message: "Add your Decart API key to start.", action: "settings" }
  if (message === "KEY_REJECTED" || error?.code === "INVALID_API_KEY") return { message: "Decart rejected your API key. Check it in settings.", action: "settings" }
  if (error?.name === "NotAllowedError") return { message: "Camera access is blocked for OpenWear.", action: "grant" }
  if (error?.name === "NotFoundError") return { message: "No camera found. Plug one in and try again." }
  if (error?.code?.startsWith?.("WEBRTC")) return { message: "Couldn't reach Decart's video servers. Check your network and try again.", action: "restart" }
  return { message: message || "Something went wrong. Try again.", action: "restart" }
}

/** Fallback when the browser won't prompt for the camera inside the iframe: ask from a full tab instead. */
function GrantPage() {
  const [state, setState] = useState<"ask" | "done" | "blocked">("ask")
  const ask = async () => {
    try { (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach(track => track.stop()); setState("done") }
    catch { setState("blocked") }
  }
  return <main className="grant">
    <span className="kicker">OPENWEAR · CAMERA</span>
    <h1>{state === "done" ? "Camera allowed." : "Let OpenWear use your camera"}</h1>
    <p>{state === "done" ? "Close this tab, go back to your shopping tab and press Enable camera." : state === "blocked" ? "Your browser blocked the camera. Click the camera icon in the address bar, allow it, then try again." : "Video goes to Decart only while the fitting room is open. Nothing is recorded."}</p>
    {state !== "done" && <button className="primary" onClick={() => void ask()}>Allow camera</button>}
    {state === "done" && <button className="primary" onClick={() => window.close()}>Close tab</button>}
  </main>
}

function Room() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [garment, setGarment] = useState<Garment | null>(null)
  const [guidance, setGuidance] = useState({ ok: false, message: "Step into the frame" })
  const [holding, setHolding] = useState(false)
  const [visionReady, setVisionReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [remoteVisible, setRemoteVisible] = useState(false)
  const [connection, setConnection] = useState("")
  const [queue, setQueue] = useState<{ position: number; queueSize: number } | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [editingName, setEditingName] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // Refs mirror state that the animation loop and async callbacks read without re-rendering.
  const stageRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const connectionRef = useRef<any>(null)
  const connectingRef = useRef<Promise<any> | null>(null)
  const connectingForRef = useRef(0)
  const remoteShownRef = useRef(false)
  const trackerRef = useRef<Awaited<ReturnType<typeof createPoseTracker>> | null>(null)
  const poseRef = useRef<Point[] | null>(null)
  const phaseRef = useRef<Phase>("idle")
  const framedRef = useRef(false)
  const framedWaitersRef = useRef<(() => void)[]>([])
  const holdStartRef = useRef(0)
  const scanRef = useRef<{ mode: "off" | "loop" | "reveal"; start: number; revealRemote: boolean }>({ mode: "off", start: 0, revealRemote: false })
  const garmentRef = useRef<Garment | null>(null)
  const imageRef = useRef<Blob | null>(null)
  const sessionRef = useRef(0) // bumped on stop(); async work from an older session bails out
  const garmentSeqRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  phaseRef.current = phase
  garmentRef.current = garment

  const updateGarment = useCallback((id: number, patch: Partial<Garment>) => {
    setGarment(current => current && current.id === id ? { ...current, ...patch } : current)
  }, [])

  // ---------- Session lifecycle ----------

  /** Ends everything: Decart connection, camera, timers and effects. Always safe to call. */
  const stop = useCallback((reason?: Notice) => {
    sessionRef.current++
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    connectionRef.current?.disconnect()
    connectionRef.current = null
    connectingRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null
    if (remoteRef.current) remoteRef.current.srcObject = null
    framedRef.current = false
    framedWaitersRef.current = []
    remoteShownRef.current = false
    scanRef.current = { mode: "off", start: 0, revealRemote: false }
    setRemoteVisible(false); setConnection(""); setQueue(null); setPhase("idle")
    setGarment(current => current && current.status !== "live" ? { ...current, status: "failed" } : current)
    if (reason) setNotice(reason)
  }, [])

  // Track the saved key, and stop the (billed) session when the tab is hidden or the room closes.
  useEffect(() => {
    background<{ hasKey: boolean }>("status").then(value => setHasKey(value.hasKey)).catch(() => setHasKey(false))
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.apiKey) { setHasKey(!!String(changes.apiKey.newValue || "").trim()); setNotice(null) }
    }
    chrome.storage.onChanged.addListener(onStorage)
    const onHidden = () => { if (document.hidden && streamRef.current) stop({ message: "Paused while you were away.", action: "restart" }) }
    const onUnload = () => stop()
    document.addEventListener("visibilitychange", onHidden)
    window.addEventListener("pagehide", onUnload)
    return () => { chrome.storage.onChanged.removeListener(onStorage); document.removeEventListener("visibilitychange", onHidden); window.removeEventListener("pagehide", onUnload); stop() }
  }, [stop])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // ---------- Framing guide ----------

  const enterFraming = useCallback(() => {
    holdStartRef.current = 0
    setHolding(false)
    setPhase("framing")
  }, [])

  const markFramed = useCallback(() => {
    framedRef.current = true
    setPhase("ready")
    framedWaitersRef.current.splice(0).forEach(resolve => resolve())
  }, [])

  /** Resolves once the user is framed (or skipped the guide), so garments dropped early wait their turn. */
  const waitUntilFramed = useCallback((session: number) => {
    if (framedRef.current) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      framedWaitersRef.current.push(() => session === sessionRef.current ? resolve() : reject(Error("stopped")))
    })
  }, [])

  /** Enable camera: open the webcam with Decart's preferred size, load the body tracker, start framing. */
  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return
    setNotice(null)
    if (!hasKey) { setNotice({ message: "Add your Decart API key to start.", action: "settings" }); return }
    const session = ++sessionRef.current
    setPhase("starting")
    try {
      const fps = typeof model.fps === "number" ? { ideal: model.fps } : model.fps
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: model.width }, height: { ideal: model.height }, ...(fps ? { frameRate: fps } : {}), facingMode: "user" },
        audio: false
      })
      if (session !== sessionRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      stream.getVideoTracks()[0].onended = () => stop({ message: "Camera disconnected.", action: "restart" })
      const camera = cameraRef.current!
      camera.srcObject = stream
      await camera.play()
      if (!trackerRef.current) {
        try { trackerRef.current = await createPoseTracker(); setVisionReady(true) }
        catch (error) { console.warn("OpenWear framing guide unavailable", error) }
      }
      if (session !== sessionRef.current) return
      if (trackerRef.current) enterFraming()
      else markFramed()
    } catch (error) {
      if (session !== sessionRef.current) return
      stop(friendly(error))
    }
  }, [enterFraming, hasKey, markFramed, stop])

  /** Opens the Decart realtime session with the first garment as its initial state. */
  const connect = useCallback(async (image: Blob, prompt: string, session: number) => {
    const token = await background<Token>("token")
    if (session !== sessionRef.current) throw Error("stopped")
    const client = createDecartClient({ apiKey: token.apiKey, telemetry: false })
    const realtime = await client.realtime.connect(streamRef.current!, {
      model,
      mirror: true, // desktop webcams rarely report facingMode, so mirror explicitly (Decart best practice)
      ...(token.fastMode ? { speed: "fast" } : {}),
      initialState: { prompt: { text: prompt, enhance: true }, image },
      onRemoteStream: (remote: MediaStream) => {
        if (session !== sessionRef.current || !remoteRef.current) return
        remoteRef.current.srcObject = remote
        remoteRef.current.play().catch(() => {})
      }
    })
    if (session !== sessionRef.current) { realtime.disconnect(); throw Error("stopped") }
    realtime.on("connectionChange", (state: string) => {
      if (session !== sessionRef.current) return
      setConnection(state)
      if (state === "generating" || state === "connected") setQueue(null)
      if (state === "disconnected") stop({ message: "The try-on session ended.", action: "restart" })
    })
    realtime.on("queuePosition", (position: { position: number; queueSize: number }) => { if (session === sessionRef.current) setQueue(position) })
    realtime.on("sessionEnded", (event: { reason: string }) => { if (session === sessionRef.current) stop({ message: `Session ended${event?.reason ? ` (${event.reason})` : ""}.`, action: "restart" }) })
    realtime.on("error", (error: any) => { if (session === sessionRef.current) stop(friendly(error)) })
    connectionRef.current = realtime
    setConnection(realtime.getConnectionState?.() || "connected")
    // Realtime video is billed per second, so enforce the session limit from settings.
    const started = Date.now()
    setRemaining(token.sessionSeconds)
    timerRef.current = setInterval(() => {
      const left = Math.max(0, token.sessionSeconds - Math.floor((Date.now() - started) / 1000))
      setRemaining(left)
      if (!left) stop({ message: "Session limit reached. Start again whenever you like.", action: "restart" })
    }, 1000)
    return realtime
  }, [stop])

  // ---------- Garment pipeline ----------

  const waitForRemoteFrame = () => new Promise<void>(resolve => {
    const video = remoteRef.current
    if (!video) return resolve()
    if (video.readyState >= 2 && video.videoWidth) return resolve()
    const done = () => { video.removeEventListener("loadeddata", done); resolve() }
    video.addEventListener("loadeddata", done)
  })

  /** Puts a prepared garment on the user: first one connects, later ones swap in with set(). */
  const apply = useCallback(async (id: number, image: Blob) => {
    const session = sessionRef.current
    await waitUntilFramed(session)
    const current = garmentRef.current
    if (session !== sessionRef.current || current?.id !== id) return
    // Read the name after framing so a rename made while waiting is honoured.
    const prompt = buildPrompt(current.name)
    updateGarment(id, { status: "fitting" })
    scanRef.current = { mode: "loop", start: performance.now(), revealRemote: false }
    const firstLook = !remoteShownRef.current
    if (!connectionRef.current) {
      // If another garment is already connecting, wait for it, then swap this one in.
      if (!connectingRef.current) { connectingRef.current = connect(image, prompt, session); connectingForRef.current = id }
      try { await connectingRef.current }
      catch (error) { if (session === sessionRef.current) connectingRef.current = null; throw error }
      if (connectingForRef.current !== id) await connectionRef.current?.set({ prompt, image, enhance: true })
    } else {
      await connectionRef.current.set({ prompt, image, enhance: true })
    }
    await waitForRemoteFrame()
    await new Promise(resolve => setTimeout(resolve, firstLook ? SETTLE_MS + 500 : SETTLE_MS))
    if (session !== sessionRef.current || garmentRef.current?.id !== id) return
    scanRef.current = { mode: "reveal", start: performance.now(), revealRemote: firstLook }
    if (firstLook) { remoteShownRef.current = true; setRemoteVisible(true) }
    updateGarment(id, { status: "live" })
  }, [connect, updateGarment, waitUntilFramed])

  /** Entry point for every garment: load and normalise the image, then apply it. */
  const tryOn = useCallback(async (incoming: Incoming) => {
    setNotice(null); setDragging(false)
    const id = ++garmentSeqRef.current
    const name = cleanName(incoming.name || "")
    setGarment({ id, name, preview: "", status: "reading" })
    if (phaseRef.current === "idle") void start()
    // The scan only runs once the user is framed; apply() starts it.
    try {
      const prepared = incoming.file ? await normalizeImage(incoming.file) : await normalizeImage(await background<string>("image", { url: incoming.url }))
      if (garmentRef.current?.id !== id) return
      imageRef.current = prepared.blob
      updateGarment(id, { preview: prepared.preview, status: phaseRef.current === "ready" ? "fitting" : "waiting" })
      await apply(id, prepared.blob)
    } catch (error: any) {
      if (error?.message === "stopped") return
      if (garmentRef.current?.id === id) updateGarment(id, { status: "failed" })
      scanRef.current = { mode: "off", start: 0, revealRemote: false }
      setNotice(friendly(error))
    }
  }, [apply, start, updateGarment])

  /** Renaming the garment re-sends it, since the name is part of the Decart prompt. */
  const rename = useCallback((name: string) => {
    const current = garmentRef.current
    if (!current) return
    const next = { ...current, name }
    setGarment(next); garmentRef.current = next
    // A garment still loading, waiting or fitting picks up the change on its own.
    if (!imageRef.current || !streamRef.current || !["live", "failed"].includes(current.status)) return
    void apply(next.id, imageRef.current).catch(error => { if (error?.message !== "stopped") setNotice(friendly(error)) })
  }, [apply])

  // Garments dragged on the host page arrive from the content script.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || typeof event.data !== "object" || !event.data) return
      if (event.data.type === "openwear:drag") setDragging(!!event.data.active)
      if (event.data.type === "openwear:garment") void tryOn({ file: event.data.file instanceof Blob ? event.data.file : undefined, url: typeof event.data.url === "string" ? event.data.url : undefined, name: typeof event.data.name === "string" ? event.data.name : "" })
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [tryOn])

  // ---------- Vision + scan effect loop ----------
  // One requestAnimationFrame loop: runs pose detection (~15 fps) while framing or scanning, feeds the
  // framing guide, and draws the laser scan. The scan either loops while Decart works ("loop") or does
  // a single top-to-bottom sweep that reveals the AI video underneath ("reveal").

  useEffect(() => {
    let frame = 0, lastDetect = 0
    const fx = document.createElement("canvas")
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const camera = cameraRef.current, canvas = fxRef.current, tracker = trackerRef.current
      if (!camera || !canvas || !streamRef.current || !camera.videoWidth) return
      const scan = scanRef.current
      const framing = phaseRef.current === "framing"
      if (tracker && (framing || scan.mode !== "off") && now - lastDetect > 66) {
        lastDetect = now
        poseRef.current = tracker.detect(camera)
      }
      const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(2, devicePixelRatio || 1)
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = fx.width = Math.round(width * dpr)
        canvas.height = fx.height = Math.round(height * dpr)
      }
      const geometry = { width, height, videoWidth: camera.videoWidth, videoHeight: camera.videoHeight }
      if (framing && tracker) {
        const result = guide(poseRef.current, geometry)
        setGuidance(previous => previous.message === result.message && previous.ok === result.ok ? previous : result)
        if (result.ok) {
          holdStartRef.current ||= now
          setHolding(true)
          if (now - holdStartRef.current > HOLD_MS) markFramed()
        } else if (holdStartRef.current) { holdStartRef.current = 0; setHolding(false) }
      }
      const context = canvas.getContext("2d")!
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      const remote = remoteRef.current
      if (scan.mode === "off") { if (remote && scan.revealRemote === false) remote.style.clipPath = ""; return }

      const elapsed = now - scan.start
      let y: number, intensity = 1
      if (scan.mode === "loop") {
        const phase = (elapsed % 2400) / 2400
        const eased = 0.5 - Math.cos(phase * Math.PI * 2) / 2
        y = height * (0.04 + 0.92 * eased)
        intensity = Math.min(1, elapsed / 300)
      } else {
        const progress = Math.min(1, elapsed / SCAN_REVEAL_MS)
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
        y = height * eased
        intensity = progress > 0.85 ? (1 - progress) / 0.15 : 1
        if (remote) remote.style.clipPath = scan.revealRemote ? `inset(0 0 ${Math.max(0, 100 - (y / height) * 100)}% 0)` : ""
        if (progress >= 1) { scanRef.current = { mode: "off", start: 0, revealRemote: false }; if (remote) remote.style.clipPath = ""; return }
      }

      // Body-conforming glow: draw the scan band, then keep only the pixels inside the person mask.
      const fxContext = fx.getContext("2d")!
      fxContext.setTransform(dpr, 0, 0, dpr, 0, 0)
      fxContext.globalCompositeOperation = "source-over"
      fxContext.clearRect(0, 0, width, height)
      const wake = scan.mode === "reveal" ? Math.min(y, 220) : 150
      const wakeGradient = fxContext.createLinearGradient(0, y - wake, 0, y)
      wakeGradient.addColorStop(0, "rgba(90,255,230,0)")
      wakeGradient.addColorStop(1, "rgba(120,255,238,0.34)")
      fxContext.fillStyle = wakeGradient
      fxContext.fillRect(0, y - wake, width, wake)
      fxContext.fillStyle = "rgba(210,255,250,0.22)"
      for (let line = y - wake; line < y; line += 5) fxContext.fillRect(0, line, width, 1)
      fxContext.fillStyle = "rgba(160,255,245,0.16)"
      for (let column = (elapsed / 40) % 18; column < width; column += 18) fxContext.fillRect(column, y - wake * 0.6, 1, wake * 0.6)
      const band = fxContext.createLinearGradient(0, y - 22, 0, y + 22)
      band.addColorStop(0, "rgba(120,255,240,0)")
      band.addColorStop(0.5, "rgba(235,255,253,0.95)")
      band.addColorStop(1, "rgba(120,255,240,0)")
      fxContext.fillStyle = band
      fxContext.fillRect(0, y - 22, width, 44)
      for (let spark = 0; spark < 36; spark++) {
        fxContext.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`
        fxContext.fillRect(Math.random() * width, y - 16 + Math.random() * 20, 2, 2)
      }
      if (tracker && poseRef.current) {
        const cover = coverRect(geometry)
        fxContext.globalCompositeOperation = "destination-in"
        fxContext.save()
        fxContext.translate(width, 0); fxContext.scale(-1, 1)
        fxContext.imageSmoothingEnabled = true
        fxContext.filter = "blur(2px)"
        fxContext.drawImage(tracker.mask, cover.x, cover.y, cover.width, cover.height)
        fxContext.restore()
        fxContext.filter = "none"
      }
      context.globalAlpha = intensity
      context.drawImage(fx, 0, 0)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      // The scanner beam itself spans the whole frame, a thin laser over the masked glow.
      context.shadowColor = "rgba(110,255,236,0.95)"
      context.shadowBlur = 14
      context.fillStyle = "rgba(225,255,252,0.9)"
      context.fillRect(0, y - 1, width, 2)
      context.shadowBlur = 0
      context.fillStyle = "rgba(130,255,240,0.85)"
      context.fillRect(8, y - 6, 3, 12)
      context.fillRect(width - 11, y - 6, 3, 12)
      context.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [markFramed])

  // ---------- Actions ----------

  /** Saves the current AI frame as a JPEG. */
  const snapshot = () => {
    const video = remoteRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    canvas.getContext("2d")!.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob), anchor = document.createElement("a")
      anchor.href = url; anchor.download = `openwear-${Date.now()}.jpg`; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, "image/jpeg", 0.95)
  }

  const onNoticeAction = () => {
    if (notice?.action === "settings") chrome.runtime.openOptionsPage()
    if (notice?.action === "grant") window.open(chrome.runtime.getURL("tabs/room.html?grant=1"), "_blank")
    if (notice?.action === "restart") { setNotice(null); void start() }
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const incoming = parseDrop(event.dataTransfer)
    if (incoming) void tryOn(incoming)
    else setNotice({ message: "Drop a product image or image link." })
  }

  // ---------- Render ----------

  const box = silhouetteBox(size.width, size.height)
  const statusText: Record<GarmentStatus, string> = {
    reading: "Reading garment…", waiting: phase === "framing" ? "Get in frame — it applies next" : "Turn on your camera — it applies next",
    fitting: queue ? `In Decart queue · #${queue.position} of ${queue.queueSize}` : "Tailoring it to you…", live: "Live", failed: "Didn't apply"
  }
  const live = remoteVisible && (connection === "generating" || connection === "connected")
  const cameraOn = phase !== "idle" && phase !== "starting"

  return <div className={`room ${dragging ? "is-dragging" : ""}`} onDragEnter={e => { e.preventDefault(); setDragging(true) }} onDragOver={e => e.preventDefault()} onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }} onDrop={onDrop}>
    <div className="stage" ref={stageRef}>
      <video className="camera" ref={cameraRef} muted playsInline />
      <video className={`remote ${remoteVisible ? "visible" : ""}`} ref={remoteRef} muted playsInline />
      <canvas className="fx" ref={fxRef} />

      {phase === "framing" && size.width > 0 && <div className={`framing ${holding ? "holding" : ""}`}>
        <svg width={size.width} height={size.height} aria-hidden="true">
          <defs><mask id="cutout"><rect width="100%" height="100%" fill="white" /><path d={SILHOUETTE} fill="black" transform={`translate(${box.left} ${box.top}) scale(${box.side / 100})`} /></mask></defs>
          <rect width="100%" height="100%" fill="rgba(8,8,8,0.62)" mask="url(#cutout)" />
          <path className="outline" d={SILHOUETTE} transform={`translate(${box.left} ${box.top}) scale(${box.side / 100})`} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="framing-copy">
          <strong key={guidance.message}>{guidance.ok ? "Hold still" : guidance.message}</strong>
          <span>Line your head and shoulders up with the outline</span>
          <button className="skip" onClick={markFramed}>Skip guide</button>
        </div>
      </div>}

      {phase === "idle" && <div className="intro">
        <span className="kicker">YOUR LIVE FITTING ROOM</span>
        <h1>See it on you.</h1>
        <ol>
          <li><b>1</b>Turn on your camera</li>
          <li><b>2</b>Line yourself up with the outline</li>
          <li><b>3</b>Drag any product photo in here</li>
        </ol>
        {hasKey === false
          ? <button className="primary" onClick={() => chrome.runtime.openOptionsPage()}>Add your Decart API key</button>
          : <button className="primary" onClick={() => void start()} disabled={hasKey === null}>Enable camera</button>}
        <small>{hasKey === false ? "Stored only in this browser. Never sent anywhere except Decart." : "Video streams to Decart only while this window is open."}</small>
      </div>}

      {phase === "starting" && <div className="intro loading"><div className="spinner" /><span>{visionReady ? "Opening camera…" : "Opening camera and loading the body guide…"}</span></div>}

      {garment && <div className={`garment-card status-${garment.status}`}>
        <div className="garment-thumb">{garment.preview ? <img src={garment.preview} alt="" /> : <span className="thumb-skeleton" />}{["reading", "fitting"].includes(garment.status) && <i className="thumb-scan" />}</div>
        <div className="garment-meta">
          {editingName
            ? <input autoFocus defaultValue={garment.name} placeholder="e.g. slim straight blue jeans" onBlur={e => { setEditingName(false); if (e.target.value.trim() !== garment.name) rename(cleanName(e.target.value)) }} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} />
            : <button className="garment-name" onClick={() => setEditingName(true)} title="Rename to describe the item better">{garment.name || "Look from photo"}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z" /></svg></button>}
          <span className="garment-status">{garment.status === "live" && <i className="dot" />}{statusText[garment.status]}</span>
        </div>
      </div>}

      {cameraOn && <div className="toolbar">
        {live && <button onClick={snapshot} title="Save a snapshot" aria-label="Save a snapshot"><svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" /><circle cx="12" cy="13.5" r="3.3" /></svg></button>}
        <button onClick={() => chrome.runtime.openOptionsPage()} title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg></button>
        <button onClick={() => stop()} title="Turn camera off" aria-label="Turn camera off"><svg viewBox="0 0 24 24"><path d="M12 3v8" /><path d="M6.3 6.8a8 8 0 1 0 11.4 0" /></svg></button>
      </div>}

      {phase !== "starting" && phase !== "framing" && <button className={`drop-pill ${cameraOn ? "" : "subtle"}`} onClick={() => fileRef.current?.click()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg>
        <span>{dragging ? "Drop to try it on" : "Drag a product image here"}</span>
      </button>}
      {dragging && <div className="drop-glow" />}

      {phase !== "framing" && <div className="footer-note">
        <strong>OpenWear</strong>
        <span>AI can make mistakes · Visual preview only</span>
        {live && remaining > 0 && <span className="timer">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>}
      </div>}
      {connection === "reconnecting" && <div className="banner">Reconnecting…</div>}
      {notice && <div className="notice" role="alert"><span>{notice.message}</span>{notice.action && <button onClick={onNoticeAction}>{notice.action === "settings" ? "Open settings" : notice.action === "grant" ? "Allow camera" : "Start again"}</button>}<button className="close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
    </div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void tryOn({ file, name: nameFromFile(file) }); e.target.value = "" }} />
  </div>
}

export default function RoomPage() {
  return isGrantPage ? <GrantPage /> : <Room />
}
