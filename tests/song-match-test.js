'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const songMatch = require('../lib/songMatch.js');
const queupParse = require('../lib/queupParse.js');

describe('songMatch (shared by the bot and the userscript)', function() {
  it('compares titles by the words that say which song it is', function() {
    assert.deepEqual(songMatch.titleWords('Kryptic Minds - Rule Of Language [OSMUK 023] (Official Video)'), ['kryptic', 'minds', 'rule', 'language']);
    assert.equal(songMatch.similarity('Kryptic Minds - Rule Of Language', 'Kryptic Minds - Rule of Language [OSMUK 023]'), 1);
    assert.equal(songMatch.similarity('', 'x'), 0);
  });

  it('counts a word once however often it is repeated', function() {
    assert.equal(songMatch.similarity('Go Go Go', 'Go'), 1);
  });

  it('tells a different version from the same song', function() {
    assert.equal(songMatch.isSameSong('Nico Lahs - The Free Life', 'Nico Lahs - The Free Life (Live)'), false);
    assert.equal(songMatch.isSameSong('Otik - Lightyear Dub', 'Otik - Lightyear (Dub Mix)'), true);
    assert.equal(songMatch.isSameSong('Sigur Rós - Hoppípolla', 'Sigur Ros - Hoppipolla'), true);
  });

  it('accepts a name a person typed when every word is in the result', function() {
    assert.equal(songMatch.containsAll('rule of language kryptic minds', 'Kryptic Minds - Rule Of Language'), true);
    assert.equal(songMatch.containsAll('kryptic minds rule of language', 'Kryptic Minds - Studio Mix'), false);
    assert.equal(songMatch.containsAll('', 'anything'), false);
  });
});

describe('matching songs more strictly', function() {
  const same = songMatch.isSameSong;

  it('needs more than a one or two word title to be sure, since any song could have that name', function() {
    assert.equal(same('Nightfall', 'Nightfall (Official Video)'), false);
    assert.equal(same('Dreams', 'Dreams'), false);
    assert.equal(same('Rule Of Language', 'Rule of Language'), false, 'two words and no artist');
    assert.equal(same('Rule Of Language Original', 'Rule of Language Original'), true, 'three words is enough');
    assert.equal(same('Artist - Dreams', 'Artist - Dreams (Official Audio)'), true, 'with the artist it is clear');
  });

  it('wants every word of the dead song in the result, and not much else', function() {
    assert.equal(same('Kryptic Minds - Rule Of Language', 'Kryptic Minds - Rule Of'), false);
    assert.equal(same('Kryptic Minds - Rule Of Language', 'Kryptic Minds - Rule Of Language extra words that are not part of it at all'), false);
    assert.equal(same('Kryptic Minds - Rule Of Language', 'Kryptic Minds - Rule of Language [OSMUK 023] (Official Video)'), true);
  });

  it('never accepts a whole album, a compilation or a long mix, even when the dead song was one too', function() {
    assert.equal(same('Artist - Some Song (Entire Album)', 'Artist - Some Song (Entire Album) [Label]'), false);
    assert.equal(same('Artist - Some Song', 'Artist - Some Song full album'), false);
    assert.equal(same('Artist - Some Song', 'Artist - Some Song (Discography)'), false);
    assert.equal(songMatch.looksLikeAlbumOrMix('Best Of Everything Compilation'), true);
    assert.equal(songMatch.looksLikeAlbumOrMix('Kryptic Minds - Rule Of Language'), false);
  });

  it('compares lengths when both are known: close enough is the same recording, far apart is not', function() {
    const base = 'Kryptic Minds - Rule Of Language';
    assert.equal(same(base, base, { length: 350000, resultLength: 352000 }), true);
    assert.equal(same(base, base, { length: 350000, resultLength: 400000 }), true, 'a few seconds of intro is fine');
    assert.equal(same(base, base, { length: 350000, resultLength: 480000 }), false);
    assert.equal(same(base, base, { length: 350000, resultLength: 3600000 }), false, 'an hour is not a six minute track');
    assert.equal(songMatch.isSameLength(350000, null), null);
    assert.equal(songMatch.isSameLength(0, 5), null);
  });

  it('refuses a very long result when the dead song\'s length is not known', function() {
    const base = 'Kryptic Minds - Rule Of Language';
    assert.equal(same(base, base, { resultLength: 3600000 }), false);
    assert.equal(same(base, base, { resultLength: 400000 }), true);
    assert.equal(same(base, base), true);
  });

  it('splits "Artist - Title" at a dash with spaces around it, and not at a dash inside a word', function() {
    assert.deepEqual(songMatch.splitArtistTitle('Kryptic Minds - Rule Of Language'), { artist: 'Kryptic Minds', title: 'Rule Of Language' });
    assert.deepEqual(songMatch.splitArtistTitle('A \u2013 B'), { artist: 'A', title: 'B' });
    assert.equal(songMatch.splitArtistTitle('Drum-and-bass anthem'), null);
    assert.equal(songMatch.splitArtistTitle('Just a title'), null);
  });
});

describe('short titles with no artist', function() {
  it('knows which names are only a title of one or two words', function() {
    assert.equal(songMatch.isObscureTitle('Roygbiv'), true);
    assert.equal(songMatch.isObscureTitle('Rule Of Language'), true);
    assert.equal(songMatch.isObscureTitle('Rule Of Language Original'), false);
    assert.equal(songMatch.isObscureTitle('Boards of Canada - Roygbiv'), false);
    assert.equal(songMatch.isObscureTitle(''), false);
  });

  it('finds the artist most of the results for that exact title agree on', function() {
    const results = [
      { name: 'Boards of Canada - Roygbiv' },
      { name: 'Boards Of Canada - Roygbiv (Remastered)' },
      { name: 'Boards of Canada - ROYGBIV (Original Mix)' },
      { name: 'Someone Else - Roygbiv' },
      { name: 'Boards of Canada - Roygbiv (Live)' },
      { name: 'Boards of Canada - Roygbiv (Full Album)' },
      { name: 'Roygbiv' },
      { name: 'Boards of Canada - Something Different' }
    ];
    const group = songMatch.obscureTitleMatches('Roygbiv', results);

    assert.equal(group.artist, 'Boards of Canada');
    assert.equal(group.results.length, 3);
    assert.equal(group.total, 4, 'the live one, the album, the one with no artist and the other song do not count');
    assert.equal(group.share, 0.75);
  });

  it('sees that a common title has results from many artists', function() {
    const group = songMatch.obscureTitleMatches('Nightfall', [{ name: 'Artist A - Nightfall' }, { name: 'Artist B - Nightfall' }, { name: 'Artist C - Nightfall' }]);
    assert.ok(group.share < 0.5);
    assert.equal(songMatch.obscureTitleMatches('Roygbiv', [{ name: 'Nothing like it' }]), null);
    assert.equal(songMatch.obscureTitleMatches('Roygbiv', []), null);
  });
});

describe('queupParse (shared by the bot and the userscript)', function() {
  it('reads a list of playlists, leaving out removed ones and ones without an id', function() {
    const body = { data: [
      { _id: 'a1', name: 'Spooky', totalItems: 34, removed: false },
      { _id: 'a2', name: 'Gone', totalItems: 3, removed: true },
      { name: 'no id' },
      null,
      { _id: 'a3' }
    ] };
    assert.deepEqual(queupParse.parsePlaylists(body), [
      { id: 'a1', name: 'Spooky', totalItems: 34 },
      { id: 'a3', name: '(unnamed)', totalItems: null }
    ]);
    assert.equal(queupParse.parsePlaylists({ data: 'nope' }), null);
    assert.equal(queupParse.parsePlaylists(null), null);
  });
});

describe('HTML codes in names', function() {
  it('turns them back into the characters, once, and leaves anything that is not a code alone', function() {
    const d = queupParse.decodeEntities;
    assert.equal(d('Fresh &amp; Low - New Life'), 'Fresh & Low - New Life');
    assert.equal(d('It&#39;s &quot;Alive&quot; &lt;3 &gt;'), 'It\'s "Alive" <3 >');
    assert.equal(d('Caf&#xE9; &#233;'), 'Caf\u00e9 \u00e9');
    assert.equal(d('&amp;amp;'), '&amp;', 'decoded once, not twice');
    assert.equal(d('Tom & Jerry &unknown; &#0; &#99999999;'), 'Tom & Jerry &unknown; &#0; &#99999999;');
    assert.equal(d('No codes here'), 'No codes here');
    assert.equal(d(null), null);
    assert.equal(d(5), 5);
  });

  it('is used on the names of playlist songs and search results, so a name is searched for and shown as it reads', function() {
    const page = queupParse.parseSongs({ data: [{ _id: 'e1', songid: 's1', _song: { _id: 's1', name: 'Fresh &amp; Low - New Life', type: 'soundcloud', fkid: '1' } }] });
    assert.equal(page.songs[0].name, 'Fresh & Low - New Life');

    const found = queupParse.parseSearch({ data: { items: [{ name: 'Fresh &amp; Low - New Life', type: 'youtube', fkid: 'f1' }] } });
    assert.equal(found.results[0].name, 'Fresh & Low - New Life');
  });
});

describe('song pictures from QueUp', function() {
  it('reads the picture link of a song or a search result, and null when there is none', function() {
    assert.equal(queupParse.thumbnailOf({ images: { thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' } }), 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
    assert.equal(queupParse.thumbnailOf({ thumbnail: 'https://i.ytimg.com/vi/abc/default.jpg' }), 'https://i.ytimg.com/vi/abc/default.jpg');
    assert.equal(queupParse.thumbnailOf({ images: {} }), null);
    assert.equal(queupParse.thumbnailOf({ images: { thumbnail: 5 } }), null);
    assert.equal(queupParse.thumbnailOf(null), null);
  });

  it('puts the picture on each song of a playlist page and each search result', function() {
    const page = queupParse.parseSongs({ data: [{ _id: 'e1', songid: 's1', _song: { _id: 's1', name: 'A - B', type: 'youtube', fkid: 'f1', images: { thumbnail: 'https://i.ytimg.com/vi/f1/hqdefault.jpg' } } }] });
    assert.equal(page.songs[0].thumbnail, 'https://i.ytimg.com/vi/f1/hqdefault.jpg');

    const found = queupParse.parseSearch({ data: { items: [{ name: 'A - B', type: 'youtube', fkid: 'f1', images: { thumbnail: 'https://i.ytimg.com/vi/f1/hqdefault.jpg' } }, { name: 'C - D', type: 'youtube', fkid: 'f2' }] } });
    assert.deepEqual(found.results.map(function(r) { return r.thumbnail; }), ['https://i.ytimg.com/vi/f1/hqdefault.jpg', null]);
  });
});

describe('song lengths from QueUp', function() {
  it('reads a length in milliseconds, or an ISO 8601 duration, and null when there is none', function() {
    assert.equal(queupParse.lengthOf({ songLength: 270000 }), 270000);
    assert.equal(queupParse.lengthOf({ duration: 'PT5M30S' }), 330000);
    assert.equal(queupParse.lengthOf({ contentDetails: { duration: 'PT1H2M3S' } }), 3723000);
    assert.equal(queupParse.lengthOf({ duration: 'PT45S' }), 45000);
    assert.equal(queupParse.lengthOf({ duration: 'P0D' }), null);
    assert.equal(queupParse.lengthOf({ songLength: 0 }), null);
    assert.equal(queupParse.lengthOf({ name: 'no length' }), null);
    assert.equal(queupParse.lengthOf(null), null);
  });

  it('puts the length on each song of a playlist page and each search result', function() {
    const songs = queupParse.parseSongs({ data: [{ _id: 'e1', songid: 's1', _song: { _id: 's1', name: 'A - B', type: 'youtube', fkid: 'f1', songLength: 211000 } }] });
    assert.equal(songs.songs[0].length, 211000);

    const found = queupParse.parseSearch({ data: { items: [{ name: 'A - B', type: 'youtube', fkid: 'f1', songLength: 212000 }, { name: 'C - D', type: 'youtube', fkid: 'f2' }] } });
    assert.deepEqual(found.results.map(function(r) { return r.length; }), [212000, null]);
  });
});
