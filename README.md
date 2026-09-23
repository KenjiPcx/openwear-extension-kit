# OpenWear

An MIT-licensed web app for live virtual try-on using Decart's latest Lucy VTON model (currently VTON 3.5). Webcam input, four original illustrative starter garments, garment uploads and switching, live AI output, and JPEG snapshots. The app is open source; Decart's inference service is proprietary and paid.

## Run locally

Requires Node.js 22+ and a Decart API key from https://platform.decart.ai/api-keys.

```sh
npm ci
cp .env.example .env
# Set DECART_API_KEY in .env. Never commit the key.
npm run build
npm start
```

Open http://localhost:3000 for the new one-page Cartroom landing/showroom prototype. Visitors can add local garment images, public HTTPS product pages, or direct public image URLs to a temporary gallery and select 1-, 2-, 5-, or 10-minute passes. Product pages are supported when they expose a public `og:image` or `twitter:image`; sites that block retrieval or hide images behind scripts may fail, so file upload remains the fallback. The gallery stays in browser memory only and disappears on reload. Checkout is deliberately disabled: no prices, payment provider, session entitlements, capacity reservation, or credit recovery are wired yet. The reel cards are placeholders until the creator supplies their actual video URLs.

The original working webcam try-on demo is preserved at http://localhost:3000/classic. There, select a garment, click Enable camera, and allow camera access. Uploaded images must be JPG, PNG, or WebP under 4 MB. Describe custom garments briefly. Keep your upper body visible. Starter garments are illustrations; upload real product photos for a representative customer demo.

The server reloads `.env` settings when a session starts. Camera and stream stop when you click Stop, leave the page, switch tabs, or reach the session limit. Save look downloads a JPEG locally. No audio is requested. Camera video and garment images go to Decart; OpenWear does not save them on its server.

## Architecture

```text
Browser ── access code ──> Node server ── API key ──> Decart token API
Browser <──────────── short-lived model-scoped token ───────────┘
Webcam + garment ── WebRTC / Decart SDK ──> Lucy VTON ──> live video
```

The permanent key never reaches the frontend. Tokens last 60 seconds for new connections, scoped to `lucy-vton-latest`, the requesting origin, and a server-enforced maximum session duration (default 120 seconds). At the published $0.02/second rate, a full two-minute session is about $2.40. Pricing: https://docs.platform.decart.ai/getting-started/pricing. The product-image resolver only fetches public HTTPS hosts, pins a validated public IPv4 address for each request, refuses redirects and unsupported content, and limits response size and lookup rate; it cannot guarantee access to every retailer.

## Share with testers

Deploy to a Node/Docker host with HTTPS. Set `DECART_API_KEY`, `DEMO_ACCESS_CODE`, `HOST=0.0.0.0`, and optionally `SESSION_SECONDS` (30–600, default 120). The host must terminate TLS; browsers require HTTPS for camera access outside localhost.

```sh
docker build -t openwear .
docker run --rm --env-file .env -p 3000:3000 openwear
```

Non-loopback binding requires a demo code. This is a controlled demo, not a public multi-tenant service: the shared code and basic per-connection-IP token rate limit do not replace user accounts, quotas, paid-session entitlements, capacity admission, or a global spend cap. Behind a proxy, the IP limit may be shared across users. Do not deploy the new page as a paid service until checkout is verified server-side and the token endpoint requires a valid, unspent pass. AI appearance does not establish sizing or fit accuracy.

## Browser extension

The [Plasmo extension](extension/README.md) adds a resizable fitting-room panel to product pages. It supports drag-and-drop page images, starter garments, webcam streaming, and snapshots while reusing this server for short-lived Decart tokens. It is a local Chrome/Brave demo; follow its README to build and load it unpacked.

## Verification

```sh
npm test
npm run build
npm audit
```

Tests exercise the real HTTP app with stubbed token minting; they do not prove paid inference. For live verification, configure a funded key, start the camera, inspect the returned video, switch two garments, upload a real garment, save a snapshot, then stop. See `proof.md` for completed checks and limits.

## Sources

- Decart SDK 0.1.0 (MIT; pinned for the verified live stream): https://github.com/DecartAI/sdk
- API: https://docs.platform.decart.ai/models/realtime/virtual-try-on
- Tokens: https://docs.platform.decart.ai/getting-started/client-tokens
- Starter garment illustrations are original and covered by this app's MIT license.
- No Anywear assets or Decart branding were copied.
