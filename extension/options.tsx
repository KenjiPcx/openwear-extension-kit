// Settings page: paste the Decart API key (verified before saving), plus fast mode and session limit.

import { useEffect, useState } from "react"
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./lib/settings"
import "./options.css"

type Reply = { ok: true } | { ok: false; error: string }

export default function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [draftKey, setDraftKey] = useState("")
  const [reveal, setReveal] = useState(false)
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "busy"; text: string } | null>(null)

  useEffect(() => { loadSettings().then(value => { setSettings(value); setDraftKey(value.apiKey) }) }, [])

  const update = async (patch: Partial<Settings>) => {
    setSettings(current => ({ ...current, ...patch }))
    await saveSettings(patch)
  }

  const saveKey = async (event: React.FormEvent) => {
    event.preventDefault()
    const key = draftKey.trim()
    if (!key) { await update({ apiKey: "" }); setStatus({ tone: "ok", text: "Key removed from this browser." }); return }
    setStatus({ tone: "busy", text: "Checking your key with Decart…" })
    const reply: Reply = await chrome.runtime.sendMessage({ type: "test-key", apiKey: key })
    if (!reply?.ok) {
      const error = (reply as { error?: string })?.error
      setStatus({ tone: "error", text: error === "KEY_REJECTED" ? "Decart rejected this key. Copy it again from platform.decart.ai." : `Couldn't verify the key: ${error}` })
      return
    }
    await update({ apiKey: key })
    setStatus({ tone: "ok", text: "Key saved. Open any shopping page and click AI fitting room." })
  }

  return <main className="options">
    <span className="kicker">OPENWEAR · SETTINGS</span>
    <h1>Your fitting room</h1>
    <p className="lede">OpenWear runs on Decart's Lucy VTON realtime model. Paste your API key and you're done.</p>

    <form className="card" onSubmit={saveKey}>
      <label htmlFor="key">Decart API key</label>
      <div className="key-row">
        <input id="key" type={reveal ? "text" : "password"} value={draftKey} onChange={event => setDraftKey(event.target.value)} placeholder="dct_…" autoComplete="off" spellCheck={false} />
        <button type="button" className="ghost" onClick={() => setReveal(value => !value)}>{reveal ? "Hide" : "Show"}</button>
      </div>
      <p className="hint">Get one at <a href="https://platform.decart.ai" target="_blank" rel="noreferrer">platform.decart.ai</a>. It's stored only in this browser. The fitting room never sees it; it gets a 60-second token instead.</p>
      <button className="primary" disabled={status?.tone === "busy"}>Save key</button>
      {status && <p className={`status ${status.tone}`} role="status">{status.text}</p>}
    </form>

    <section className="card">
      <label className="toggle"><input type="checkbox" checked={settings.fastMode} onChange={event => void update({ fastMode: event.target.checked })} /><span><b>Fast mode</b>Lower latency, billed at 2× the realtime rate.</span></label>
      <label className="select">Session limit
        <select value={settings.sessionMinutes} onChange={event => void update({ sessionMinutes: Number(event.target.value) })}>
          {[2, 5, 10, 20].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
        </select>
      </label>
      <p className="hint">Realtime video is billed per second. Sessions stop at this limit, when you close the window or when you switch tabs.</p>
    </section>
  </main>
}
