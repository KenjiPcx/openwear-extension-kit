// Person framing and segmentation with MediaPipe Pose Landmarker (lite).
// Runs on a downscaled copy of the camera frame so it stays cheap next to the WebRTC stream.
import { PoseLandmarker } from "../vendor/decart-sdk.mjs"

export type Point = { x: number; y: number; visibility?: number }
export type Guidance = { ok: boolean; message: string }
export type Geometry = { width: number; height: number; videoWidth: number; videoHeight: number }

const DETECT_WIDTH = 256

export async function createPoseTracker() {
  // Explicit paths: FilesetResolver would otherwise probe for SIMD/module variants we don't ship.
  const base = chrome.runtime.getURL("vision/")
  const fileset = { wasmLoaderPath: `${base}vision_wasm_internal.js`, wasmBinaryPath: `${base}vision_wasm_internal.wasm` }
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    outputSegmentationMasks: true
  })
  const input = document.createElement("canvas")
  const inputContext = input.getContext("2d", { willReadFrequently: true })!
  const mask = document.createElement("canvas")
  const maskContext = mask.getContext("2d")!
  let maskImage: ImageData | null = null
  let lastTimestamp = 0

  return {
    mask,
    /** Detects the pose on the current video frame and refreshes the person mask canvas. */
    detect(video: HTMLVideoElement): Point[] | null {
      if (!video.videoWidth) return null
      const width = DETECT_WIDTH, height = Math.round(DETECT_WIDTH * video.videoHeight / video.videoWidth)
      if (input.width !== width || input.height !== height) {
        input.width = mask.width = width
        input.height = mask.height = height
        maskImage = maskContext.createImageData(width, height)
      }
      inputContext.drawImage(video, 0, 0, width, height)
      const now = Math.max(performance.now(), lastTimestamp + 1)
      lastTimestamp = now
      let landmarks: Point[] | null = null
      landmarker.detectForVideo(input, now, (result: any) => {
        landmarks = result.landmarks?.[0] || null
        const segmentation = result.segmentationMasks?.[0]
        if (segmentation && maskImage) {
          const values: Float32Array = segmentation.getAsFloat32Array()
          const data = maskImage.data
          for (let i = 0; i < values.length; i++) {
            const offset = i * 4
            data[offset] = data[offset + 1] = data[offset + 2] = 255
            data[offset + 3] = values[i] * 255
          }
          maskContext.putImageData(maskImage, 0, 0)
        } else if (!landmarks) {
          maskContext.clearRect(0, 0, mask.width, mask.height)
        }
      })
      return landmarks
    },
    close() { landmarker.close() }
  }
}

// ---------- Geometry: mapping camera coordinates onto the (mirrored, cropped) stage ----------

/** Where the mirrored, object-fit: cover camera image lands on the stage. */
export function coverRect(geometry: Geometry) {
  const { width, height, videoWidth, videoHeight } = geometry
  const scale = Math.max(width / videoWidth, height / videoHeight)
  const drawWidth = videoWidth * scale, drawHeight = videoHeight * scale
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight }
}

/** The silhouette lives in a 100×100 box, bottom-centred on the stage. */
export function silhouetteBox(width: number, height: number) {
  const side = Math.min(width, height)
  return { left: (width - side) / 2, top: height - side, side }
}

/** Head-and-shoulders outline shown during framing (SVG path in the 100×100 box). */
export const SILHOUETTE = "M45.5 31.2 L45.5 36 C38 37 26 38.5 22 47 C19.5 52 19 60 19 70 L19 100 L81 100 L81 70 C81 60 80.5 52 78 47 C74 38.5 62 37 54.5 36 L54.5 31.2 A12 12 0 1 0 45.5 31.2 Z"

// Where the nose and shoulders should land, in silhouette units, and how much leeway to allow.
const TARGET = { head: { x: 50, y: 20 }, shoulders: 39, near: 1.3, far: 0.68, slack: 10 }

/** Turns pose landmarks into a single coaching instruction for the framing mask. */
export function guide(landmarks: Point[] | null, geometry: Geometry): Guidance {
  if (!landmarks) return { ok: false, message: "Step into the frame" }
  const seen = (point: Point) => (point.visibility ?? 1) > 0.5
  const [nose, leftShoulder, rightShoulder] = [landmarks[0], landmarks[11], landmarks[12]]
  if (!seen(nose)) return { ok: false, message: "Face the camera" }
  if (!seen(leftShoulder) || !seen(rightShoulder)) return { ok: false, message: "Step back" }
  const cover = coverRect(geometry), box = silhouetteBox(geometry.width, geometry.height)
  const toUnits = (point: Point) => ({
    x: (geometry.width - (cover.x + point.x * cover.width) - box.left) / box.side * 100,
    y: (cover.y + point.y * cover.height - box.top) / box.side * 100
  })
  const target = TARGET, head = toUnits(nose)
  const shoulders = Math.abs(toUnits(leftShoulder).x - toUnits(rightShoulder).x)
  if (shoulders > target.shoulders * target.near) return { ok: false, message: "Step back" }
  if (shoulders < target.shoulders * target.far) return { ok: false, message: "Come a little closer" }
  if (head.x < target.head.x - target.slack) return { ok: false, message: "Move right" }
  if (head.x > target.head.x + target.slack) return { ok: false, message: "Move left" }
  if (Math.abs(head.y - target.head.y) > target.slack * 1.3) return { ok: false, message: "Line your head up with the circle" }
  return { ok: true, message: "Hold still" }
}
