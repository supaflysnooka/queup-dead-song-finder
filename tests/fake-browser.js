'use strict';
/** A pretend browser page for the tests: just enough of a document for the panel to draw itself into, and a clock the tests can set */
const vm = require('node:vm');

class FakeNode {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.listeners = {}; this.className = ''; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this._text = ''; }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this._text + this.children.map(function(c) { return c.textContent; }).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(function(c) { return c !== child; }); return child; }
  attachShadow() { this.shadow = new FakeNode('#shadow'); return this.shadow; }
  addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  async click() { for (const fn of this.listeners.click || []) { await fn({}); } }
  find(predicate, out) { out = out || []; if (predicate(this)) { out.push(this); } this.children.forEach(function(c) { if (c.find) { c.find(predicate, out); } }); return out; }
  querySelectorAll(selector) { const onlyChecked = /:checked/.test(selector || ''); return this.find(function(n) { return n.tagName === 'input' && n.type === 'checkbox' && (!onlyChecked || n.checked); }); }
}

/** a clock the tests can set, for the code that looks at what day it is */
const clock = { now: Date.UTC(2026, 9, 15, 12) };
class FakeDate extends Date {
  constructor(...args) { if (args.length === 0) { super(clock.now); } else { super(...args); } }
  static now() { return clock.now; }
}

function fakeBrowser(fetchImpl, confirmAnswer, storage, extra) {
  const page = new FakeNode('html');
  const document = {
    createElement: function(tag) { return new FakeNode(tag); },
    createTextNode: function(text) { const node = new FakeNode('#text'); node._text = text; return node; },
    getElementById: function(id) { return page.find(function(n) { return n.id === id; })[0] || null; },
    documentElement: page,
    execCommand: function() { return true; }
  };
  const window = { confirm: function(question) { window.asked = question; return confirmAnswer; } };
  window.top = window; window.self = window; window.document = document;
  const context = { window: window, document: document, fetch: fetchImpl, URLSearchParams: URLSearchParams, setTimeout: function(fn) { return setImmediate(fn); }, navigator: {}, console: console, Date: FakeDate };
  // the userscript manager's own storage, when the test gives one
  if (storage) {
    context.GM_getValue = function(key, fallback) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : fallback; };
    context.GM_setValue = function(key, value) { storage[key] = value; };
  }
  Object.assign(context, extra || {});
  return { page: page, window: window, context: vm.createContext(context) };
}

function waitFor(condition) {
  return new Promise(function(resolve, reject) {
    var tries = 0;
    (function check() {
      if (condition()) { return resolve(); }
      if (++tries > 2000) { return reject(new Error('timed out waiting')); }
      setImmediate(check);
    })();
  });
}

module.exports = { FakeNode, clock, FakeDate, fakeBrowser, waitFor };
