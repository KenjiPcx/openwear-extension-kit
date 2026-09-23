import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { models } from "../vendor/decart-sdk.mjs"

const root = new URL("../build/chrome-mv3-prod/", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"))

test("the browser SDK resolves Decart models with finite camera constraints", () => {
  const model = models.realtime("lucy-vton-latest")
  assert.ok(Number.isFinite(model.width))
  assert.ok(Number.isFinite(model.height))
  assert.ok(Number.isFinite(model.fps?.ideal))
})

test("the packaged popup and content script exist", () => {
  assert.equal(manifest.action.default_popup, "popup.html")
  assert.ok(existsSync(new URL(manifest.action.default_popup, root)))
  const content = manifest.content_scripts[0].js[0]
  assert.ok(existsSync(new URL(content, root)))
  const source = readFileSync(new URL(content, root), "utf8")
  assert.ok(!source.includes('"./v4/classic/external.js":!1'), "Parcel stripped Zod and would crash before mounting")
})
