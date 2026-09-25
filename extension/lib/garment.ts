// Garment naming, the Decart prompt, and reference-image preparation.

/** Strips prices, store boilerplate and separators from a product title, e.g.
 *  "Slim Straight Jeans | RM 149.90 | Shop online" → "Slim Straight Jeans". */
export function cleanName(raw: string) {
  const text = raw
    .replace(/\s+/g, " ")
    .replace(/(RM|USD|\$|€|£|¥)\s?\d[\d.,]*/gi, "")
    .replace(/\b(buy|shop|sale|new|online|official|store)\b.*$/i, "")
    .replace(/[|•·–—].*$/, "")
    .trim()
  return text.length > 70 ? `${text.slice(0, 70).trim()}…` : text
}

/** Every try-on swaps the complete outfit shown in the photo ("Substitute the outfit with …" pattern). */
export function buildPrompt(name: string) {
  // Long alt text ("a woman wearing…") makes a poor garment name; the reference image carries the detail.
  const named = name && name.length <= 48 ? `, including the ${name.toLowerCase()}` : ""
  return `Substitute the outfit with the complete outfit shown in the reference image${named}.`
}

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"])

/** Letterboxes any garment image onto a clean white 768px square JPEG (Decart recommends ≥512px, plain background). */
export async function normalizeImage(source: Blob | string): Promise<{ blob: Blob; preview: string }> {
  if (typeof source !== "string" && (!ACCEPTED.has(source.type) || source.size > 8 * 1024 * 1024)) throw Error("Use a JPG, PNG or WebP image under 8 MB")
  const objectUrl = typeof source === "string" ? source : URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const size = 768
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const context = canvas.getContext("2d")!
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size, size)
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight) * 0.94
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale
    context.imageSmoothingQuality = "high"
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error("Could not prepare image")), "image/jpeg", 0.92))
    return { blob, preview: canvas.toDataURL("image/jpeg", 0.8) }
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(objectUrl)
  }
}
