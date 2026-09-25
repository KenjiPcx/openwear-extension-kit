// Copies the MediaPipe wasm runtime and pose model into a built extension folder.
// MediaPipe loads these by URL at runtime, so they must ship as plain files.
import { cpSync, existsSync, mkdirSync } from "node:fs"

const target = process.argv[2] || "build/chrome-mv3-prod"
if (!existsSync(target)) throw Error(`Build folder ${target} does not exist`)
mkdirSync(`${target}/vision`, { recursive: true })
for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) cpSync(`node_modules/@mediapipe/tasks-vision/wasm/${file}`, `${target}/vision/${file}`)
cpSync("vision/pose_landmarker_lite.task", `${target}/vision/pose_landmarker_lite.task`)
console.log(`Copied MediaPipe vision files into ${target}/vision`)
