'use strict';
/***********************************************************************
 * background.js
 * Reads YouTube watch pages for the panel, because a page's own code isn't allowed to. It is only ever asked for
 * https://www.youtube.com/watch?v=<11 characters>, with no cookies, and it stops reading (and stops the download)
 * as soon as the panel says it has what it needs, or goes away.
 */

var WATCH_URL = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;
var MAX_CHARACTERS = 3 * 1000 * 1000;
var MAX_MS = 20 * 1000;

/**
 * Answers one request on a port
 * @param {{postMessage: function, onDisconnect: {addListener: function}}} port
 * @param {{url: string, headers: object, progressWhen: string|null}} request
 * @param {function} fetchImpl
 */
async function serve(port, request, fetchImpl) {
  var gone = false;
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, MAX_MS);
  port.onDisconnect.addListener(function() { gone = true; controller.abort(); });

  function send(message) { if (!gone) { try { port.postMessage(message); } catch (error) { gone = true; } } }

  try {
    if (!request || typeof request.url !== 'string' || !WATCH_URL.test(request.url)) { return send({ type: 'error' }); }

    var when = null;
    if (typeof request.progressWhen === 'string' && request.progressWhen.length < 200) {
      try { when = new RegExp(request.progressWhen); } catch (error) { when = null; }
    }

    var language = request.headers && typeof request.headers['Accept-Language'] === 'string' ? request.headers['Accept-Language'].slice(0, 50) : 'en-US,en;q=0.9';
    var response = await fetchImpl(request.url, { credentials: 'omit', cache: 'no-store', headers: { 'Accept-Language': language }, signal: controller.signal });

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var text = '';
    var told = false;

    while (!gone) {
      var chunk = await reader.read();
      if (chunk.done) { break; }
      text += decoder.decode(chunk.value, { stream: true });

      if (when && !told && when.test(text)) {
        told = true;
        send({ type: 'progress', status: response.status, finalUrl: response.url, text: text });
        // the panel stops the download when it has what it needs, which shows here as the port going away
        await new Promise(function(resolve) { setTimeout(resolve, 0); });
      }
      if (text.length > MAX_CHARACTERS) { break; }
    }

    try { controller.abort(); } catch (error) { /* done anyway */ }
    send({ type: 'load', status: response.status, finalUrl: response.url, text: text });
  } catch (error) {
    send({ type: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

function listen(chromeApi, fetchImpl) {
  chromeApi.runtime.onConnect.addListener(function(port) {
    if (port.name !== 'watch-page') { return; }
    var started = false;
    port.onMessage.addListener(function(request) {
      // one request for each port
      if (started) { return; }
      started = true;
      serve(port, request, fetchImpl);
    });
  });
}

module.exports = { serve: serve, listen: listen, WATCH_URL: WATCH_URL };
