'use strict';
/***********************************************************************
 * songMatch.js
 * Deciding whether a search result is the same song as another, by its title. Used by the bot
 * (bot/utilities/replacements.js) and by the browser userscript (userscript/), which is built from this
 * same file, so the two can't disagree about what counts as "the same song".
 *
 * No requires, nothing from Node, so it runs in a browser too.
 */

// how much of the dead song's title the result's title has to share (1 is identical)
var MIN_SIMILARITY = 0.8;

// a result with one of these that the original's own name doesn't have is a different version of the song
var VERSION_WORDS = [
  'remix', 'live', 'cover', 'karaoke', 'instrumental', 'acoustic', 'slowed', 'reverb', 'sped', 'nightcore',
  '8d', 'boosted', 'mashup', 'edit', 'bootleg', 'rework', 'vip', 'unmixed', 'trip', 'chat', 'interview',
  'tutorial', 'reaction', 'lesson', 'remake', 'megamix', 'mixtape', 'dub', 'flip', 'refix', 'rmx', 'session', 'set'
];

// words that don't say which song it is
var NOISE_WORDS = [
  'official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', 'music', 'full', 'version', 'out', 'now',
  'premiere', 'free', 'download', 'the', 'a', 'an', 'feat', 'ft', 'featuring', 'with', 'and', 'of', 'in'
];

function toSet(list) {
  var set = {};
  list.forEach(function(word) { set[word] = true; });
  return set;
}

// a result with one of these is a whole album or a long mix, not a track, even when the dead song's own name has them too
var ALBUM_WORDS = [
  'album', 'entire', 'compilation', 'discography', 'anthology', 'playlist', 'nonstop', 'megamix', 'mixtape', 'soundtrack', 'ost'
];

// a result longer than this is not a track (used when the length of the dead song isn't known)
var MAX_TRACK_MS = 25 * 60 * 1000;

var VERSION = toSet(VERSION_WORDS);
var ALBUM = toSet(ALBUM_WORDS);
var NOISE = toSet(NOISE_WORDS);

function words(text) {
  return String(text)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** the words that say which song it is: no labels like [OSMUK 023], and no noise like "official video" */
function titleWords(text) {
  var withoutLabels = String(text).replace(/\[[^\]]*\]/g, ' ');
  return words(withoutLabels).filter(function(word) { return !NOISE[word]; });
}

function unique(list) {
  return Object.keys(toSet(list));
}

/**
 * How alike two titles are, from 0 to 1: the words they share against the words in both
 * @returns {number}
 */
function similarity(a, b) {
  var first = unique(titleWords(a));
  var second = toSet(titleWords(b));
  var secondCount = Object.keys(second).length;
  if (first.length === 0 || secondCount === 0) { return 0; }

  var shared = first.filter(function(word) { return second[word]; }).length;
  return (2 * shared) / (first.length + secondCount);
}

/** does the candidate say it is a different version (remix, live, cover...) than the original does */
function isDifferentVersion(original, candidate) {
  var had = toSet(words(original));
  return words(candidate).some(function(word) { return VERSION[word] && !had[word]; });
}

/** does the name say it is a whole album, a long mix or a compilation */
function looksLikeAlbumOrMix(name) {
  return words(name).some(function(word) { return ALBUM[word]; });
}

/** "Artist - Title" as two parts, or null when the name has no artist in it */
function splitArtistTitle(name) {
  var match = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/.exec(String(name).trim());
  return match ? { artist: match[1], title: match[2] } : null;
}

/**
 * Are two lengths (in milliseconds) close enough to be the same recording? A re-upload can have a few seconds
 * of intro or silence, so 15% or 20 seconds is allowed. When one isn't known the answer is "can't tell" (null).
 * @returns {boolean|null}
 */
function isSameLength(a, b) {
  if (!(a > 0) || !(b > 0)) { return null; }
  return Math.abs(a - b) <= Math.max(20000, 0.15 * Math.max(a, b));
}

/**
 * Could this result be the song? Every word that says which song it is has to be in the result, with not much
 * else, it can't be a whole album or another version of the song, and when both lengths are known they have
 * to be about the same. A name with no artist in it ("Dreams") could be any song with that name, so it
 * needs enough words to be sure, and otherwise there is no match.
 *
 * @param {string} originalName
 * @param {string} resultName
 * @param {{length: number, resultLength: number}} [lengths] in milliseconds, either may be missing
 * @returns {boolean}
 */
function isSameSong(originalName, resultName, lengths) {
  if (looksLikeAlbumOrMix(resultName) || isDifferentVersion(originalName, resultName)) { return false; }

  var wanted = unique(titleWords(originalName));
  if (wanted.length === 0) { return false; }
  if (!splitArtistTitle(originalName) && wanted.length < 3) { return false; }

  var have = toSet(titleWords(resultName));
  var shared = wanted.filter(function(word) { return have[word]; }).length;
  if (shared < wanted.length || Object.keys(have).length > wanted.length + 4) { return false; }

  var original = lengths && lengths.length;
  var result = lengths && lengths.resultLength;
  var sameLength = isSameLength(original, result);
  if (sameLength === false) { return false; }
  // the dead song's length isn't known: a very long result is not a track
  if (sameLength === null && !(original > 0) && result > MAX_TRACK_MS) { return false; }

  return true;
}

/**
 * For a name a person typed (not a dead song's whole name): every word they typed is in the result's
 * title, and the result isn't much longer than what they typed (that would be a long mix or a compilation)
 */
function containsAll(query, result) {
  var wanted = titleWords(query);
  var have = toSet(titleWords(result));
  if (wanted.length === 0) { return false; }
  return wanted.every(function(word) { return have[word]; }) && Object.keys(have).length <= wanted.length + 6;
}

// words that say it is the same recording rather than another, so "Roygbiv (Remastered)" is still "Roygbiv"
var NEUTRAL = toSet(['original', 'mix', 'remastered', 'remaster']);

/** the words that make up a title, in a form two titles can be compared in */
function titleKey(text) {
  return unique(titleWords(text).filter(function(word) { return !NEUTRAL[word]; })).sort().join(' ');
}

/**
 * The results that have exactly the words of a title, with an artist in front ("Artist - Lapis") or without ("Lapis",
 * "Lapis (Official Audio)"). Albums, long mixes and other versions are left out. This only says the title is the same:
 * for a title that short, something else has to say it is the same song.
 */
function exactTitleMatches(original, results) {
  var wanted = titleKey(original);
  if (!wanted) { return []; }

  return results.filter(function(result) {
    if (looksLikeAlbumOrMix(result.name) || isDifferentVersion(original, result.name)) { return false; }
    var parts = splitArtistTitle(result.name);
    return titleKey(parts ? parts.title : result.name) === wanted;
  });
}

/**
 * Why a result is not a match for a song, in words, or null when it is one (see isSameSong). For showing the person
 * what was looked at.
 */
function whyNot(original, resultName, lengths) {
  if (looksLikeAlbumOrMix(resultName)) { return 'a whole album or a long mix'; }
  if (isDifferentVersion(original, resultName)) { return 'a different version (remix, live, cover...)'; }

  var wanted = unique(titleWords(original));
  if (wanted.length === 0) { return 'the dead song has no words to compare'; }
  if (!splitArtistTitle(original) && wanted.length < 3) { return 'the dead song is only a short title with no artist, too little to be sure'; }

  var have = toSet(titleWords(resultName));
  var missing = wanted.filter(function(word) { return !have[word]; });
  if (missing.length > 0) { return 'the title is missing: ' + missing.join(', '); }
  if (Object.keys(have).length > wanted.length + 4) { return 'the title has a lot of other words in it'; }

  var original_ = lengths && lengths.length;
  var result_ = lengths && lengths.resultLength;
  if (isSameLength(original_, result_) === false) { return 'the length is very different'; }
  if (isSameLength(original_, result_) === null && !(original_ > 0) && result_ > MAX_TRACK_MS) { return 'too long to be a track'; }
  return null;
}

/**
 * A name with one or two words and no artist, like "Roygbiv". Any song could have a name that short, so
 * isSameSong never accepts one, but a very unusual word is its own giveaway (see obscureTitleMatches).
 */
function isObscureTitle(name) {
  var wanted = unique(titleWords(name));
  return wanted.length > 0 && wanted.length < 3 && !splitArtistTitle(name);
}

/**
 * For a title with no artist: of the search results that are exactly that title ("Artist - Roygbiv"), which artist do
 * most of them agree on? A title nobody else uses has results that all come from one artist. A common one ("Nightfall")
 * has results from many.
 *
 * @param {string} original the dead song's name, a title alone
 * @param {{name: string}[]} results search results, best first
 * @returns {{artist: string, results: object[], total: number, share: number}|null} the artist most results agree on, how many
 *   results are exactly this title, and the share of those by that artist. Null when none is
 */
function obscureTitleMatches(original, results) {
  var wanted = titleKey(original);
  var groups = {};
  var total = 0;

  results.forEach(function(result) {
    if (looksLikeAlbumOrMix(result.name) || isDifferentVersion(original, result.name)) { return; }

    var parts = splitArtistTitle(result.name);
    if (!parts) { return; }
    if (titleKey(parts.title) !== wanted) { return; }

    var artistKey = titleKey(parts.artist);
    if (!artistKey) { return; }

    total++;
    if (!groups[artistKey]) { groups[artistKey] = { artist: parts.artist, results: [] }; }
    groups[artistKey].results.push(result);
  });

  var best = null;
  Object.keys(groups).forEach(function(artistKey) {
    if (!best || groups[artistKey].results.length > best.results.length) { best = groups[artistKey]; }
  });

  return best ? { artist: best.artist, results: best.results, total: total, share: best.results.length / total } : null;
}

module.exports = {
  titleKey: titleKey,
  exactTitleMatches: exactTitleMatches,
  whyNot: whyNot,
  isObscureTitle: isObscureTitle,
  obscureTitleMatches: obscureTitleMatches,
  MIN_SIMILARITY: MIN_SIMILARITY,
  titleWords: titleWords,
  similarity: similarity,
  isDifferentVersion: isDifferentVersion,
  isSameSong: isSameSong,
  isSameLength: isSameLength,
  looksLikeAlbumOrMix: looksLikeAlbumOrMix,
  splitArtistTitle: splitArtistTitle,
  containsAll: containsAll
};
