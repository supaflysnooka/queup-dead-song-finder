'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const builder = require('../tools/build-extension.js');
const shim = require('../extension/src/shim.js');
const background = require('../extension/src/background.js');
const { fakeBrowser, waitFor } = require('./fake-browser.js');

const files = builder.build();
const header = fs.readFileSync(path.join(__dirname, '..', 'userscript/src/header.txt'), 'utf8');
const YT = function(n) { return 'yt' + String(n).padStart(9, '0'); };

describe('the extension files', function() {
  it('are up to date with what they are built from', function() {
    assert.deepEqual(builder.outOfDate(files), [], 'run: node tools/build-extension.js');
  });

  it('have a manifest for each browser that asks for as little as the userscript does', function() {
    ['chrome', 'firefox'].forEach(function(target) {
      const m = JSON.parse(files[target + '/manifest.json']);
      assert.equal(m.manifest_version, 3);
      assert.equal(m.version, /@version\s+(\S+)/.exec(header)[1], 'the userscript version');
      assert.deepEqual(m.permissions, ['storage'], 'only its own settings');
      assert.deepEqual(m.host_permissions, ['https://www.youtube.com/*'], 'only the one site the page can not read itself');
      assert.deepEqual(m.content_scripts.map(function(c) { return c.matches; }), [['https://queup.net/*']]);
      assert.equal(m.content_scripts[0].all_frames, false);
      assert.equal(m.content_scripts[0].js[0], 'content.js');
      Object.keys(m.icons).forEach(function(size) { assert.ok(files[target + '/' + m.icons[size]], 'icon ' + size); });
      assert.equal(m.homepage_url, 'https://github.com/supaflysnooka/queup-dead-song-finder');
    });

    assert.equal(JSON.parse(files['chrome/manifest.json']).background.service_worker, 'background.js');
    const firefox = JSON.parse(files['firefox/manifest.json']);
    assert.deepEqual(firefox.background, { scripts: ['background.js'] });
    assert.match(firefox.browser_specific_settings.gecko.id, /^[\w.-]+@[\w.-]+$/);
    assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] }, 'it collects nothing');
  });

  it('are plain JavaScript that parses, and have nothing that runs code they did not ship with', function() {
    ['content.js', 'background.js'].forEach(function(name) {
      const code = files['chrome/' + name];
      assert.doesNotThrow(function() { new vm.Script(code); }, name);
      ['eval(', 'new Function', 'document.write', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'XMLHttpRequest', 'importScripts', '<script', 'localStorage', 'sessionStorage', 'document.cookie', 'WebSocket', 'sendBeacon']
        .forEach(function(forbidden) { assert.equal(code.indexOf(forbidden), -1, forbidden + ' is in ' + name); });
    });

    // the same site list as the userscript: what it talks to, and the links a person can click
    const hosts = new Set();
    (files['chrome/content.js'].match(/https?:\/\/[A-Za-z0-9.-]+/g) || []).forEach(function(url) { hosts.add(url.replace(/^https?:\/\//, '')); });
    const allowed = ['lens.google.com', 'www.google.com', 'api.queup.net', 'queup.net', 'www.youtube.com', 'i.ytimg.com', 'soundcloud.com', 'api.soundcloud.com', 'w.soundcloud.com', 'github.com'];
    hosts.forEach(function(host) { assert.ok(allowed.indexOf(host) !== -1, 'unexpected host: ' + host); });
  });

  it('give both browsers the same scripts', function() {
    assert.equal(files['chrome/content.js'], files['firefox/content.js']);
    assert.equal(files['chrome/background.js'], files['firefox/background.js']);
  });

  it('zips to a real zip, the same every time', function() {
    const entries = [{ name: 'a.txt', data: Buffer.from('hello hello hello') }, { name: 'icons/b.bin', data: Buffer.from([1, 2, 3]) }];
    const first = builder.zip(entries);
    assert.ok(first.equals(builder.zip(entries)));
    assert.equal(first.readUInt32LE(0), 0x04034b50, 'starts with a file header');
    assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50, 'ends with the end record');
    assert.equal(first.readUInt16LE(first.length - 22 + 10), 2, 'two files');
  });
});

/** two ends of one port: what one posts the other gets, a moment later */
function portPair(name) {
  function end() {
    return { name: name, messages: [], onMessage: { fns: [], addListener: function(fn) { this.fns.push(fn); } }, onDisconnect: { fns: [], addListener: function(fn) { this.fns.push(fn); } }, other: null, closed: false };
  }
  const a = end();
  const b = end();
  a.other = b; b.other = a;
  [a, b].forEach(function(self) {
    self.postMessage = function(message) {
      if (self.closed || self.other.closed) { throw new Error('port closed'); }
      const copy = JSON.parse(JSON.stringify(message));
      setImmediate(function() { if (!self.other.closed) { self.other.onMessage.fns.forEach(function(fn) { fn(copy); }); } });
    };
    self.disconnect = function() {
      if (self.closed) { return; }
      self.closed = true;
      setImmediate(function() { if (!self.other.closed) { self.other.closed = true; self.other.onDisconnect.fns.forEach(function(fn) { fn(); }); } });
    };
  });
  return { content: a, background: b };
}

/** a page that arrives in pieces, and notes whether the download was stopped */
function streamOf(chunks, options) {
  options = options || {};
  const state = { stopped: false, read: 0 };
  const fetchImpl = async function(url, init) {
    state.url = url;
    state.init = init;
    const queue = chunks.slice();
    return {
      status: options.status || 200,
      url: options.finalUrl || url,
      body: {
        getReader: function() {
          return {
            read: function() {
              return new Promise(function(resolve, reject) {
                setImmediate(function() {
                  if (init.signal.aborted) { state.stopped = true; return reject(new Error('aborted')); }
                  if (queue.length === 0) { return resolve({ done: true }); }
                  state.read++;
                  resolve({ done: false, value: new TextEncoder().encode(queue.shift()) });
                });
              });
            }
          };
        }
      }
    };
  };
  return { fetch: fetchImpl, state: state };
}

const MARKER = '"playabilityStatus":\\{"status":"[A-Z_]+"';
const WATCH = 'https://www.youtube.com/watch?v=abcdefghijk';

describe('the background script', function() {
  async function ask(chunks, request, options) {
    const ports = portPair('watch-page');
    const stream = streamOf(chunks, options);
    const got = [];
    ports.content.onMessage.addListener(function(message) { got.push(message); });
    background.serve(ports.background, request, stream.fetch);
    ports.content.postMessage({});   // (nothing, the request is handed to serve directly)
    await waitFor(function() { return got.some(function(m) { return m.type === 'load' || m.type === 'error'; }); });
    return { got: got, stream: stream, ports: ports };
  }

  it('sends the page when it has been read, with no cookies', async function() {
    const result = await ask(['<html>', 'x"playabilityStatus":{"status":"OK"}', 'rest'], { url: WATCH, headers: { 'Accept-Language': 'de' }, progressWhen: null });
    const last = result.got[result.got.length - 1];
    assert.equal(last.type, 'load');
    assert.equal(last.status, 200);
    assert.equal(last.text, '<html>x"playabilityStatus":{"status":"OK"}rest');
    assert.equal(result.stream.state.init.credentials, 'omit');
    assert.equal(result.stream.state.init.headers['Accept-Language'], 'de');
  });

  it('says so as soon as the part that was asked for has arrived, and stops the download when the panel goes away', async function() {
    const ports = portPair('watch-page');
    const stream = streamOf(['<html>', 'x"playabilityStatus":{"status":"UNPLAYABLE"}', 'more', 'more', 'more', 'more']);
    const got = [];
    ports.content.onMessage.addListener(function(message) {
      got.push(message);
      if (message.type === 'progress') { ports.content.disconnect(); }
    });
    await background.serve(ports.background, { url: WATCH, headers: {}, progressWhen: MARKER }, stream.fetch);

    assert.equal(got.filter(function(m) { return m.type === 'progress'; }).length, 1);
    assert.match(got[0].text, /UNPLAYABLE/);
    assert.equal(got.filter(function(m) { return m.type === 'load'; }).length, 0, 'nothing more once it was told to stop');
    assert.ok(stream.state.read < 6, 'it stopped reading (' + stream.state.read + ' of 6 pieces)');
  });

  it('only fetches a YouTube watch page, whatever it is asked', async function() {
    const bad = [
      'https://www.youtube.com/watch?v=abc', 'https://www.youtube.com/watch?v=abcdefghijk&x=1', 'http://www.youtube.com/watch?v=abcdefghijk',
      'https://evil.example/watch?v=abcdefghijk', 'https://www.youtube.com.evil.example/watch?v=abcdefghijk', 'https://www.youtube.com/feed/history',
      'https://queup.net/', 'file:///etc/passwd', 5, null, undefined
    ];
    for (const url of bad) {
      const result = await ask(['x'], { url: url, headers: {} });
      assert.equal(result.got[0].type, 'error', String(url));
      assert.equal(result.stream.state.url, undefined, 'nothing was fetched for ' + String(url));
    }
    assert.equal((await ask(['x'], null)).got[0].type, 'error');
  });

  it('reports a failed fetch, and ignores a pattern it can not use', async function() {
    const ports = portPair('watch-page');
    const got = [];
    ports.content.onMessage.addListener(function(m) { got.push(m); });
    await background.serve(ports.background, { url: WATCH, headers: {} }, async function() { throw new Error('offline'); });
    await waitFor(function() { return got.length > 0; });
    assert.equal(got[0].type, 'error');

    const odd = await ask(['abc'], { url: WATCH, headers: {}, progressWhen: '(' });
    assert.equal(odd.got[odd.got.length - 1].type, 'load');
  });

  it('serves one request for each port, and nothing on a port with another name', function() {
    const listeners = [];
    const api = { runtime: { onConnect: { addListener: function(fn) { listeners.push(fn); } } } };
    let fetched = 0;
    background.listen(api, async function() { fetched++; throw new Error('stop'); });

    const other = portPair('something-else');
    listeners[0](other.background);
    assert.equal(other.background.onMessage.fns.length, 0);

    const mine = portPair('watch-page');
    listeners[0](mine.background);
    mine.background.onMessage.fns[0]({ url: WATCH, headers: {} });
    mine.background.onMessage.fns[0]({ url: WATCH, headers: {} });
    return waitFor(function() { return fetched >= 1; }).then(function() { assert.equal(fetched, 1); });
  });
});

describe('the userscript manager stand-in', function() {
  function fakeChrome(saved) {
    const stored = Object.assign({}, saved);
    const ports = [];
    return {
      stored: stored, ports: ports,
      storage: { local: { get: async function() { return Object.assign({}, stored); }, set: async function(item) { Object.assign(stored, item); } } },
      runtime: { connect: function(info) { const pair = portPair(info.name); ports.push(pair); return pair.content; } }
    };
  }

  it('reads its settings once, answers from memory, and writes changes back', async function() {
    const api = fakeChrome({ lastScans: '{"a":1}' });
    const gm = await shim.load(api);
    assert.equal(gm.GM_getValue('lastScans', null), '{"a":1}');
    assert.equal(gm.GM_getValue('missing', 'fallback'), 'fallback');
    gm.GM_setValue('reminder', '{"off":true}');
    assert.equal(gm.GM_getValue('reminder', null), '{"off":true}', 'at once');
    await waitFor(function() { return api.stored.reminder; });
    assert.equal(api.stored.reminder, '{"off":true}');
  });

  it('survives storage that fails', async function() {
    const api = fakeChrome({});
    api.storage.local.set = function() { return Promise.reject(new Error('quota')); };
    const gm = await shim.load(api);
    assert.doesNotThrow(function() { gm.GM_setValue('a', 'b'); });
    assert.equal(gm.GM_getValue('a', null), 'b');
  });

  it('gets a page through the background script, in pieces, and can stop it', async function() {
    const api = fakeChrome({});
    const gm = await shim.load(api);
    const stream = streamOf(['<html>', 'x"playabilityStatus":{"status":"UNPLAYABLE"}', 'a', 'b', 'c', 'd']);
    const events = [];
    let request;
    request = gm.GM_xmlhttpRequest({
      method: 'GET', url: WATCH, anonymous: true, timeout: 5000, headers: { 'Accept-Language': 'en' }, progressWhen: MARKER,
      onprogress: function(response) { events.push(['progress', response.status, response.responseText.indexOf('UNPLAYABLE') !== -1]); request.abort(); },
      onload: function() { events.push(['load']); },
      onerror: function() { events.push(['error']); },
      ontimeout: function() { events.push(['timeout']); }
    });
    background.listen({ runtime: { onConnect: { addListener: function(fn) { fn(api.ports[0].background); } } } }, stream.fetch);
    await waitFor(function() { return events.length > 0; });
    await new Promise(function(resolve) { setTimeout(resolve, 50); });

    assert.deepEqual(events, [['progress', 200, true]], 'told once, and nothing after it was stopped');
    assert.ok(stream.state.read < 6, 'the download stopped (' + stream.state.read + ' of 6 pieces)');
  });

  it('gives the whole page when asked for nothing in particular, and says when something went wrong', async function() {
    const api = fakeChrome({});
    const gm = await shim.load(api);
    const events = [];
    gm.GM_xmlhttpRequest({ url: WATCH, headers: {}, timeout: 5000, onload: function(r) { events.push(['load', r.status, r.responseText, r.finalUrl]); }, onerror: function() { events.push(['error']); } });
    background.listen({ runtime: { onConnect: { addListener: function(fn) { fn(api.ports[0].background); } } } }, streamOf(['one ', 'two'], { finalUrl: 'https://www.google.com/sorry/x' }).fetch);
    await waitFor(function() { return events.length > 0; });
    assert.deepEqual(events, [['load', 200, 'one two', 'https://www.google.com/sorry/x']]);

    const failing = fakeChrome({});
    const gm2 = await shim.load(failing);
    const second = [];
    gm2.GM_xmlhttpRequest({ url: WATCH, headers: {}, onerror: function() { second.push('error'); } });
    failing.ports[0].background.disconnect();   // the background script going away without an answer
    await waitFor(function() { return second.length > 0; });
    assert.deepEqual(second, ['error']);

    const noRuntime = { storage: failing.storage, runtime: { connect: function() { throw new Error('no background'); } } };
    const gm3 = await shim.load(noRuntime);
    const third = [];
    gm3.GM_xmlhttpRequest({ url: WATCH, headers: {}, onerror: function() { third.push('error'); } });
    await waitFor(function() { return third.length > 0; });
  });

  it('gives up when the page takes too long', async function() {
    const api = fakeChrome({});
    const gm = await shim.load(api);
    const events = [];
    gm.GM_xmlhttpRequest({ url: WATCH, headers: {}, timeout: 20, onload: function() { events.push('load'); }, ontimeout: function() { events.push('timeout'); } });
    await waitFor(function() { return events.length > 0; });
    assert.deepEqual(events, ['timeout']);
  });
});

describe('the content script, run as a browser would run it', function() {
  it('draws the panel, keeps its settings in the extension, and finds a blocked video through the background script', async function() {
    const json = function(status, body) { return Promise.resolve({ status: status, json: function() { return Promise.resolve(body); } }); };
    const entries = [{ _id: 'entry3', added: 3, songid: 's3', _song: { _id: 's3', name: 'Artist 3 - Title 3', type: 'youtube', fkid: YT(3) } }];
    const fetchImpl = function(url) {
      url = String(url);
      if (url.indexOf('https://www.youtube.com/oembed') === 0) { return json(200, {}); }
      if (url === 'https://api.queup.net/playlist') { return json(200, { data: [{ _id: 'pl1', name: 'First', totalItems: 1, removed: false }] }); }
      if (/playlist\/pl1\/songs\?page=1$/.test(url)) { return json(200, { data: entries }); }
      if (url.indexOf('https://api.queup.net/song?name=') === 0) { return json(200, { data: { items: [] } }); }
      return json(404, null);
    };

    const stored = {};
    const ports = [];
    const chrome = {
      storage: { local: { get: async function() { return Object.assign({}, stored); }, set: async function(item) { Object.assign(stored, item); } } },
      runtime: { connect: function(info) { const pair = portPair(info.name); ports.push(pair); background.serve(pair.background, { url: WATCH.replace('abcdefghijk', YT(3).slice(0, 11)), headers: {}, progressWhen: MARKER }, streamOf(['<html>"playabilityStatus":{"status":"UNPLAYABLE"}', 'x']).fetch); return pair.content; } }
    };
    // the pretend browser skips every wait, except the long ones (the time allowed for a page), which are real and never reached
    const realSetTimeout = setTimeout;
    const timers = {
      setTimeout: function(fn, ms) { if (ms >= 10000) { const t = realSetTimeout(fn, ms); t.unref(); return t; } return setImmediate(fn); },
      clearTimeout: function(t) { if (t && t._onTimeout !== undefined) { clearTimeout(t); } else if (t) { clearImmediate(t); } }
    };
    const browser = fakeBrowser(fetchImpl, true, undefined, Object.assign({ chrome: chrome }, timers));
    vm.runInContext(files['chrome/content.js'], browser.context);

    await waitFor(function() { return browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; }).length > 0; });
    const shadow = browser.page.find(function(n) { return n.id === 'queup-dead-song-finder'; })[0].shadow;
    const button = function(text) { return shadow.find(function(n) { return n.tagName === 'button' && n.textContent === text; })[0]; };

    await button('Dead songs').click();
    await waitFor(function() { return shadow.find(function(n) { return n.tagName === 'option'; }).length > 0; });
    await button('Scan all playlists').click();
    assert.match(shadow.textContent, /Checked 1 of 1 playlists \(1 song\): 1 dead/, 'the video the page check calls unplayable is found');
    assert.ok(ports.length >= 1, 'the watch page went through the background script');
    assert.ok(stored.playlists && stored.lastScans && stored.report, 'settings and the report are kept in the extension storage: ' + Object.keys(stored));
  });
});
