# QueUp Dead Song Finder

A userscript for [QueUp](https://queup.net). It checks one of **your own playlists** for songs that can't be played anymore (deleted, private, blocked), and finds songs that are clearly the same one to take their place. Nothing changes until you click **Apply**.

It runs in your own browser, signed in as you, so it can work on your playlists. The bot can't do that: it can only change its own.

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Add the script: create a new script in the manager and paste in the whole of [`queup-dead-song-finder.user.js`](queup-dead-song-finder.user.js), then save. (If the file is somewhere public, opening its raw link makes the manager offer to install it.)
3. Open [queup.net](https://queup.net), signed in. A **Dead songs** button shows at the bottom left.

### If the manager says "invalid userscript" or "add metadata"

- The very first line of what you paste has to be `// ==UserScript==`, with nothing above it, not even a blank line or the manager's own template header. In a new script, select everything in the editor, delete it, and paste the whole file.
- Make sure the paste is the whole file: it runs from `// ==UserScript==` to the closing `})();` at the bottom, about 900 lines.
- Or install it from the file instead of pasting: save it as `queup-dead-song-finder.user.js` and open it in the browser (`file:///...`), and the manager offers to install it. In Chrome the extension needs "Allow access to file URLs", and newer Chrome versions also need "Allow User Scripts" (or Developer mode) turned on for the manager in `chrome://extensions`.

## Use

1. Click **Dead songs**, pick a playlist, and click **Scan**. It checks 20 songs a page, 50 pages (1000 songs) at a time. A big playlist is done in steps: it sets the start page for the next one.
2. Read the report. Each dead song shows its picture (or "picture gone" when the video has lost it, which deleted and private videos do), why it is dead, and what could replace it, with the replacement's picture, length and a link to check it yourself.
3. **Sure** replacements are ticked for you. **Possible** matches (see below) and anything without a replacement are not. **Select all** and **Select none** tick or untick everything that can be ticked, so picking a single song is **Select none** and one click. A line says how many are selected.
4. Click **Apply selected**. It asks first. Each replacement is **added first**, and the dead song is only taken out once that worked, so nothing is lost. The panel then lists what happened to each song, with QueUp's own words for anything that failed.
5. A dead song with no replacement can be removed too: tick **Also remove dead songs that have no replacement**, and those songs can then be ticked. They are never removed otherwise.
6. **Copy report** copies the list as text. Reload QueUp afterwards to see the new playlist.

### Scanning every playlist

**Scan all playlists** checks all of your playlists one after the other (empty ones are skipped), from page 1, up to the number of pages set in **Pages to check** for each. It tells you roughly how long that takes and asks first, since it can be a while: a song a second or two. Press **Stop** at any time to keep what was found so far (see Stop below). The report is one list, with each song marked with its playlist, and **Apply selected** changes each song in the playlist it is in, one playlist at a time. A playlist that can't be read is named at the end and the rest carry on. If YouTube or SoundCloud ask the browser to slow down, the scan stops, since the rest would only be told the same. A playlist longer than the pages checked is listed as "not checked to the end": scan it on its own, with the start page, to carry on.

### What was looked at

A dead song with no replacement has an expandable **What was looked at** under it. It says what was searched for and lists each result with its length and why it wasn't taken: `a whole album or a long mix`, `a different version (remix, live, cover...)`, `the title is missing: ...`, `already in the playlist`, `the length is very different`, `the same title, but nothing shows it is the same song`, and so on. If the search found nothing at all it says that. So a "no replacement" always comes with its reasons, and if a good result was turned down, the reason shows what rule to look at.

### Stop

The first press of **Stop** stops checking more songs, but still looks for replacements for the dead songs found so far, so a stopped scan is still a useful report. That takes a moment, and the panel says so. Press **Stop** a second time to skip that too: the dead songs found are still listed, marked "not searched for". In **Scan all playlists**, Stop also keeps the playlists already done. (If YouTube or SoundCloud ask the browser to slow down the scan stops by itself and doesn't look for replacements, since checking them would only be told the same.)

### Carrying on after the tab is closed

A scan saves where it has got to as it goes: which playlists are done, how far into the current one it got, and the dead songs and replacements found so far. If the tab is closed, the page is reloaded, the browser crashes, or you press **Stop**, or YouTube or SoundCloud ask the browser to slow down, the panel offers **Resume it** the next time it opens, with what it was doing (`An earlier scan was interrupted (playlist 2 of 5, "Chill mix", 120 songs checked, 3 dead so far, 2 hours ago)`). Resuming skips what was already checked and doesn't search again for what already has a replacement. **Throw it away** forgets it. A scan that finishes leaves nothing to carry on, but its report is kept (next).

- **It finds its place by the songs themselves,** not just a count, so a playlist that changed in between (songs added or taken out) doesn't make it skip or repeat any.
- **Replacements are looked for on both sites.** A dead YouTube song is searched for on YouTube first, and if nothing there is clearly the same song and plays, on SoundCloud (and the other way round). The same rules apply on both. A replacement from the other site is marked **on SoundCloud instead** (or YouTube) and its link goes to SoundCloud's player page for that track, since QueUp gives only a track number. SoundCloud titles often leave out the artist, so a match isn't certain there: **What was looked at** lists what each site returned, each marked with its site.
- **A finished report is kept for a week.** After a reload or a closed tab the panel says `A finished scan from 3 hours ago is saved: 12 dead songs, 9 with a replacement.` with **Open it** and **Throw the report away**. It holds the dead songs, replacements and "What was looked at" notes, not where to carry on from. Songs you apply are taken out of it, and it goes away when none are left. The playlists may have changed since, so scan again if it's old.
- **A song YouTube answered "slow down" on wasn't really checked,** so a scan carried on after that starts again at the first of them.
- **It is kept for a week,** then forgotten. It is stored in the userscript manager's own storage, like the reminder's dates, and whatever is read back is checked before it is used.
- **A finished scan's report is not kept.** If the tab is closed after a scan finishes but before you click Apply, the report is gone and the playlist has to be scanned again.

### The reminder

The script remembers, for each playlist, when it was last scanned from the first page to the end. A playlist that has never been scanned, or not for over 30 days, puts a small red dot on the **Dead songs** button, and the panel says which ones: `Not scanned for over a month: 1 Favorites (never), Spooky (34 days)`. The panel also always shows when the last scan was.

- **It is only a nudge.** It never scans by itself, and it can't: a userscript only runs while a QueUp tab is open. It makes no requests to remind you, it works from what it remembered the last time the panel listed your playlists.
- **A scan counts** when it reaches the end of the playlist from page 1 and isn't stopped. A scan that starts part way through, or is stopped, doesn't count. A playlist longer than the pages checked (50 pages, 1000 songs, by default) stays due until it has been scanned to the end.
- **Snooze or turn it off:** two links in the reminder box: **Remind me in a week** (the whole box goes away for 7 days) or **Stop reminding me**. While reminders are off or paused, a line at that spot says so, with **Turn reminders back on**.
- **What it stores:** only the playlists' ids, names and song counts, and the dates of the last scans, in the userscript manager's own storage (the page can't read it). That is why the script asks for the `GM_getValue` and `GM_setValue` permissions. Without them the reminder still works, but only until the page is closed.

### Reading the lengths

Each replacement shows both lengths, like `length: 4:00 vs 4:10 (+10 s)`. A few seconds of difference is quiet, a little more is in a lighter colour, and a lot (more than 10 seconds and more than 5%) is in **bold amber** with "check this one". It is the same song by title, but it may be another cut.

## What counts as "dead", and "the same song"

- **Dead** only when YouTube or SoundCloud clearly say so, twice in a row: deleted, private, embedding turned off, or (YouTube) the watch page says it is unplayable. An unclear answer, an error, or being told to slow down never counts as dead.
- **The same song** only when every word of its title is in the result (ignoring labels like `[OSMUK 023]` and noise like "Official Video"), with not much else, and it isn't a remix, live version, cover and so on that the original wasn't. It is **never a whole album, a compilation or a long mix**, even if the dead song's own name says it was one. When QueUp gives the lengths, they have to be about the same (within 15%, or 20 seconds), and the report shows both (`6:12 vs 6:09`). A title with only one or two words and no artist ("Dreams") could be any song with that name, so those get **no replacement**. It also has to play, and not already be in the playlist. If nothing is that sure, it says "no replacement" and leaves the song alone.
- Lengths are used whenever QueUp provides them. If a replacement says "length not available", only the title was compared, so check that one by ear.
- **Possible matches.** A short title with no artist ("Lapis", "Roygbiv") could be any song, so it is never a sure match. A result with exactly those words (with an artist in front, `Artist - Lapis`, or just `Lapis` or `Lapis (Official Audio)`) is offered as a **possible match, check it** only when something else shows it is the same song:
  - most of the results with that exact title are by one artist (at least two results, three quarters of them), or
  - its picture is the same cover as the dead song's (when the dead song still has its picture, which a blocked video does), or
  - its length matches the dead song's to within two seconds.

  It must still play, and its length can't be very different. A possible match is never ticked for you. A common title like "Nightfall" has results from many artists, different pictures and different lengths, so it gets nothing.
- **Pictures.** The dead song's picture is shown when YouTube still has it. When both pictures can be loaded, the script compares them (a small fingerprint of each, made in your browser) and says **same cover picture** or **different picture**. A different picture does not rule a replacement out, since re-uploads often use another one. A deleted or private video has lost its picture, so for most dead songs there is nothing to compare, and the match rests on the title, the artist and the length.
- A song QueUp has lost the name of ("Failed to refresh song details.") can't be searched for.

## Safety and privacy

- It only talks to `api.queup.net` (your own playlists, as you), YouTube and SoundCloud (is the song there; links to a SoundCloud track open `w.soundcloud.com`). Nothing is sent anywhere else, there are no analytics, and it loads no other code.
- Pictures are only loaded from `i.ytimg.com` (YouTube) and the SoundCloud picture sites, and an address from anywhere else in a song's details is ignored.
- It never sees or stores your password. It uses the session your browser already has.
- It asks the userscript manager for three things: to read YouTube watch pages (`@grant GM_xmlhttpRequest`, `@connect www.youtube.com`), which a web page isn't allowed to do itself (without it, that one check is skipped), and to store the dates of the last scans for the reminder (`GM_getValue`, `GM_setValue`).
- It goes one song at a time with a pause between, and stops by itself if YouTube or SoundCloud tell it to slow down (that includes the watch page answering "too many requests" or sending the browser to YouTube's "unusual traffic" page).
- **Also look for blocked videos** (a checkbox under the page settings, remembered, on by default) turns the watch page check off. Without it a scan is much lighter, and still finds deleted, private and embedding-off videos; it only misses videos YouTube blocks (usually by country). Scan all playlists says roughly how much it will download.
- The watch page is the heavy part: over a megabyte for each song that isn't already marked dead. The answer is about 60% of the way in, so the userscript stops reading as soon as it is there, which saves roughly 40% (YouTube ignores partial-download requests, so it can't be cut further). Expect a few hundred KB to a megabyte per song, so a 500-song playlist is several hundred MB of downloading.
- Song names are always shown as plain text.
- **Try it on a small playlist first.** Apply really does change your playlist.

## Limits

- This is an early version (0.1.x). It was built from the replies QueUp's site gets, and tested against those shapes and a pretend QueUp, but not yet against many real playlists. If **Dead songs** says it couldn't read your playlists, tell the author what it says.
- Checking is slow on purpose: about a song a second or two.
- It can only change playlists that are yours.

## For developers

The file is built, don't edit it by hand:

- `lib/songMatch.js` and `lib/queupParse.js` are also used by the [DerpyBot](https://github.com/supaflysnooka/DerpyBot) chat bot, so both agree on what "the same song" means and how QueUp's answers are read.
- `userscript/src/core.js` is the logic (scan, replacements, apply). All its network calls go through one `io` object, so it is tested without a browser.
- `userscript/src/ui.js` is the panel.
- `node tools/build-userscript.js` puts them together into `queup-dead-song-finder.user.js`. The tests fail if that file is out of date, and they also run the built file in a pretend browser against a pretend QueUp.
