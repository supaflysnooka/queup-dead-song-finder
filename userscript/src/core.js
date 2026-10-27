'use strict';
/***********************************************************************
 * core.js
 * What the userscript does, apart from drawing the panel (ui.js): reads one of the person's own playlists,
 * finds the songs that can't be played, finds a clear replacement for each, and swaps them in when asked.
 *
 * Everything that touches the network goes through `io`, so this can be tested without a browser:
 *   io.api(method, path, form)  a call to QueUp's API as the signed in person -> Promise<{code, body}>
 *   io.status(url)              the HTTP status of a plain GET (0 when it couldn't be made) -> Promise<number>
 *   io.page(url)                a page's text, for the one check a browser page isn't allowed to make itself.
 *                               Null when the userscript manager can't do it -> Promise<{status, text}|null>
 *   io.imageHash(url)           a small fingerprint of a picture, to tell if two are the same cover. Optional -> Promise<string|null>
 *   io.store                    {get(key, fallback), set(key, value)}: a little storage for the dates of the last scans (the userscript
 *                               manager's own, not readable by the page). Only dates and playlist names are kept in it
 *   io.sleep(ms)
 *   io.config                   {confirmMs, checkMs, apiMs} the pauses between requests
 *
 * Nothing is sent anywhere but QueUp (the person's own playlists), YouTube and SoundCloud (is this song there).
 */
var songMatch = require('../../lib/songMatch.js');
var queupParse = require('../../lib/queupParse.js');

var PLACEHOLDER_NAME = /^failed to refresh song details\.?$/i;

// what an oEmbed answer means for a YouTube video (seen on real videos): 404 deleted, 403 private, 401 embedding off
var YOUTUBE_CLEAR = { 404: 'gone', 403: 'private', 401: 'blocked' };
var SOUNDCLOUD_CLEAR = { 404: 'gone' };

var TEXTS = {
  gone: 'this YouTube video does not exist anymore',
  private: 'this YouTube video is private',
  blocked: "this YouTube video can't be played here (embedding is off or it is age restricted)",
  unplayable: "this YouTube video is blocked and can't be played",
  soundcloud: 'this SoundCloud track does not exist anymore'
};

// how many results are looked at for a replacement, and how many of those are checked for playing
var RESULTS_LOOKED_AT = 10;
var MAX_PLAY_CHECKS = 3;
// how many dead songs a replacement is looked for in one scan
var MAX_DEAD_SEARCHED = 50;
// pictures are only loaded from the sites song pictures come from
var PICTURE_HOSTS = /^https:\/\/(i\.ytimg\.com|i1\.sndcdn\.com|i\.scdn\.co)\//;
// two pictures this far apart (out of 64 bits) are the same cover, and this far or more are different
var SAME_PICTURE_BITS = 10;
// a short title with no artist: this share of the matching results have to be by one artist, out of at least this many
var MIN_AGREEMENT = 0.75;
var MIN_AGREEING_RESULTS = 2;
// how often (in songs checked) a scan says where it has got to, so it can be carried on if the tab is closed
var CHECKPOINT_EVERY = 10;
// this many "slow down" answers in a row and the scan stops, it is being rate limited
var MAX_RATE_LIMITED_IN_A_ROW = 5;

function hasRealName(song) {
  return !!song.name && !PLACEHOLDER_NAME.test(String(song.name).trim());
}

function keyOf(song) {
  return String(song.type).toLowerCase() + ':' + song.fkid;
}

/** QueUp's own words for why a call failed, if it gave any: ": Song already in playlist" */
function answerText(answer) {
  var body = answer && answer.body;
  var details = body && body.data && body.data.details && body.data.details.message;
  var message = details || (body && typeof body.message === 'string' && body.message !== 'OK' ? body.message : null) || (body && typeof body.data === 'string' ? body.data : null);
  return message ? ': ' + String(message).replace(/\s+/g, ' ').slice(0, 120) : '';
}

/** 372000 -> "6:12", 3723000 -> "1:02:03", and "" when the length isn't known */
function formatLength(ms) {
  if (!(ms > 0)) { return ''; }
  var total = Math.round(ms / 1000);
  var hours = Math.floor(total / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  var seconds = total % 60;
  var pad = function(n) { return n < 10 ? '0' + n : String(n); };
  return hours > 0 ? hours + ':' + pad(minutes) + ':' + pad(seconds) : minutes + ':' + pad(seconds);
}

/**
 * How different a replacement's length is from the dead song's.
 * @returns {{seconds: number, level: 'same'|'close'|'far'}|null} seconds is longer (+) or shorter (-). 'far' is more than
 *   10 seconds and 5% apart, worth a warning, 'close' is a few seconds, and null when either length isn't known
 */
function lengthDifference(song, replacement) {
  if (!(song.length > 0) || !(replacement.length > 0)) { return null; }

  var seconds = Math.round((replacement.length - song.length) / 1000);
  var far = Math.abs(seconds) > Math.max(10, 0.05 * song.length / 1000);
  return { seconds: seconds, level: far ? 'far' : Math.abs(seconds) > 3 ? 'close' : 'same' };
}

/** "+10 s" or "-1:05", for how much longer or shorter */
function formatDifference(seconds) {
  var sign = seconds < 0 ? '-' : '+';
  var total = Math.abs(seconds);
  return total >= 60 ? sign + Math.floor(total / 60) + ':' + (total % 60 < 10 ? '0' : '') + (total % 60) : sign + total + ' s';
}

/** "6:12 vs 6:09" for a dead song and what replaces it, or a note when it can't be compared */
function compareLengths(song, replacement) {
  var was = formatLength(song.length);
  var now = formatLength(replacement.length);
  if (was && now) {
    var difference = lengthDifference(song, replacement);
    return was + ' vs ' + now + (difference && difference.level !== 'same' ? ' (' + formatDifference(difference.seconds) + ')' : '');
  }
  return now ? now + ' (the dead song\'s length is not known)' : 'length not available';
}

function youtubeLink(fkid) {
  return /^[A-Za-z0-9_-]{11}$/.test(String(fkid)) ? 'https://www.youtube.com/watch?v=' + fkid : null;
}

/**
 * A link to look at a song: the video page for YouTube, and for SoundCloud (which gives only a track number, not the
 * track's own address) SoundCloud's player page for that track
 */
function songLink(song) {
  var type = String(song.type).toLowerCase();
  if (type === 'youtube') { return youtubeLink(song.fkid); }
  if (type === 'soundcloud' && /^\d+$/.test(String(song.fkid))) { return 'https://w.soundcloud.com/player/?url=' + encodeURIComponent('https://api.soundcloud.com/tracks/' + song.fkid); }
  return null;
}

/**
 * "Artist - Title" as an artist and a title, when the name really has both (a dash with something on each side).
 * A single word, or a title with no artist, is too little to search the web for.
 */
function artistAndTitle(name) {
  var parts = String(name || '').split(/\s+[-\u2013\u2014]\s+/);
  if (parts.length < 2) { return null; }

  var artist = parts[0].trim();
  var title = parts.slice(1).join(' - ').trim();
  var hasText = function(text) { return /[\p{L}\p{N}]/u.test(text); };
  return hasText(artist) && hasText(title) ? { artist: artist, title: title, query: (artist + ' ' + title).slice(0, 150) } : null;
}

/**
 * Where the person could look themselves for a song that could not be found: searches for the name on the web, YouTube and
 * SoundCloud (only when the name has an artist and a title), and a search by the picture (only when the song has one,
 * which the screen checks has really loaded: a deleted video has lost it). Only links, nothing is sent anywhere
 * until the person clicks one.
 * @returns {{imageSearch: string|null, names: {label: string, url: string}[]}}
 */
function lookElsewhere(song) {
  var named = hasRealName(song) ? artistAndTitle(song.name) : null;
  var query = named ? encodeURIComponent(named.query) : null;
  var image = pictureFor(song);

  return {
    imageSearch: image ? 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(image) : null,
    names: query ? [
      { label: 'Search the web', url: 'https://www.google.com/search?q=' + query },
      { label: 'YouTube', url: 'https://www.youtube.com/results?search_query=' + query },
      { label: 'SoundCloud', url: 'https://soundcloud.com/search?q=' + query }
    ] : []
  };
}

var PLATFORM_NAMES = { youtube: 'YouTube', soundcloud: 'SoundCloud' };

/** a link that is safe to load as a picture: https, from the sites song pictures come from */
function safeImageUrl(url) {
  return typeof url === 'string' && PICTURE_HOSTS.test(url) ? url : null;
}

/** a song's picture: the one QueUp has for it, or for a YouTube video the one YouTube makes. Null when there is none to load */
function pictureFor(song) {
  var stored = safeImageUrl(song.thumbnail);
  if (stored) { return stored; }
  return String(song.type).toLowerCase() === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(String(song.fkid)) ? 'https://i.ytimg.com/vi/' + song.fkid + '/hqdefault.jpg' : null;
}

/**
 * A fingerprint of a picture from 72 grey values (a 9 by 8 version of it): each bit says whether a pixel is
 * brighter than the one to its right. The same picture at a different size or quality gives nearly the same bits.
 * @param {number[]} grey 72 values, row by row
 * @returns {string} 64 characters, 0 or 1
 */
function dHash(grey) {
  var bits = '';
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 8; col++) {
      bits += grey[row * 9 + col] > grey[row * 9 + col + 1] ? '1' : '0';
    }
  }
  return bits;
}

/** how many of the 64 bits differ, or null when either fingerprint is missing */
function hashDistance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) { return null; }
  var distance = 0;
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { distance++; } }
  return distance;
}

/**
 * Is a replacement's picture the same cover as the dead song's? Only when both pictures can be loaded, and a deleted
 * video has lost its picture, so for most dead songs this can't be told.
 * @returns {Promise<'same'|'different'|null>}
 */
async function pictureVerdict(io, dead, candidate) {
  if (!io.imageHash) { return null; }
  var was = pictureFor(dead);
  var now = pictureFor(candidate);
  if (!was || !now) { return null; }

  var distance = hashDistance(await io.imageHash(was), await io.imageHash(now));
  if (distance === null) { return null; }
  return distance <= SAME_PICTURE_BITS ? 'same' : 'different';
}

/**
 * Asks an oEmbed service about a song. A clear answer has to come twice, the same, before it counts.
 * @returns {Promise<'ok'|'rate'|'unknown'|string>} ok, rate (told to slow down), unknown (anything unclear, which never counts as dead),
 *   or the name of the clear answer ('gone', 'private', 'blocked')
 */
async function oembedAnswer(io, url, clear) {
  var last = null;

  for (var attempt = 0; attempt < 2; attempt++) {
    var status = await io.status(url);
    if (status === 200) { return 'ok'; }
    if (status === 429) { return 'rate'; }
    if (!clear[status]) { return 'unknown'; }

    // the same clear answer both times, or it doesn't count
    if (last !== null && last !== status) { return 'unknown'; }
    last = status;

    if (attempt === 0) { await io.sleep(io.config.confirmMs); }
  }

  return clear[last];
}

/** the watch page's own word on whether the video can be played. Only "UNPLAYABLE", twice, counts */
async function watchPageAnswer(io, fkid) {
  // no way to read the page, or the person turned the check off
  if (!io.page || io.usePage === false) { return 'ok'; }

  for (var attempt = 0; attempt < 2; attempt++) {
    var page = await io.page('https://www.youtube.com/watch?v=' + fkid);
    if (!page) { return 'ok'; }
    // told to slow down (or sent to YouTube's "unusual traffic" page): counts like a slow down from oEmbed
    if (page.status === 429 || /\/sorry\//.test(String(page.finalUrl || ''))) { return 'rate'; }
    if (page.status !== 200) { return 'ok'; }

    var match = /"playabilityStatus":\{"status":"([A-Z_]+)"/.exec(String(page.text));
    if (!match || match[1] !== 'UNPLAYABLE') { return 'ok'; }

    if (attempt === 0) { await io.sleep(io.config.confirmMs); }
  }

  return 'unplayable';
}

/**
 * Is a song dead? Only when YouTube or SoundCloud clearly say so, never on an unclear answer
 * @param {{type: string, fkid: string}} song
 * @returns {Promise<{dead: boolean, text?: string, rate?: boolean}>} rate: the service said to slow down
 */
async function checkSong(io, song) {
  var type = String(song.type).toLowerCase();

  if (type === 'youtube') {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(song.fkid))) { return { dead: false }; }

    var state = await oembedAnswer(io, 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + song.fkid), YOUTUBE_CLEAR);
    if (state === 'rate') { return { dead: false, rate: true }; }
    if (state === 'ok') {
      var onPage = await watchPageAnswer(io, song.fkid);
      if (onPage === 'rate') { return { dead: false, rate: true }; }
      state = onPage === 'unplayable' ? 'unplayable' : 'ok';
    }

    return TEXTS[state] && state !== 'soundcloud' ? { dead: true, text: TEXTS[state] } : { dead: false };
  }

  if (type === 'soundcloud') {
    if (!/^\d+$/.test(String(song.fkid))) { return { dead: false }; }

    var answer = await oembedAnswer(io, 'https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent('https://api.soundcloud.com/tracks/' + song.fkid), SOUNDCLOUD_CLEAR);
    if (answer === 'rate') { return { dead: false, rate: true }; }
    return answer === 'gone' ? { dead: true, text: TEXTS.soundcloud } : { dead: false };
  }

  return { dead: false };
}

/** the person's playlists */
async function listPlaylists(io) {
  var answer = await io.api('GET', 'playlist');
  var playlists = answer.code === 200 ? queupParse.parsePlaylists(answer.body) : null;
  if (!playlists) { return { error: "couldn't read your playlists (QueUp answered " + answer.code + ')' }; }

  // in alphabetical order: capitals and accents don't matter, and numbers go by their value ("Mix 2" before "Mix 10").
  // That is the order of the list, of Scan all playlists, and of the reminder
  playlists.sort(function(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); });
  return { playlists: playlists };
}

/**
 * Reads pages of a playlist, 20 songs a page
 * @param {{fromPage: number, maxPages: number, onProgress: function, shouldStop: function}} options
 * @returns {Promise<{songs: object[], finished: boolean, nextPage: number}|{error: string}>} finished: the end of the playlist was reached
 */
async function readPlaylist(io, playlistId, options) {
  var fromPage = options.fromPage || 1;
  var maxPages = options.maxPages || 25;
  var songs = [];

  for (var page = fromPage; page < fromPage + maxPages; page++) {
    if (options.shouldStop && options.shouldStop()) { return { songs: songs, finished: false, nextPage: page }; }

    var answer = await io.api('GET', 'playlist/' + playlistId + '/songs?page=' + page);
    var read = answer.code === 200 ? queupParse.parseSongs(answer.body) : null;
    if (!read) { return { error: "couldn't read page " + page + ' of the playlist (QueUp answered ' + answer.code + ')' }; }

    songs = songs.concat(read.songs);
    if (options.onProgress) { options.onProgress({ stage: 'reading', done: songs.length }); }
    if (read.last) { return { songs: songs, finished: true, nextPage: page + 1 }; }

    await io.sleep(io.config.apiMs);
  }

  return { songs: songs, finished: false, nextPage: fromPage + maxPages };
}

/** does this result play (a result that can't be checked counts as playing, only a clear "dead" rules it out) */
async function plays(io, candidate) {
  var verdict = await checkSong(io, candidate);
  await io.sleep(io.config.checkMs);
  return !verdict.dead;
}

// a result of the same title is "the same length" when it is within this many milliseconds, for a short title
var TIGHT_LENGTH_MS = 2000;
// how many results with exactly the title are looked at for a short title
var MAX_EXACT_TITLES = 5;

/**
 * Searches for a song that can take a dead one's place.
 *
 * A replacement is "sure" when it is clearly the same song: the title says the same things, it isn't a remix, live version
 * or cover unless the original is, it isn't an album, the length fits, not already in the playlist, and it plays.
 *
 * A title of one or two words and no artist ("Lapis") could be any song, so for those a result with exactly the same
 * title is only "possible", and only when something else shows it is the same song:
 *   - most of the results with that exact title are by one artist (at least two, three quarters of them), or
 *   - the picture is the same cover (when the dead song still has its picture, which a blocked video does), or
 *   - the length matches to within two seconds.
 * A possible one is never ticked for the person, they look at it first.
 *
 * Everything that was looked at is returned too, with why each was not taken, so a "no replacement" can be explained.
 *
 * @param {{type: string, fkid: string, name: string, length: number, thumbnail: string}} dead
 * @param {Set<string>} skip "type:fkid" keys that can't be the replacement
 * @returns {Promise<{name, fkid, type, length, confidence, picture, note, tried}|{none: string, searched: string, tried: object[]}>}
 */
async function findOnPlatform(io, dead, skip, type) {
  if (!hasRealName(dead)) { return { none: 'no name to search for', searched: null, tried: [] }; }

  var searched = String(dead.name).trim();
  var answer = await io.api('GET', 'song?name=' + encodeURIComponent(searched) + '&type=' + type + '&details=1');
  var found = answer.code === 200 ? queupParse.parseSearch(answer.body) : null;
  if (!found) { return { none: 'the search failed', searched: searched, tried: [] }; }

  var results = found.results.slice(0, RESULTS_LOOKED_AT);
  var asCandidate = function(result) {
    return { name: result.name, fkid: result.fkid, type: result.type || type, length: result.length || null, thumbnail: result.thumbnail || null };
  };

  // what became of each result, to show when there is no replacement
  var verdicts = new Map();
  var usable = [];
  results.forEach(function(result) {
    if (result.fkid === dead.fkid) { verdicts.set(result, 'this is the dead song itself'); }
    else if (skip.has(keyOf({ type: result.type || type, fkid: result.fkid }))) { verdicts.set(result, 'already in the playlist (or already used for another song)'); }
    else { usable.push(result); }
  });
  var tried = function() {
    return results.map(function(result) {
      return { name: String(result.name).slice(0, 90), length: result.length || null, verdict: verdicts.get(result) || 'not looked at' };
    });
  };

  var sure = usable.filter(function(result) {
    var why = songMatch.whyNot(dead.name, result.name, { length: dead.length, resultLength: result.length });
    if (why) { verdicts.set(result, why); }
    return why === null;
  });
  var checks = 0;
  for (var i = 0; i < sure.length && checks < MAX_PLAY_CHECKS; i++) {
    var candidate = asCandidate(sure[i]);
    checks++;
    if (await plays(io, candidate)) {
      candidate.confidence = 'sure';
      candidate.picture = await pictureVerdict(io, dead, candidate);
      candidate.tried = tried();
      return candidate;
    }
    verdicts.set(sure[i], 'a clear match, but it does not play either');
  }

  // one or two words and no artist: the same title is not enough, something else has to say it is the same song
  if (songMatch.isObscureTitle(dead.name)) {
    var group = songMatch.obscureTitleMatches(dead.name, usable);
    var agreed = !!group && group.total >= MIN_AGREEING_RESULTS && group.share >= MIN_AGREEMENT;
    var exact = songMatch.exactTitleMatches(dead.name, usable).slice(0, MAX_EXACT_TITLES);

    for (var j = 0; j < exact.length && checks < MAX_PLAY_CHECKS + MAX_EXACT_TITLES; j++) {
      var result = exact[j];
      if (songMatch.isSameLength(dead.length, result.length) === false) { verdicts.set(result, 'the same title, but the length is very different'); continue; }

      var evidence = [];
      if (agreed && group.results.indexOf(result) !== -1) { evidence.push('most results for it are by ' + group.artist); }
      if (dead.length > 0 && result.length > 0 && Math.abs(dead.length - result.length) <= TIGHT_LENGTH_MS) { evidence.push('the length matches to within two seconds'); }

      var possible = asCandidate(result);
      var picture = await pictureVerdict(io, dead, possible);
      if (picture === 'same') { evidence.push('the picture is the same cover'); }

      if (evidence.length === 0) {
        verdicts.set(result, 'the same title, but nothing shows it is the same song' + (picture === 'different' ? ' (the picture is different)' : picture === null ? ' (no picture to compare, or the length is not known)' : ''));
        continue;
      }

      checks++;
      if (!(await plays(io, possible))) { verdicts.set(result, 'looked like the same song (' + evidence.join(' and ') + '), but it does not play'); continue; }

      possible.confidence = 'possible';
      possible.picture = picture;
      possible.note = 'a short title with no artist, but ' + evidence.join(' and ');
      possible.tried = tried();
      return possible;
    }
  }

  return { none: sure.length > 0 ? "the matching results don't play either" : 'no result is clearly the same song', searched: searched, tried: tried() };
}

/**
 * Looks for a replacement on the dead song's own site first, then on the other one (a YouTube video that is gone
 * may well be on SoundCloud, and the other way round). The same rules apply on both. What was looked at on each site is kept.
 */
async function findReplacement(io, dead, skip) {
  var type = String(dead.type).toLowerCase();
  var first = await findOnPlatform(io, dead, skip, type);
  if (!first.none || !PLATFORM_NAMES[type] || !hasRealName(dead) || first.none === 'the search failed') { return first; }

  var otherType = type === 'youtube' ? 'soundcloud' : 'youtube';
  await io.sleep(io.config.apiMs);
  var second = await findOnPlatform(io, dead, skip, otherType);
  if (!second.none) {
    second.otherSite = true;
    var all = first.tried.map(function(entry) { return Object.assign({}, entry, { name: PLATFORM_NAMES[type] + ': ' + entry.name }); })
      .concat(second.tried.map(function(entry) { return Object.assign({}, entry, { name: PLATFORM_NAMES[otherType] + ': ' + entry.name }); }));
    second.tried = all;
    return second;
  }

  return {
    none: first.none === second.none
      ? first.none + ' (looked on both ' + PLATFORM_NAMES[type] + ' and ' + PLATFORM_NAMES[otherType] + ')'
      : PLATFORM_NAMES[type] + ': ' + first.none + '; ' + PLATFORM_NAMES[otherType] + ': ' + second.none,
    searched: first.searched,
    tried: first.tried.map(function(entry) { return Object.assign({}, entry, { name: PLATFORM_NAMES[type] + ': ' + entry.name }); })
      .concat(second.tried.map(function(entry) { return Object.assign({}, entry, { name: PLATFORM_NAMES[otherType] + ': ' + entry.name }); }))
  };
}

/**
 * Looks through a playlist for dead songs and finds what could replace each. Changes nothing.
 * @param {{id: string, name: string}} playlist
 * @param {{fromPage: number, maxPages: number, onProgress: function, shouldStop: function, shouldCancel: function}} options
 *   shouldStop ends the reading and checking, and the replacements of what was found are still looked for.
 *   shouldCancel (a second stop) ends the looking for replacements too
 * @returns {Promise<object>} {playlist, scanned, finished, nextPage, items: [{entryId, song, text, replacement, none}], stopped}
 *   or {error}
 */
async function scan(io, playlist, options) {
  options = options || {};
  var read = await readPlaylist(io, playlist.id, options);
  if (read.error) { return { error: read.error }; }

  var songs = read.songs;
  var inPlaylist = new Set(songs.map(keyOf));

  // carrying on from an earlier scan of this playlist: what was found and searched for before is kept, and the songs
  // already checked are skipped. The playlist may have changed since, so the place is found by the last song checked
  var resume = options.resume || null;
  var dead = resume ? resume.dead.slice() : [];
  var searched = resume ? resume.items.slice() : [];
  var start = 0;
  if (resume) {
    // by the next song to check, or if that one is gone by the last one checked, and only if both are gone by how many were checked
    var next = resume.nextEntryId ? songs.findIndex(function(song) { return song.entryId === resume.nextEntryId; }) : -1;
    var last = resume.lastEntryId ? songs.findIndex(function(song) { return song.entryId === resume.lastEntryId; }) : -1;
    start = next >= 0 ? next : last >= 0 ? last + 1 : Math.min(resume.index, songs.length);
  }

  // stopped while the playlist was being read (or before it was)
  var stopped = !read.finished && options.shouldStop && options.shouldStop() ? 'you stopped it' : null;
  var rateLimitedInARow = 0;
  var firstTold = 0;
  var rateLimited = false;
  var nextIndex = start;

  /** where this scan is, to carry on from: the next song to check, what is dead, and what has a replacement looked for */
  var snapshot = function() {
    return {
      index: nextIndex,
      lastEntryId: nextIndex > 0 && songs[nextIndex - 1] ? songs[nextIndex - 1].entryId : null,
      nextEntryId: songs[nextIndex] ? songs[nextIndex].entryId : null,
      dead: dead.slice(),
      items: searched.slice()
    };
  };
  var checkpoint = function() { if (options.onCheckpoint) { options.onCheckpoint(snapshot()); } };

  for (var i = start; i < songs.length; i++) {
    if (options.shouldStop && options.shouldStop()) { stopped = 'you stopped it'; break; }

    var song = songs[i];
    nextIndex = i;
    if (options.onProgress) { options.onProgress({ stage: 'checking', done: i, total: songs.length, dead: dead.length }); }
    if (!song.fkid || !song.type) { nextIndex = i + 1; continue; }

    var verdict = await checkSong(io, song);
    if (verdict.rate) {
      if (rateLimitedInARow === 0) { firstTold = i; }
      rateLimitedInARow++;
    } else {
      rateLimitedInARow = 0;
    }
    if (rateLimitedInARow >= MAX_RATE_LIMITED_IN_A_ROW) {
      stopped = 'YouTube or SoundCloud is asking this browser to slow down, try again in a while';
      rateLimited = true;
      // those songs were not really checked, a scan carried on later starts again at the first of them
      nextIndex = firstTold;
      break;
    }
    nextIndex = i + 1;
    if (verdict.dead) { dead.push({ song: song, text: verdict.text }); }
    if (nextIndex % CHECKPOINT_EVERY === 0) { checkpoint(); }

    await io.sleep(io.config.checkMs);
  }

  // The dead songs found so far get their replacements looked for even when the scan was stopped, so a stopped
  // scan is still a useful report. Only a second stop (shouldCancel) skips that, and so does being rate limited,
  // since checking the replacements would only be told to slow down too
  var cancelled = false;
  var done = {};
  searched.forEach(function(item) { done[item.entryId] = true; });
  var waiting = dead.filter(function(entry) { return !done[entry.song.entryId]; });
  var searchLimit = rateLimited ? 0 : Math.max(0, Math.min(waiting.length, MAX_DEAD_SEARCHED - searched.length));
  var searchedNow = 0;

  for (; searchedNow < searchLimit; searchedNow++) {
    if (options.shouldCancel && options.shouldCancel()) { cancelled = true; stopped = stopped || 'you stopped it'; break; }
    if (options.onProgress) { options.onProgress({ stage: 'searching', done: searchedNow, total: searchLimit, dead: dead.length }); }

    var entry = waiting[searchedNow];
    var found = await findReplacement(io, entry.song, inPlaylist);
    if (found.fkid) { inPlaylist.add(keyOf(found)); }
    searched.push({
      entryId: entry.song.entryId,
      song: entry.song,
      text: entry.text,
      replacement: found.fkid ? found : null,
      none: found.none || null,
      searched: found.searched || null,
      tried: found.tried || []
    });
    checkpoint();
    await io.sleep(io.config.apiMs);
  }

  // dead songs that were found but not searched for (cancelled, rate limited, or past the limit) are still listed
  var items = searched.slice();
  waiting.slice(searchedNow).forEach(function(entry) {
    items.push({
      entryId: entry.song.entryId, song: entry.song, text: entry.text, replacement: null,
      none: cancelled || rateLimited ? 'not searched for' : 'past the limit of ' + MAX_DEAD_SEARCHED + ' searches, scan again after applying'
    });
  });

  return {
    playlist: playlist,
    scanned: songs.length,
    finished: read.finished,
    nextPage: read.nextPage,
    items: items,
    stopped: stopped,
    // to carry on from, when this scan stopped before the end
    resume: snapshot()
  };
}

/**
 * Scans several playlists one after the other, each the same way as scan. A playlist that can't be read is
 * recorded with its error and the rest carry on. It stops when asked, and when YouTube or SoundCloud say to slow down
 * (the rest would only be told the same).
 * @param {{id: string, name: string, totalItems: number|null}[]} playlists
 * @param {object} options as for scan, plus onPlaylist({index, total, playlist}) when it moves on to the next one
 * @returns {Promise<{results: {playlist: object, scan: object}[], stopped: string|null}>}
 */
async function scanAll(io, playlists, options) {
  options = options || {};

  // carrying on: the playlists already finished are kept as they were, and the one that was in the middle carries on from where it got to
  var resume = options.resume || null;
  var results = resume ? resume.finished.slice() : [];
  var finishedIds = {};
  results.forEach(function(entry) { finishedIds[entry.playlist.id] = true; });
  var stopped = null;
  var carryOn = null;

  for (var i = 0; i < playlists.length; i++) {
    if (options.shouldStop && options.shouldStop()) { stopped = 'you stopped it'; break; }

    var playlist = playlists[i];
    if (playlist.totalItems === 0 || finishedIds[playlist.id]) { continue; }
    if (options.onPlaylist) { options.onPlaylist({ index: i, total: playlists.length, playlist: playlist }); }

    var current = playlist;
    var scanOptions = Object.assign({}, options, {
      resume: resume && resume.current && resume.current.playlistId === playlist.id ? resume.current.state : null,
      onCheckpoint: function(state) {
        if (options.onCheckpoint) { options.onCheckpoint({ finished: results.slice(), current: { playlistId: current.id, state: state } }); }
      }
    });
    var result = await scan(io, playlist, scanOptions);

    // a playlist that stopped before its end is not finished: it is where a later scan carries on from
    if (!result.error && result.stopped) {
      results.push({ playlist: playlist, scan: result });
      stopped = result.stopped;
      carryOn = { finished: results.slice(0, -1), current: { playlistId: playlist.id, state: result.resume } };
      break;
    }

    results.push({ playlist: playlist, scan: result });
    await io.sleep(io.config.apiMs);
  }

  // stopped between playlists: the next one has not been started
  if (stopped && !carryOn) { carryOn = { finished: results.slice(), current: null }; }

  return { results: results, stopped: stopped, resume: carryOn };
}

/**
 * Swaps in the replacements that were chosen. Each replacement is added first, and the dead song is only
 * taken out once that worked, so nothing is lost. Dead songs without a replacement are only taken out when asked.
 * @param {{id: string, name: string}} playlist
 * @param {object[]} items items from scan, the ones the person left ticked
 * @param {{removeWithoutReplacement: boolean, onProgress: function, shouldStop: function}} options
 * @returns {Promise<{results: {item: object, status: string, detail: string}[], totalItems: number|null}>}
 *   status is 'replaced', 'removed', 'add-failed' or 'remove-failed'
 */
async function apply(io, playlist, items, options) {
  options = options || {};
  var results = [];
  var totalItems = null;

  for (var i = 0; i < items.length; i++) {
    if (options.shouldStop && options.shouldStop()) { break; }
    var item = items[i];
    if (options.onProgress) { options.onProgress({ stage: 'applying', done: i, total: items.length }); }

    if (item.replacement) {
      var added = await io.api('POST', 'playlist/' + playlist.id + '/songs', { fkid: item.replacement.fkid, type: item.replacement.type });
      if (added.code !== 200) {
        results.push({ item: item, status: 'add-failed', detail: "couldn't add the replacement (QueUp answered " + added.code + answerText(added) + '), left as it was' });
        await io.sleep(io.config.apiMs);
        continue;
      }
    } else if (!options.removeWithoutReplacement) {
      continue;
    }

    var removed = await io.api('DELETE', 'playlist/' + playlist.id + '/songs/' + item.entryId);
    if (removed.code === 200) {
      var parsed = queupParse.parseRemoved(removed.body);
      if (parsed) { totalItems = parsed.totalItems; }
      results.push({ item: item, status: item.replacement ? 'replaced' : 'removed', detail: item.replacement ? 'added "' + item.replacement.name + '" and took the dead song out' : 'took the dead song out' });
    } else {
      results.push({ item: item, status: 'remove-failed', detail: (item.replacement ? 'added the replacement, but ' : '') + "couldn't take the dead song out (QueUp answered " + removed.code + answerText(removed) + ')' });
    }
    await io.sleep(io.config.apiMs);
  }

  return { results: results, totalItems: totalItems };
}

// ---- songs that are in more than one place ----

// a playlist read for duplicates is read to its end, up to this many pages (QueUp playlists are 300 songs, 15 pages)
var DUPLICATE_MAX_PAGES = 100;

/** can this song be told apart from others: it needs a site and an id */
function hasIdentity(song) {
  return !!song.type && !!song.fkid;
}

/**
 * Are these two different uploads probably the same recording? The title words have to be the same, the name has
 * to have an artist in it (or enough words) so a bare "Dreams" is not taken for every song called that, they can't be
 * different versions of the song, and when both lengths are known they have to be about the same.
 */
function looksLikeSameUpload(a, b) {
  var key = songMatch.titleKey(a.name);
  if (!key || key !== songMatch.titleKey(b.name)) { return false; }
  if (!songMatch.splitArtistTitle(a.name) && key.split(' ').length < 3) { return false; }
  if (songMatch.looksLikeAlbumOrMix(a.name) || songMatch.looksLikeAlbumOrMix(b.name)) { return false; }
  if (songMatch.isDifferentVersion(a.name, b.name) || songMatch.isDifferentVersion(b.name, a.name)) { return false; }
  return songMatch.isSameLength(a.length, b.length) !== false;
}

/**
 * Finds the songs that are in a playlist more than once, or in more than one playlist. This only looks at what was read, nothing is asked of any site.
 *   exact: the very same video or track. The extra copies in one playlist are suggested for removal, a copy in another playlist is
 *          not (playlists often overlap on purpose), but can be ticked.
 *   similar: different uploads that look like the same song (same title words, about the same length). Nothing is suggested, they are looked at first.
 * @param {{playlist: {id: string, name: string}, songs: object[]}[]} read
 * @returns {{exact: object[], similar: object[], songs: number}} a group is {name, copies: [{playlist, song, suggested}]}
 */
function groupDuplicates(read) {
  var byKey = {};
  var order = [];
  var total = 0;

  read.forEach(function(entry) {
    entry.songs.forEach(function(song) {
      total++;
      if (!hasIdentity(song)) { return; }
      var key = keyOf(song);
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push({ playlist: { id: entry.playlist.id, name: entry.playlist.name }, song: song });
    });
  });

  var exact = [];
  order.forEach(function(key) {
    var copies = byKey[key];
    if (copies.length < 2) { return; }

    // the first copy in each playlist is kept, the second and later in the same playlist are the ones to take out
    var seen = {};
    copies.forEach(function(copy) {
      copy.suggested = !!seen[copy.playlist.id];
      seen[copy.playlist.id] = true;
    });
    var named = copies.filter(function(copy) { return hasRealName(copy.song); })[0];
    exact.push({ name: named ? named.song.name : copies[0].song.fkid, copies: copies });
  });

  // different uploads: one stand-in per distinct video, grouped by the words of the title
  var buckets = {};
  var bucketOrder = [];
  order.forEach(function(key) {
    var stand = byKey[key][0];
    if (!hasRealName(stand.song)) { return; }
    var bucket = songMatch.titleKey(stand.song.name);
    if (!bucket) { return; }
    if (!buckets[bucket]) { buckets[bucket] = []; bucketOrder.push(bucket); }
    buckets[bucket].push(stand);
  });

  var similar = [];
  bucketOrder.forEach(function(bucket) {
    var left = buckets[bucket];
    // the first song of what is left is the anchor, the ones that look like it join it, the others make the next group
    while (left.length > 1) {
      var anchor = left[0];
      var group = [anchor];
      var rest = [];
      left.slice(1).forEach(function(other) { (looksLikeSameUpload(anchor.song, other.song) ? group : rest).push(other); });
      if (group.length > 1) {
        similar.push({ name: anchor.song.name, copies: group.map(function(copy) { return { playlist: copy.playlist, song: copy.song, suggested: false }; }) });
      }
      left = rest;
    }
  });

  return { exact: exact, similar: similar, songs: total };
}

/**
 * Reads every one of the playlists to its end, for finding duplicates
 * @param {{id: string, name: string, totalItems: number|null}[]} playlists
 * @param {{onProgress: function, shouldStop: function}} options onProgress({index, total, playlist, done})
 * @returns {Promise<{read: object[], failed: string[], stopped: boolean}>}
 */
async function readAllPlaylists(io, playlists, options) {
  options = options || {};
  var read = [];
  var failed = [];
  var stopped = false;

  for (var i = 0; i < playlists.length; i++) {
    if (options.shouldStop && options.shouldStop()) { stopped = true; break; }
    var playlist = playlists[i];
    if (playlist.totalItems === 0) { continue; }

    var result = await readPlaylist(io, playlist.id, {
      maxPages: DUPLICATE_MAX_PAGES,
      shouldStop: options.shouldStop,
      onProgress: function(info) { if (options.onProgress) { options.onProgress({ index: i, total: playlists.length, playlist: playlist, done: info.done }); } }
    });

    if (result.error) { failed.push(playlist.name); }
    else if (!result.finished) { stopped = true; break; }
    else { read.push({ playlist: playlist, songs: result.songs }); }
    await io.sleep(io.config.apiMs);
  }

  return { read: read, failed: failed, stopped: stopped };
}

/**
 * Of the copies that were picked, the ones that can safely be removed: at least one copy of every song is always kept,
 * even when every box is ticked. A copy is only counted once.
 * @param {object[]} groups from groupDuplicates (exact or similar)
 * @param {function} isPicked (copy) -> boolean
 * @returns {{playlist: object, song: object}[]}
 */
function safeRemovals(groups, isPicked) {
  var removals = [];
  var taken = {};

  groups.forEach(function(group) {
    var picked = group.copies.filter(isPicked);
    if (picked.length >= group.copies.length) { picked = picked.slice(1); }
    picked.forEach(function(copy) {
      var id = copy.playlist.id + '/' + copy.song.entryId;
      if (taken[id]) { return; }
      taken[id] = true;
      removals.push({ playlist: copy.playlist, song: copy.song });
    });
  });

  return removals;
}

/**
 * Takes the picked copies out of their playlists. Nothing is added.
 * @param {{playlist: object, song: object}[]} removals
 * @param {{onProgress: function, shouldStop: function}} options
 * @returns {Promise<{results: {playlist: object, song: object, status: string, detail: string}[], totals: object}>} status is 'removed' or 'failed'
 */
async function removeCopies(io, removals, options) {
  options = options || {};
  var results = [];
  var totals = {};

  for (var i = 0; i < removals.length; i++) {
    if (options.shouldStop && options.shouldStop()) { break; }
    var one = removals[i];
    if (options.onProgress) { options.onProgress({ stage: 'removing', done: i, total: removals.length }); }

    var answer = await io.api('DELETE', 'playlist/' + one.playlist.id + '/songs/' + one.song.entryId);
    if (answer.code === 200) {
      var parsed = queupParse.parseRemoved(answer.body);
      if (parsed) { totals[one.playlist.id] = parsed.totalItems; }
      results.push({ playlist: one.playlist, song: one.song, status: 'removed', detail: 'took the extra copy out' });
    } else {
      results.push({ playlist: one.playlist, song: one.song, status: 'failed', detail: "couldn't take it out (QueUp answered " + answer.code + answerText(answer) + ')' });
    }
    await io.sleep(io.config.apiMs);
  }

  return { results: results, totals: totals };
}

// ---- carrying on a scan that was interrupted ----

var CHECKPOINT_MAX_AGE_DAYS = 7;

/** saves where a scan has got to, with what it is scanning, so it can be carried on */
function saveCheckpoint(store, checkpoint, now) {
  store.set('checkpoint', {
    v: 1,
    savedAt: now,
    multi: !!checkpoint.multi,
    fromPage: checkpoint.fromPage,
    maxPages: checkpoint.maxPages,
    playlists: checkpoint.playlists.map(function(playlist) { return { id: playlist.id, name: playlist.name, totalItems: playlist.totalItems }; }),
    resume: checkpoint.resume
  });
}

function clearCheckpoint(store) {
  store.set('checkpoint', null);
}

/**
 * The saved scan, if there is one that is still worth carrying on: not older than a week, and shaped as it was saved
 * (what comes out of storage is checked and never trusted)
 * @returns {object|null}
 */
function loadCheckpoint(store, now) {
  var saved = store.get('checkpoint', null);
  if (!saved || saved.v !== 1 || typeof saved.savedAt !== 'number') { return null; }
  if (now - saved.savedAt > CHECKPOINT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 || saved.savedAt > now + 60000) { return null; }

  var idLike = /^[A-Za-z0-9]{1,64}$/;
  if (!Array.isArray(saved.playlists) || saved.playlists.length === 0) { return null; }
  if (!saved.playlists.every(function(p) { return p && idLike.test(String(p.id)) && typeof p.name === 'string'; })) { return null; }
  if (!(saved.fromPage >= 1) || !(saved.maxPages >= 1)) { return null; }

  var resume = saved.resume;
  if (!resume || !Array.isArray(resume.finished)) { return null; }
  if (!resume.finished.every(function(entry) { return entry && entry.playlist && idLike.test(String(entry.playlist.id)) && entry.scan && Array.isArray(entry.scan.items); })) { return null; }

  if (resume.current) {
    var state = resume.current.state;
    if (!idLike.test(String(resume.current.playlistId)) || !state || !Array.isArray(state.dead) || !Array.isArray(state.items) || !(state.index >= 0)) { return null; }
  }
  return saved;
}

/** the saved scan in words: what it was doing, and how long ago */
function describeCheckpoint(checkpoint, now) {
  var finished = checkpoint.resume.finished.length;
  var current = checkpoint.resume.current;
  var where;

  if (current) {
    var playlist = checkpoint.playlists.filter(function(p) { return p.id === current.playlistId; })[0];
    where = (checkpoint.multi ? 'playlist ' + (finished + 1) + ' of ' + checkpoint.playlists.length + ', ' : '') + '"' + (playlist ? playlist.name : 'a playlist') + '", ' +
      current.state.index + (current.state.index === 1 ? ' song' : ' songs') + ' checked, ' + current.state.dead.length + ' dead so far';
  } else {
    where = finished + ' of ' + checkpoint.playlists.length + ' playlists done';
  }

  return 'An earlier scan was interrupted (' + where + ', ' + timeAgo(checkpoint.savedAt, now) + ').';
}

function timeAgo(then, now) {
  var minutes = Math.floor((now - then) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? minutes + ' minutes ago' : minutes < 1440 ? Math.floor(minutes / 60) + ' hours ago' : Math.floor(minutes / 1440) + ' days ago';
}

// ---- the finished report, kept so a reload doesn't lose it ----

var REPORT_MAX_AGE_DAYS = 7;

function countRows(entries) {
  var rows = 0;
  var withReplacement = 0;
  entries.forEach(function(entry) {
    entry.scan.items.forEach(function(item) { rows++; if (item.replacement) { withReplacement++; } });
  });
  return { rows: rows, withReplacement: withReplacement };
}

/**
 * Keeps what a scan found. Only what the list shows is kept (not where to carry on from).
 * Nothing is kept when nothing was found, and what was kept before is forgotten
 * @param {{multi: boolean, stopped: string|null, scans: {playlist: object, scan: object}[]}} found
 * @param {string} summary the line shown above the list
 */
function saveReport(store, found, summary, now) {
  var entries = found.scans.filter(function(entry) { return !entry.scan.error; }).map(function(entry) {
    var scan = entry.scan;
    return {
      playlist: { id: entry.playlist.id, name: entry.playlist.name, totalItems: entry.playlist.totalItems },
      scan: { scanned: scan.scanned, finished: scan.finished, nextPage: scan.nextPage, stopped: scan.stopped, items: scan.items }
    };
  });

  if (countRows(entries).rows === 0) { return clearReport(store); }
  store.set('report', { v: 1, savedAt: now, multi: !!found.multi, stopped: found.stopped || null, summary: String(summary), entries: entries });
}

function clearReport(store) {
  store.set('report', null);
}

/**
 * The saved report, if there is one still worth looking at: not older than a week, and shaped as it was saved
 * (what comes out of storage is checked and never trusted)
 * @returns {{savedAt: number, multi: boolean, stopped: string|null, summary: string, entries: object[]}|null}
 */
function loadReport(store, now) {
  var saved = store.get('report', null);
  if (!saved || saved.v !== 1 || typeof saved.savedAt !== 'number' || typeof saved.summary !== 'string') { return null; }
  if (now - saved.savedAt > REPORT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 || saved.savedAt > now + 60000) { return null; }
  if (!Array.isArray(saved.entries) || saved.entries.length === 0) { return null; }

  var idLike = /^[A-Za-z0-9]{1,64}$/;
  var shaped = saved.entries.every(function(entry) {
    return entry && entry.playlist && idLike.test(String(entry.playlist.id)) && typeof entry.playlist.name === 'string' &&
      entry.scan && Array.isArray(entry.scan.items) && entry.scan.items.every(function(item) {
        return item && item.song && typeof item.song.fkid === 'string' && typeof item.text === 'string';
      });
  });
  if (!shaped || countRows(saved.entries).rows === 0) { return null; }
  return saved;
}

/** the saved report in words, for the box that offers it */
function describeReport(report, now) {
  var counts = countRows(report.entries);
  return 'A finished scan from ' + timeAgo(report.savedAt, now) + ' is saved: ' + counts.rows + (counts.rows === 1 ? ' dead song' : ' dead songs') + ', ' + counts.withReplacement + ' with a replacement.';
}

/**
 * Takes songs out of the saved report once they have been changed in the playlist, so the report only keeps what is still to do
 * @param {{playlistId: string, entryId: string}[]} done
 */
function dropFromReport(store, done, now) {
  var report = loadReport(store, now);
  if (!report) { return; }

  var gone = {};
  done.forEach(function(one) { gone[one.playlistId + '/' + one.entryId] = true; });
  report.entries.forEach(function(entry) {
    entry.scan.items = entry.scan.items.filter(function(item) { return !gone[entry.playlist.id + '/' + item.entryId]; });
  });

  if (countRows(report.entries).rows === 0) { return clearReport(store); }
  // the date it was saved stays, a report doesn't get younger by being used
  store.set('report', report);
}

// ---- the reminder: a playlist not scanned for a while ----

var REMIND_AFTER_DAYS = 30;
var SNOOZE_DAYS = 7;
var DAY_MS = 24 * 60 * 60 * 1000;

/** what the panel knows about the playlists, kept from the last time they were listed (so the button can show a reminder without asking QueUp) */
function rememberPlaylists(store, playlists) {
  store.set('playlists', playlists.map(function(playlist) { return { id: playlist.id, name: playlist.name, totalItems: playlist.totalItems }; }));
}

/** a playlist was scanned from the start to the end, now */
function recordScan(store, playlist, now) {
  var scans = store.get('lastScans', {}) || {};
  scans[playlist.id] = now;
  store.set('lastScans', scans);
}

/**
 * What the reminder should say.
 * @returns {{show: boolean, due: {playlist: object, lastScan: number|null, days: number|null}[], lastScan: number|null, known: boolean, off: boolean, snoozedUntil: number|null}}
 *   show: the button should show the reminder. due: playlists never scanned or not scanned for 30 days (empty ones don't count).
 *   known: the playlists have been listed at least once
 */
function reminderStatus(store, now) {
  var playlists = store.get('playlists', null);
  var scans = store.get('lastScans', {}) || {};
  var settings = store.get('reminder', {}) || {};
  var known = Array.isArray(playlists);

  var due = (known ? playlists : [])
    .filter(function(playlist) { return playlist.totalItems !== 0; })
    .filter(function(playlist) { return !(scans[playlist.id] > 0) || now - scans[playlist.id] > REMIND_AFTER_DAYS * DAY_MS; })
    .map(function(playlist) {
      var last = scans[playlist.id] > 0 ? scans[playlist.id] : null;
      return { playlist: playlist, lastScan: last, days: last ? Math.floor((now - last) / DAY_MS) : null };
    });

  var times = Object.keys(scans).map(function(id) { return scans[id]; }).filter(function(time) { return time > 0; });
  var snoozed = settings.snoozeUntil > now;

  return {
    show: !settings.off && !snoozed && (!known || due.length > 0),
    due: due,
    lastScan: times.length ? Math.max.apply(null, times) : null,
    known: known,
    off: !!settings.off,
    snoozedUntil: snoozed ? settings.snoozeUntil : null
  };
}

/** don't remind again for a week */
function snoozeReminder(store, now) {
  var settings = store.get('reminder', {}) || {};
  settings.snoozeUntil = now + SNOOZE_DAYS * DAY_MS;
  store.set('reminder', settings);
}

/** turn the reminder off, or back on */
function setReminderOff(store, off) {
  var settings = store.get('reminder', {}) || {};
  settings.off = !!off;
  if (!off) { delete settings.snoozeUntil; }
  store.set('reminder', settings);
}

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "today", "yesterday", "5 days ago" */
function daysAgo(days) {
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
}

/**
 * The reminder as words for the panel
 * @returns {{last: string, due: string|null}}
 */
function describeReminder(status, now) {
  var last = status.lastScan
    ? 'Last scan: ' + formatDate(status.lastScan) + ' (' + daysAgo(Math.floor((now - status.lastScan) / DAY_MS)) + ')'
    : 'You have not scanned a playlist all the way through yet.';

  var due = null;
  if (status.due.length > 0) {
    due = 'Not scanned for over a month: ' + status.due.map(function(entry) {
      return entry.playlist.name + (entry.lastScan ? ' (' + entry.days + ' days)' : ' (never)');
    }).join(', ');
  }
  return { last: last, due: due };
}

/** the report as plain text, to copy */
function reportText(scanResult) {
  var lines = ['Dead songs in "' + scanResult.playlist.name + '" (checked ' + scanResult.scanned + ' songs):'];
  scanResult.items.forEach(function(item, n) {
    var name = hasRealName(item.song) ? '"' + item.song.name + '"' : 'an unnamed song (' + item.song.fkid + ')';
    var instead = item.replacement
      ? ' -> "' + item.replacement.name + '"' + (songLink(item.replacement) ? ' ' + songLink(item.replacement) : '') + (item.replacement.otherSite ? ' (on ' + PLATFORM_NAMES[String(item.replacement.type).toLowerCase()] + ' instead)' : '') + ' [' + compareLengths(item.song, item.replacement) + ']' +
        (item.replacement.confidence === 'possible' ? ' POSSIBLE MATCH, check it: ' + item.replacement.note : '') +
        (item.replacement.picture === 'same' ? ' (same cover picture)' : '')
      : ' -> no replacement (' + item.none + ')';
    lines.push((n + 1) + ') ' + name + ' (' + item.text + ')' + instead);
  });
  if (scanResult.items.length === 0) { lines.push('none found'); }
  return lines.join('\n');
}

/** the report for several playlists as plain text, to copy */
function reportTextAll(all) {
  return all.results.map(function(entry) {
    return entry.scan.error
      ? 'Dead songs in "' + entry.playlist.name + '": ' + entry.scan.error
      : reportText(entry.scan);
  }).join('\n\n') || 'No playlists were checked.';
}

module.exports = {
  checkSong: checkSong,
  listPlaylists: listPlaylists,
  readPlaylist: readPlaylist,
  findReplacement: findReplacement,
  scan: scan,
  apply: apply,
  groupDuplicates: groupDuplicates,
  readAllPlaylists: readAllPlaylists,
  safeRemovals: safeRemovals,
  removeCopies: removeCopies,
  looksLikeSameUpload: looksLikeSameUpload,
  reportText: reportText,
  timeAgo: timeAgo,
  saveReport: saveReport,
  loadReport: loadReport,
  clearReport: clearReport,
  describeReport: describeReport,
  dropFromReport: dropFromReport,
  saveCheckpoint: saveCheckpoint,
  clearCheckpoint: clearCheckpoint,
  loadCheckpoint: loadCheckpoint,
  describeCheckpoint: describeCheckpoint,
  rememberPlaylists: rememberPlaylists,
  recordScan: recordScan,
  reminderStatus: reminderStatus,
  snoozeReminder: snoozeReminder,
  setReminderOff: setReminderOff,
  describeReminder: describeReminder,
  REMIND_AFTER_DAYS: REMIND_AFTER_DAYS,
  reportTextAll: reportTextAll,
  scanAll: scanAll,
  lengthDifference: lengthDifference,
  formatDifference: formatDifference,
  hasRealName: hasRealName,
  youtubeLink: youtubeLink,
  songLink: songLink,
  artistAndTitle: artistAndTitle,
  lookElsewhere: lookElsewhere,
  PLATFORM_NAMES: PLATFORM_NAMES,
  safeImageUrl: safeImageUrl,
  pictureFor: pictureFor,
  dHash: dHash,
  hashDistance: hashDistance,
  formatLength: formatLength,
  compareLengths: compareLengths,
  answerText: answerText,
  keyOf: keyOf,
  PAGE_SIZE: queupParse.PAGE_SIZE,
  MAX_DEAD_SEARCHED: MAX_DEAD_SEARCHED
};
