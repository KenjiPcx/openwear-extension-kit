// Settings live in chrome.storage.local on this browser only. The permanent Decart key is
// read by the background worker, which hands the fitting room short-lived client tokens.

export type Settings = {
  apiKey: string
  fastMode: boolean
  sessionMinutes: number
}

export const DEFAULT_SETTINGS: Settings = { apiKey: "", fastMode: false, sessionMinutes: 5 }

export async function loadSettings(): Promise<Settings> {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS))
  return { ...DEFAULT_SETTINGS, ...saved }
}

export async function saveSettings(patch: Partial<Settings>) {
  await chrome.storage.local.set(patch)
}
