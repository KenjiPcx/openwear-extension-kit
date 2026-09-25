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

test("the packaged popup, content script, fitting room and vision files exist", () => {
  assert.equal(manifest.action.default_popup, "popup.html")
  assert.ok(existsSync(new URL(manifest.action.default_popup, root)))
  const content = manifest.content_scripts[0].js[0]
  assert.ok(existsSync(new URL(content, root)))
  const source = readFileSync(new URL(content, root), "utf8")
  assert.ok(existsSync(new URL("tabs/room.html", root)))
  assert.ok(existsSync(new URL("vision/pose_landmarker_lite.task", root)))
  assert.ok(manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval"))
  assert.ok(!source.includes('"./v4/classic/external.js":!1'), "Parcel stripped Zod and would crash before mounting")
})
