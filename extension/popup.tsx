// Toolbar popup: opens the fitting room on the current tab, or sends a new user to settings.

import { useEffect, useState } from "react"
import "./popup.css"

/** Asks the tab's content script to open the room, injecting the script first if the tab
 *  was open before the extension was installed or reloaded. */
async function openFittingRoom() {
  const type = "openwear:open"
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) throw Error("Open a normal shopping page first.")
  try {
    await chrome.tabs.sendMessage(tab.id, { type })
  } catch {
    const script = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0]
    if (!script) throw Error("Extension content script is missing. Reload the extension.")
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [script] })
      let sent = false
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await chrome.tabs.sendMessage(tab.id, { type }); sent = true; break }
        catch { await new Promise(resolve => setTimeout(resolve, 80)) }
      }
      if (!sent) throw Error("Refresh this page and try again.")
    } catch (error: any) {
      throw Error(error.message?.includes("Cannot access") ? "This browser page does not allow extensions. Open a shopping page." : error.message || "Could not open the fitting room.")
    }
  }
}

export default function Popup() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  useEffect(() => { chrome.storage.local.get("apiKey").then(value => setHasKey(!!String(value.apiKey || "").trim())) }, [])
  const open = async () => {
    if (busy) return
    setBusy(true); setError("")
    try { await openFittingRoom(); window.close() }
    catch (error: any) { setError(error.message || "Could not reach this page") }
    finally { setBusy(false) }
  }
  return <main className="popup">
    <div className="eyebrow">VIRTUAL TRY-ON ·<br /> OPENWEAR</div>
    {hasKey === false
      ? <button className="popup-action primary" onClick={() => chrome.runtime.openOptionsPage()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></svg>
          <span>Add your Decart key</span>
        </button>
      : <button className="popup-action primary" disabled={busy} onClick={() => void open()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <span>Open fitting room</span>
        </button>}
    <button className="popup-action secondary" onClick={() => chrome.runtime.openOptionsPage()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
      <span>Settings</span>
    </button>
    <p className="popup-hint">{hasKey ? "Key saved · open a shopping page, then drag any product photo in." : "One-time setup: paste your key from platform.decart.ai."}</p>
    {error && <p role="alert" className="popup-error">{error}</p>}
  </main>
}
