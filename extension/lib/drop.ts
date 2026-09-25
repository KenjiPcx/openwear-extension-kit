// Turns whatever the user dropped (a file, a dragged web image, or an image link) into something the
// fitting room can load. Used by both the page script (drags from the shop page) and the fitting room
// itself (files dragged in from the desktop).

export type Incoming = { file?: Blob; url?: string; name?: string }

/** "slim-straight_jeans.jpg" → "slim straight jeans" */
export function nameFromFile(file: File) {
  return file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")
}

export function parseDrop(transfer: DataTransfer): Incoming | null {
  const file = [...transfer.files].find(item => item.type.startsWith("image/"))
  if (file) return { file, name: nameFromFile(file) }
  // Dragged web images carry HTML (<img src alt>); dragged links carry a URL list or plain text.
  const html = transfer.getData("text/html")
  const image = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img") : null
  const source = image?.getAttribute("src") || image?.getAttribute("data-src")
  const uri = transfer.getData("text/uri-list").split("\n").find(line => line && !line.startsWith("#")) || transfer.getData("text/plain")
  const url = [source, uri].map(value => value?.trim()).find(value => value && /^https?:\/\//.test(value))
  return url ? { url, name: image?.getAttribute("alt") || "" } : null
}
