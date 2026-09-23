# OpenWear extension kit — start here

This package contains the source for a Chrome/Brave fitting-room extension, its local Node token server, a starter garment catalog, and the economics note in `BUSINESS_ANALYSIS.md`. It is an educational, local demo—not a hosted service or an official Decart product.

## What you need

- Node.js 22 or newer, Chrome or Brave, and a webcam.
- Your own Decart account, API key, available credits, and access to Lucy VTON. Decart charges you separately for active generation. Buying this kit does **not** grant model access or credits.
- A local machine that can run the token server while you use the extension.

## First result

1. In the package root, run `npm ci`.
2. Copy `.env.example` to `.env`. Set `DECART_API_KEY` in `.env` and set `PORT=4317`. Never paste the permanent key into the extension, a prompt, or a public repository.
3. Run `npm run build` and `npm start`. Leave this terminal open.
4. In `extension/`, run `npm ci` and `npm run build`.
5. Open `chrome://extensions` or `brave://extensions`, enable Developer mode, and load `extension/build/chrome-mv3-prod` as an unpacked extension.
6. Visit an ordinary HTTP(S) product page. Click the OpenWear toolbar icon and **Open fitting room**. Drag in a public garment image or choose a starter garment, then click **Enable camera** and approve that page's camera request.
7. Wait for the returned AI video. Try switching garments and stopping the stream. The default local session limit is 120 seconds; active generation is billed by Decart.

The permanent API key stays on the Node server. The extension receives a short-lived, model-scoped token. If you change the source, rebuild and reload the unpacked extension, then refresh the product page.

## When something fails

| Symptom | First check |
| --- | --- |
| “Start the OpenWear app server first” | Is `npm start` running on port 4317? Check the extension Options URL. |
| “Model not permitted” | Your Decart account does not currently have Lucy VTON access. Check the Decart dashboard or contact Decart. A new API key alone may not fix account permission. |
| Camera does not open | Use `localhost` or an HTTPS site, allow camera access for the page, and close another app holding the webcam. |
| No AI frames | Check Decart model access/credits, browser network restrictions, and the visible error. A connected webcam alone does not prove generation works. |
| Product link cannot be read | Try a direct public JPG/PNG/WebP or upload the image. Some sites hide or block preview images. |
| The extension behaves like an older build | Reload the extension and refresh the product page. |

## What's in scope

The current code includes the extension popup/tutorial, draggable images and public links, resizable fitting room, a brief holographic transition, local token server, and source tests. It also contains an unfinished shopping-room website; its checkout is **not** wired. The extension is a local demo, not a Chrome Web Store release or a multi-user SaaS. Generated try-on is a visual preview, not a size or fit guarantee.

The source is MIT licensed. Decart's inference service and terms are separate. See `README.md`, `extension/README.md`, and `proof.md` for implementation and verification details. The recorded automated build and tests passed on 2026-09-24, but this package's real AI output has **not** been re-verified with an account permitted to use Lucy VTON. Verify your own key and model access before relying on a live demo.
