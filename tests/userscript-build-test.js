'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('node:vm');

const builder = require('../tools/build-userscript.js');
const code = fs.readFileSync(builder.OUTPUT, 'utf8');

describe('the userscript file', function() {
  it('is up to date with the files it is built from', function() {
    assert.equal(code, builder.build(), 'run: node tools/build-userscript.js');
  });

  it('has the details a userscript manager needs, and asks for as little as it can', function() {
    const header = code.slice(code.indexOf('// ==UserScript=='), code.indexOf('// ==/UserScript==') + 18);
    const field = function(name) { return header.split('\n').filter(function(line) { return new RegExp('^// @' + name + '\\s').test(line); }).map(function(line) { return line.replace(/^\/\/ @\S+\s+/, '').trim(); }); };

    assert.deepEqual(field('match'), ['https://queup.net/*']);
    assert.deepEqual(field('grant'), ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue'], 'the watch page check, and storing the dates of the last scans');
    assert.ok(code.indexOf("var VERSION = '" + field('version')[0] + "';") !== -1, 'the version in the panel is the version in the header');
    assert.deepEqual(field('connect'), ['www.youtube.com'], 'the one extra site');
    assert.equal(field('name').length, 1);
    assert.match(field('version')[0], /^\d+\.\d+\.\d+$/);
    assert.equal(field('license')[0], 'MIT');
    // what linters and the script sites usually ask for
    ['author', 'homepageURL', 'supportURL', 'description', 'namespace'].forEach(function(name) { assert.equal(field(name).length, 1, '@' + name); });
    assert.ok(header.split('\n').indexOf('// @noframes') !== -1, '@noframes: it only runs in the top window');
  });

  it('only talks to QueUp, YouTube and SoundCloud, and has nothing that runs code it did not ship with', function() {
    const hosts = new Set();
    (code.match(/https?:\/\/[A-Za-z0-9.-]+/g) || []).forEach(function(url) { hosts.add(url.replace(/^https?:\/\//, '')); });
    // links the person can click (a search for a song they chose), which the script never opens itself
    const linked = ['lens.google.com', 'www.google.com'];
    const allowed = linked.concat(['api.queup.net', 'queup.net', 'www.youtube.com', 'i.ytimg.com', 'soundcloud.com', 'api.soundcloud.com', 'w.soundcloud.com', 'github.com']);
    hosts.forEach(function(host) { assert.ok(allowed.indexOf(host) !== -1, 'unexpected host: ' + host); });

    ['eval(', 'new Function', 'document.write', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'XMLHttpRequest', 'importScripts', '<script', 'localStorage', 'sessionStorage', 'document.cookie', 'WebSocket', 'sendBeacon']
      .forEach(function(forbidden) { assert.equal(code.indexOf(forbidden), -1, forbidden + ' is in the userscript'); });
  });

  it('is plain JavaScript that parses', function() {
    assert.doesNotThrow(function() { new vm.Script(code); });
  });
});

// ---- running the real file in a pretend browser against a pretend QueUp ----

const { FakeNode, clock, fakeBrowser, waitFor } = require('./fake-browser.js');

/** the checkbox in the label with these words */
function optionNamed(shadow, words) {
  const label = shadow.find(function(n) { return n.tagName === 'label' && n.textContent.indexOf(words) === 0; })[0];
  return label.find(function(n) { return n.tagName === 'input'; })[0];
}

describe('the userscript, run as a browser would run it', function() {
  const YT = function(n) { return 'yt' + String(n).padStart(9, '0'); };

  function fakeQueUp() {
    const log = [];
    const songs = [];
    for (let n = 1; n <= 5; n++) { songs.push({ _id: 'entry' + n, added: n, songid: 'song' + n, _song: { _id: 'song' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) } }); }
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };

    const fetchImpl = function(url, options) {
      options = options || {};
      const method = options.method || 'GET';
      log.push({ method: method, url: String(url), credentials: options.credentials, body: options.body ? options.body.toString() : undefined });
      url = String(url);

      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(url.indexOf(YT(2)) !== -1 ? 404 : 200, {}); }
      if (url.indexOf('https://soundcloud.com/oembed') === 0) { return json(200, {}); }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'Spooky', totalItems: 5, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: songs }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) { return json(200, { data: { items: [{ name: 'Artist 2 - Title 2 [Label]', type: 'youtube', fkid: 'newvideo002' }], pageInfo: { totalResults: 1 } } }); }
      if (method === 'POST') { return json(200, {}); }
      if (method === 'DELETE') { return json(200, { data: { _id: 'pl1', name: 'Spooky', totalItems: 5 } }); }
      return json(404, null);
    };
    return { fetchImpl: fetchImpl, log: log };
  }

  async function open(confirmAnswer) {
    const queup = fakeQueUp();
    const browser = fakeBrowser(queup.fetchImpl, confirmAnswer);
    vm.runInContext(code, browser.context);

    const host = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0];
    const shadow = host.shadow;
    const byText = function(tag, text) { return shadow.find(function(n) { return n.tagName === tag && n.textContent === text; })[0]; };
    return { queup: queup, browser: browser, host: host, shadow: shadow, byText: byText };
  }

  it('adds one button to the page, once, and nothing else yet', async function() {
    const app = await open(true);
    assert.ok(app.host);
    assert.equal(app.byText('button', 'Dead songs').tagName, 'button');
    assert.equal(app.queup.log.length, 0, 'it asks for nothing until the panel is opened');

    vm.runInContext(code, app.browser.context);
    assert.equal(app.browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; }).length, 1, 'a second load adds nothing');
  });

  it('loads the playlists when the panel is opened, with the person\'s own session', async function() {
    const app = await open(true);
    await app.byText('button', 'Dead songs').click();
    await waitFor(function() { return app.shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });

    assert.equal(app.queup.log[0].url, 'https://api.queup.net/playlist');
    assert.equal(app.queup.log[0].credentials, 'include');
    assert.match(app.shadow.find(function(n) { return n.tagName === 'option'; })[0].textContent, /^Spooky \(5 songs\)$/);
  });

  it('scans, shows the dead song with its replacement, and changes nothing until Apply', async function() {
    const app = await open(true);
    await app.byText('button', 'Dead songs').click();
    await waitFor(function() { return app.shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    app.shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    await app.byText('button', 'Scan').click();

    const status = app.shadow.find(function(n) { return n.className === 'status'; })[0];
    assert.match(status.textContent, /^Checked 5 songs in "Spooky": 1 dead, 1 with a replacement\./);
    const items = app.shadow.find(function(n) { return n.className === 'item'; });
    assert.equal(items.length, 1);
    assert.match(items[0].textContent, /"Artist 2 - Title 2"this YouTube video does not exist anymoreinstead: Artist 2 - Title 2 \[Label\]/);
    const link = items[0].find(function(n) { return n.tagName === 'a'; })[0];
    assert.equal(link.href, 'https://www.youtube.com/watch?v=newvideo002');
    assert.equal(link.rel, 'noopener noreferrer');

    assert.equal(app.queup.log.filter(function(c) { return c.method === 'POST' || c.method === 'DELETE'; }).length, 0, 'nothing was changed');
    assert.ok(app.queup.log.filter(function(c) { return c.url.indexOf('youtube.com/oembed') !== -1; }).every(function(c) { return c.credentials === 'omit'; }), 'no cookies go to YouTube');
  });

  it('adds the replacement and then removes the dead song when Apply is clicked and confirmed, and not if it is refused', async function() {
    for (const answer of [false, true]) {
      const app = await open(answer);
      await app.byText('button', 'Dead songs').click();
      await waitFor(function() { return app.shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
      app.shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
      await app.byText('button', 'Scan').click();
      await app.byText('button', 'Apply selected').click();

      const changes = app.queup.log.filter(function(c) { return c.method === 'POST' || c.method === 'DELETE'; });
      assert.match(app.browser.window.asked, /Swap in 1 replacement in "Spooky"\?/);
      if (!answer) {
        assert.equal(changes.length, 0, 'refused, nothing changed');
      } else {
        assert.deepEqual(changes.map(function(c) { return c.method + ' ' + c.url; }), ['POST https://api.queup.net/playlist/pl1/songs', 'DELETE https://api.queup.net/playlist/pl1/songs/entry2']);
        assert.equal(changes[0].body, 'fkid=newvideo002&type=youtube');
        assert.match(app.shadow.find(function(n) { return n.className === 'status'; })[0].textContent, /^Done: 1 of 1 changed in "Spooky"/);
      }
    }
  });

  it('saves a backup file before Apply changes anything, offers to undo it, and puts the song back', async function() {
    const app = await open(true);
    await app.byText('button', 'Dead songs').click();
    await waitFor(function() { return app.shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    app.shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    await app.byText('button', 'Scan').click();
    await app.byText('button', 'Apply selected').click();

    assert.equal(app.browser.window.downloads.length, 1, 'one backup file');
    const file = JSON.parse(await app.browser.window.downloads[0].text());
    assert.equal(file.playlists[0].name, 'Spooky');
    const firstChange = app.queup.log.findIndex(function(c) { return c.method === 'POST' || c.method === 'DELETE'; });
    assert.ok(firstChange > app.queup.log.findIndex(function(c) { return /songs\?page=1/.test(c.url); }), 'the playlist was read before it was changed');

    const box = app.shadow.find(function(n) { return n.tagName === 'button' && n.textContent === 'Undo the last change'; })[0];
    assert.ok(box, 'undo is offered');
    app.queup.log.length = 0;
    await box.click();
    const changes = app.queup.log.filter(function(c) { return c.method === 'POST' || c.method === 'DELETE'; });
    assert.equal(changes[0].method, 'POST');
    assert.match(changes[0].body, /type=youtube/);
  });

  it('finds duplicates, ticks only the extra copy in the same playlist, and removes just that after a backup', async function() {
    const app = await open(true);
    const original = app.queup.fetchImpl;
    app.browser.context.fetch = function(url, options) {
      if (/playlist\/pl1\/songs\?page=1$/.test(String(url))) {
        const entries = [1, 2, 1].map(function(n, i) { return { _id: 'entry' + (i + 1), songid: 's' + n, _song: { _id: 's' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) } }; });
        return Promise.resolve({ status: 200, json: function() { return Promise.resolve({ data: entries }); } });
      }
      return original(url, options);
    };
    await app.byText('button', 'Dead songs').click();
    await waitFor(function() { return app.shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    await app.byText('button', 'Find duplicates').click();

    const status = function() { return app.shadow.find(function(n) { return n.className === 'status'; })[0].textContent; };
    assert.match(status(), /1 song is in more than one place/);
    const boxes = app.shadow.find(function(n) { return n.tagName === 'input' && n.type === 'checkbox' && n.dataset.copy !== undefined; });
    assert.deepEqual(boxes.map(function(b) { return b.checked; }), [false, true]);

    // ticking the other copy too is not allowed: one copy stays
    boxes[0].checked = true;
    await boxes[0].listeners.change[0]({});
    assert.equal(boxes[0].checked, false);

    app.queup.log.length = 0;
    await app.byText('button', 'Remove ticked copies').click();
    assert.equal(app.browser.window.downloads.length, 1, 'backed up first');
    const changes = app.queup.log.filter(function(c) { return c.method === 'POST' || c.method === 'DELETE'; });
    assert.deepEqual(changes.map(function(c) { return c.method + ' ' + c.url; }), ['DELETE https://api.queup.net/playlist/pl1/songs/entry3']);
  });

  it('shows a song name as text, never as page content, whatever it contains', async function() {
    const app = await open(true);
    const original = app.queup.fetchImpl;
    // a dead song with a name that would do something if it were treated as HTML
    const evil = '<img src=x onerror=alert(1)> @everyone';
    const wrapped = function(url, options) {
      if (/songs\?page=1$/.test(String(url))) {
        return Promise.resolve({ status: 200, json: function() { return Promise.resolve({ data: [{ _id: 'e1', songid: 's1', _song: { _id: 's1', name: evil, type: 'youtube', fkid: YT(2) } }] }); } });
      }
      return original(url, options);
    };
    const again = fakeBrowser(wrapped, true);
    vm.runInContext(code, again.context);
    const shadow = again.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    await shadow.find(function(n) { return n.tagName === 'button' && n.textContent === 'Dead songs'; })[0].click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    await shadow.find(function(n) { return n.tagName === 'button' && n.textContent === 'Scan'; })[0].click();

    const shown = shadow.find(function(n) { return n.className === 'item'; })[0];
    assert.ok(shown.textContent.indexOf(evil) !== -1, 'the name is shown as text');
    // the only pictures are song pictures from YouTube, nothing was made from the name
    shown.find(function(n) { return n.tagName === 'img'; }).forEach(function(img) { assert.match(img.src, /^https:\/\/i\.ytimg\.com\/vi\//); });
    assert.equal(shown.find(function(n) { return n.tagName !== 'input' && n.tagName !== 'img' && n.tagName !== 'div' && n.tagName !== 'a' && n.tagName !== 'span' && n.tagName !== 'details' && n.tagName !== 'summary' && n.tagName !== '#text'; }).length, 0, 'and no element was made from it');
  });

  // ---- the panel with a few kinds of dead song ----

  async function openWith(entries, searchFor, confirmAnswer) {
    const log = [];
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const fetchImpl = function(url, options) {
      options = options || {};
      const method = options.method || 'GET';
      url = String(url);
      log.push(method + ' ' + url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(/yt00000000[345]/.test(decodeURIComponent(url)) ? 404 : 200, {}); }
      if (url.indexOf('soundcloud.com/oembed') !== -1) { return json(200, {}); }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'Spooky', totalItems: entries.length, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: entries }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) { return json(200, { data: { items: searchFor(decodeURIComponent(url.split('name=')[1].split('&')[0])), pageInfo: { totalResults: 1 } } }); }
      if (method === 'POST') { return json(200, {}); }
      if (method === 'DELETE') { return json(200, { data: { _id: 'pl1', name: 'Spooky', totalItems: 1 } }); }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, confirmAnswer);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    await button('Scan').click();
    const boxes = function() { return shadow.find(function(n) { return n.tagName === 'input' && n.type === 'checkbox' && n.dataset && n.dataset.index !== undefined; }); };
    return { log: log, shadow: shadow, button: button, boxes: boxes, browser: browser, items: function() { return shadow.find(function(n) { return n.className === 'item'; }); } };
  }

  function dead(n, extra) {
    return { _id: 'entry' + n, added: n, songid: 'song' + n, _song: Object.assign({ _id: 'song' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) }, extra) };
  }

  // three dead songs: one with a sure replacement, one with none, and one with a short title only a possible match can be found for
  function scenario() {
    const entries = [dead(3), dead(4), dead(5, { name: 'Roygbiv', images: { thumbnail: 'https://evil.example/tracker.png' } })];
    const searchFor = function(name) {
      if (name === 'Roygbiv') { return [{ name: 'Boards of Canada - Roygbiv', type: 'youtube', fkid: 'bocroygbiv1' }, { name: 'Boards of Canada - Roygbiv (Remastered)', type: 'youtube', fkid: 'bocroygbiv2' }]; }
      if (name.indexOf('Title 3') !== -1) { return [{ name: name + ' [Label]', type: 'youtube', fkid: 'sureone0001', images: { thumbnail: 'https://i.ytimg.com/vi/sureone0001/hqdefault.jpg' } }]; }
      return [];
    };
    return { entries: entries, searchFor: searchFor };
  }

  it('ticks a sure replacement for the person, and leaves a possible one and a song with none unticked', async function() {
    const s = scenario();
    const app = await openWith(s.entries, s.searchFor, true);
    const boxes = app.boxes();

    assert.equal(boxes.length, 3);
    assert.deepEqual(boxes.map(function(b) { return b.checked; }), [true, false, false]);
    assert.deepEqual(boxes.map(function(b) { return b.disabled; }), [false, true, false], 'a song with no replacement cannot be ticked');
    assert.match(app.items()[2].textContent, /possible match, check it/);
    assert.match(app.items()[2].textContent, /most results for it are by Boards of Canada/);
    assert.match(app.items()[1].textContent, /no replacement/);
  });

  it('shows the pictures of the dead song and of its replacement, only from places song pictures come from', async function() {
    const s = scenario();
    const app = await openWith(s.entries, s.searchFor, true);
    const imagesOf = function(item) { return item.find(function(n) { return n.tagName === 'img'; }); };

    const first = imagesOf(app.items()[0]);
    assert.equal(first.length, 2, 'the dead song and its replacement');
    assert.equal(first[0].src, 'https://i.ytimg.com/vi/' + YT(3) + '/hqdefault.jpg');
    assert.equal(first[1].src, 'https://i.ytimg.com/vi/sureone0001/hqdefault.jpg');
    assert.ok(first.every(function(img) { return img.referrerPolicy === 'no-referrer'; }));

    // an address that is not from a picture site is never loaded: the song's own picture is used instead
    imagesOf(app.items()[2]).forEach(function(img) { assert.notEqual(img.src, 'https://evil.example/tracker.png'); assert.match(img.src, /^https:\/\/i\.ytimg\.com\//); });

    // a picture that will not load is swapped for a box that says so
    assert.match(app.items()[1].textContent, /^$|picture gone|"Artist 4 - Title 4"/);
  });

  it('has Select all and Select none, and says how many are selected', async function() {
    const s = scenario();
    const app = await openWith(s.entries, s.searchFor, true);
    const counter = function() { return app.shadow.find(function(n) { return n.className === 'count'; })[0].textContent; };

    assert.equal(counter(), '1 selected');
    await app.button('Select all').click();
    assert.deepEqual(app.boxes().map(function(b) { return b.checked; }), [true, false, true], 'everything that can be ticked, not the song with no replacement');
    assert.equal(counter(), '2 selected');

    await app.button('Select none').click();
    assert.deepEqual(app.boxes().map(function(b) { return b.checked; }), [false, false, false]);
    assert.equal(counter(), '0 selected');
    assert.equal(app.button('Apply selected').disabled, true, 'nothing to apply');
    assert.equal(app.button('Select none').disabled, true);

    // picking a single song: none, then one box
    app.boxes()[2].checked = true;
    await app.boxes()[2].listeners.change[0]();
    assert.equal(counter(), '1 selected');
    assert.equal(app.button('Apply selected').disabled, false);
  });

  it('only changes the song that is ticked, and a possible match is only added when it is ticked', async function() {
    const s = scenario();
    const app = await openWith(s.entries, s.searchFor, true);
    await app.button('Select none').click();
    app.boxes()[2].checked = true;
    await app.boxes()[2].listeners.change[0]();
    await app.button('Apply selected').click();

    const changes = app.log.filter(function(l) { return /^(POST|DELETE)/.test(l); });
    assert.deepEqual(changes, ['POST https://api.queup.net/playlist/pl1/songs', 'DELETE https://api.queup.net/playlist/pl1/songs/entry5'], 'only the possible match that was ticked');
  });

  it('lets a song with no replacement be ticked only when the option to remove those is on', async function() {
    const s = scenario();
    const app = await openWith(s.entries, s.searchFor, true);
    const removeOption = optionNamed(app.shadow, 'Also remove dead songs');

    assert.equal(app.boxes()[1].disabled, true);
    removeOption.checked = true;
    await removeOption.listeners.change[0]();
    assert.equal(app.boxes()[1].disabled, false);

    await app.button('Select none').click();
    app.boxes()[1].checked = true;
    await app.boxes()[1].listeners.change[0]();
    await app.button('Apply selected').click();
    const changes = app.log.filter(function(l) { return /^(POST|DELETE)/.test(l); });
    assert.deepEqual(changes, ['DELETE https://api.queup.net/playlist/pl1/songs/entry4'], 'nothing is added for it');

    // and turning the option off again clears the tick
    const again = await openWith(s.entries, s.searchFor, true);
    const option = optionNamed(again.shadow, 'Also remove dead songs');
    option.checked = true; await option.listeners.change[0]();
    again.boxes()[1].checked = true;
    option.checked = false; await option.listeners.change[0]();
    assert.equal(again.boxes()[1].checked, false);
    assert.equal(again.boxes()[1].disabled, true);
  });

  // ---- scanning every playlist, and the length warnings ----

  async function openMulti(confirmAnswer) {
    const log = [];
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const song = function(n, extra) { return { _id: 'entry' + n, added: n, songid: 's' + n, _song: Object.assign({ _id: 's' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) }, extra) }; };
    const lists = {
      pl1: [song(3, { songLength: 240000 }), song(6, { songLength: 240000 })],
      pl2: [song(4, { songLength: 240000 })]
    };
    const fetchImpl = function(url, options) {
      options = options || {};
      const method = options.method || 'GET';
      url = String(url);
      log.push(method + ' ' + url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(/yt00000000[346]/.test(decodeURIComponent(url)) ? 404 : 200, {}); }
      if (url === 'https://api.queup.net/playlist') {
        return json(200, { data: [
          { _id: 'pl1', name: 'First', totalItems: 2, removed: false },
          { _id: 'empty', name: 'Empty', totalItems: 0, removed: false },
          { _id: 'bad', name: 'Unreadable', totalItems: 7, removed: false },
          { _id: 'pl2', name: 'Second', totalItems: 1, removed: false }
        ] });
      }
      var m = /playlist\/(\w+)\/songs\?page=1$/.exec(url);
      if (m) { return m[1] === 'bad' ? json(500, null) : json(200, { data: lists[m[1]] || [] }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) {
        const name = decodeURIComponent(url.split('name=')[1].split('&')[0]);
        // the replacement for Title 3 is 15 seconds longer, for Title 4 a few seconds, for Title 6 the same
        const length = name.indexOf('Title 3') !== -1 ? 255000 : name.indexOf('Title 4') !== -1 ? 246000 : 240000;
        return json(200, { data: { items: [{ name: name + ' [Label]', type: 'youtube', fkid: 'new' + name.match(/\d+/)[0].padStart(8, '0'), songLength: length }], pageInfo: { totalResults: 1 } } });
      }
      if (method === 'POST') { return json(200, {}); }
      if (method === 'DELETE') { return json(200, { data: { _id: 'x', name: 'x', totalItems: 1 } }); }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, confirmAnswer);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    return {
      log: log, shadow: shadow, button: button, browser: browser,
      items: function() { return shadow.find(function(n) { return n.className === 'item'; }); },
      boxes: function() { return shadow.find(function(n) { return n.tagName === 'input' && n.type === 'checkbox' && n.dataset && n.dataset.index !== undefined; }); },
      status: function() { return shadow.find(function(n) { return n.className === 'status'; })[0].textContent; }
    };
  }

  it('scans every playlist when asked, after saying roughly how long it takes, and shows which playlist each song is in', async function() {
    const app = await openMulti(true);
    await app.button('Scan all playlists').click();

    assert.match(app.browser.window.asked, /^Scan all 3 playlists\?\n\nAbout \d+ songs, which takes roughly \d+ minutes?\. Up to 50 pages/);
    assert.doesNotMatch(app.browser.window.asked, /\b1 minutes\b/);
    assert.match(app.browser.window.asked, /Nothing is changed by a scan\.$/);
    assert.match(app.status(), /^Checked 2 of 3 playlists \(3 songs\): 3 dead, 3 with a replacement\./, 'the empty one is not counted, the unreadable one was not checked');
    assert.match(app.status(), /Could not read: "Unreadable"\./);

    const items = app.items();
    assert.equal(items.length, 3);
    assert.match(items[0].textContent, /^in "First"/);
    assert.match(items[2].textContent, /^in "Second"/);
    assert.equal(app.log.filter(function(l) { return /^(POST|DELETE)/.test(l); }).length, 0, 'a scan changes nothing');
    assert.equal(app.log.filter(function(l) { return l.indexOf('/playlist/empty/') !== -1; }).length, 0, 'the empty playlist was not even asked about');
  });

  it('does nothing when the person says no to scanning everything', async function() {
    const app = await openMulti(false);
    const before = app.log.length;
    await app.button('Scan all playlists').click();
    assert.equal(app.log.length, before, 'no request was made');
    assert.equal(app.items().length, 0);
  });

  it('applies the chosen songs to the playlists they are in, one playlist at a time', async function() {
    const app = await openMulti(true);
    await app.button('Scan all playlists').click();
    await app.button('Apply selected').click();

    assert.match(app.browser.window.asked, /^Swap in 3 replacements across 2 playlists\?/);
    const changes = app.log.filter(function(l) { return /^(POST|DELETE)/.test(l); });
    assert.deepEqual(changes, [
      'POST https://api.queup.net/playlist/pl1/songs', 'DELETE https://api.queup.net/playlist/pl1/songs/entry3',
      'POST https://api.queup.net/playlist/pl1/songs', 'DELETE https://api.queup.net/playlist/pl1/songs/entry6',
      'POST https://api.queup.net/playlist/pl2/songs', 'DELETE https://api.queup.net/playlist/pl2/songs/entry4'
    ]);
    assert.match(app.status(), /^Done: 3 of 3 changed, "First" has 1 songs now, "Second" has 1 songs now\. Reload QueUp to see the new playlists\.$/);
    assert.match(app.items()[0].textContent, /^in "First"Done: /);
  });

  it('shows a length that is a lot different from the dead song\'s in a warning colour, and a small difference quietly', async function() {
    const app = await openMulti(true);
    await app.button('Scan all playlists').click();
    const lengthLine = function(item) { return item.find(function(n) { return /^length:/.test(n.textContent) && n.children.length === 0; })[0]; };

    const far = lengthLine(app.items()[0]);       // 15 seconds longer
    const same = lengthLine(app.items()[1]);      // the same
    const close = lengthLine(app.items()[2]);     // 6 seconds longer

    assert.equal(far.textContent, 'length: 4:00 vs 4:15 (+15 s), check this one');
    assert.match(far.className, /\bwarn\b/);
    assert.equal(same.textContent, 'length: 4:00 vs 4:00');
    assert.doesNotMatch(same.className, /warn|close/);
    assert.equal(close.textContent, 'length: 4:00 vs 4:06 (+6 s)');
    assert.match(close.className, /\bclose\b/);
  });

  // ---- the reminder ----

  async function openWithStore(storage, confirmAnswer) {
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const entries = [{ _id: 'entry3', added: 3, songid: 's3', _song: { _id: 's3', name: 'Artist 3 - Title 3', type: 'youtube', fkid: YT(3) } }];
    const fetchImpl = function(url, options) {
      url = String(url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(/yt000000003/.test(decodeURIComponent(url)) ? 404 : 200, {}); }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'First', totalItems: 1, removed: false }, { _id: 'pl2', name: 'Second', totalItems: 1, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: entries }); }
      if (/playlist\/pl2\/songs\?page=1$/.test(url)) { return json(200, { data: [] }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) { return json(200, { data: { items: [] } }); }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, confirmAnswer === undefined ? true : confirmAnswer, storage);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    return {
      shadow: shadow, button: button,
      dot: function() { return shadow.find(function(n) { return n.className === 'dot'; })[0]; },
      savedBox: function() { return shadow.find(function(n) { return n.className === 'resume' && /finished scan|Open it/.test(n.textContent + n.children.map(function(c) { return c.textContent; }).join('')); })[0]; },
      reminderBox: function() { return shadow.find(function(n) { return n.className === 'reminder'; })[0]; },
      lines: function() { return shadow.find(function(n) { return n.className === 'reminder'; })[0].textContent; },
      open: async function() { await button('Dead songs').click(); await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; }); }
    };
  }

  it('shows the dot on the button the first time, before anything has been scanned', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const app = await openWithStore({});
    assert.equal(app.dot().hidden, false);
    assert.match(app.lines(), /You have not scanned a playlist all the way through yet\./);
  });

  it('scanning every playlist to the end clears the dot, and what is kept is the dates, the finished report and a place to carry on from', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const app = await openWithStore(storage);
    await app.open();
    assert.equal(app.dot().hidden, false, 'the playlists are known now, and neither was ever scanned');
    assert.match(app.lines(), /Not scanned for over a month: First \(never\), Second \(never\)/);

    await app.button('Scan all playlists').click();
    assert.equal(app.dot().hidden, true);
    assert.match(app.lines(), /Last scan: 2026-10-15 \(today\)/);
    assert.doesNotMatch(app.lines(), /Not scanned for over a month/);

    assert.deepEqual(Object.keys(storage).sort(), ['checkpoint', 'lastScans', 'playlists', 'report']);
    assert.equal(JSON.parse(storage.checkpoint), null, 'a scan that finished leaves nothing to carry on');
    assert.deepEqual(Object.keys(JSON.parse(storage.lastScans)).sort(), ['pl1', 'pl2']);
    assert.ok(JSON.parse(storage.playlists).every(function(p) { return Object.keys(p).sort().join() === 'id,name,totalItems'; }), 'only ids, names and counts');
  });

  it('shows the dot on the button when it opens a month later, without asking QueUp for anything', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const first = await openWithStore(storage);
    await first.open();
    await first.button('Scan all playlists').click();
    assert.equal(first.dot().hidden, true);

    clock.now = Date.UTC(2026, 10, 20, 12);   // 36 days later
    const later = await openWithStore(storage);
    assert.equal(later.dot().hidden, false, 'both are over 30 days old');
    assert.match(later.lines(), /Last scan: 2026-10-15 \(36 days ago\)/);
    assert.match(later.lines(), /Not scanned for over a month: First \(36 days\), Second \(36 days\)/);
  });

  it('does not count a scan that started part way through a playlist, or was stopped', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const app = await openWithStore(storage);
    await app.open();
    app.shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    app.shadow.find(function(n) { return n.tagName === 'input' && n.type === 'number'; })[0].value = '2';
    await app.button('Scan').click();
    assert.equal(storage.lastScans, undefined, 'it started at page 2');
    assert.equal(app.dot().hidden, false);
  });

  it('can be snoozed, and turned off and on again, and remembers that', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const app = await openWithStore(storage);
    await app.open();
    assert.equal(app.dot().hidden, false);

    await app.button('Remind me in a week').click();
    assert.equal(app.dot().hidden, true);
    assert.equal(app.reminderBox().hidden, true, 'the whole box goes away, so it is clear it worked');
    assert.ok(JSON.parse(storage.reminder).snoozeUntil > clock.now);

    clock.now += 8 * 24 * 60 * 60 * 1000;
    const after = await openWithStore(storage);
    assert.equal(after.dot().hidden, false, 'a week later it is back');

    await after.button('Stop reminding me').click();
    assert.equal(after.dot().hidden, true);
    assert.equal(JSON.parse(storage.reminder).off, true);
    assert.equal(after.reminderBox().hidden, true, 'the box goes away, not just the dot');

    const again = await openWithStore(storage);
    assert.equal(again.dot().hidden, true, 'off stays off');
    await again.button('Turn reminders back on').click();
    assert.equal(again.dot().hidden, false);
    assert.equal(again.reminderBox().hidden, false);
  });

  it('keeps the report of a finished scan over a reload, and opens it again', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const first = await openWithStore(storage);
    await first.open();
    await first.button('Scan all playlists').click();
    assert.ok(storage.report, 'saved when the scan finished');
    assert.equal(first.savedBox().hidden, true, 'the report is on screen already');

    clock.now += 3 * 60 * 60 * 1000;
    const later = await openWithStore(storage);
    assert.equal(later.savedBox().hidden, false);
    assert.match(later.savedBox().textContent, /A finished scan from 3 hours ago is saved: 1 dead song, 0 with a replacement\./);
    await later.open();
    await later.button('Open it').click();
    assert.match(later.shadow.textContent, /Artist 3 - Title 3/);
    assert.equal(later.savedBox().hidden, true, 'hidden while it is open');

    const another = await openWithStore(storage);
    await another.button('Throw the report away').click();
    assert.equal(storage.report, 'null');
    assert.equal(another.savedBox().hidden, true);
  });

  it('still works, in memory, when the manager has no storage', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const app = await openWithStore(undefined);
    await app.open();
    await app.button('Scan all playlists').click();
    assert.equal(app.dot().hidden, true);
  });

  // ---- Stop ----

  /** a playlist of dead songs and a hook that presses Stop when the Nth song is checked */
  async function openForStop(pressOn, presses) {
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const entries = [];
    for (let n = 1; n <= 6; n++) { entries.push({ _id: 'entry' + n, added: n, songid: 's' + n, _song: { _id: 's' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) } }); }
    var checked = 0;
    var app;

    const fetchImpl = function(url) {
      url = String(url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) {
        checked++;
        if (checked === pressOn) { Promise.resolve().then(async function() { for (let i = 0; i < presses; i++) { await app.button('Stop').click(); } }); }
        // songs 2 and 3 are dead
        return json(/yt00000000[23]/.test(decodeURIComponent(url)) ? 404 : 200, {});
      }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'First', totalItems: 6, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: entries }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) {
        const name = decodeURIComponent(url.split('name=')[1].split('&')[0]);
        return json(200, { data: { items: [{ name: name + ' [Label]', type: 'youtube', fkid: 'new' + name.match(/\d+/)[0].padStart(8, '0') }] } });
      }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, true);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    app = {
      shadow: shadow, button: button,
      status: function() { return shadow.find(function(n) { return n.className === 'status'; })[0].textContent; },
      items: function() { return shadow.find(function(n) { return n.className === 'item'; }); },
      count: function() { return checked; }
    };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    return app;
  }

  it('on the first Stop, stops checking but still looks for replacements for the dead songs found', async function() {
    // Stop is pressed while the fourth song is being checked: songs 2 and 3 are dead and were found already
    const app = await openForStop(4, 1);
    await app.button('Scan').click();

    assert.match(app.status(), /Stopped: you stopped it\./);
    assert.match(app.status(), /2 dead, 2 with a replacement/);
    assert.equal(app.items().length, 2);
    assert.match(app.items()[0].textContent, /instead: Artist 2 - Title 2 \[Label\]/);
    assert.ok(app.count() < 12, 'it did not carry on checking every song and every replacement');
  });

  it('on a second Stop, skips the looking for replacements too, and still lists the dead songs', async function() {
    const app = await openForStop(4, 2);
    await app.button('Scan').click();

    assert.match(app.status(), /Stopped: you stopped it\./);
    assert.equal(app.items().length, 2, 'the dead songs found are not lost');
    assert.match(app.items().map(function(i) { return i.textContent; }).join(' '), /no replacement \(not searched for\)/);
  });

  it('says what the first Stop is doing, and what a second one would do', async function() {
    var seen = [];
    const app = await openForStop(4, 0);
    // press it by hand and read what the panel says each time
    const original = app.status;
    const scan = app.button('Scan').click();
    await waitFor(function() { return app.count() >= 3; });
    await app.button('Stop').click();
    seen.push(original());
    await app.button('Stop').click();
    seen.push(original());
    await scan;

    assert.match(seen[0], /Stopping\. Looking for replacements for what was found so far, press Stop again to skip that\./);
    assert.equal(seen[1], 'Stopping...');
  });

  // ---- carrying on after the tab is closed ----

  /**
   * A playlist of 25 songs, where songs 4, 13 and 22 are dead. With hangAfter, every request after that many songs have been
   * checked never answers, which is a tab that was closed: the page freezes and whatever it saved stays in the storage.
   */
  async function openScanner(storage, options) {
    options = options || {};
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const entries = [];
    for (let n = 1; n <= 25; n++) { entries.push({ _id: 'entry' + n, added: n, songid: 's' + n, _song: { _id: 's' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) } }); }
    const checked = [];
    var hung = false;

    const fetchImpl = function(url, init) {
      url = String(url);
      if (hung) { return new Promise(function() {}); }
      if (url.indexOf('https://www.youtube.com/oembed') === 0) {
        const id = (decodeURIComponent(url).match(/yt\d{9}/) || [null])[0];
        if (id) {
          if (options.hangAfter && checked.length >= options.hangAfter) { hung = true; return new Promise(function() {}); }
          checked.push(id);
        }
        return json(/yt0000000(04|13|22)/.test(decodeURIComponent(url)) ? 404 : 200, {});
      }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'First', totalItems: 25, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: entries.slice(0, 20) }); }
      if (/playlist\/pl1\/songs\?page=2$/.test(url)) { return json(200, { data: entries.slice(20) }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) {
        const name = decodeURIComponent(url.split('name=')[1].split('&')[0]);
        return json(200, { data: { items: [{ name: name + ' [Label]', type: 'youtube', fkid: 'new' + name.match(/\d+/)[0].padStart(8, '0') }] } });
      }
      if ((init && init.method) === 'POST') { return json(200, {}); }
      if ((init && init.method) === 'DELETE') { return json(200, { data: { _id: 'pl1', name: 'First', totalItems: 25 } }); }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, true, storage);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    return {
      shadow: shadow, button: button, checked: checked, browser: browser,
      banner: function() { return shadow.find(function(n) { return n.className === 'resume'; })[0]; },
      status: function() { return shadow.find(function(n) { return n.className === 'status'; })[0].textContent; },
      items: function() { return shadow.find(function(n) { return n.className === 'item'; }); }
    };
  }

  it('offers to carry on after the tab was closed in the middle of a scan, and carries on from where it got to', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};

    // the tab is closed after 15 songs: the page freezes, and what was saved at the 10th song is all that is left
    const closed = await openScanner(storage, { hangAfter: 15 });
    closed.button('Scan').click();
    await waitFor(function() { return closed.checked.length >= 15; });
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.equal(JSON.parse(storage.checkpoint).resume.current.state.index, 10, 'saved every ten songs');

    // a new page, with the same storage
    clock.now += 5 * 60 * 1000;
    const again = await openScanner(storage);
    assert.equal(again.banner().hidden, false);
    assert.match(again.banner().textContent, /An earlier scan was interrupted \("First", 10 songs checked, 1 dead so far, 5 minutes ago\)\./);

    await again.button('Resume it').click();
    assert.ok(again.checked.length > 0 && again.checked[0] === YT(11), 'it carried on with the 11th song: ' + again.checked[0]);
    assert.equal(again.checked.filter(function(id) { return id <= YT(10); }).length, 0, 'the first ten were not checked again');
    assert.match(again.status(), /^Checked 25 songs in "First": 3 dead, 3 with a replacement\./);
    assert.equal(again.items().length, 3, 'the one found before the tab closed, and the two after');
    assert.equal(again.banner().hidden, true, 'nothing is left to carry on');
    assert.equal(JSON.parse(storage.checkpoint), null);
  });

  it('can carry on a scan that was stopped, and says so', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const app = await openScanner(storage);
    const scanning = app.button('Scan').click();
    await waitFor(function() { return app.checked.length >= 12; });
    await app.button('Stop').click();
    await scanning;

    assert.match(app.status(), /Stopped: you stopped it\..*It can be carried on from the box at the top\./);
    assert.equal(app.banner().hidden, false);

    const before = app.checked.length;
    await app.button('Resume it').click();
    assert.match(app.status(), /^Checked 25 songs in "First": 3 dead, 3 with a replacement\./);
    // a dead song is asked about twice (a clear answer has to come twice), every other song once: any more means one was checked again
    const times = {};
    app.checked.forEach(function(id) { times[id] = (times[id] || 0) + 1; });
    assert.equal(Object.keys(times).length, 25, 'every song was checked');
    Object.keys(times).forEach(function(id) { assert.equal(times[id], /yt0000000(04|13|22)/.test(id) ? 2 : 1, id + ' was checked ' + times[id] + ' times'); });
    assert.ok(app.checked.length > before);
  });

  it('throws a saved scan away when asked, and does not offer one that is old or that is not a scan at all', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const first = await openScanner(storage);
    const scanning = first.button('Scan').click();
    await waitFor(function() { return first.checked.length >= 12; });
    await first.button('Stop').click();
    await scanning;
    assert.equal(first.banner().hidden, false);

    await first.button('Throw it away').click();
    assert.equal(first.banner().hidden, true);
    assert.equal(JSON.parse(storage.checkpoint), null);

    // an old one is not offered
    storage.checkpoint = JSON.stringify({ v: 1, savedAt: clock.now - 8 * 24 * 60 * 60 * 1000, multi: false, fromPage: 1, maxPages: 50, playlists: [{ id: 'pl1', name: 'First', totalItems: 25 }], resume: { finished: [], current: null } });
    assert.equal((await openScanner(storage)).banner().hidden, true, 'a week old');

    // and neither is anything that is not what was saved
    for (const garbage of ['not json', '{"v":1}', '{"v":1,"savedAt":1,"playlists":[{"id":"../x","name":"n"}]}', 'null', '[]', '"text"']) {
      storage.checkpoint = garbage;
      assert.equal((await openScanner(storage)).banner().hidden, true, garbage);
    }
  });

  it('carries on scanning every playlist after the tab was closed, without scanning the finished ones again', async function() {
    clock.now = Date.UTC(2026, 9, 15, 12);
    const storage = {};
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const song = function(n) { return { _id: 'entry' + n, added: n, songid: 's' + n, _song: { _id: 's' + n, name: 'Artist ' + n + ' - Title ' + n, type: 'youtube', fkid: YT(n) } }; };
    const lists = { pl1: [song(1), song(2)], pl2: [song(3), song(4), song(5), song(6), song(7), song(8), song(9), song(10), song(11), song(12), song(13), song(14), song(15), song(16)] };
    const reads = [];
    var checks = 0;

    const make = function(hangAfter) {
      var hung = false;
      return function(url) {
        url = String(url);
        if (hung) { return new Promise(function() {}); }
        if (url.indexOf('https://www.youtube.com/oembed') === 0) {
          if (hangAfter && ++checks > hangAfter) { hung = true; return new Promise(function() {}); }
          return json(/yt000000(002|011)/.test(decodeURIComponent(url)) ? 404 : 200, {});
        }
        if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'One', totalItems: 2, removed: false }, { _id: 'pl2', name: 'Two', totalItems: 14, removed: false }] }); }
        const m = /playlist\/(\w+)\/songs\?page=1$/.exec(url);
        if (m) { reads.push(m[1]); return json(200, { data: lists[m[1]] }); }
        if (url.indexOf('https://api.queup.net/song?name=') === 0) { return json(200, { data: { items: [] } }); }
        return json(404, null);
      };
    };
    const open = async function(fetchImpl) {
      const browser = fakeBrowser(fetchImpl, true, storage);
      vm.runInContext(code, browser.context);
      const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
      const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
      await button('Dead songs').click();
      await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
      return { shadow: shadow, button: button, status: function() { return shadow.find(function(n) { return n.className === 'status'; })[0].textContent; }, banner: function() { return shadow.find(function(n) { return n.className === 'resume'; })[0]; } };
    };

    // the tab is closed in the second playlist, just after its tenth song (14 requests so far, a dead song is asked about twice)
    const closed = await open(make(14));
    closed.button('Scan all playlists').click();
    await waitFor(function() { return checks > 14; });
    await new Promise(function(resolve) { setImmediate(resolve); });

    reads.length = 0;
    const again = await open(make(0));
    assert.match(again.banner().textContent, /An earlier scan was interrupted \(playlist 2 of 2, "Two", 10 songs checked, 1 dead so far/);
    await again.button('Resume it').click();

    assert.deepEqual(reads, ['pl2'], 'the finished playlist was not read again');
    assert.match(again.status(), /^Checked 2 of 2 playlists \(16 songs\): 2 dead, 0 with a replacement\./, 'the dead song found in the first playlist is kept');
  });

  it('lists the playlists in alphabetical order in the drop-down, and scans them in that order', async function() {
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const order = [];
    const fetchImpl = function(url) {
      url = String(url);
      if (url === 'https://api.queup.net/playlist') {
        return json(200, { data: [
          { _id: 'z1', name: 'zebra songs', totalItems: 1, removed: false },
          { _id: 'm2', name: 'Mix 10', totalItems: 1, removed: false },
          { _id: 'm1', name: 'mix 2', totalItems: 1, removed: false },
          { _id: 'a1', name: 'Apple', totalItems: 1, removed: false }
        ] });
      }
      const m = /playlist\/(\w+)\/songs\?page=1$/.exec(url);
      if (m) { order.push(m[1]); return json(200, { data: [] }); }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, true);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });

    assert.deepEqual(shadow.find(function(n) { return n.tagName === 'option'; }).map(function(o) { return o.textContent; }),
      ['Apple (1 song)', 'mix 2 (1 song)', 'Mix 10 (1 song)', 'zebra songs (1 song)']);

    await button('Scan all playlists').click();
    assert.deepEqual(order, ['a1', 'm1', 'm2', 'z1']);
  });

  it('shows, for a dead song with no replacement, what was searched for and why each result was not taken, as plain text', async function() {
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const entries = [
      { _id: 'entry1', added: 1, songid: 's1', _song: { _id: 's1', name: 'Lapis', type: 'youtube', fkid: YT(1) } },
      { _id: 'entry2', added: 2, songid: 's2', _song: { _id: 's2', name: 'Artist 2 - Title 2', type: 'youtube', fkid: YT(2) } }
    ];
    const fetchImpl = function(url) {
      url = String(url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(/yt00000000[12]/.test(decodeURIComponent(url)) ? 404 : 200, {}); }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'First', totalItems: 2, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: entries }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) {
        const name = decodeURIComponent(url.split('name=')[1].split('&')[0]);
        if (name === 'Lapis') { return json(200, { data: { items: [{ name: 'Lapis (Full Album)', type: 'youtube', fkid: 'album000001', songLength: 3600000 }, { name: '<b onmouseover=alert(1)>Lapis</b>', type: 'youtube', fkid: 'justtitle01', songLength: 200000 }] } }); }
        return json(200, { data: { items: [] } });
      }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, true);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    await button('Scan').click();

    const details = shadow.find(function(n) { return n.tagName === 'details'; });
    assert.equal(details.length, 2, 'one for each song with no replacement');

    const lapis = details[0].textContent;
    assert.match(lapis, /^What was looked atSearched for "Lapis", 4 results:/);
    assert.match(lapis, /- YouTube: Lapis \(Full Album\) \(1:00:00\): a whole album or a long mix/);
    assert.match(lapis, /<b onmouseover=alert\(1\)>Lapis<\/b> \(3:20\): the dead song is only a short title with no artist, too little to be sure/);
    assert.equal(details[0].find(function(n) { return n.tagName === 'b'; }).length, 0, 'a name is shown as text, never made into an element');

    assert.match(details[1].textContent, /Searched for "Artist 2 - Title 2", and it found nothing\./);

    // links to look elsewhere: by name only with an artist and a title, by picture only once the picture has loaded
    const elsewhere = shadow.find(function(n) { return n.className === 'why elsewhere'; });
    assert.equal(elsewhere.length, 2);
    const linksOf = function(box) { return box.find(function(n) { return n.tagName === 'a'; }); };

    assert.equal(elsewhere[0].hidden, true, '"Lapis" has no artist, and its picture has not loaded');
    assert.equal(linksOf(elsewhere[0]).length, 0);
    assert.deepEqual(linksOf(elsewhere[1]).map(function(a) { return a.textContent; }), ['Search the web', 'YouTube', 'SoundCloud']);
    assert.equal(linksOf(elsewhere[1])[1].href, 'https://www.youtube.com/results?search_query=Artist%202%20Title%202');
    assert.equal(elsewhere[1].hidden, false);

    const pictureOf = function(n) { return shadow.find(function(x) { return x.tagName === 'img' && x.className === 'pic'; })[n]; };
    const lapisPicture = pictureOf(0);
    lapisPicture.naturalWidth = 120;
    lapisPicture.onload();
    assert.equal(linksOf(elsewhere[0]).length, 0, "YouTube's grey box for a gone video is not a picture");

    lapisPicture.naturalWidth = 480;
    lapisPicture.onload();
    lapisPicture.onload();
    assert.deepEqual(linksOf(elsewhere[0]).map(function(a) { return a.textContent; }), ['Search by picture'], 'once, and only after it loaded');
    assert.equal(elsewhere[0].hidden, false);
    assert.match(linksOf(elsewhere[0])[0].href, /^https:\/\/lens\.google\.com\/uploadbyurl\?url=https%3A%2F%2Fi\.ytimg\.com%2Fvi%2F/);
    assert.equal(linksOf(elsewhere[0])[0].rel, 'noopener noreferrer');
  });

  it('says "1 song" and not "1 songs" in what it reports', async function() {
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const fetchImpl = function(url) {
      url = String(url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(200, {}); }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'Tiny', totalItems: 1, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: [{ _id: 'entry1', added: 1, songid: 's1', _song: { _id: 's1', name: 'Artist 1 - Title 1', type: 'youtube', fkid: YT(1) } }] }); }
      return json(404, null);
    };
    const browser = fakeBrowser(fetchImpl, true);
    vm.runInContext(code, browser.context);
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };
    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    shadow.find(function(n) { return n.tagName === 'select'; })[0].value = 'pl1';
    await button('Scan').click();
    assert.match(shadow.find(function(n) { return n.className === 'status'; })[0].textContent, /^Checked 1 song in "Tiny": 0 dead/);

    await button('Scan all playlists').click();
    assert.match(shadow.find(function(n) { return n.className === 'status'; })[0].textContent, /^Checked 1 of 1 playlists \(1 song\): 0 dead/);
  });
});
