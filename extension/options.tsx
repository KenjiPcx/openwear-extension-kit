import { useEffect, useState } from "react"

export default function Options() {
  const [url, setUrl] = useState("http://127.0.0.1:4317")
  const [message, setMessage] = useState("")
  useEffect(() => { chrome.storage.local.get("serverUrl").then(value => { if (value.serverUrl) setUrl(value.serverUrl) }) }, [])
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) throw Error("Enter a local URL with a port, such as http://127.0.0.1:4317")
      await chrome.storage.local.set({ serverUrl: parsed.origin })
      setMessage("Saved. Reopen the fitting room to reconnect.")
    } catch (error: any) { setMessage(error.message) }
  }
  return <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 510, margin: "64px auto", color: "#19372e" }}>
    <h1>OpenWear settings</h1>
    <p>Connect the extension to your local OpenWear app server. Your permanent Decart key stays on that server.</p>
    <form onSubmit={save}>
      <label htmlFor="server">Local server URL</label>
      <input id="server" value={url} onChange={event => setUrl(event.target.value)} style={{ display: "block", width: "100%", padding: 12, margin: "8px 0 18px", boxSizing: "border-box" }} />
      <button style={{ background: "#245e45", color: "white", border: 0, borderRadius: 8, padding: "11px 18px", cursor: "pointer" }}>Save</button>
    </form>
    {message && <p role="status">{message}</p>}
  </main>
}
