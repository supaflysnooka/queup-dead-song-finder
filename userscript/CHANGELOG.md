# What's new

Changes to the QueUp Dead Song Finder (the userscript and the browser extension, which always have the same version). The newest is at the top.

## 0.3.0
- **Backup before changes.** Before Apply, or before removing duplicates, it downloads a file with every song in the playlists about to change, so nothing can be lost for good. It is on by default, and the box can be unticked.
- **Undo the last change.** After Apply or removing duplicates, **Undo the last change** puts the removed songs back (at the end of their playlist, QueUp can't put them where they were) and takes out the replacement that took their place. It is offered for a week.

## 0.2.0
- **Find duplicates.** Reads all your playlists (QueUp only, quick) and lists songs that are in more than one place: the same video twice in a playlist (the extra copy is ticked), the same song in several playlists (not ticked, playlists often share songs on purpose), and different uploads that look like the same song (never ticked, look at them first). One copy of every song always stays.

## 0.1.18
- **Look elsewhere** links under a dead song that has no replacement: web, YouTube and SoundCloud searches, and a search by picture.
- **Cross-site replacements.** A YouTube video that is gone may be on SoundCloud, and the other way round. It now looks on both and says "on SoundCloud instead".
- Also available as a **browser extension** for Chrome, Edge and Firefox.

## 0.1.17 and earlier
- **Saved report.** A finished scan is kept for a week, so a reload doesn't lose it.
- **Also look for blocked videos** checkbox. Turn it off for a much lighter scan that still finds deleted, private and embedding-off videos.
- **Gentler on YouTube.** It stops by itself if YouTube asks it to slow down, and reads less of each page.
- **Reminder** to scan: a red dot for playlists not scanned in 30 days. It can be snoozed for a week or turned off.
- **Stop** still looks for replacements for what was found, and a scan can be **carried on** after closing the tab.
- **Scan all playlists**, with one combined report; playlists in alphabetical order.
- **Length comparison** between a dead song and its replacement, with a warning when they are far apart.
- Select all / none, pictures, and "possible match" marks for short titles.
- First version: finds dead songs in one of your own playlists and swaps in clear replacements, after showing a report.
