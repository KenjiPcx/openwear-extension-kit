# OpenWear browser extension

Plasmo/Chrome MV3 extension for the OpenWear live try-on server. The toolbar popup offers **Open fitting room** and a three-step **Tutorial**. The content script adds a dismissible camera launcher to ordinary HTTP(S) pages. Drag a product image or public product-page link into the floating room, choose a starter look or upload a file, then enable the webcam. A brief holographic sweep marks each garment application. The room can be resized from its left edge or expanded with ⤢. It uses the existing Decart Lucy VTON stream and token server; it does not include a permanent API key.

## Local demo

1. Start the app server from the parent `openwear` folder (`npm ci`, `npm run build`, `npm start`). Set `PORT=4317` in its `.env` for the extension's default connection. Keep `DECART_API_KEY` only there.
2. In this folder, run `npm ci && npm run build`.
3. In Chrome or Brave, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `extension/build/chrome-mv3-prod`.
4. Visit an HTTP(S) product page. Click the extension toolbar icon and **Open fitting room**, or use the black **AI fitting room** launcher on the page. Drag a garment image or product link into the video window. Allow camera access for that page when prompted.

If the extension was installed or reloaded while the product page was already open, the popup attempts to inject the content script on demand. On a restricted browser page, open a normal product page instead.

Version 0.3.0 resolves Pinterest-style drags that carry a pin link instead of image bytes. It first checks the dragged image and HTML, then uses a public page's `og:image`/`twitter:image` preview when necessary. Version 0.2.0 fixed the initial content-script crash (`z.enum is not a function`) by prebundling the Decart browser SDK with esbuild before Plasmo packages it. After updating an unpacked installation, click **Reload** on the OpenWear card in `chrome://extensions`, then refresh any already-open product pages. Older entries remain in Chrome's Errors panel until cleared.

If your server uses another port, open the extension's **Options** page (or the gear in the panel) and enter `http://127.0.0.1:<port>`. The extension currently connects only to a local server. If you set `DEMO_ACCESS_CODE` on the app server, enter it in the panel. For a shared demo, you may also set `EXTENSION_ID` in the server `.env` to the ID shown at `chrome://extensions` and restart the server.

## Boundaries

- Chrome/Brave permissions cover HTTP(S) pages and images because the extension is meant to work across shopping sites. It does not inject into `chrome://`, browser store pages, or other restricted pages.
- Only JPG, PNG and WebP files under 4 MB are accepted. Public web images and public page previews are fetched by the background worker without site cookies; private, authenticated, or preview-less pages may not work. Starter garments are illustrative.
- Webcam and garment data go to Decart for generation. The local server never stores them. A visual preview cannot establish garment sizing or physical fit.
- This is a local demo, not a public extension release. Before publishing, add per-user accounts, spend quotas, production HTTPS configuration, a privacy policy, and a full browser QA pass. Do not expose the local token server without access controls.

## Checks

`npm run build`, `npm run typecheck`, `npm run test:bundle`, and `node --test tests/image-links.test.mjs` validate the extension, including the popup asset, page-link preview handling, and Decart model import that previously crashed. Parent `npm test` covers token scoping and HTTP behavior. A real webcam/Decart stream requires loading the unpacked extension in Chrome/Brave and accepting its site and camera permissions.

Plasmo structure follows the official [Content Scripts UI](https://docs.plasmo.com/framework/content-scripts-ui), [styling](https://docs.plasmo.com/framework/content-scripts-ui/styling), and [Chrome cross-origin request](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) patterns.
