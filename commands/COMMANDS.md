![DerpyBot Avatar](https://i.imgur.com/p999E1u.png)

Please add an [issue](https://github.com/franciscog/DerpyBot/issues) for any suggestions, request, or bugs!

# Triggers
You can create and delete a trigger using the `!trigger` command. Existing
triggers are protected from accidental overwrites.

## Creating a trigger 
**!trigger \[trigger_name\] \[trigger_text\]**    
access level: ResDJ or higher only

example
```
!trigger funnycow look at this funny cow https://i.imgur.com/rp7zs.gif
```

## Adding to a trigger pool
Use `!!trigger` to create a numbered variant without overwriting the existing
trigger. It fills the first available name in the pool, such as `funnycow2`.
The trigger name must not already end in a number, and trigger text is required.

```
!!trigger funnycow another funny cow
```

## Overwriting a trigger
Use `!overtrigger` with an existing trigger name. It also creates the trigger
normally when the name does not exist.

access level: Mods only

Example:    
This example will change the `funnycow` trigger we just created
```
!overtrigger funnycow jokes on you, there are no funny cows
```

## Deleting a trigger 
Just: **!overtrigger \[trigger_name\]**

access level: Mods only

Example:    
This example will delete the `funnycow` trigger
```
!overtrigger funnycow
```

## Adding dynamic content

**%me%** - will be replaced by your user name    
**%dj%** - will be replaced by the current DJ playing    

### Variables
Put these in trigger text and they are filled in when the trigger is used. They can go inside each other, like `$or[$day, $month]`.

| Variable | Becomes |
|---|---|
| `$me` | the person who used the trigger |
| `$msg` | what they typed after the trigger |
| `$date` | today's date, like 2026-10-08 |
| `$day` | the weekday, like Thursday |
| `$daynum` | the day of the month, like 8 |
| `$month` | the month name, like October |
| `$year` | the year |
| `$randomnumber` | a number from 1 to 100 |
| `$randomnumber[1,6]` | a number from 1 to 6, both ends included |
| `$randomemoji` | a random emoji |
| `$or[this, that, other]` | one of the choices, picked at random (separate them with commas) |
| `$if[a, b, yes, no]` | `yes` if a and b are the same (capitals don't matter, 1 and 1.0 are the same), otherwise `no`. It needs four parts. The `no` part can have commas in it, the other three can't |
| `$mock[some text]` | sOmE tExT with random capitals |
| `$scramble[some text]` | all the characters mixed up, spaces too |
| `$randomresponse[a, b, c]` | the text of a random one of those triggers, with its own variables filled in. Triggers that don't exist and code triggers are skipped, and a `+prop` at the end of the trigger is left out |

Dates use the Los Angeles time zone unless the `trigger_timezone` setting says different. Anything else that starts with `$`, like `$5`, is left as it is.

```
!trigger roll You rolled a $randomnumber[1,6]
!trigger today Happy $day! It is $month $daynum.
!trigger mood %me% is feeling $or[great, meh, spooky] today
!trigger lucky $if[$randomnumber[1,10], 1, Jackpot! 10% chance, Better luck next time]
```

### Trigger arguments
when you call a trigger with extra words, they effectively serve as arguments (i.e. parameters) for your trigger.

when you call a trigger, every subsequent word will be assigned a number starting at 0 in order

```
!mytrigger dude rad awesome    
^^^^^^^^^^ ^^^^ ^^^ ^^^^^^^    
trigger     0    1     2
```

then in your trigger text you place the following anywhere    
**%0%** will be replaced with "dude"    
**%1%** will be replaced with "rad"    
**%2%** will be replaced with "awesome"    
and so on, in order

`hey %0%, you are pretty %1% and %2%`    
`!mytrigger dude rad awesome`    
becomes this:  `hey dude, you are pretty rad and awesome`

you can also place the numbers in text out of order    
`hey %0%, you are pretty %2% and %1%`    
calling with arguments: `!mytrigger dude rad awesome`    
becomes this:  `hey dude, you are pretty awesome and rad`

and you can add defaults to them with the | symbol like this:    
`hey %dj%, you are pretty %0|cool%`    
no arguments: `!mytrigger`    
becomes this:  `hey currentDJperson, you are pretty cool`    

When using defaults, "me" and "dj" are reserved words act just like %me% and %dj%:

`this %0|dj% is cool`    
without arguments: `this currentDJname is cool`


# Commands

Anything not listed here is probably a trigger, try `!search name` or `!random`.

### Bot
* **!v** or **!ver** or **!version** - Bot responds with "Version: [*version number*]"
* **!shuffleplaylist** or **!sp** - Shuffle the bot's playlist (mods only)
* **!toggle [config item]** - Turn a [config item](#config) on/off (mods only)
* **!admin [restart|reconnect|mute|unmute|history]** - Owner/approved users only
* **!dj [stop]** - Have the bot join/leave the queue (mods only, off unless the `dj_command` config is on)

### Credits

##### Giving points
*Giving a point to a user is limited to one time per song.* These are triggers stored in the database
that end with a point keyword, so they can be changed with `!overtrigger`.
* **!props** or **!tune** or **!fire** or **!love** - Add to the current DJ's total "props" count
* **!props @username** (and the same for the others) - Add to @username's total "props" count

##### Credit Info
* **!leaders** - Who led props and flow in each of the last 6 months. Asking again within 5 minutes won't repost it
* **!leaders [year]** - Every month of that year
* **!leaders [month] [year]** - Top 3 for one month, e.g. `!leaders Sep 2020`
* **!balance** or **!stats** or **!score** - See the amount of total "hearts" and total "props" connected to your name
* **!balance @username** - See the amount of total "hearts" and total "props" connected to @username

### Fun
* **!cat** - Show a random cat picture or gif
* **!dog** - Show a random dog picture or gif
* **!echo [text]** - Bot repeats what you said
* **!fact** - A random fact
* **!todayfact** - Something that happened on this day in history
* **!trivia** - Asks a random trivia question and reveals the answer after 30 seconds
* **!trivia [category]** - Asks a question from a category. Pick one by name or the start of it, like `!trivia music` or `!trivia vid`: General, Music, Science & Nature, History & Holidays, Geography, Sports & Leisure, Food & Drink, Art & Literature, Film & TV, Video Games, Entertainment, Society & Culture, People & Places, Religion & Mythology, Anime & Cartoons, Toys & Games, Technology, Mathematics, Language, Comics, Animals, Vehicles, Politics. With no category it picks one at random first
* **!trivia [answer]** - Guess the answer while a question is open. A wrong guess gets a "guess again" reply. Capitalization, punctuation, "the", small typos and spelled out numbers (four thousand = 4000) are forgiven
* **!poll [2m] Question? | option 1 | option 2** - Starts a poll (Resident DJs and above). 2 to 6 options split with `|`, and an optional `2m` for how many minutes it stays open (1-30, default 2). Counts stay hidden until it closes, then the result is posted
* **!poll** - Shows the open poll and how long is left
* **!poll end** - Closes the poll now and posts the result (whoever started it, or a mod)
* **!poll cancel** - Closes the poll without a result (whoever started it, or a mod)
* **!vote [number]** - Vote in the open poll, `!vote 2` or the option's text. Voting again changes your vote
* **!urban [word]** - Look up a word on Urban Dictionary (random word if none given)
* **!giphy [search text]** - Return a random giphy image (off unless the `giphy` config is on and an API key is set)
* **!issmithavailableyet** - Checks whether the username "smith" has been freed up

### Info
* **!commands** or **!help** - Link to this list. With a command name after it, like `!help playcount`, it says what that command does, the same as `!moreinfo`
* **!moreinfo [command]** (or **!commandinfo**) - What a command does, like `!moreinfo playcount` (the `!` is optional). The first sentence about each way of using it comes now and typing `more` shows the rest. It reads this page, so it is always up to date. A name it doesn't know gets close suggestions
* **!eta** - Gets the user's estimated time in minutes until their song plays
* **!rules** - Rules of the room
* **!replace [Artist - Title]** - Finds songs that are clearly that one and play, with YouTube links, for when a track is dead. Every word you type has to be in the result, and remixes, live versions and covers are left out unless you typed them. Says so if nothing clearly matches. Once every 30 seconds each
* **!replace** - Checks your next queued song, and if it is dead finds what to queue instead
* **!myrole** - Shows the role the bot sees you as, and whether it lets you create triggers or use mod commands. Useful if a command isn't working for you
* **!lastplay** - Who last played the current song and when
* **!lastplay [Artist - Title]** - Same, for a specific song. The name has to match exactly
* **!firstplay** - Who first played the current song and when
* **!plays** - How many times the current song has been played in the room, and the last play
* **!playcount** - How many times the current song has been played in the room, from the room's own play history (matched by the song itself, so the name doesn't matter). The song playing now isn't counted until it finishes
* **!playcount [Artist - Title]** - Same, for a specific song. The name has to match exactly (if several share it, the most played one)
* **!lastfmcount** - How many times the current song was played on the bot's Last.fm account
* **!lastfmcount [Artist - Title]** - Same, for a specific song
* **!whatsnew** - A short reminder of what is new in the bot, three short pages: the first now, type `more` for the next one. Once a minute at most
* **!trackinfo** or **!songinfo** - What the bot knows about the song playing now, in one line: who queued it, how long it is, YouTube or SoundCloud, the props and flow points so far, how many times it was played in the room (with the first and last play), the Last.fm play count when that can be read quickly, and the link. It also looks the track up on [MusicBrainz](https://musicbrainz.org) and, only when it is sure which track it is, adds the year, label, release and genres. When it found the track, type `more` (within 3 minutes) for the other releases and about the artist: what kind (group or solo), where from, since when for a group, genres and links to a few music sites (Wikipedia, Bandcamp, Discogs, SoundCloud, Resident Advisor). Nothing is guessed: a remix, another version or a different artist is not taken for the track, and nothing is added when MusicBrainz doesn't know it. Asking again for the same song within 30 seconds won't repost it. Can be turned off with the `trackinfo_web` setting
* **!brbcount** - The 5 people who have said they'll be right back because of a meeting or a call the most. The bot counts these quietly in chat (a message needs both a "brb / be right back / back in..." and a meeting or call as the reason, like "brb, meeting" or "be right back, hopping on a call"), the same person only counts once every 5 minutes, and nothing of the message is kept: only the name, the count and the date of the last one. **The counts are never reset**, not even by the monthly points reset. Shown at most once a minute. `!brbcount me` shows yours and `!brbcount @name` someone else's
* **!glhfcount** - The 5 people who have said glhf (or "good luck, have fun") the most. Counted quietly in chat, once a minute at most per person, nothing of the message is kept, and **never reset**. `!glhfcount me` and `!glhfcount @name` show one person's
* **!dogwalkcount** - The 5 people who have said they are walking the dog or dogs the most ("walking the dogs", "gonna walk my dog", "taking the dog for a walk", "dog walk", "walkies"). Only as something they are doing or about to do: "walked the dog" and questions aren't counted. Counted quietly, once every 30 minutes at most per person (one walk is one walk), and **never reset**. `!dogwalkcount me` and `!dogwalkcount @name` show one person's
* **!coffeecount** - The 5 people who have talked about coffee the most (coffee, espresso, latte or cappuccino, not questions). Counted quietly, once every 10 minutes per person, and never reset. Add `me` for your own count or `@name` for someone else's
* **!mostplayed** (also **!topsongs**) - The 5 songs played most in this room, from the room's play history, like `*Most played here*: 1) Artist - Title (12) | 2) ...`
* **!rediscover** - A random song from the room's history that hasn't been played for a long time (a year, or 90 days if nothing is that old yet), with who played it last. For a DJ who can't think of what to queue
* **!topdjs** - Who has played the most songs in the room, this month and all time. Counted from November 2026, the bot itself is left out
* **!mystats** - Everything the bot counts about you in one line: props, flow, songs played, and your brb, glhf, dog walk and coffee counts (what is zero is left out). `!mystats @name` for someone else
* **!lastplayed** or **!lastsong** or **!lasttrack** - Name and link of the song that just played
* **!lasttrigger** - The most recently created or changed trigger and who did it
* **!mostused** - The 10 triggers that get used the most (or `!mostused 20`, up to 25). Uses are counted from when this was added, and asking again within a minute won't repost it
* **!searchauthor [username]** - The triggers a person made. Long lists show a page at a time, say `more` for the next one. If nobody has that name it suggests similar ones
* **!link** - Get the current song's name and link.
    * *Note*: Get's the actual link of the song to SoundCloud instead of the api.soundcloud..../redirect link
* **!translate [text]** - Link to a Google Translate page for the text

*Play history (`!lastplay`, `!firstplay`, `!plays`) was reset in October 2026 because of bad imported data, so it only counts plays since then.*

### Triggers
* **!trigger** (or **!triggers**), **!!trigger**, **!overtrigger** - See [Triggers](#triggers) above
* **!addresponse [name] [new response]** - Adds another response to a trigger. If the trigger is written as one `$or[a, b, c]`, the response is added to its choices (mods only, it changes an existing trigger, and it can't contain commas or brackets). For any other trigger it is added as the next numbered version, `name2`, `name3`... like `!!trigger` (Resident DJs and above)
* **!deleteresponse [name]** - Lists the numbered choices of a trigger written as `$or[a, b, c]` (mods only)
* **!deleteresponse [name] [number or response]** - Removes one choice from it, like `!deleteresponse greet 2` or `!deleteresponse greet hello`. The last choice can't be removed this way. For a numbered version like `name2`, use `!overtrigger name2`
* **!search [name]** - Find triggers with that in the name (3 letters minimum). Best matches come first, numbered variants are grouped like `dance (3)`, and if nothing matches it suggests the closest names, typos included. Long results show 40 at a time, type `more` (just the word) to see the next page for the next 3 minutes
* **!?[term]** - Random trigger from the search results for the term
* **!random** - Random trigger. **!randomprop** / **!randomflow** give a random props/flow trigger
* **!!name** - Random trigger from the `name`, `name2`, `name3`... pool
* **!source [trigger]** - Who made a trigger and when, and how many times it has been used
* **!sourcetext [trigger]** - The raw text of a trigger without any formatting applied
* **!wasitbrad [trigger]** - Tells you whether Brad made the trigger

##### Code triggers (mods only to create)
A trigger like `{GET [3][0] FROM https://example.com/api?q={0}}` fetches JSON and replies with the
value at the given path. Only `https` urls that point to public hosts are allowed, redirects are not followed,
and long replies are shortened.

### Auto-Moderation
* Automatically skips YouTube videos that are deleted, private, age restricted or can't be embedded, and SoundCloud tracks that no longer exist (turn it off with `!toggle autoskip_stuck`)

### Moderation
##### For Mods and higher
* **!front @username** - Move @username to the front of the queue
* **!lock @username** - Lock/Pause @username's queue from playing
* **!pause @username** - Same as !lock
* **!cleanplaylist** (mods) - Checks the bot's current playlist for dead tracks and finds a replacement for each (only one that is clearly the same song and plays, on YouTube or, if it isn't there, SoundCloud). Reports it in chat a page at a time, say `more` for the next page. Nothing is changed
* **!cleanplaylist apply** (mods) - Swaps in the replacements from that report (within 10 minutes). Each replacement is added first and the dead song is only taken out once that worked. Dead tracks without a replacement are left alone
* **!botstats** - How many songs the bot has played in the room and how many got skipped, how many are in its queue, and which playlist it is saving to (with how full it is), like `I've played 5,953 songs in this room and 0 got skipped. 163 in my queue, saving to "1Playlist" (163/300)`
* **!health** (also **!uptime**) - Mods only. Says if the bot is OK, like `*DerpyBot* 2.6.2 | up 3d 4h | 1,204 triggers loaded | 96 MB memory | database OK`
* **!botqueue** or **!queuesize** - How many songs are in the bot's own queue. Asked from QueUp at most once a minute
* **!botplaylist** - (mods) Shows which playlist the bot is saving songs to, its id and how full it is, and which one it queues from
* **!botplaylist list** - (mods) The bot's playlists that can be queued, with how many songs each has
* **!botplaylist use name_or_number [now]** - (managers and above) Picks the playlist the bot queues from when it joins the queue, by name, number (`2` is `2Playlist`) or id. `now` queues it right away like `!dj` does (needs `dj_command` on). It doesn't change where the bot saves songs
* **!botplaylist auto** - (managers and above) Goes back to queueing the playlist the bot saves to
* **!lockskip** - Skip the current DJ, and lock/pause their queue. Useful for DJs that are AFK and continue to requeue

##### For Resident DJs and higher
* **!skip** - Skip the current song without reason or message using a reason of (broke, nsfw, op, theme, troll, and more to come) can leave blank if just want to skip without reason
* **!skip broke** or **!skip broken** - Skip the current song giving a reason that the song/video no longer exists or is unavailable in all countries
* **!skip nsfw** - Skip the current song giving a reason that the song/video is not safe for a work environment
* **!skip op** - Skip the current song giving a reason that the song/video is overplayed and banned from the room
* **!skip theme** (or **offtheme**, **topic**, **offtopic**, **genre**) - Skip the current song because it doesn't match the room's theme
* **!skip troll** - Skip the current song giving a reason that the song/video is trolling, *this also then kicks the DJ*


# Config

Here are a list of configuration items that can be toggled on/off with the `!toggle` command.

Example usage:
```
!toggle allow_multi_prop
```

All of these config items below will be reset if the bot happens to reboot, that's why the default state is listed. At some point I might try and make the changes persist. 

* **muted** -  (default: false) - Whether the bot is allowed to send chats or not    
* **allow_multi_prop** -  (default: false) - allow people to give multiple props for the same song    
* **welcomeUsers** -  (default: false) - display a welcome message to new users (default: false)    
* **autoUpvote** - (default: true) - allow bot to auto upvote every song    
* **playOnEmpty** - (default: false) - play music when the queue is empty. The bot queues its playlist once, then waits at least 10 minutes before trying again    
* **max_playlist_size** - (default: 300) - the most songs the bot saves to one playlist. When it's full the bot makes a new one, 1Playlist, then 2Playlist and so on, and remembers which one it's on in Firebase (`botPlaylist`)    
* **check_queue_songs** - (default: true) - check the songs DJs have lined up next, and warn the DJ in chat when one can't be played (a deleted, private or blocked video), so it can be replaced before it gets stuck and skipped    
* **suggest_replacements** - (default: true) - add what could be queued instead to the warning for a dead song: a song found by searching for its name that is clearly the same song and plays, with a YouTube link. Left out when none is found    
* **remove_dead_queue_songs** - (default: false) - also take such a song out of the DJ's queue, but only once the DJ is next in line to play, so they have until then to replace it themselves. The DJ is warned when the song is first noticed. The bot needs the permission to remove songs    
* **max_queue_playlist_size** - (default: 300) - the most songs the bot's playlist can have for the bot to queue it. A bigger playlist is never queued, because queuing adds the whole playlist. It can't be changed with `!toggle`    
* **autoskip_stuck** - (default: true) - skip a song that is stuck because it has issues    
* **recently\_played\_warning** - (default: true) - warn the room that a song in the queue was played within `recently_played_limit` hours (default: 12)    
* **reset_points** :  (default: true) - reset all user points back to 0 at the beginning of each month    
* **leader_announce** :  (default: true) - whether the bot should announce to the room who the current monthly leaders are, every 8 hours
* **giphy** - (default: false) - allow `!giphy` (needs a Giphy API key in the private settings)    
* **dj_command** - (default: false) - allow mods to use `!dj`    
