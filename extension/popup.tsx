import { useState } from "react"
import "./popup.css"

async function sendToPage(type: "openwear:open" | "openwear:tutorial") {
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
  const run = async (type: "openwear:open" | "openwear:tutorial") => {
    if (busy) return
    setBusy(true); setError("")
    try { await sendToPage(type); window.close() }
    catch (error: any) { setError(error.message || "Could not reach this page") }
    finally { setBusy(false) }
  }
  return <main className="popup">
    <div className="eyebrow">VIRTUAL TRY-ON ·<br /> OPENWEAR</div>
    <button className="popup-action primary" disabled={busy} onClick={() => void run("openwear:open")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>
      <span>Open fitting room</span>
    </button>
    <button className="popup-action secondary" disabled={busy} onClick={() => void run("openwear:tutorial")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7.5h.01"/></svg>
      <span>Tutorial</span>
    </button>
    {error && <p role="alert" className="popup-error">{error}</p>}
  </main>
}
