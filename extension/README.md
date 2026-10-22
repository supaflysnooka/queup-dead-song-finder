# QueUp Dead Song Finder as a browser extension

The same panel and the same checks as [the userscript](../userscript/README.md), as a browser extension, so there is nothing else to install (no Tampermonkey). Chrome, Edge and Firefox, on Mac and PC.

> **Status:** built and tested against pretend browsers, not yet published to the Chrome or Firefox stores. Load it as described below to try it.

Use **either** the extension **or** the userscript, not both. If both are installed, whichever starts first draws the panel and the other stays out of the way.

## Try it

**Chrome or Edge**

1. Get this folder: [`extension/build/chrome`](build/chrome) (download the repository as a zip and unzip it, or clone it).
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `build/chrome` folder.
4. Open [queup.net](https://queup.net), signed in. A **Dead songs** button shows at the bottom left.

**Firefox**

1. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on**.
2. Choose `build/firefox/manifest.json`.
3. Firefox forgets a temporary add-on when it closes. A permanent install needs the add-on signed (see below).

## What it asks for

| Permission | Why |
|---|---|
| Run on `https://queup.net/*` | To draw the panel and talk to QueUp as you, with the session your browser already has |
| `https://www.youtube.com/*` | To read a video's watch page for the "blocked video" check, which a web page can't do for itself. It is optional in practice: the **Also look for blocked videos** checkbox turns it off |
| `storage` | To remember the dates of your last scans, the reminder settings, a scan that was interrupted, and the last finished report |

It never sees your password, collects nothing, and sends nothing anywhere but QueUp, YouTube and SoundCloud (is the song there). The one thing the background script ever fetches is `https://www.youtube.com/watch?v=<video id>`, without cookies.

## How it is built

`node tools/build-extension.js` puts the extension together from the userscript's own pieces (`lib/`, `userscript/src/`) and two small files of its own in `extension/src/`:

- `shim.js` stands in for the userscript manager: it keeps the settings in extension storage and passes watch page requests to the background script.
- `background.js` fetches the watch page (only that address), stops reading as soon as the answer is in it, and hands it back.

The result is in `extension/build/chrome` and `extension/build/firefox` (the manifests differ: Chrome takes a service worker, Firefox a background script and an add-on id). `node tools/build-extension.js --zip` also writes the two zips the stores take, into `extension/dist/`. The tests fail if `extension/build` is out of date.

## Publishing (not done yet)

- **Chrome Web Store** (Edge accepts the same package): a one-time $5 developer registration, then upload `queup-dead-song-finder-chrome-<version>.zip`. Review usually takes a few days.
- **Firefox Add-ons** (addons.mozilla.org): free, upload `queup-dead-song-finder-firefox-<version>.zip` for signing. It can be listed publicly or signed for your own distribution.
- **Safari** is left out: it needs an Apple developer account and an Xcode conversion.
