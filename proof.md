# OpenWear verification

Date: 2026-09-23 (Asia/Kuala_Lumpur)

## Package check — 2026-09-24

The current package pins `@decartai/sdk` 0.1.0 in both npm projects. The older note below mentioning 0.2.1 records an earlier state and is not the current pin. On 2026-09-24, the root project passed 14/14 Node tests and `npm run build`; the extension passed TypeScript checking, 4/4 active tests (one optional live-link test skipped), and `npm run build`. These checks do not verify generated video. The last documented live attempt below ended at `Model not permitted`; no later successful AI stream has been recorded here.

## Passed

- Production JavaScript bundle built against installed Decart SDK 0.2.1.
- Eight Node tests: secrets excluded from config/static routes; four garment endpoints render; wrong code and foreign origins rejected; tokens scoped to model/origin/session duration; missing key fails before provider call; provider errors sanitized; token requests rate limited; camera constraints normalized.
- Camera constraint tests cover Decart's object-shaped FPS value and numeric FPS values.
- Runtime UI now distinguishes WebRTC connection/playback from the first decoded AI frame and reports queue, generation, mute, end, and 20-second no-frame states.
- The VTON startup sequence follows Decart's official examples: connect first, then apply the garment with `setImage()`.
- A transient page-hide during camera/connection setup no longer cancels the app's pending connect attempt; established sessions still stop when the page is hidden.
- Decart's exact provider rejection is retained instead of being overwritten by the SDK's follow-on `Stale connect attempt` error.
- If Decart rejects Lucy VTON access, the result panel now renders a clearly labeled non-AI layout preview instead of remaining blank. Switching Cobalt → Forest was operated and visibly updated the overlay.
- `npm audit`: zero vulnerabilities.
- Operated browser at http://localhost:4317: the camera opened, Decart accepted the ephemeral token and WebRTC connection, then rejected `lucy-vton-latest` with `Model not permitted`. The UI displayed that exact blocker and rendered the non-AI fallback.
- Inspected desktop and 390px mobile layouts in the Codex browser.
- Confirmed the local key is configured without exposing it. The Decart account currently lacks Lucy VTON permission.

## Not yet verified

- Generated camera-to-AI video, AI garment switching fidelity, and snapshot export remain unverified because the configured Decart account is not permitted to use Lucy VTON.
- Docker build and hosted HTTPS deployment have not been run.
- The operated camera test connected to Decart before the model-permission rejection; the session was stopped after verification.

## Runtime

- Local Node server on port 4317.
- No Runpod GPU left running for this app. The empty temporary pod from the self-hosted investigation was deleted.
- Two-minute limit is passed using Decart's documented `constraints.realtime.maxSessionDuration`, with a matching browser timer. Its enforcement by the remote service is not yet live-tested.

## Next proof

Enable `lucy-vton-latest` / `lucy-vton-3.5` for the configured Decart account (or replace the key with one that has access), then inspect real returned video. Switch Cobalt → Clay, upload a real product photo, save a look, then stop. Only then call live try-on verified.
