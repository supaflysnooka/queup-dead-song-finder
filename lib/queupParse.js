'use strict';
/***********************************************************************
 * queupParse.js
 * Reading QueUp's answers to the playlist and search calls, as seen in what the site gets. Used by the bot
 * (bot/utilities/playlistApi.js) and by the browser userscript (userscript/), which is built from this same
 * file. Each function gives back null when the answer isn't shaped as expected, so a change on QueUp's side
 * shows up as "couldn't read" and not as a wrong guess.
 *
 * No requires, nothing from Node, so it runs in a browser too.
 */

// how many songs a page of a playlist holds
var PAGE_SIZE = 20;

/**
 * How long a song is, in milliseconds, from whatever the item has: songLength (milliseconds, like a song in a
 * playlist) or an ISO 8601 duration like PT5M30S. Null when it doesn't say.
 */
/** the link to a song's picture, as QueUp has it (songs have images.thumbnail), or null */
function thumbnailOf(item) {
  var link = get(item, ['images', 'thumbnail']) || (item && item.thumbnail);
  return typeof link === 'string' && link ? link : null;
}

function lengthOf(item) {
  if (!item) { return null; }
  if (typeof item.songLength === 'number' && item.songLength > 0) { return item.songLength; }

  var iso = get(item, ['contentDetails', 'duration']) || item.duration;
  if (typeof iso === 'string') {
    var match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
    if (match && (match[1] || match[2] || match[3])) {
      return ((Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0)) * 1000;
    }
  }
  return null;
}

// QueUp keeps some song names with HTML codes in them ("Fresh &amp; Low"), which would be searched for as typed and shown as typed
var NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Turns HTML codes in a name back into the characters they stand for: &amp; &lt; &gt; &quot; &apos; &#39; &#x27;
 * Once only, and with plain text work, never by putting the name into a page, so nothing in a name can run.
 */
function decodeEntities(text) {
  if (typeof text !== 'string') { return text; }

  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function(match, body) {
    if (body.charAt(0) === '#') {
      var code = body.charAt(1).toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match;
    }
    var named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

function get(object, path) {
  var value = object;
  for (var i = 0; i < path.length; i++) {
    if (value === null || value === undefined) { return undefined; }
    value = value[path[i]];
  }
  return value;
}

/**
 * One page of a playlist
 * @returns {{songs: {entryId: string, songId: string|null, name: string|null, type: string|null, fkid: string|null, added: number|null}[], last: boolean}|null}
 *   last is true when this page is the end of the playlist (fewer than a full page)
 */
function parseSongs(body) {
  var list = get(body, ['data']);
  if (!Array.isArray(list)) { return null; }

  var songs = [];
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    // QueUp sometimes returns null inside a list
    if (!entry) { continue; }
    if (typeof entry._id !== 'string') { return null; }

    songs.push({
      entryId: entry._id,
      songId: entry.songid || get(entry, ['_song', '_id']) || null,
      name: decodeEntities(get(entry, ['_song', 'name'])) || null,
      type: get(entry, ['_song', 'type']) || null,
      fkid: get(entry, ['_song', 'fkid']) || null,
      length: lengthOf(entry._song),
      thumbnail: thumbnailOf(entry._song),
      added: entry.added || null
    });
  }

  return { songs: songs, last: list.length < PAGE_SIZE };
}

/**
 * The result of taking a song out of a playlist
 * @returns {{playlistId: string, name: string|null, totalItems: number}|null}
 */
function parseRemoved(body) {
  var playlist = get(body, ['data']);
  if (!playlist || typeof playlist._id !== 'string' || typeof playlist.totalItems !== 'number') { return null; }
  return { playlistId: playlist._id, name: playlist.name || null, totalItems: playlist.totalItems };
}

/**
 * A page of search results
 * @returns {{total: number|null, results: {name: string, type: string|null, fkid: string}[]}|null}
 */
function parseSearch(body) {
  var items = get(body, ['data', 'items']);
  if (!Array.isArray(items)) { return null; }

  var results = items
    .filter(function(item) { return item && typeof item.name === 'string' && typeof item.fkid === 'string'; })
    .map(function(item) { return { name: decodeEntities(item.name), type: item.type || null, fkid: item.fkid, length: lengthOf(item), thumbnail: thumbnailOf(item) }; });

  var total = get(body, ['data', 'pageInfo', 'totalResults']);
  return { total: total === undefined ? null : total, results: results };
}

/**
 * The list of a person's playlists
 * @returns {{id: string, name: string, totalItems: number|null}[]|null}
 */
function parsePlaylists(body) {
  var list = get(body, ['data']);
  if (!Array.isArray(list)) { return null; }

  return list
    .filter(function(playlist) { return playlist && typeof playlist._id === 'string' && !playlist.removed; })
    .map(function(playlist) {
      return { id: playlist._id, name: String(playlist.name || '(unnamed)'), totalItems: typeof playlist.totalItems === 'number' ? playlist.totalItems : null };
    });
}

module.exports = {
  PAGE_SIZE: PAGE_SIZE,
  decodeEntities: decodeEntities,
  lengthOf: lengthOf,
  thumbnailOf: thumbnailOf,
  parseSongs: parseSongs,
  parseRemoved: parseRemoved,
  parseSearch: parseSearch,
  parsePlaylists: parsePlaylists
};
