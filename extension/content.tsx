import { createDecartClient, models } from "./vendor/decart-sdk.mjs"
import { useCallback, useEffect, useRef, useState } from "react"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import styleText from "data-text:./style.css"

export const config: PlasmoCSConfig = { matches: ["http://*/*", "https://*/*"], all_frames: false }
export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}

type Garment = { id: string; name: string; kind: string; prompt: string; image?: string }
type Reply<T> = { ok: true; data: T } | { ok: false; error: string }
type Config = { configured: boolean; requiresCode: boolean; sessionSeconds: number }
const model = models.realtime("lucy-vton-latest")
const MESSAGE_ERROR = "OpenWear extension was reloaded. Refresh this page and try again."

async function background<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  let response: Reply<T>
  try { response = await chrome.runtime.sendMessage({ type, ...fields }) }
  catch { throw new Error(MESSAGE_ERROR) }
  if (!response?.ok) throw new Error((response as { error?: string })?.error || "OpenWear is unavailable")
  return response.data
}

async function normalizeImage(source: Blob | string): Promise<{ blob: Blob; preview: string }> {
  if (typeof source !== "string" && (!new Set(["image/jpeg", "image/png", "image/webp"]).has(source.type) || source.size > 4 * 1024 * 1024)) throw Error("Choose a JPG, PNG or WebP under 4 MB")
  const objectUrl = typeof source === "string" ? source : URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 768
    const context = canvas.getContext("2d")!
    context.fillStyle = "#f5f2eb"
    context.fillRect(0, 0, 768, 768)
    const scale = Math.min(768 / image.naturalWidth, 768 / image.naturalHeight)
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale
    context.drawImage(image, (768 - width) / 2, (768 - height) / 2, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error("Could not prepare image")), "image/jpeg", 0.92))
    return { blob, preview: canvas.toDataURL("image/jpeg", 0.72) }
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(objectUrl)
  }
}

async function imageFromUrl(url: string) {
  const dataUrl = await background<string>("image", { url })
  return normalizeImage(dataUrl)
}

function FittingRoom() {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(760)
  const [launcherHidden, setLauncherHidden] = useState(false)
  const [tutorial, setTutorial] = useState(false)
  const [tutorialStep, setTutorialStep] = useState(0)
  const [status, setStatus] = useState("Choose a garment to begin")
  const [error, setError] = useState("")
  const [config, setConfig] = useState<Config | null>(null)
  const [garments, setGarments] = useState<Garment[]>([])
  const [selected, setSelected] = useState("cobalt")
  const [custom, setCustom] = useState<{ blob: Blob; preview: string } | null>(null)
  const [description, setDescription] = useState("the garment shown in the product image")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const [firstFrame, setFirstFrame] = useState(false)
  const [wave, setWave] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const resultRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const connectionRef = useRef<any>(null)
  const generationRef = useRef(0)
  const selectedRef = useRef(selected)
  const customRef = useRef(custom)
  const garmentsRef = useRef(garments)
  const descriptionRef = useRef(description)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRef = useRef(false)
  const pendingRef = useRef(false)
  selectedRef.current = selected
  customRef.current = custom
  garmentsRef.current = garments
  descriptionRef.current = description

  const stop = useCallback((message = "Camera off") => {
    generationRef.current++
    if (timerRef.current) clearInterval(timerRef.current)
    if (frameTimerRef.current) clearTimeout(frameTimerRef.current)
    timerRef.current = null
    frameTimerRef.current = null
    connectionRef.current?.disconnect()
    connectionRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null
    if (resultRef.current) resultRef.current.srcObject = null
    setBusy(false); setLive(false); setFirstFrame(false); setWave(0); setStatus(message)
  }, [])

  useEffect(() => {
    const listener = (message: { type?: string }, _sender: chrome.runtime.MessageSender, sendResponse: (response: { ok: boolean }) => void) => {
      if (message.type === "openwear:toggle") { setTutorial(false); setOpen(value => !value) }
      if (message.type === "openwear:open") { setTutorial(false); setLauncherHidden(false); setOpen(true) }
      if (message.type === "openwear:tutorial") { stop(); setOpen(false); setTutorial(true); setTutorialStep(0) }
      if (message.type?.startsWith("openwear:")) sendResponse({ ok: true })
    }
    chrome.runtime.onMessage.addListener(listener)
    const onHide = () => stop("Paused while away")
    const onVisibility = () => { if (document.hidden && streamRef.current) stop("Paused while away") }
    window.addEventListener("pagehide", onHide)
    document.addEventListener("visibilitychange", onVisibility)
    return () => { chrome.runtime.onMessage.removeListener(listener); window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onVisibility); stop() }
  }, [stop])

  useEffect(() => {
    const onDragStart = (event: DragEvent) => {
      const target = event.target as Element | null
      const pathImage = event.composedPath().find(node => node instanceof HTMLImageElement) as HTMLImageElement | undefined
      const image = pathImage || (target instanceof HTMLImageElement ? target : target?.querySelector?.("img") || target?.closest?.("a")?.querySelector("img")) as HTMLImageElement | null
      const source = image?.currentSrc || image?.src
      if (source?.startsWith("http")) event.dataTransfer?.setData("application/x-openwear-image", source)
    }
    document.addEventListener("dragstart", onDragStart, true)
    return () => document.removeEventListener("dragstart", onDragStart, true)
  }, [])

  useEffect(() => {
    if (!open) { if (streamRef.current) stop("Camera off"); return }
    let alive = true
    Promise.all([background<Config>("config"), background<Garment[]>("catalog")]).then(async ([nextConfig, nextGarments]) => {
      if (!alive) return
      setConfig(nextConfig); setRemaining(nextConfig.sessionSeconds)
      const withImages = await Promise.all(nextGarments.map(async garment => {
        try { return { ...garment, image: await background<string>("image", { url: `starter:${garment.id}` }) } }
        catch { return garment }
      }))
      if (alive) setGarments(withImages)
    }).catch(e => { if (alive) setError(`${e.message}. Start the OpenWear app server first.`) })
    return () => { alive = false }
  }, [open, stop])

  const getSelectedImage = useCallback(async () => {
    if (selectedRef.current === "custom") {
      if (!customRef.current) throw Error("Add a garment image first")
      return customRef.current.blob
    }
    const item = garmentsRef.current.find(g => g.id === selectedRef.current)
    if (!item?.image) throw Error("Starter garment is still loading")
    return (await normalizeImage(item.image)).blob
  }, [])

  const apply = useCallback(async () => {
    pendingRef.current = true
    if (applyingRef.current) return
    applyingRef.current = true
    try {
      while (pendingRef.current && connectionRef.current) {
        pendingRef.current = false
        const connection = connectionRef.current, generation = generationRef.current
        const image = await getSelectedImage()
        if (generation !== generationRef.current || connection !== connectionRef.current) break
        const prompt = selectedRef.current === "custom" ? descriptionRef.current : garmentsRef.current.find(g => g.id === selectedRef.current)?.prompt
        setStatus("Applying garment…")
        setWave(value => value + 1)
        await connection.setImage(image, { prompt: `Substitute the current top with ${prompt}`, enhance: false })
        if (generation === generationRef.current) setStatus("● Live try-on")
      }
    } catch (e: any) { setError(e.message || "Could not apply garment") }
    finally { applyingRef.current = false }
  }, [getSelectedImage])

  const choose = (id: string) => {
    setSelected(id); selectedRef.current = id; setError("")
    if (connectionRef.current) void apply()
  }

  const useImage = async (source: Blob | string) => {
    try {
      setStatus("Preparing garment…"); setError("")
      const garment = typeof source === "string" ? await imageFromUrl(source) : await normalizeImage(source)
      setCustom(garment); customRef.current = garment; choose("custom")
      setStatus(connectionRef.current ? "Applying garment…" : "Garment ready — enable camera")
    } catch (e: any) { setError(e.message || "Could not open this image") }
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const file = [...event.dataTransfer.files].find(file => file.type.startsWith("image/"))
    if (file) { void useImage(file); return }
    const html = event.dataTransfer.getData("text/html")
    const draggedImage = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img") : null
    const htmlImage = draggedImage?.getAttribute("src") || draggedImage?.getAttribute("data-src")
    let htmlImageUrl = ""
    try { if (htmlImage) { const url = new URL(htmlImage, document.baseURI); if (["http:", "https:"].includes(url.protocol)) htmlImageUrl = url.href } } catch { /* Fall through to the dragged link. */ }
    const raw = event.dataTransfer.getData("application/x-openwear-image") || htmlImageUrl || event.dataTransfer.getData("text/uri-list").split("\n").find(line => line && !line.startsWith("#")) || event.dataTransfer.getData("text/plain")
    if (raw) { void useImage(raw.trim()); return }
    setError("Drag a product image or link here, or upload a JPG/PNG/WebP file")
  }

  const start = async () => {
    if (busy || live) return
    const generation = ++generationRef.current
    setBusy(true); setError(""); setStatus("Opening camera…")
    try {
      const nextConfig = await background<Config>("config")
      setConfig(nextConfig)
      if (!nextConfig.configured) throw Error("Add DECART_API_KEY to the OpenWear server .env file")
      if (nextConfig.requiresCode && !code.trim()) throw Error("Enter the demo access code first")
      const fps = typeof model.fps === "number" && Number.isFinite(model.fps) ? { ideal: model.fps } : model.fps
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: model.width }, height: { ideal: model.height }, ...(fps ? { frameRate: fps } : {}), facingMode: "user" }, audio: false })
      if (generation !== generationRef.current) { media.getTracks().forEach(t => t.stop()); return }
      streamRef.current = media
      media.getVideoTracks()[0].onended = () => stop("Camera disconnected")
      if (cameraRef.current) { cameraRef.current.srcObject = media; await cameraRef.current.play() }
      setStatus("Connecting to Decart…")
      const token = await background<{ apiKey: string }>("token", { code: code.trim() })
      if (generation !== generationRef.current) return
      const client = createDecartClient({ apiKey: token.apiKey, telemetry: false })
      const connection = await client.realtime.connect(media, {
        model, mirror: "auto",
        onRemoteStream: (remote: MediaStream) => {
          if (generation !== generationRef.current) return
          if (resultRef.current) {
            resultRef.current.srcObject = remote
            resultRef.current.play().catch(() => {})
          }
          setStatus("Connected · waiting for AI video…")
        }
      })
      if (generation !== generationRef.current) { connection.disconnect(); return }
      connectionRef.current = connection
      connection.on("error", () => { if (generation === generationRef.current) { stop("Connection interrupted"); setError("Decart reported a stream error") } })
      connection.on("connectionChange", state => { if (generation === generationRef.current && state === "disconnected") stop("Session ended") })
      setBusy(false); setLive(true); setStatus("Connected · applying garment…")
      await apply()
      if (generation !== generationRef.current) return
      frameTimerRef.current = setTimeout(() => { if (generation === generationRef.current && !resultRef.current?.videoWidth) setError("Connected, but no AI frames arrived after 20 seconds. Try a new session.") }, 20000)
      const started = Date.now()
      timerRef.current = setInterval(() => {
        const left = Math.max(0, nextConfig.sessionSeconds - Math.floor((Date.now() - started) / 1000))
        setRemaining(left)
        if (!left) stop("Demo session complete")
      }, 1000)
    } catch (e: any) {
      if (generation !== generationRef.current) return
      stop("Ready when you are")
      setError(e.name === "NotAllowedError" ? "Allow camera access for this website, then try again" : e.message || "Could not start try-on")
    }
  }

  const save = () => {
    const video = resultRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const context = canvas.getContext("2d")!
    context.translate(canvas.width, 0); context.scale(-1, 1); context.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob), anchor = document.createElement("a")
      anchor.href = url; anchor.download = "openwear-look.jpg"; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, "image/jpeg", 0.95)
  }

  const resize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX, startWidth = width
    const move = (next: PointerEvent) => setWidth(Math.max(400, Math.min(window.innerWidth - 24, startWidth + startX - next.clientX)))
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end) }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end)
  }

  const steps = [
    { title: "Find a look", detail: "Browse a shop and choose a clear product image of a top you want to try." },
    { title: "Open your camera", detail: "Open the fitting room and select Enable camera. Keep your upper body in view." },
    { title: "Drag it in", detail: "Drag a product image or link onto the video, or upload a photo. OpenWear will apply it to the live AI preview." }
  ]

  return <div className="ow-root">
    {!open && !tutorial && !launcherHidden && <div className="ow-launcher"><button className="ow-launcher-main" onClick={() => setOpen(true)} aria-label="Open AI fitting room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg><span>AI fitting room</span></button><button className="ow-launcher-close" onClick={() => setLauncherHidden(true)} aria-label="Hide fitting-room button">×</button></div>}
    {tutorial && <div className="ow-tutorial" role="dialog" aria-label="OpenWear tutorial"><button className="ow-tutorial-close" onClick={() => setTutorial(false)} aria-label="Close tutorial">×</button><span className="ow-tutorial-kicker">HOW IT WORKS · {tutorialStep + 1} / 3</span><h2>{steps[tutorialStep].title}</h2><p>{steps[tutorialStep].detail}</p><div className="ow-tutorial-dots">{steps.map((_, index) => <span key={index} className={index === tutorialStep ? "active" : ""} />)}</div><div className="ow-tutorial-actions"><button disabled={tutorialStep === 0} onClick={() => setTutorialStep(value => value - 1)}>Back</button>{tutorialStep < 2 ? <button className="primary" onClick={() => setTutorialStep(value => value + 1)}>Next</button> : <button className="primary" onClick={() => { setTutorial(false); setOpen(true) }}>Open fitting room</button>}</div></div>}
    {open && <aside className="ow-panel" style={{ width: `min(${width}px, calc(100vw - 24px))` }} onDragOver={e => e.preventDefault()} onDrop={onDrop} aria-label="OpenWear fitting room">
      <div className="ow-resizer" onPointerDown={resize} title="Drag to resize" />
      <header className="ow-header"><strong>Try-On <span>✦</span> OpenWear</strong><div className="ow-header-actions"><button onClick={() => chrome.runtime.openOptionsPage()} title="Settings" aria-label="Settings">⚙</button><button onClick={() => setWidth(width < 900 ? 1000 : 760)} title="Resize fitting room" aria-label="Resize fitting room">⤢</button><button onClick={() => { stop(); setOpen(false) }} title="Minimize fitting room" aria-label="Minimize fitting room">−</button></div></header>
      <div className="ow-stage">
        <video className={`ow-stage-camera ${firstFrame ? "ow-hidden-video" : ""}`} ref={cameraRef} muted autoPlay playsInline />
        <video className={`ow-stage-result ${!firstFrame ? "ow-hidden-video" : ""}`} ref={resultRef} muted autoPlay playsInline onLoadedData={() => { setFirstFrame(true); setStatus("● Live try-on"); if (frameTimerRef.current) clearTimeout(frameTimerRef.current) }} />
        {wave > 0 && <div key={wave} className="ow-holo-wave" aria-hidden="true" onAnimationEnd={() => setWave(current => current === wave ? 0 : current)}><span /></div>}
        {!streamRef.current && <div className="ow-stage-empty"><span>YOUR LIVE FITTING ROOM</span><strong>See it on you.</strong><p>Enable your camera, then drag an image or product link here.</p></div>}
        <button className="ow-drop-target" onClick={() => fileRef.current?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg><span>Drag an image or product link here</span></button>
        <div className="ow-stage-bottom"><strong>OpenWear</strong><span>AI can make mistakes · Visual preview only</span>{live && <span>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>}</div>
      </div>
      <div className="ow-footer"><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void useImage(file); e.target.value = "" }} /><div className="ow-footer-top"><span>CHOOSE A LOOK</span><button onClick={() => fileRef.current?.click()}>Upload image ↗</button></div><div className="ow-garments">{garments.map(g => <button key={g.id} className={`ow-garment ${selected === g.id ? "selected" : ""}`} onClick={() => choose(g.id)}><span className="ow-thumb">{g.image && <img src={g.image} alt="" />}</span><strong>{g.name}</strong></button>)}{custom && <button className={`ow-garment ${selected === "custom" ? "selected" : ""}`} onClick={() => choose("custom")}><span className="ow-thumb"><img src={custom.preview} alt="" /></span><strong>Your image</strong></button>}</div>{selected === "custom" && <label className="ow-description">Garment description<input value={description} onChange={e => setDescription(e.target.value)} onBlur={() => { if (connectionRef.current) void apply() }} /></label>}{config?.requiresCode && <label className="ow-description">Demo access code<input type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label>}<div className="ow-bottom-row"><div className="ow-status"><span className={live ? "ow-live-dot" : ""} />{status}</div><div className="ow-controls"><button className="ow-primary" disabled={busy || live} onClick={() => void start()}>{busy ? "Opening…" : live ? "Live" : "Enable camera"}</button><button disabled={!busy && !live} onClick={() => stop()}>Stop</button><button disabled={!firstFrame} onClick={save}>Save</button></div></div>{error && <div className="ow-error" role="alert">{error}</div>}</div>
    </aside>}
  </div>
}

export default FittingRoom
