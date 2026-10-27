# QueUp Dead Song Finder

A userscript for [QueUp](https://queup.net) that checks your own playlists for songs that can't be played anymore (deleted, private, blocked) and finds songs that are clearly the same one to take their place. Nothing changes until you click **Apply**.

**Install:** add a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)), then open the script file and choose Install:
[`queup-dead-song-finder.user.js`](https://raw.githubusercontent.com/supaflysnooka/queup-dead-song-finder/main/userscript/queup-dead-song-finder.user.js)

**Or as a browser extension** (Chrome, Edge, Firefox; nothing else to install): see the [extension README](extension/README.md). It isn't in the browser stores yet, so for now it is loaded from this repo.

What changed in each version is in the **[changelog](userscript/CHANGELOG.md)**.

Everything about how it works, what it checks, and what it asks permission for is in the **[userscript README](userscript/README.md)**.

## Development

The userscript is one built file, put together from the pieces in `userscript/src` and `lib` by `npm run build`, which also builds the extension (`extension/build`). The tests fail if either is out of date. `npm run package` also writes the zips the browser stores take.

```
npm run build
npm test
```

The matching rules in `lib/` are shared with [DerpyBot](https://github.com/supaflysnooka/DerpyBot), a QueUp chat bot.

MIT licensed.
