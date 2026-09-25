# OpenWear: AI fitting room for your browser

Try on clothes from any online shop, live on your webcam.

Open a shopping site (or Pinterest), click **AI fitting room**, line yourself up with the outline, then drag any product photo onto the video. A laser scan sweeps over you and you appear wearing the outfit.

It runs on [Decart](https://platform.decart.ai)'s Lucy VTON realtime model. **The only thing you need to bring is a Decart API key.**

---

## What you need

| | |
|---|---|
| A computer | Mac, Windows or Linux, with a webcam |
| A browser | Google Chrome or Brave |
| Node.js | Version 20 or newer. Download the **LTS** version from [nodejs.org](https://nodejs.org). This is only used to build the extension once. |
| A Decart account | Sign up at [platform.decart.ai](https://platform.decart.ai), add credits, and create an API key (it starts with `dct_`). |

> 💸 **Cost:** Decart bills live video **per second**, and it comes out of your Decart credits. The fitting room stops automatically when you close it, switch tabs, or reach the session limit (5 minutes by default).

---

## Quick start (no coding, 2 minutes)

This repo includes a ready-made build in the **`openwear-extension`** folder.

1. On GitHub, click the green **Code** button → **Download ZIP**, then unzip it.
2. Go to `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Turn on **Developer mode** (the switch in the top-right corner).
4. Click **Load unpacked** and select the **`openwear-extension`** folder.
5. The settings page opens. Paste your Decart API key and click **Save key**.

Done. Skip to [Using it](#using-it). You only need the setup below if you want to change the code.

---

## Build it yourself (about 5 minutes)

### 1. Open a terminal in the `extension` folder

- **Mac:** open **Terminal**, type `cd ` (with a space after it), drag the `extension` folder onto the Terminal window, then press Enter.
- **Windows:** open the `extension` folder in File Explorer, click the address bar, type `cmd`, and press Enter.

To check you're in the right place, run:

```bash
ls
```

You should see `package.json` in the list (on Windows, use `dir` instead).

### 2. Check Node.js is installed

```bash
node -v
```

You should see something like `v22.x.x`. If you get "command not found", install Node.js from [nodejs.org](https://nodejs.org) and open a new terminal.

### 3. Install the dependencies

```bash
npm ci
```

This downloads everything the project needs into a `node_modules` folder. It takes a minute or two, and you only do it once.

### 4. Build the extension

```bash
npm run build
```

When it finishes you'll see `Copied MediaPipe vision files into build/chrome-mv3-prod/vision`. The finished extension is now in **`extension/build/chrome-mv3-prod`**.

### 5. Load it into your browser

1. Go to `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
2. Turn on **Developer mode** (the switch in the top-right corner).
3. Click **Load unpacked**.
4. Select the **`build/chrome-mv3-prod`** folder inside `extension`.

OpenWear appears in your extension list. Click the puzzle-piece icon in the toolbar and pin it so it's easy to find.

### 6. Add your Decart API key

The settings page opens automatically the first time. You can also reach it anytime from the OpenWear toolbar icon → **Settings**.

1. Paste your key (`dct_…`).
2. Click **Save key**. OpenWear checks the key with Decart before saving it.

Your key is stored **only in this browser**. It's never written into the code, and the fitting room only ever receives a 60-second temporary token.

---

## Using it

1. Open any shopping site, like Uniqlo, Zara or Pinterest.
2. Click the black **AI fitting room** button on the right side of the page (or the OpenWear toolbar icon → **Open fitting room**).
3. Click **Enable camera** and allow camera access.
4. **Line up with the outline** until it lights up, with your head in the circle and your shoulders in the body. Or click **Skip guide**.
5. **Drag a product photo** from the page onto the video (or click the drop area to upload a photo).
6. Watch the scan. In a few seconds you're wearing the outfit.

Drag another photo in any time to switch outfits. Click the ✏️ next to the item name to describe it better (for example, "black bomber jacket with blue logo"). The 📷 button saves a snapshot, and ⏻ turns the camera off.

**Tips for good results**
- Use photos where the clothes are clearly visible. Plain backgrounds work best.
- Stand in good, even light, facing the camera.
- The whole outfit in the photo gets swapped onto you. It's a visual preview, not a size guide.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No **AI fitting room** button on the page | Refresh the page. It won't appear on browser pages like `chrome://…` or the web store. You can always open it from the toolbar icon. |
| "Camera access is blocked" | Click **Allow camera** in the message, or click the camera icon in the address bar and allow it. |
| "Decart rejected your API key" | Copy the key again from platform.decart.ai and paste it in Settings. Also check your account has credits. |
| "In Decart queue · #3 of 10" | Decart is busy. Wait, and it starts automatically. |
| Video freezes or won't connect | Usually a network or VPN blocking video traffic. Try another network. |
| Nothing changes after editing the code | Run `npm run build` again, then click the ↻ reload icon on OpenWear at `chrome://extensions`, then refresh the shop page. |

---

## Commands

Run these inside the `extension` folder.

| Command | What it does |
|---|---|
| `npm ci` | Install dependencies (first time only) |
| `npm run build` | Build the extension into `build/chrome-mv3-prod` |
| `npm run package` | Build, then zip it into `build/chrome-mv3-prod.zip` |
| `npm test` | Run the automated checks |
| `npm run typecheck` | Check the TypeScript for errors |

---

## How the code is organised

```
extension/
├── content.tsx        Runs on every website: the launcher button and the floating window
├── tabs/room.tsx      The fitting room: camera, framing guide, Decart session, laser scan
├── tabs/room.css      Fitting room styles
├── background.ts      Holds your API key, mints temporary Decart tokens, downloads dragged images
├── popup.tsx          The toolbar popup
├── options.tsx        The settings page (API key, fast mode, session limit)
├── lib/
│   ├── drop.ts        Reads a dropped file, image or link
│   ├── garment.ts     Product-name cleanup, the Decart prompt, image preparation
│   ├── settings.ts    Saved settings
│   └── vision.ts      Body tracking (MediaPipe) and the framing-guide rules
├── vision/            The body-tracking model file
├── vendor/            Decart SDK + MediaPipe, pre-bundled at build time
├── scripts/           Build helper that copies the body-tracking files into the build
└── tests/             Automated checks
```

**How a try-on works:** the page script catches your drag and sends the image to the fitting room. The fitting room loads the image onto a white 768px square, which is what Decart recommends. It asks the background worker for a short-lived token and connects to Decart with your camera and the garment. From then on it swaps new garments into the same live session.

**Privacy:** your camera video goes to Decart only while the fitting room is open. Nothing is recorded or stored. Body tracking runs on your own computer.

**Developer note:** when OpenWear is loaded unpacked (Developer mode), a page on `http://localhost` can ask it to reload itself, so new builds can be picked up without visiting the extensions page. Installs from a store ignore this.

## Business notes

[BUSINESS_ANALYSIS.md](BUSINESS_ANALYSIS.md) has my breakdown of what realtime try-on costs, and where a try-on business might and might not work.

## License

MIT (see [LICENSE](LICENSE)).
