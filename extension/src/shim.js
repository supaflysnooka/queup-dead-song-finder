'use strict';
/***********************************************************************
 * shim.js
 * The three things the userscript asks its manager for (GM_getValue, GM_setValue, GM_xmlhttpRequest), done by the
 * extension instead, so the panel's code is the same one in both.
 *
 *   - storage: the browser's extension storage, read once at the start and kept in memory (the panel asks for
 *     values without waiting), and written back as they change
 *   - GM_xmlhttpRequest: only for YouTube watch pages. A page's own code can't read those, so the extension's
 *     background script fetches them (see background.js) and this talks to it over a port
 */

/**
 * @param {object} chromeApi `chrome` (or `browser`): storage.local and runtime.connect
 * @returns {Promise<{GM_getValue: function, GM_setValue: function, GM_xmlhttpRequest: function}>}
 */
function load(chromeApi) {
  return Promise.resolve(chromeApi.storage.local.get(null)).then(function(saved) {
    var cache = Object.assign({}, saved || {});

    function GM_getValue(key, fallback) {
      return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback;
    }

    function GM_setValue(key, value) {
      cache[key] = value;
      var item = {};
      item[key] = value;
      // a value that can't be saved is lost on reload, which is not worth a failure
      try { Promise.resolve(chromeApi.storage.local.set(item)).catch(function() {}); } catch (error) { /* same */ }
    }

    function GM_xmlhttpRequest(details) {
      var finished = false;
      var timer = null;
      var port;

      function end() {
        finished = true;
        if (timer) { clearTimeout(timer); }
        try { port.disconnect(); } catch (error) { /* already gone */ }
      }

      try { port = chromeApi.runtime.connect({ name: 'watch-page' }); } catch (error) {
        if (details.onerror) { setTimeout(details.onerror, 0); }
        return { abort: function() {} };
      }

      port.onMessage.addListener(function(message) {
        if (finished || !message) { return; }
        var response = { status: message.status, finalUrl: message.finalUrl, responseText: message.text };
        if (message.type === 'progress') { if (details.onprogress) { details.onprogress(response); } }
        else if (message.type === 'load') { end(); if (details.onload) { details.onload(response); } }
        else if (message.type === 'error') { end(); if (details.onerror) { details.onerror(); } }
      });
      // the background script going away without an answer is an error, but only if nobody ended this already
      port.onDisconnect.addListener(function() {
        if (finished) { return; }
        finished = true;
        if (timer) { clearTimeout(timer); }
        if (details.onerror) { details.onerror(); }
      });

      port.postMessage({ url: details.url, headers: details.headers || {}, progressWhen: details.progressWhen || null });
      if (details.timeout > 0) {
        timer = setTimeout(function() {
          if (finished) { return; }
          end();
          if (details.ontimeout) { details.ontimeout(); }
        }, details.timeout);
      }

      return { abort: function() { if (!finished) { end(); } } };
    }

    return { GM_getValue: GM_getValue, GM_setValue: GM_setValue, GM_xmlhttpRequest: GM_xmlhttpRequest };
  });
}

module.exports = { load: load };
