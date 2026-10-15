'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../userscript/src/core.js');

var calls;       // every request the script made, in order
var statuses;    // oEmbed url fragment -> list of statuses to answer (the last one repeats)
var pages;       // watch page replies by video id
var songs;       // the playlist: entries for the fake QueUp
var searchItems;
var addCode;
var removeCodes;
var io;

const YT = function(n) { return 'yt' + String(n).padStart(9, '0'); };

function entry(n, extra) {
  return { _id: 'entry' + n, added: n, songid: 'song' + n, _song: Object.assign({ _id: 'song' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) }, extra) };
}

function makeIo(withPage) {
  var made = {
    config: { confirmMs: 0, checkMs: 0, apiMs: 0 },
    sleep: function() { return Promise.resolve(); },
    status: async function(url) {
      calls.push('GET ' + url);
      var key = Object.keys(statuses).find(function(fragment) { return url.indexOf(fragment) !== -1; });
      var list = key ? statuses[key] : [200];
      return list.length > 1 ? list.shift() : list[0];
    },
    api: async function(method, path, form) {
      calls.push(method + ' ' + path + (form ? ' ' + JSON.stringify(form) : ''));
      var m;
      if (method === 'GET' && path === 'playlist') {
        return { code: 200, body: { data: [{ _id: 'pl1', name: 'Spooky', totalItems: 34, removed: false }, { _id: 'pl2', name: 'Old', totalItems: 0, removed: true }] } };
      }
      if (method === 'GET' && (m = /^playlist\/(\w+)\/songs\?page=(\d+)$/.exec(path))) {
        var page = parseInt(m[2], 10);
        return { code: 200, body: { data: songs.slice((page - 1) * 20, page * 20) } };
      }
      if (method === 'GET' && path.indexOf('song?name=') === 0) { return { code: 200, body: { data: { items: searchItems(decodeURIComponent(path.split('name=')[1].split('&')[0]), (/[?&]type=(\w+)/.exec(path) || [])[1]), pageInfo: { totalResults: 1 } } } }; }
      if (method === 'POST') { return { code: addCode, body: {} }; }
      if (method === 'DELETE') {
        var id = path.split('/').pop();
        var code = removeCodes[id] || 200;
        return { code: code, body: code === 200 ? { data: { _id: 'pl1', name: 'Spooky', totalItems: 33 } } : null };
      }
      return { code: 404, body: null };
    }
  };
  if (withPage !== false) {
    made.page = async function(url) {
      calls.push('PAGE ' + url);
      var id = url.split('v=')[1];
      return pages[id] || { status: 200, text: '..."playabilityStatus":{"status":"OK"}...' };
    };
  }
  return made;
}

beforeEach(function() {
  calls = [];
  statuses = {};
  pages = {};
  songs = [];
  for (var n = 1; n <= 27; n++) { songs.push(entry(n)); }
  searchItems = function(name) { return [{ name: name + ' [Label]', type: 'youtube', fkid: 'new' + String(name.match(/\d+/)[0]).padStart(8, '0') }]; };
  addCode = 200;
  removeCodes = {};
  io = makeIo();
});

describe('checkSong', function() {
  it('says a video is dead only when YouTube clearly says so twice: deleted, private, embedding off', async function() {
    statuses[YT(1)] = [404];
    statuses[YT(2)] = [403];
    statuses[YT(3)] = [401];
    assert.deepEqual(await core.checkSong(io, { type: 'youtube', fkid: YT(1) }), { dead: true, text: 'this YouTube video does not exist anymore' });
    assert.deepEqual(await core.checkSong(io, { type: 'youtube', fkid: YT(2) }), { dead: true, text: 'this YouTube video is private' });
    assert.match((await core.checkSong(io, { type: 'youtube', fkid: YT(3) })).text, /embedding is off/);
    assert.equal(calls.filter(function(c) { return c.indexOf(YT(1)) !== -1 && /^GET/.test(c); }).length, 2, 'asked twice');
  });

  it('does not call a video dead when the answers disagree, or are not a clear one', async function() {
    statuses[YT(1)] = [404, 200];
    statuses[YT(2)] = [500];
    statuses[YT(3)] = [0];
    for (var n = 1; n <= 3; n++) { assert.equal((await core.checkSong(io, { type: 'youtube', fkid: YT(n) })).dead, false, 'video ' + n); }
  });

  it('says a video that exists but the watch page calls UNPLAYABLE is dead, after asking twice', async function() {
    pages[YT(1)] = { status: 200, text: 'x"playabilityStatus":{"status":"UNPLAYABLE","reason":"Video unavailable"}x' };
    var verdict = await core.checkSong(io, { type: 'youtube', fkid: YT(1) });
    assert.deepEqual(verdict, { dead: true, text: "this YouTube video is blocked and can't be played" });
    assert.equal(calls.filter(function(c) { return /^PAGE/.test(c); }).length, 2);
  });

  it('never calls a video dead for a login wall, a changed page, an error, or a different answer the second time', async function() {
    var cases = [
      [{ status: 200, text: '"playabilityStatus":{"status":"LOGIN_REQUIRED"}' }],
      [{ status: 200, text: '<html>consent</html>' }],
      [{ status: 429, text: '' }],
      [null]
    ];
    for (var i = 0; i < cases.length; i++) {
      var list = cases[i].slice();
      io.page = async function() { return list.length > 1 ? list.shift() : list[0]; };
      assert.equal((await core.checkSong(io, { type: 'youtube', fkid: YT(5) })).dead, false, 'case ' + i);
    }
    var second = [{ status: 200, text: '"playabilityStatus":{"status":"UNPLAYABLE"}' }, { status: 200, text: '"playabilityStatus":{"status":"OK"}' }];
    io.page = async function() { return second.length > 1 ? second.shift() : second[0]; };
    assert.equal((await core.checkSong(io, { type: 'youtube', fkid: YT(5) })).dead, false);
  });

  it('counts a watch page that says too many requests, or sends the browser to the unusual traffic page, as being told to slow down', async function() {
    io.page = async function() { return { status: 429, text: '' }; };
    assert.deepEqual(await core.checkSong(io, { type: 'youtube', fkid: YT(1) }), { dead: false, rate: true });
    io.page = async function() { return { status: 200, text: '<html>sorry</html>', finalUrl: 'https://www.google.com/sorry/index?continue=x' }; };
    assert.deepEqual(await core.checkSong(io, { type: 'youtube', fkid: YT(1) }), { dead: false, rate: true });
  });

  it('skips the watch page check when the person turned it off', async function() {
    pages[YT(1)] = { status: 200, text: '"playabilityStatus":{"status":"UNPLAYABLE"}' };
    io.usePage = false;
    assert.equal((await core.checkSong(io, { type: 'youtube', fkid: YT(1) })).dead, false);
    assert.equal(calls.filter(function(c) { return /^PAGE/.test(c); }).length, 0);
    io.usePage = true;
    assert.equal((await core.checkSong(io, { type: 'youtube', fkid: YT(1) })).dead, true);
  });

  it('skips the watch page check when the userscript manager can not make it', async function() {
    var plain = makeIo(false);
    pages[YT(1)] = { status: 200, text: '"playabilityStatus":{"status":"UNPLAYABLE"}' };
    assert.equal((await core.checkSong(plain, { type: 'youtube', fkid: YT(1) })).dead, false);
  });

  it('reports being told to slow down, and does not call it dead', async function() {
    statuses[YT(1)] = [429];
    assert.deepEqual(await core.checkSong(io, { type: 'youtube', fkid: YT(1) }), { dead: false, rate: true });
  });

  it('checks SoundCloud tracks, and ignores ids and types it does not know', async function() {
    statuses['tracks%2F12345'] = [404];
    assert.deepEqual(await core.checkSong(io, { type: 'soundcloud', fkid: '12345' }), { dead: true, text: 'this SoundCloud track does not exist anymore' });
    assert.equal((await core.checkSong(io, { type: 'soundcloud', fkid: 'notanumber' })).dead, false);
    assert.equal((await core.checkSong(io, { type: 'youtube', fkid: 'short' })).dead, false);
    assert.equal((await core.checkSong(io, { type: 'vimeo', fkid: '1' })).dead, false);
  });
});

describe('listPlaylists and readPlaylist', function() {
  it('lists the playlists that have not been removed', async function() {
    assert.deepEqual(await core.listPlaylists(io), { playlists: [{ id: 'pl1', name: 'Spooky', totalItems: 34 }] });
  });

  it('puts the playlists in alphabetical order: capitals and accents ignored, numbers by their value', async function() {
    const names = ['zebra', 'Apple', '1 Favorites', 'mix 10', 'Mix 2', 'banana', '\u00c9clair', 'Chill', 'apple pie'];
    io.api = async function() { return { code: 200, body: { data: names.map(function(name, n) { return { _id: 'id' + n, name: name, totalItems: 1, removed: false }; }) } }; };

    const listed = await core.listPlaylists(io);
    assert.deepEqual(listed.playlists.map(function(p) { return p.name; }), ['1 Favorites', 'Apple', 'apple pie', 'banana', 'Chill', '\u00c9clair', 'Mix 2', 'mix 10', 'zebra']);
  });

  it('keeps playlists with the same name, and does not lose any, when it sorts', async function() {
    io.api = async function() { return { code: 200, body: { data: [{ _id: 'a', name: 'Same', totalItems: 1 }, { _id: 'b', name: 'same', totalItems: 2 }, { _id: 'c', name: 'Other', totalItems: 3 }] } }; };
    const listed = await core.listPlaylists(io);
    assert.deepEqual(listed.playlists.map(function(p) { return p.id; }).sort(), ['a', 'b', 'c']);
    assert.equal(listed.playlists[0].name, 'Other');
  });

  it('says what went wrong when the list can not be read', async function() {
    io.api = async function() { return { code: 500, body: null }; };
    assert.match((await core.listPlaylists(io)).error, /QueUp answered 500/);
  });

  it('reads every page until the last, 20 songs at a time', async function() {
    var read = await core.readPlaylist(io, 'pl1', {});
    assert.equal(read.songs.length, 27);
    assert.equal(read.finished, true);
    assert.deepEqual(calls.filter(function(c) { return /songs\?page/.test(c); }), ['GET playlist/pl1/songs?page=1', 'GET playlist/pl1/songs?page=2']);
  });

  it('stops after the pages it was asked for, and says where to carry on', async function() {
    songs = [];
    for (var n = 1; n <= 100; n++) { songs.push(entry(n)); }
    var read = await core.readPlaylist(io, 'pl1', { fromPage: 2, maxPages: 2 });
    assert.equal(read.songs.length, 40);
    assert.equal(read.finished, false);
    assert.equal(read.nextPage, 4);
  });

  it('gives an error, and not a guess, when a page can not be read', async function() {
    io.api = async function() { return { code: 200, body: { data: 'nope' } }; };
    assert.match((await core.readPlaylist(io, 'pl1', {})).error, /couldn't read page 1/);
  });
});

describe('looking on the other site', function() {
  const playlist = { id: 'pl1', name: 'Spooky' };
  const dead = { type: 'youtube', fkid: YT(3), name: 'MEDL4 - Leaper', length: 200000 };

  function soundcloudHas(items) {
    searchItems = function(name, type) { return type === 'soundcloud' ? items : []; };
  }

  it('finds a YouTube song on SoundCloud when YouTube has nothing, and says it is from there', async function() {
    soundcloudHas([{ name: 'MEDL4 - Leaper', type: 'soundcloud', fkid: '123456789', songLength: 201000 }]);
    const found = await core.findReplacement(io, dead, new Set());
    assert.equal(found.type, 'soundcloud');
    assert.equal(found.fkid, '123456789');
    assert.equal(found.otherSite, true);
    assert.equal(found.confidence, 'sure');
    assert.equal(calls.filter(function(c) { return /type=youtube/.test(c); }).length, 1, 'its own site was tried first');
    assert.equal(core.songLink(found), 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F123456789');
  });

  it('does not look on the other site when its own has a replacement', async function() {
    searchItems = function() { return [{ name: 'MEDL4 - Leaper', type: 'youtube', fkid: 'abcdefghijk', songLength: 200000 }]; };
    const found = await core.findReplacement(io, dead, new Set());
    assert.equal(found.type, 'youtube');
    assert.equal(found.otherSite, undefined);
    assert.equal(calls.filter(function(c) { return /type=soundcloud/.test(c); }).length, 0);
  });

  it('works the other way round, and applies the same rules there (no remix, no album)', async function() {
    searchItems = function(name, type) { return type === 'youtube' ? [{ name: 'MEDL4 - Leaper (Remix)', type: 'youtube', fkid: 'abcdefghijk' }] : [{ name: 'MEDL4 - Leaper', type: 'soundcloud', fkid: '5' }]; };
    const found = await core.findReplacement(io, { type: 'soundcloud', fkid: '99', name: 'MEDL4 - Leaper' }, new Set());
    assert.equal(found.type, 'soundcloud', 'it started on SoundCloud, where there is the same song');
    searchItems = function(name, type) { return type === 'youtube' ? [{ name: 'MEDL4 - Leaper (Full Album)', type: 'youtube', fkid: 'abcdefghijk' }] : []; };
    assert.match((await core.findReplacement(io, { type: 'soundcloud', fkid: '99', name: 'MEDL4 - Leaper' }, new Set())).none, /looked on both|YouTube: .*SoundCloud: /);
  });

  it('does not offer a SoundCloud track that is dead too', async function() {
    soundcloudHas([{ name: 'MEDL4 - Leaper', type: 'soundcloud', fkid: '123456789' }]);
    statuses['tracks%2F123456789'] = [404];
    const found = await core.findReplacement(io, dead, new Set());
    assert.ok(found.none);
    assert.match(found.none, /SoundCloud: the matching results don't play either/);
  });

  it('lists what was looked at on each site, and carries on when one search fails', async function() {
    searchItems = function(name, type) { return type === 'youtube' ? [{ name: 'Something else', type: 'youtube', fkid: 'abcdefghijk' }] : []; };
    const none = await core.findReplacement(io, dead, new Set());
    assert.ok(none.tried.some(function(t) { return /^YouTube: Something else/.test(t.name); }));

    const api = io.api;
    io.api = async function(method, path, form) { return /type=soundcloud/.test(path) ? { code: 500, body: null } : api(method, path, form); };
    const failed = await core.findReplacement(io, dead, new Set());
    assert.match(failed.none, /SoundCloud: the search failed/);
  });

  it('keeps SoundCloud track numbers that look like YouTube ids from getting a YouTube link', function() {
    assert.equal(core.songLink({ type: 'soundcloud', fkid: '12345678901' }).indexOf('https://w.soundcloud.com/'), 0);
    assert.equal(core.songLink({ type: 'youtube', fkid: 'abcdefghijk' }), 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(core.songLink({ type: 'vimeo', fkid: '1' }), null);
  });
});

describe('scan', function() {
  const playlist = { id: 'pl1', name: 'Spooky' };

  it('changes nothing, and finds nothing wrong when nothing is', async function() {
    var result = await core.scan(io, playlist, {});
    assert.equal(result.scanned, 27);
    assert.deepEqual(result.items, []);
    assert.equal(calls.filter(function(c) { return /^(POST|DELETE)/.test(c); }).length, 0);
  });

  it('finds each dead song with what could replace it', async function() {
    statuses[YT(3)] = [404];
    statuses[YT(10)] = [403];
    var result = await core.scan(io, playlist, {});

    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].entryId, 'entry3');
    assert.equal(result.items[0].text, 'this YouTube video does not exist anymore');
    const taken = Object.assign({}, result.items[0].replacement);
    assert.equal(taken.tried.length, 1, 'what was looked at comes with it');
    delete taken.tried;
    assert.deepEqual(taken, { name: 'Artist 3 - Title 3 [Label]', fkid: 'new00000003', type: 'youtube', length: null, thumbnail: null, confidence: 'sure', picture: null });
    assert.equal(result.items[1].replacement.fkid, 'new00000010');
  });

  it('says why a dead song has no replacement, and never offers one that is not clearly the same song', async function() {
    statuses[YT(3)] = [404];
    searchItems = function() { return [{ name: 'Something else entirely', type: 'youtube', fkid: 'otherthing01' }]; };
    var result = await core.scan(io, playlist, {});
    assert.equal(result.items[0].replacement, null);
    assert.equal(result.items[0].none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)');

    statuses[YT(3)] = [404];
    searchItems = function(name) { return [{ name: name + ' (Live)', type: 'youtube', fkid: 'liveversion01' }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)');
  });

  it('does not offer an album, or something of a very different length, as a replacement', async function() {
    songs[2] = entry(3, { songLength: 270000 });
    statuses[YT(3)] = [404];
    searchItems = function(name) {
      return [
        { name: name + ' (Full Album)', type: 'youtube', fkid: 'albumvideo01', songLength: 3600000 },
        { name: name + ' [Label]', type: 'youtube', fkid: 'longvideo001', songLength: 3600000 },
        { name: name + ' [Other]', type: 'youtube', fkid: 'rightvideo01', songLength: 272000 }
      ];
    };
    var result = await core.scan(io, playlist, {});
    assert.equal(result.items[0].replacement.fkid, 'rightvideo01');
  });

  it('does not offer a replacement for a title too short to be sure of', async function() {
    songs[2] = entry(3, { name: 'Nightfall' });
    statuses[YT(3)] = [404];
    searchItems = function() { return [{ name: 'Nightfall (Official Video)', type: 'youtube', fkid: 'othernight01' }]; };
    var result = await core.scan(io, playlist, {});
    assert.equal(result.items[0].none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)');
  });

  it('does not offer a replacement that is dead too, or that is already in the playlist', async function() {
    statuses[YT(3)] = [404];
    statuses.new00000003 = [404];
    var result = await core.scan(io, playlist, {});
    assert.equal(result.items[0].none, "the matching results don't play either (looked on both YouTube and SoundCloud)");

    statuses = { [YT(3)]: [404] };
    searchItems = function() { return [{ name: 'Artist 3 - Title 3 [Label]', type: 'youtube', fkid: YT(4) }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)', 'song 4 is already in the playlist');
  });

  it('does not search for a song QueUp has no name for', async function() {
    songs[2] = entry(3, { name: 'Failed to refresh song details.' });
    statuses[YT(3)] = [404];
    var result = await core.scan(io, playlist, {});
    assert.equal(result.items[0].none, 'no name to search for');
    assert.equal(calls.filter(function(c) { return /song\?name/.test(c); }).length, 0);
  });

  it('stops checking when asked, but still looks for replacements for the dead songs it found', async function() {
    statuses[YT(3)] = [404];
    statuses[YT(4)] = [404];
    var stop = false;
    var result = await core.scan(io, playlist, { onProgress: function(info) { if (info.stage === 'checking' && info.done === 5) { stop = true; } }, shouldStop: function() { return stop; } });

    assert.equal(result.stopped, 'you stopped it');
    assert.equal(result.items.length, 2, 'what was found before the stop');
    assert.deepEqual(result.items.map(function(i) { return i.replacement && i.replacement.fkid; }), ['new00000003', 'new00000004'], 'with their replacements');
    assert.equal(calls.filter(function(c) { return c.indexOf(YT(10)) !== -1; }).length, 0, 'no song after the stop was checked');
  });

  it('skips the looking for replacements too on a second stop, and still lists every dead song it found', async function() {
    statuses[YT(3)] = [404];
    statuses[YT(4)] = [404];
    statuses[YT(5)] = [404];
    var stop = false;
    var cancel = false;
    var result = await core.scan(io, playlist, {
      shouldStop: function() { return stop; },
      shouldCancel: function() { return cancel; },
      onProgress: function(info) {
        if (info.stage === 'checking' && info.done === 8) { stop = true; }
        // the second stop comes after the first replacement has been looked for
        if (info.stage === 'searching' && info.done === 1) { cancel = true; }
      }
    });

    assert.equal(result.stopped, 'you stopped it');
    assert.equal(result.items.length, 3, 'none of the dead songs is lost');
    // the second stop came while the second song was being searched for: that one finished, the third was skipped
    assert.deepEqual(result.items.map(function(i) { return i.replacement ? 'found' : i.none; }), ['found', 'found', 'not searched for']);
  });

  it('does not look for replacements when it was told to slow down, since checking them would only be told the same', async function() {
    songs = [];
    for (var n = 1; n <= 8; n++) { songs.push(entry(n)); }
    statuses[YT(1)] = [404];
    statuses.oembed = [429];
    var result = await core.scan(io, playlist, {});

    assert.match(result.stopped, /slow down/);
    assert.equal(calls.filter(function(c) { return /song\?name/.test(c); }).length, 0);
  });

  it('stops and says so when it is told to slow down again and again, and calls nothing dead for it', async function() {
    statuses.oembed = [429];
    var result = await core.scan(io, playlist, {});
    assert.match(result.stopped, /slow down/);
    assert.deepEqual(result.items, []);
    assert.ok(calls.filter(function(c) { return /oembed/.test(c); }).length <= 6, 'it stopped after a few');
  });

  it('stops a scan when the watch page keeps saying slow down', async function() {
    io.page = async function() { return { status: 429, text: '' }; };
    var result = await core.scan(io, playlist, {});
    assert.match(result.stopped, /slow down/);
    assert.deepEqual(result.items, []);
  });

  it('reports progress, and skips songs with no id or an unknown type', async function() {
    songs[0] = entry(1, { fkid: null });
    songs[1] = entry(2, { type: 'vimeo' });
    var stages = {};
    await core.scan(io, playlist, { onProgress: function(info) { stages[info.stage] = true; } });
    assert.ok(stages.reading && stages.checking);
    assert.equal(calls.filter(function(c) { return c.indexOf(YT(1)) !== -1 || c.indexOf(YT(2)) !== -1; }).length, 0);
  });

  it('only searches for the first 50 dead songs, and lists the rest', async function() {
    songs = [];
    for (var n = 1; n <= 60; n++) { songs.push(entry(n)); statuses[YT(n)] = [404]; }
    var result = await core.scan(io, playlist, { maxPages: 5 });
    assert.equal(result.items.length, 60);
    assert.equal(result.items.filter(function(i) { return i.replacement; }).length, 50);
    assert.match(result.items[59].none, /past the limit of 50/);
  });
});

describe('pictures', function() {
  it('only loads pictures from the sites song pictures come from', function() {
    assert.equal(core.safeImageUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg'), 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
    assert.equal(core.safeImageUrl('https://i1.sndcdn.com/artworks-x.jpg'), 'https://i1.sndcdn.com/artworks-x.jpg');
    ['https://evil.example/x.png', 'http://i.ytimg.com/vi/abc/default.jpg', 'https://i.ytimg.com.evil.example/x.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//i.ytimg.com/x', null, undefined, 5]
      .forEach(function(url) { assert.equal(core.safeImageUrl(url), null, String(url)); });
  });

  it('uses the song\'s own picture, or for a YouTube video the one YouTube makes, and none when there is no way to know', function() {
    assert.equal(core.pictureFor({ type: 'youtube', fkid: 'abcdefghijk', thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' }), 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
    assert.equal(core.pictureFor({ type: 'youtube', fkid: 'abcdefghijk', thumbnail: 'https://evil.example/x.png' }), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    assert.equal(core.pictureFor({ type: 'youtube', fkid: 'abcdefghijk' }), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    assert.equal(core.pictureFor({ type: 'youtube', fkid: 'not valid' }), null);
    assert.equal(core.pictureFor({ type: 'soundcloud', fkid: '123' }), null);
  });

  it('fingerprints a picture by whether each pixel is brighter than the next, so the same picture gives the same bits', function() {
    const ramp = []; for (let i = 0; i < 72; i++) { ramp.push((i % 9) * 10); }
    const hash = core.dHash(ramp);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[01]+$/);

    // brighter all over, or a little noisy, is still the same picture
    const brighter = ramp.map(function(v) { return v + 40; });
    const noisy = ramp.map(function(v, i) { return v + (i % 2 ? 1 : -1); });
    assert.equal(core.hashDistance(hash, core.dHash(brighter)), 0);
    assert.ok(core.hashDistance(hash, core.dHash(noisy)) <= 10);

    // the opposite picture is as different as it gets
    const flipped = ramp.map(function(v) { return 100 - v; });
    assert.equal(core.hashDistance(hash, core.dHash(flipped)), 64, 'a ramp up and a ramp down differ in every bit');
    assert.equal(core.hashDistance(null, hash), null);
    assert.equal(core.hashDistance('01', '011'), null);
  });
});

describe('short titles with no artist', function() {
  const playlist = { id: 'pl1', name: 'Spooky' };
  var imageHashes;

  function roygbivIsDead(extra) {
    songs = [entry(1, { name: 'Roygbiv', fkid: YT(1) })];
    songs[0]._song = Object.assign(songs[0]._song, extra);
    statuses[YT(1)] = [404];
  }

  beforeEach(function() { imageHashes = {}; });

  it('suggests a possible match when most results for that exact title are by one artist, and says so', async function() {
    roygbivIsDead();
    searchItems = function() {
      return [
        { name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1' },
        { name: 'Boards of Canada - Roygbiv (Remastered)', type: 'youtube', fkid: 'bocroygbiv2' },
        { name: 'Boards Of Canada - ROYGBIV', type: 'youtube', fkid: 'bocroygbiv3' },
        { name: 'Someone Else - Roygbiv', type: 'youtube', fkid: 'someoneelse1' }
      ];
    };
    const result = await core.scan(io, playlist, {});
    const found = result.items[0].replacement;

    assert.equal(found.fkid, 'bocroygbiv1');
    assert.equal(found.confidence, 'possible');
    assert.match(found.note, /a short title with no artist, but most results for it are by Boards of Canada/);
    assert.match(core.reportText(result), /POSSIBLE MATCH, check it: a short title with no artist/);
  });

  it('gives nothing when the results for a short title are by many different artists, like Nightfall', async function() {
    songs = [entry(1, { name: 'Nightfall' })];
    statuses[YT(1)] = [404];
    searchItems = function() { return [{ name: 'Artist A - Nightfall', type: 'youtube', fkid: 'nightfall001' }, { name: 'Artist B - Nightfall', type: 'youtube', fkid: 'nightfall002' }, { name: 'Artist C - Nightfall', type: 'youtube', fkid: 'nightfall003' }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)');
  });

  it('does not accept one result alone as agreement, or a result of the wrong length', async function() {
    roygbivIsDead({ songLength: 150000 });
    searchItems = function() { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1', songLength: 156000 }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement, null, 'one result is not enough agreement, and 6 seconds off is not the same length');

    statuses = { [YT(1)]: [404] };
    searchItems = function() { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1', songLength: 900000 }, { name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv2', songLength: 910000 }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement, null, 'a different length is not the same recording');

    statuses = { [YT(1)]: [404] };
    searchItems = function() { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1', songLength: 152000 }, { name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv2', songLength: 905000 }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement.fkid, 'bocroygbiv1', 'the right length, with the other as agreement');
  });

  it('accepts a result with exactly the title and no artist when the length matches to within two seconds', async function() {
    roygbivIsDead({ songLength: 150000 });
    searchItems = function() { return [{ name: 'Roygbiv', type: 'youtube', fkid: 'justtitle01', songLength: 151000 }]; };
    const found = (await core.scan(io, playlist, {})).items[0].replacement;

    assert.equal(found.fkid, 'justtitle01');
    assert.equal(found.confidence, 'possible');
    assert.equal(found.note, 'a short title with no artist, but the length matches to within two seconds');
  });

  it('does not accept the same title with a length that is only near, or a length that is not known', async function() {
    roygbivIsDead({ songLength: 150000 });
    searchItems = function() { return [{ name: 'Roygbiv', type: 'youtube', fkid: 'justtitle01', songLength: 153000 }]; };
    const near = (await core.scan(io, playlist, {})).items[0];
    assert.equal(near.replacement, null);
    assert.match(near.tried[0].verdict, /^the same title, but nothing shows it is the same song/);

    statuses = { [YT(1)]: [404] };
    songs[0]._song.songLength = undefined;
    searchItems = function() { return [{ name: 'Roygbiv', type: 'youtube', fkid: 'justtitle01' }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement, null);
  });

  it('accepts a result with exactly the title and no artist when the picture is the same cover', async function() {
    roygbivIsDead({ images: { thumbnail: 'https://i.ytimg.com/vi/' + YT(1) + '/hqdefault.jpg' } });
    searchItems = function() { return [{ name: 'Roygbiv (Official Audio)', type: 'youtube', fkid: 'justtitle01', images: { thumbnail: 'https://i.ytimg.com/vi/justtitle01/hqdefault.jpg' } }]; };
    io.imageHash = async function(url) { return url.indexOf(YT(1)) !== -1 || url.indexOf('justtitle01') !== -1 ? '1010'.repeat(16) : '0101'.repeat(16); };

    const found = (await core.scan(io, playlist, {})).items[0].replacement;
    assert.equal(found.fkid, 'justtitle01');
    assert.equal(found.picture, 'same');
    assert.equal(found.note, 'a short title with no artist, but the picture is the same cover');
  });

  it('says the picture is different when it is, and gives no match from the title alone', async function() {
    roygbivIsDead();
    searchItems = function() { return [{ name: 'Roygbiv', type: 'youtube', fkid: 'justtitle01' }]; };
    io.imageHash = async function(url) { return url.indexOf(YT(1)) !== -1 ? '1010'.repeat(16) : '0101'.repeat(16); };
    const item = (await core.scan(io, playlist, {})).items[0];
    assert.equal(item.replacement, null);
    assert.equal(item.tried[0].verdict, 'the same title, but nothing shows it is the same song (the picture is different)');
  });

  it('combines the kinds of evidence in the note, and still needs the result to play', async function() {
    roygbivIsDead({ songLength: 150000, images: { thumbnail: 'https://i.ytimg.com/vi/' + YT(1) + '/hqdefault.jpg' } });
    searchItems = function() { return [{ name: 'Roygbiv', type: 'youtube', fkid: 'justtitle01', songLength: 150500, images: { thumbnail: 'https://i.ytimg.com/vi/justtitle01/hqdefault.jpg' } }]; };
    io.imageHash = async function() { return '1010'.repeat(16); };
    const found = (await core.scan(io, playlist, {})).items[0].replacement;
    assert.equal(found.note, 'a short title with no artist, but the length matches to within two seconds and the picture is the same cover');

    statuses = { [YT(1)]: [404], justtitle01: [404] };
    const dead = (await core.scan(io, playlist, {})).items[0];
    assert.equal(dead.replacement, null);
    assert.match(dead.tried[0].verdict, /^looked like the same song \(.*\), but it does not play$/);
  });

  it('says what was searched for and why each result was not taken', async function() {
    songs = [entry(1, { name: 'Lapis' })];
    statuses[YT(1)] = [404];
    searchItems = function() {
      return [
        { name: 'Lapis (Full Album)', type: 'youtube', fkid: 'album0000001' },
        { name: 'Someone - Lapis (Live)', type: 'youtube', fkid: 'live00000001' },
        { name: 'Lapis Lazuli', type: 'youtube', fkid: 'lazuli000001' },
        { name: 'Lapis', type: 'youtube', fkid: YT(1) },
        { name: 'Lapis', type: 'youtube', fkid: 'justtitle01' }
      ];
    };
    const item = (await core.scan(io, playlist, {})).items[0];

    assert.equal(item.searched, 'Lapis');
    assert.equal(item.none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)');
    assert.deepEqual(item.tried.map(function(t) { return t.verdict; }), [
      'a whole album or a long mix',
      'a different version (remix, live, cover...)',
      'the dead song is only a short title with no artist, too little to be sure',
      'this is the dead song itself',
      'the same title, but nothing shows it is the same song (no picture to compare, or the length is not known)'
    ,
      'a whole album or a long mix',
      'a different version (remix, live, cover...)',
      'the dead song is only a short title with no artist, too little to be sure',
      'this is the dead song itself',
      'the same title, but nothing shows it is the same song (no picture to compare, or the length is not known)'
    
]);
  });

  it('says so when the search found nothing at all, or could not be made', async function() {
    songs = [entry(1, { name: 'Lapis' })];
    statuses[YT(1)] = [404];
    searchItems = function() { return []; };
    const empty = (await core.scan(io, playlist, {})).items[0];
    assert.deepEqual([empty.searched, empty.tried], ['Lapis', []]);
    assert.equal(empty.none, 'no result is clearly the same song (looked on both YouTube and SoundCloud)');

    statuses = { [YT(1)]: [404] };
    const plain = io.api;
    io.api = async function(method, path, form) { return /song\?name/.test(path) ? { code: 500, body: null } : plain(method, path, form); };
    const failed = (await core.scan(io, playlist, {})).items[0];
    assert.equal(failed.none, 'the search failed');
    assert.equal(failed.searched, 'Lapis');
  });

  it('does not suggest a result that is dead too', async function() {
    roygbivIsDead();
    statuses.bocroygbiv1 = [404];
    statuses.bocroygbiv2 = [404];
    searchItems = function() { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1' }, { name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv2' }]; };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement, null);
  });

  it('accepts a single result when the picture is the same cover as the dead song\'s, and says so', async function() {
    roygbivIsDead({ images: { thumbnail: 'https://i.ytimg.com/vi/' + YT(1) + '/hqdefault.jpg' } });
    searchItems = function() { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1', images: { thumbnail: 'https://i.ytimg.com/vi/bocroygbiv1/hqdefault.jpg' } }]; };

    io.imageHash = async function(url) { return url.indexOf(YT(1)) !== -1 || url.indexOf('bocroygbiv1') !== -1 ? '1010'.repeat(16) : '0101'.repeat(16); };
    const found = (await core.scan(io, playlist, {})).items[0].replacement;

    assert.equal(found.fkid, 'bocroygbiv1');
    assert.equal(found.confidence, 'possible');
    assert.equal(found.picture, 'same');
    assert.match(found.note, /the picture is the same cover/);
  });

  it('does not accept a single result whose picture is different, or when the dead song\'s picture is gone', async function() {
    roygbivIsDead();
    searchItems = function() { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1' }]; };

    io.imageHash = async function(url) { return url.indexOf(YT(1)) !== -1 ? '1010'.repeat(16) : '0101'.repeat(16); };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement, null, 'different pictures');

    statuses = { [YT(1)]: [404] };
    io.imageHash = async function(url) { return url.indexOf(YT(1)) !== -1 ? null : '0101'.repeat(16); };
    assert.equal((await core.scan(io, playlist, {})).items[0].replacement, null, 'the dead song has lost its picture');
  });

  it('notes the picture on a sure match too, without letting a different picture rule one out', async function() {
    songs = [entry(3)];
    statuses[YT(3)] = [404];
    io.imageHash = async function(url) { return url.indexOf(YT(3)) !== -1 ? '1010'.repeat(16) : '0101'.repeat(16); };
    const found = (await core.scan(io, playlist, {})).items[0].replacement;
    assert.equal(found.confidence, 'sure');
    assert.equal(found.picture, 'different', 're-uploads often have another picture');
  });
});

describe('carrying on an interrupted scan', function() {
  const playlist = { id: 'pl1', name: 'Spooky' };
  var oembedCalls;

  beforeEach(function() {
    songs = [];
    for (var n = 1; n <= 30; n++) { songs.push(entry(n)); }
    [3, 12, 14, 25].forEach(function(n) { statuses[YT(n)] = [404]; });
    // the songs of the playlist that were checked, in order (the replacements that were checked are left out)
    oembedCalls = function() { return calls.filter(function(c) { return /oembed.*yt\d{9}/.test(c); }).map(function(c) { return c.match(/yt\d{9}/)[0]; }); };
  });

  function summary(result) {
    return result.items.map(function(i) { return i.entryId + ':' + (i.replacement ? i.replacement.fkid : i.none); });
  }

  it('gives exactly what an uninterrupted scan gives, when it is stopped and carried on', async function() {
    const whole = await core.scan(io, playlist, {});

    calls = [];
    var stop = false;
    const first = await core.scan(io, playlist, { onProgress: function(info) { if (info.stage === 'checking' && info.done === 13) { stop = true; } }, shouldStop: function() { return stop; } });
    assert.equal(first.stopped, 'you stopped it');
    assert.equal(first.resume.index, 14, 'songs 1 to 14 were checked');
    assert.equal(first.resume.dead.length, 3, 'songs 3, 12 and 14');

    calls = [];
    const second = await core.scan(io, playlist, { resume: first.resume });
    assert.equal(second.stopped, null);
    assert.deepEqual(summary(second), summary(whole));
    assert.deepEqual(oembedCalls().filter(function(id) { return id <= YT(14); }), [], 'the songs already checked were not checked again');
    assert.equal(calls.filter(function(c) { return c.indexOf('name=Artist%203%20') !== -1; }).length, 0, 'and what was already searched for was not searched for again');
  });

  it('can carry on from a checkpoint in the middle of a scan, the way it would after a closed tab', async function() {
    const whole = await core.scan(io, playlist, {});

    const checkpoints = [];
    await core.scan(io, playlist, { onCheckpoint: function(state) { checkpoints.push(JSON.parse(JSON.stringify(state))); } });
    assert.ok(checkpoints.length >= 4, 'every ten songs, and after each replacement looked for');
    assert.deepEqual(checkpoints.map(function(c) { return c.index; }).slice(0, 3), [10, 20, 30]);

    // the tab was closed after the 20th song: carry on from that checkpoint
    const closed = checkpoints[1];
    assert.equal(closed.index, 20);
    calls = [];
    const carried = await core.scan(io, playlist, { resume: closed });
    assert.deepEqual(summary(carried), summary(whole));
    assert.deepEqual(oembedCalls().filter(function(id) { return id <= YT(20); }), [], 'nothing before the 21st song was checked again');

    // and from one taken while the replacements were being looked for
    const searching = checkpoints.filter(function(c) { return c.index === 30 && c.items.length === 2; })[0];
    calls = [];
    const finished = await core.scan(io, playlist, { resume: searching });
    assert.deepEqual(summary(finished), summary(whole));
    assert.equal(oembedCalls().filter(function(id) { return /^yt0000000(0[1-9]|[12]\d|30)$/.test(id) && !/new/.test(id); }).length, 0, 'every song had been checked already');
  });

  it('finds its place again when the playlist has changed since, by the last song that was checked', async function() {
    var stop = false;
    const first = await core.scan(io, playlist, { onProgress: function(info) { if (info.stage === 'checking' && info.done === 13) { stop = true; } }, shouldStop: function() { return stop; } });

    // two songs were added at the front, and one in the middle taken out
    songs = [entry(101), entry(102)].concat(songs.filter(function(e) { return e._id !== 'entry5'; }));
    calls = [];
    await core.scan(io, playlist, { resume: first.resume });
    const ids = oembedCalls();
    assert.ok(ids.indexOf(YT(14)) === -1, 'song 14 was the last one checked, it is not checked again');
    assert.ok(ids.indexOf(YT(15)) !== -1, 'the next one is');
    assert.ok(ids.indexOf(YT(101)) === -1 && ids.indexOf(YT(102)) === -1, 'the new songs at the front are before the place, so they are left');
  });

  it('does not skip a song when the last one checked was taken out: it finds its place by the next one', async function() {
    var stop = false;
    const first = await core.scan(io, playlist, { onProgress: function(info) { if (info.stage === 'checking' && info.done === 13) { stop = true; } }, shouldStop: function() { return stop; } });
    songs = songs.filter(function(e) { return e._id !== 'entry14'; });   // the last song checked was taken out

    calls = [];
    await core.scan(io, playlist, { resume: first.resume });
    const ids = oembedCalls();
    assert.equal(ids[0], YT(15), 'it carries on with song 15, the one after');
    assert.equal(ids.indexOf(YT(3)), -1, 'and does not go back');
  });

  it('finds its place by the last one checked when the next one was taken out, and by the count when both were', async function() {
    var stop = false;
    const first = await core.scan(io, playlist, { onProgress: function(info) { if (info.stage === 'checking' && info.done === 13) { stop = true; } }, shouldStop: function() { return stop; } });

    songs = songs.filter(function(e) { return e._id !== 'entry15'; });   // the next song to check was taken out
    calls = [];
    await core.scan(io, playlist, { resume: first.resume });
    assert.equal(oembedCalls()[0], YT(16), 'after the last one checked');

    songs = [entry(1), entry(2)].concat(songs.filter(function(e) { return e._id !== 'entry14' && e._id !== 'entry16'; }));   // both gone, and two added in front
    calls = [];
    await core.scan(io, playlist, { resume: first.resume });
    assert.equal(oembedCalls().length > 0, true, 'it still carries on, from about where it was');
  });

  it('keeps what a scan stopped by being told to slow down had found, to carry on later', async function() {
    songs = [];
    for (var n = 1; n <= 12; n++) { songs.push(entry(n)); }
    statuses[YT(2)] = [404];
    const slow = io.status;
    io.status = async function(url) { return /yt00000000[89]|yt00000001\d/.test(url) ? 429 : slow(url); };

    const first = await core.scan(io, playlist, {});
    assert.match(first.stopped, /slow down/);
    assert.equal(first.resume.dead.length, 2, 'songs 2 and 3');
    assert.equal(first.resume.index, 7, 'the songs it was told to slow down on were not really checked, it carries on at the first of them (song 8)');

    io.status = slow;
    const later = await core.scan(io, playlist, { resume: first.resume });
    assert.equal(later.stopped, null);
    assert.equal(later.items.length, 3, 'songs 2, 3 and 12');
    assert.ok(later.items.every(function(i) { return i.replacement; }), 'and the replacements that had not been looked for are now');
  });

  it('carries on scanning every playlist: the finished ones are kept, the stopped one carries on, the rest are scanned', async function() {
    const lists = { pl1: [entry(1), entry(2), entry(3)], pl2: [entry(4), entry(5), entry(6), entry(7), entry(8)], pl3: [entry(9), entry(10)] };
    const plain = io.api;
    io.api = async function(method, path, form) {
      const m = /^playlist\/(\w+)\/songs\?page=(\d+)$/.exec(path);
      if (m) { calls.push(method + ' ' + path); return { code: 200, body: { data: m[2] === '1' ? lists[m[1]] : [] } }; }
      return plain(method, path, form);
    };
    statuses[YT(2)] = [404];
    statuses[YT(6)] = [404];
    statuses[YT(9)] = [404];
    const all = [{ id: 'pl1', name: 'One', totalItems: 3 }, { id: 'pl2', name: 'Two', totalItems: 5 }, { id: 'pl3', name: 'Three', totalItems: 2 }];

    const whole = await core.scanAll(io, all, {});
    assert.equal(whole.resume, null, 'a scan that finished has nothing to carry on');

    // stopped while the second playlist was being checked
    var stop = false;
    const first = await core.scanAll(io, all, { onProgress: function(info) { if (info.stage === 'checking' && info.done === 3) { stop = true; } }, shouldStop: function() { return stop; } });
    assert.equal(first.stopped, 'you stopped it');
    assert.deepEqual(first.resume.finished.map(function(r) { return r.playlist.id; }), ['pl1']);
    assert.equal(first.resume.current.playlistId, 'pl2');

    calls = [];
    const second = await core.scanAll(io, all, { resume: first.resume });
    assert.equal(second.stopped, null);
    assert.deepEqual(second.results.map(function(r) { return r.playlist.id + ':' + r.scan.items.map(function(i) { return i.entryId; }).join(); }), whole.results.map(function(r) { return r.playlist.id + ':' + r.scan.items.map(function(i) { return i.entryId; }).join(); }));
    assert.equal(calls.filter(function(c) { return /playlist\/pl1\//.test(c); }).length, 0, 'the finished playlist was not read again');
    assert.equal(second.resume, null);
  });

  it('says where to carry on from when it was stopped between playlists, before the next was started', async function() {
    const all = [{ id: 'pl1', name: 'One', totalItems: 3 }, { id: 'pl2', name: 'Two', totalItems: 2 }];
    var stop = false;
    const first = await core.scanAll(io, all, { onPlaylist: function(info) { if (info.index === 1) { stop = true; } }, shouldStop: function() { return stop; } });
    assert.equal(first.stopped, 'you stopped it');
    assert.ok(first.resume, 'there is something to carry on');
  });
});

describe('the saved scan', function() {
  const NOW = Date.UTC(2026, 9, 15, 12);
  const MIN = 60 * 1000;
  var store;

  function makeStore() {
    const memory = {};
    return { get: function(key, fallback) { return Object.prototype.hasOwnProperty.call(memory, key) && memory[key] !== null ? JSON.parse(JSON.stringify(memory[key])) : fallback; }, set: function(key, value) { memory[key] = JSON.parse(JSON.stringify(value)); }, memory: memory };
  }

  function sample(overrides) {
    return Object.assign({
      multi: true, fromPage: 1, maxPages: 50,
      playlists: [{ id: 'pl1', name: 'One', totalItems: 3 }, { id: 'pl2', name: 'Two', totalItems: 5 }],
      resume: { finished: [{ playlist: { id: 'pl1', name: 'One' }, scan: { scanned: 3, items: [] } }], current: { playlistId: 'pl2', state: { index: 4, lastEntryId: 'e4', dead: [{ song: { entryId: 'e2' }, text: 'x' }], items: [] } } }
    }, overrides);
  }

  beforeEach(function() { store = makeStore(); });

  it('saves a scan, loads it back, and clears it', function() {
    core.saveCheckpoint(store, sample(), NOW);
    const loaded = core.loadCheckpoint(store, NOW + 5 * MIN);
    assert.equal(loaded.resume.current.playlistId, 'pl2');
    assert.equal(loaded.maxPages, 50);

    core.clearCheckpoint(store);
    assert.equal(core.loadCheckpoint(store, NOW), null);
    assert.equal(core.loadCheckpoint(makeStore(), NOW), null, 'nothing saved');
  });

  it('forgets a scan after a week', function() {
    core.saveCheckpoint(store, sample(), NOW);
    assert.ok(core.loadCheckpoint(store, NOW + 6 * 24 * 60 * MIN));
    assert.equal(core.loadCheckpoint(store, NOW + 8 * 24 * 60 * MIN), null);
  });

  it('only takes what is shaped as it was saved, since what comes out of storage is never trusted', function() {
    const bad = function(change) { const saved = JSON.parse(JSON.stringify(Object.assign({ v: 1, savedAt: NOW }, sample()))); change(saved); store.set('checkpoint', saved); return core.loadCheckpoint(store, NOW + MIN); };

    assert.ok(bad(function() {}), 'the untouched one is fine');
    assert.equal(bad(function(c) { c.v = 2; }), null);
    assert.equal(bad(function(c) { c.savedAt = 'yesterday'; }), null);
    assert.equal(bad(function(c) { c.savedAt = NOW + 24 * 60 * MIN; }), null, 'from the future');
    assert.equal(bad(function(c) { c.playlists = []; }), null);
    assert.equal(bad(function(c) { c.playlists[0].id = '../evil'; }), null, 'an id goes into an address');
    assert.equal(bad(function(c) { c.playlists[0].name = 5; }), null);
    assert.equal(bad(function(c) { c.fromPage = 0; }), null);
    assert.equal(bad(function(c) { c.resume = null; }), null);
    assert.equal(bad(function(c) { c.resume.finished = 'nope'; }), null);
    assert.equal(bad(function(c) { c.resume.finished[0].playlist.id = 'a b'; }), null);
    assert.equal(bad(function(c) { c.resume.current.playlistId = '/x'; }), null);
    assert.equal(bad(function(c) { c.resume.current.state.index = -1; }), null);
    assert.equal(bad(function(c) { c.resume.current.state.dead = {}; }), null);

    store.set('checkpoint', 'garbage');
    assert.equal(core.loadCheckpoint(store, NOW), null);
    store.set('checkpoint', 5);
    assert.equal(core.loadCheckpoint(store, NOW), null);
  });

  it('puts the saved scan into words', function() {
    core.saveCheckpoint(store, sample(), NOW);
    const saved = core.loadCheckpoint(store, NOW + 3 * MIN);
    assert.equal(core.describeCheckpoint(saved, NOW + 3 * MIN), 'An earlier scan was interrupted (playlist 2 of 2, "Two", 4 songs checked, 1 dead so far, 3 minutes ago).');
    assert.match(core.describeCheckpoint(saved, NOW + 2 * 60 * MIN), /2 hours ago\)/);
    assert.match(core.describeCheckpoint(saved, NOW + 3 * 24 * 60 * MIN), /3 days ago\)/);
    assert.match(core.describeCheckpoint(saved, NOW), /just now\)/);

    const one = sample();
    one.resume.current.state.index = 1;
    core.saveCheckpoint(store, one, NOW);
    assert.match(core.describeCheckpoint(core.loadCheckpoint(store, NOW), NOW), /"Two", 1 song checked, 1 dead so far/);

    const between = sample({ multi: true });
    between.resume.current = null;
    core.saveCheckpoint(store, between, NOW);
    assert.match(core.describeCheckpoint(core.loadCheckpoint(store, NOW), NOW), /\(1 of 2 playlists done, just now\)/);
  });
});

describe('the reminder', function() {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 9, 15, 12);
  var store;

  function makeStore() {
    const memory = {};
    return { get: function(key, fallback) { return Object.prototype.hasOwnProperty.call(memory, key) ? JSON.parse(JSON.stringify(memory[key])) : fallback; }, set: function(key, value) { memory[key] = JSON.parse(JSON.stringify(value)); }, memory: memory };
  }

  const lists = [{ id: 'a', name: 'Favorites', totalItems: 554 }, { id: 'b', name: 'Old', totalItems: 20 }, { id: 'c', name: 'Empty', totalItems: 0 }];

  beforeEach(function() { store = makeStore(); });

  it('shows the reminder on first use, before the playlists have ever been listed', function() {
    const status = core.reminderStatus(store, NOW);
    assert.equal(status.known, false);
    assert.equal(status.show, true);
    assert.equal(core.describeReminder(status, NOW).last, 'You have not scanned a playlist all the way through yet.');
  });

  it('is due for a playlist never scanned or not scanned for over 30 days, and not for an empty one', function() {
    core.rememberPlaylists(store, lists);
    core.recordScan(store, { id: 'b' }, NOW - 31 * DAY);
    const status = core.reminderStatus(store, NOW);

    assert.equal(status.show, true);
    assert.deepEqual(status.due.map(function(d) { return d.playlist.name + ':' + d.days; }), ['Favorites:null', 'Old:31']);
    const words = core.describeReminder(status, NOW);
    assert.equal(words.due, 'Not scanned for over a month: Favorites (never), Old (31 days)');
    assert.equal(words.last, 'Last scan: 2026-09-14 (31 days ago)');
  });

  it('is not due when every playlist was scanned in the last 30 days, each one counted on its own', function() {
    core.rememberPlaylists(store, lists);
    core.recordScan(store, { id: 'a' }, NOW - 2 * DAY);
    core.recordScan(store, { id: 'b' }, NOW - 30 * DAY);
    assert.equal(core.reminderStatus(store, NOW).show, false, 'exactly 30 days is not over a month');

    core.recordScan(store, { id: 'b' }, NOW - 30 * DAY - 1000);
    const status = core.reminderStatus(store, NOW);
    assert.equal(status.show, true);
    assert.deepEqual(status.due.map(function(d) { return d.playlist.name; }), ['Old'], 'only the one that is overdue');
  });

  it('puts it into words: today, yesterday, days ago', function() {
    core.rememberPlaylists(store, lists);
    core.recordScan(store, { id: 'a' }, NOW);
    core.recordScan(store, { id: 'b' }, NOW);
    assert.equal(core.describeReminder(core.reminderStatus(store, NOW), NOW).last, 'Last scan: 2026-10-15 (today)');
    assert.equal(core.describeReminder(core.reminderStatus(store, NOW + DAY), NOW + DAY).last, 'Last scan: 2026-10-15 (yesterday)');
    assert.equal(core.describeReminder(core.reminderStatus(store, NOW + 5 * DAY), NOW + 5 * DAY).last, 'Last scan: 2026-10-15 (5 days ago)');
  });

  it('can be snoozed for a week, and comes back after it', function() {
    core.rememberPlaylists(store, lists);
    core.snoozeReminder(store, NOW);
    const snoozed = core.reminderStatus(store, NOW + 6 * DAY);
    assert.equal(snoozed.show, false);
    assert.equal(snoozed.snoozedUntil, NOW + 7 * DAY);
    assert.equal(snoozed.due.length, 2, 'it still knows what is overdue');
    assert.equal(core.reminderStatus(store, NOW + 8 * DAY).show, true);
  });

  it('can be turned off, and back on, which also ends a snooze', function() {
    core.rememberPlaylists(store, lists);
    core.setReminderOff(store, true);
    assert.equal(core.reminderStatus(store, NOW).show, false);
    assert.equal(core.reminderStatus(store, NOW).off, true);

    core.snoozeReminder(store, NOW);
    core.setReminderOff(store, false);
    assert.equal(core.reminderStatus(store, NOW).show, true);
  });

  it('ignores the dates of playlists that are gone, and keeps only dates and names', function() {
    core.rememberPlaylists(store, [{ id: 'a', name: 'Favorites', totalItems: 5, other: 'ignored' }]);
    core.recordScan(store, { id: 'deleted-playlist' }, NOW);
    core.recordScan(store, { id: 'a' }, NOW - 40 * DAY);

    assert.deepEqual(core.reminderStatus(store, NOW).due.map(function(d) { return d.playlist.id; }), ['a']);
    assert.deepEqual(store.memory.playlists, [{ id: 'a', name: 'Favorites', totalItems: 5 }]);
    assert.deepEqual(Object.keys(store.memory).sort(), ['lastScans', 'playlists']);
  });
});

describe('length differences', function() {
  it('says how much longer or shorter, and how much to worry', function() {
    assert.deepEqual(core.lengthDifference({ length: 240000 }, { length: 241000 }), { seconds: 1, level: 'same' });
    assert.deepEqual(core.lengthDifference({ length: 240000 }, { length: 246000 }), { seconds: 6, level: 'close' });
    assert.deepEqual(core.lengthDifference({ length: 240000 }, { length: 232000 }), { seconds: -8, level: 'close' });
    assert.deepEqual(core.lengthDifference({ length: 240000 }, { length: 255000 }), { seconds: 15, level: 'far' }, 'more than 10 seconds and 5%');
    assert.equal(core.lengthDifference({ length: 240000 }, { length: 252000 }).level, 'close', '12 seconds is exactly 5% of four minutes, not more');
    assert.equal(core.lengthDifference({ length: 3600000 }, { length: 3630000 }).level, 'close', '30 seconds of an hour is under 5%');
    assert.equal(core.lengthDifference({ length: 3600000 }, { length: 3800000 }).level, 'far');
    assert.equal(core.lengthDifference({ length: null }, { length: 240000 }), null);
    assert.equal(core.lengthDifference({ length: 240000 }, {}), null);
  });

  it('writes the difference, and puts it in the length comparison when it is more than a few seconds', function() {
    assert.equal(core.formatDifference(10), '+10 s');
    assert.equal(core.formatDifference(-8), '-8 s');
    assert.equal(core.formatDifference(65), '+1:05');
    assert.equal(core.formatDifference(-130), '-2:10');

    assert.equal(core.compareLengths({ length: 240000 }, { length: 241000 }), '4:00 vs 4:01');
    assert.equal(core.compareLengths({ length: 240000 }, { length: 250000 }), '4:00 vs 4:10 (+10 s)');
    assert.equal(core.compareLengths({ length: 240000 }, { length: 232000 }), '4:00 vs 3:52 (-8 s)');
  });
});

describe('scanAll', function() {
  var byPlaylist;

  beforeEach(function() {
    byPlaylist = { pl1: [entry(1), entry(2), entry(3)], pl2: [entry(4), entry(5)] };
    var plain = io.api;
    io.api = async function(method, path, form) {
      var m = /^playlist\/(\w+)\/songs\?page=(\d+)$/.exec(path);
      if (m) {
        calls.push(method + ' ' + path);
        if (m[1] === 'broken') { return { code: 500, body: null }; }
        return { code: 200, body: { data: m[2] === '1' ? (byPlaylist[m[1]] || []) : [] } };
      }
      return plain(method, path, form);
    };
  });

  const playlists = [{ id: 'pl1', name: 'One', totalItems: 3 }, { id: 'pl2', name: 'Two', totalItems: 2 }];

  it('scans each playlist in turn and keeps the results apart', async function() {
    statuses[YT(2)] = [404];
    statuses[YT(5)] = [403];
    var order = [];
    var all = await core.scanAll(io, playlists, { onPlaylist: function(info) { order.push(info.index + ':' + info.playlist.name); } });

    assert.deepEqual(order, ['0:One', '1:Two']);
    assert.deepEqual(all.results.map(function(r) { return r.playlist.name + ' ' + r.scan.scanned + ' ' + r.scan.items.length; }), ['One 3 1', 'Two 2 1']);
    assert.equal(all.stopped, null);
    assert.equal(calls.filter(function(c) { return /^(POST|DELETE)/.test(c); }).length, 0, 'changes nothing');
  });

  it('skips an empty playlist, and records one it can not read while carrying on with the rest', async function() {
    var all = await core.scanAll(io, [{ id: 'pl1', name: 'One', totalItems: 3 }, { id: 'empty', name: 'Empty', totalItems: 0 }, { id: 'broken', name: 'Broken', totalItems: 9 }, { id: 'pl2', name: 'Two', totalItems: 2 }], {});

    assert.deepEqual(all.results.map(function(r) { return r.playlist.name; }), ['One', 'Broken', 'Two']);
    assert.match(all.results[1].scan.error, /couldn't read page 1/);
    assert.equal(all.results[2].scan.scanned, 2, 'the one after the broken one was still scanned');
  });

  it('stops when asked, keeping what was found, and does not start the next playlist', async function() {
    var stop = false;
    var all = await core.scanAll(io, playlists, { onPlaylist: function(info) { if (info.index === 1) { stop = true; } }, shouldStop: function() { return stop; } });
    assert.equal(all.results.length, 2, 'the second had started, and stopped straight away');
    assert.equal(all.results[1].scan.stopped, 'you stopped it');
    assert.equal(all.stopped, 'you stopped it');

    stop = false;
    var first = await core.scanAll(io, playlists, { shouldStop: function() { stop = true; return false; }, onProgress: function() {} });
    assert.equal(first.results.length, 2);
  });

  it('stops everything when it is told to slow down, since the rest would only be told the same', async function() {
    byPlaylist.pl1 = [entry(1), entry(2), entry(3), entry(4), entry(5), entry(6)];
    statuses.oembed = [429];
    var all = await core.scanAll(io, playlists, {});
    assert.equal(all.results.length, 1);
    assert.match(all.stopped, /slow down/);
  });

  it('writes the report of every playlist, and the ones that could not be read', async function() {
    statuses[YT(2)] = [404];
    var all = await core.scanAll(io, [{ id: 'pl1', name: 'One', totalItems: 3 }, { id: 'broken', name: 'Broken', totalItems: 9 }], {});
    var text = core.reportTextAll(all);

    assert.match(text, /^Dead songs in "One" \(checked 3 songs\):\n1\) "Artist 2 - Title 2"/);
    assert.match(text, /\n\nDead songs in "Broken": couldn't read page 1/);
    assert.equal(core.reportTextAll({ results: [] }), 'No playlists were checked.');
  });
});

describe('apply', function() {
  const playlist = { id: 'pl1', name: 'Spooky' };
  var items;

  beforeEach(async function() {
    statuses[YT(3)] = [404];
    statuses[YT(10)] = [404];
    items = (await core.scan(io, playlist, {})).items;
    calls = [];
  });

  it('adds each replacement first, and takes the dead song out only after, in that order', async function() {
    var done = await core.apply(io, playlist, items, {});

    assert.deepEqual(calls, [
      'POST playlist/pl1/songs {"fkid":"new00000003","type":"youtube"}', 'DELETE playlist/pl1/songs/entry3',
      'POST playlist/pl1/songs {"fkid":"new00000010","type":"youtube"}', 'DELETE playlist/pl1/songs/entry10'
    ]);
    assert.deepEqual(done.results.map(function(r) { return r.status; }), ['replaced', 'replaced']);
    assert.equal(done.totalItems, 33);
  });

  it('does not take a dead song out when its replacement could not be added', async function() {
    addCode = 400;
    var done = await core.apply(io, playlist, items, {});
    assert.equal(calls.filter(function(c) { return /^DELETE/.test(c); }).length, 0);
    assert.equal(done.results[0].status, 'add-failed');
    assert.match(done.results[0].detail, /left as it was/);
  });

  it('says QueUp\'s own words when it refuses, so a failure is never a mystery', async function() {
    var refuse = io.api;
    io.api = async function(method, path, form) {
      if (method === 'POST') { return { code: 400, body: { code: 400, message: 'Bad Request', data: { details: { message: 'Song is already in the playlist' } } } }; }
      return refuse(method, path, form);
    };
    var done = await core.apply(io, playlist, items, {});
    assert.equal(done.results[0].detail, "couldn't add the replacement (QueUp answered 400: Song is already in the playlist), left as it was");

    assert.equal(core.answerText({ code: 403, body: { message: 'Forbidden' } }), ': Forbidden');
    assert.equal(core.answerText({ code: 200, body: { message: 'OK' } }), '');
    assert.equal(core.answerText({ code: 500, body: null }), '');
    assert.equal(core.answerText({ code: 400, body: { data: 'x'.repeat(500) } }).length, 122, 'cut short');
  });

  it('says what happened to every song that was applied, including the ones that worked', async function() {
    var done = await core.apply(io, playlist, items, {});
    assert.equal(done.results[0].detail, 'added "Artist 3 - Title 3 [Label]" and took the dead song out');
  });

  it('says when the replacement was added but the dead song could not be taken out', async function() {
    removeCodes.entry3 = 403;
    var done = await core.apply(io, playlist, items, {});
    assert.equal(done.results[0].status, 'remove-failed');
    assert.match(done.results[0].detail, /added the replacement, but couldn't take the dead song out \(QueUp answered 403\)/);
    assert.equal(done.results[1].status, 'replaced');
  });

  it('leaves dead songs without a replacement alone, unless asked to take them out', async function() {
    items[1] = Object.assign({}, items[1], { replacement: null, none: 'no result is clearly the same song' });

    calls = [];
    var plain = await core.apply(io, playlist, items, {});
    assert.deepEqual(plain.results.map(function(r) { return r.status; }), ['replaced']);
    assert.equal(calls.filter(function(c) { return c === 'DELETE playlist/pl1/songs/entry10'; }).length, 0);

    calls = [];
    var removing = await core.apply(io, playlist, items, { removeWithoutReplacement: true });
    assert.deepEqual(removing.results.map(function(r) { return r.status; }), ['replaced', 'removed']);
    assert.ok(calls.indexOf('DELETE playlist/pl1/songs/entry10') !== -1);
    assert.equal(calls.filter(function(c) { return /^POST/.test(c); }).length, 1, 'nothing is added for it');
  });

  it('only does the ones it is given, and stops when asked', async function() {
    var stop = false;
    var done = await core.apply(io, playlist, items, { onProgress: function(info) { if (info.done === 0) { stop = true; } }, shouldStop: function() { return stop; } });
    assert.equal(done.results.length, 1);

    calls = [];
    await core.apply(io, playlist, [], {});
    assert.deepEqual(calls, []);
  });
});

describe('lengths in the report', function() {
  it('writes a length as minutes and seconds, or hours', function() {
    assert.equal(core.formatLength(372000), '6:12');
    assert.equal(core.formatLength(65000), '1:05');
    assert.equal(core.formatLength(3723000), '1:02:03');
    assert.equal(core.formatLength(null), '');
    assert.equal(core.formatLength(0), '');
  });

  it('compares the dead song\'s length with the replacement\'s, and says when it can\'t', function() {
    assert.equal(core.compareLengths({ length: 372000 }, { length: 369000 }), '6:12 vs 6:09');
    assert.equal(core.compareLengths({ length: null }, { length: 369000 }), "6:09 (the dead song's length is not known)");
    assert.equal(core.compareLengths({ length: 372000 }, { length: null }), 'length not available');
  });

  it('keeps the replacement\'s length so the report can show it', async function() {
    songs[2] = entry(3, { songLength: 270000 });
    statuses[YT(3)] = [404];
    searchItems = function(name) { return [{ name: name + ' [Label]', type: 'youtube', fkid: 'rightvideo01', songLength: 272000 }]; };
    var result = await core.scan(io, { id: 'pl1', name: 'Spooky' }, {});
    assert.equal(result.items[0].replacement.length, 272000);
    assert.match(core.reportText(result), /\[4:30 vs 4:32\]/);
  });
});

describe('reportText', function() {
  it('writes the report as plain text, with YouTube links for what could replace each', async function() {
    statuses[YT(3)] = [404];
    songs[9] = entry(10, { name: 'Failed to refresh song details.' });
    statuses[YT(10)] = [404];
    var text = core.reportText(await core.scan(io, { id: 'pl1', name: 'Spooky' }, {}));

    assert.match(text, /^Dead songs in "Spooky" \(checked 27 songs\):\n1\) "Artist 3 - Title 3" \(this YouTube video does not exist anymore\) -> "Artist 3 - Title 3 \[Label\]" https:\/\/www\.youtube\.com\/watch\?v=new00000003 \[length not available\]\n2\) an unnamed song \(yt000000010\) \(.*\) -> no replacement \(no name to search for\)$/);
    assert.match(core.reportText({ playlist: { name: 'P' }, scanned: 5, items: [] }), /none found$/);
  });
});

describe('the saved report of a finished scan', function() {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 9, 15, 12);
  var store;

  function makeStore() {
    const memory = {};
    return { get: function(key, fallback) { return Object.prototype.hasOwnProperty.call(memory, key) ? JSON.parse(JSON.stringify(memory[key])) : fallback; }, set: function(key, value) { memory[key] = JSON.parse(JSON.stringify(value)); }, memory: memory };
  }

  function song(n) { return { entryId: 'e' + n, fkid: 'yt00000000' + n, type: 'youtube', name: 'Artist ' + n + ' - Title ' + n }; }
  function found() {
    return {
      multi: true, stopped: null,
      scans: [
        { playlist: { id: 'a', name: 'First', totalItems: 9 }, scan: { scanned: 9, finished: true, nextPage: 2, stopped: null, resume: { big: 'thing' }, items: [
          { entryId: 'e1', song: song(1), text: 'gone', replacement: { name: 'Artist 1 - Title 1', fkid: 'new00000001', confidence: 'sure' } },
          { entryId: 'e2', song: song(2), text: 'gone', replacement: null, none: 'nothing found', searched: 'Title 2', tried: [] }] } },
        { playlist: { id: 'b', name: 'Second', totalItems: 4 }, scan: { error: 'could not read it' } },
        { playlist: { id: 'c', name: 'Third', totalItems: 4 }, scan: { scanned: 4, finished: true, nextPage: 2, stopped: null, items: [{ entryId: 'e3', song: song(3), text: 'private', replacement: null, none: 'x' }] } }
      ]
    };
  }

  beforeEach(function() { store = makeStore(); });

  it('keeps what a scan found, leaves out where to carry on from and playlists that could not be read, and describes it', function() {
    core.saveReport(store, found(), 'Checked 2 of 3 playlists.', NOW);
    const saved = core.loadReport(store, NOW + 2 * 60 * 60 * 1000);
    assert.equal(saved.entries.length, 2);
    assert.equal(saved.entries[0].scan.resume, undefined);
    assert.equal(saved.summary, 'Checked 2 of 3 playlists.');
    assert.equal(core.describeReport(saved, NOW + 2 * 60 * 60 * 1000), 'A finished scan from 2 hours ago is saved: 3 dead songs, 1 with a replacement.');
  });

  it('keeps nothing, and forgets the old one, when a scan found nothing', function() {
    core.saveReport(store, found(), 's', NOW);
    core.saveReport(store, { multi: false, stopped: null, scans: [{ playlist: { id: 'a', name: 'First' }, scan: { scanned: 5, finished: true, items: [] } }] }, 's', NOW);
    assert.equal(core.loadReport(store, NOW), null);
  });

  it('forgets a report after a week, and never trusts what is in storage', function() {
    core.saveReport(store, found(), 's', NOW);
    assert.ok(core.loadReport(store, NOW + 6 * DAY));
    assert.equal(core.loadReport(store, NOW + 8 * DAY), null);
    assert.equal(core.loadReport(store, NOW - 5 * 60 * 1000), null, 'saved in the future');

    const bad = [null, 'text', { v: 2 }, { v: 1, savedAt: NOW, summary: 's', entries: [] }, { v: 1, savedAt: NOW, summary: 's', entries: [{ playlist: { id: 'a b', name: 'x' }, scan: { items: [] } }] },
      { v: 1, savedAt: NOW, summary: 's', entries: [{ playlist: { id: 'a', name: 'x' }, scan: { items: [{ song: { fkid: 5 }, text: 't' }] } }] }];
    bad.forEach(function(value, i) {
      store.set('report', value);
      assert.equal(core.loadReport(store, NOW), null, 'case ' + i);
    });
  });

  it('drops the songs that were changed and keeps the rest, without making the report any younger', function() {
    core.saveReport(store, found(), 's', NOW);
    core.dropFromReport(store, [{ playlistId: 'a', entryId: 'e1' }], NOW + DAY);
    const saved = core.loadReport(store, NOW + DAY);
    assert.deepEqual(saved.entries[0].scan.items.map(function(i) { return i.entryId; }), ['e2']);
    assert.equal(saved.savedAt, NOW);

    core.dropFromReport(store, [{ playlistId: 'a', entryId: 'e2' }, { playlistId: 'c', entryId: 'e3' }], NOW + DAY);
    assert.equal(core.loadReport(store, NOW + DAY), null, 'nothing left to do');
  });
});
