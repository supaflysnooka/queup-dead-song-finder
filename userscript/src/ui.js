'use strict';
/***********************************************************************
 * ui.js
 * The panel. A "Dead songs" button on QueUp opens it: pick one of your playlists, scan it, read the report,
 * and click Apply to swap in the replacements. Nothing changes until Apply, and Apply asks first.
 *
 * It is drawn inside a shadow container so it can't clash with QueUp's own styling, and every piece of text that
 * comes from a song is put in with textContent, never as HTML, so a strangely named song can't do anything to the page.
 */

var API = 'https://api.queup.net/';
// the part of a YouTube watch page that says whether the video can be played
var PLAYABILITY_MARKER = '"playabilityStatus":\\{"status":"[A-Z_]+"';
var VERSION = '0.2.0';

var CSS = [
  ':host { all: initial; }',
  '* { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }',
  '.open { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; background: #3b82f6; color: #fff; border: 0; border-radius: 20px; padding: 8px 14px; font-size: 13px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.4); }',
  '.panel { position: fixed; left: 16px; bottom: 60px; z-index: 2147483001; width: 460px; max-width: calc(100vw - 32px); max-height: 75vh; overflow: auto; background: #1b1d23; color: #e8e8e8; border: 1px solid #3a3d46; border-radius: 10px; padding: 14px; font-size: 13px; line-height: 1.4; box-shadow: 0 6px 24px rgba(0,0,0,.6); }',
  '.panel[hidden] { display: none; }',
  'h2 { margin: 0 0 6px; font-size: 15px; display: flex; justify-content: space-between; align-items: center; }',
  'p { margin: 6px 0; color: #b8bcc6; }',
  'label { display: block; margin: 8px 0 3px; color: #b8bcc6; }',
  'select, input[type=number] { width: 100%; background: #12141a; color: #e8e8e8; border: 1px solid #3a3d46; border-radius: 6px; padding: 6px; }',
  '.row { display: flex; gap: 8px; } .row > div { flex: 1; }',
  'button { background: #2b2f3a; color: #e8e8e8; border: 1px solid #3a3d46; border-radius: 6px; padding: 6px 12px; cursor: pointer; margin: 8px 6px 0 0; }',
  'button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }',
  'button.danger { background: #b4443a; border-color: #b4443a; color: #fff; }',
  'button:disabled { opacity: .45; cursor: default; }',
  '.bar { height: 6px; background: #12141a; border-radius: 3px; margin-top: 8px; overflow: hidden; } .bar > div { height: 100%; width: 0; background: #3b82f6; }',
  '.status { margin-top: 8px; color: #e8e8e8; }',
  '.items { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }',
  '.item { border: 1px solid #3a3d46; border-radius: 6px; padding: 8px; display: flex; gap: 8px; }',
  '.item .what { flex: 1; min-width: 0; overflow-wrap: anywhere; } .dead { color: #ff8f86; } .why { color: #8d93a1; } .none { color: #d9b36a; }',
  'a { color: #7db3ff; }',
  '.check { margin: 0; display: flex; gap: 6px; align-items: center; color: #b8bcc6; }',
  '.close { margin: 0; padding: 2px 8px; }',
  '.pics { display: flex; gap: 4px; flex-shrink: 0; }',
  '.pic { width: 72px; height: 54px; border-radius: 4px; background: #12141a; object-fit: cover; display: block; }',
  '.pic.gone { display: flex; align-items: center; justify-content: center; font-size: 10px; color: #7d8391; border: 1px dashed #3a3d46; text-align: center; }',
  '.elsewhere a { margin-right: 10px; color: #8ab4f8; }',
  '.badge { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 9px; margin: 3px 6px 0 0; }',
  '.badge.possible { background: #7a5b14; color: #ffe2a0; } .badge.same { background: #1f5d3a; color: #b8f2cf; } .badge.different { background: #3a3d46; color: #b8bcc6; }',
  '.count { margin-left: 6px; color: #8d93a1; }',
  '.warn { color: #ffb347; font-weight: 600; } .close { color: #d9c27a; }',
  '.from { color: #7db3ff; font-size: 12px; }',
  '.tried { margin-top: 4px; } .tried summary { cursor: pointer; color: #7db3ff; font-size: 12px; } .tried .why { margin: 3px 0; overflow-wrap: anywhere; }',
  '.resume { margin: 8px 0; padding: 8px; border: 1px solid #3b82f6; border-radius: 6px; font-size: 12px; } .resume[hidden] { display: none; }',
  '.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #ff5a4f; margin-left: 7px; vertical-align: middle; box-shadow: 0 0 0 2px rgba(255,255,255,.35); } .dot[hidden] { display: none; }',
  '.reminder { margin: 8px 0; padding: 8px; border: 1px solid #3a3d46; border-radius: 6px; font-size: 12px; } .reminder .due { color: #ffb347; margin-top: 4px; }',
  '.link { background: none; border: 0; padding: 0; margin: 4px 12px 0 0; color: #8ab4f8; text-decoration: underline; cursor: pointer; font-size: 12px; }',
  '.reminder-note { margin: 8px 0; font-size: 12px; color: #7d8391; }',
  '.copy { margin: 4px 0; align-items: flex-start; } .copy input { margin-top: 3px; }',
  '.tiny { margin-top: 10px; font-size: 11px; color: #7d8391; }'
].join('\n');

function el(tag, props, children) {
  var node = document.createElement(tag);
  Object.keys(props || {}).forEach(function(key) {
    if (key === 'text') { node.textContent = props[key]; }
    else if (key === 'class') { node.className = props[key]; }
    else { node[key] = props[key]; }
  });
  (children || []).forEach(function(child) { node.appendChild(child); });
  return node;
}

/** the calls the core makes, done in the browser: the person's own session for QueUp, no cookies for anyone else */
function makeIo(core) {
  var hasGM = typeof GM_xmlhttpRequest === 'function';

  return {
    config: { confirmMs: 1500, checkMs: 350, apiMs: 450 },
    sleep: function(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); },

    api: function(method, path, form) {
      var options = { method: method, credentials: 'include' };
      if (form) { options.body = new URLSearchParams(form); }
      return fetch(API + path, options)
        .then(function(response) {
          return response.json().then(function(body) { return { code: response.status, body: body }; }, function() { return { code: response.status, body: null }; });
        })
        .catch(function() { return { code: 0, body: null }; });
    },

    status: function(url) {
      return fetch(url, { credentials: 'omit', cache: 'no-store' })
        .then(function(response) { return response.status; })
        .catch(function() { return 0; });
    },

    // a small fingerprint of a picture, to tell if two are the same cover. YouTube's picture server lets a page read the pixels.
    // A picture that isn't there (a gone video) answers with an error and a grey box, and that has no fingerprint
    imageHash: typeof createImageBitmap === 'function' ? function(url) {
      return fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(function(response) { return response.ok ? response.blob() : null; })
        .then(function(blob) { return blob ? createImageBitmap(blob) : null; })
        .then(function(bitmap) {
          if (!bitmap) { return null; }
          var canvas = document.createElement('canvas');
          canvas.width = 9;
          canvas.height = 8;
          var context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0, 9, 8);
          var data = context.getImageData(0, 0, 9, 8).data;
          var grey = [];
          for (var i = 0; i < 72; i++) { grey.push(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]); }
          return core.dHash(grey);
        })
        .catch(function() { return null; });
    } : null,

    // a little storage for the dates of the last scans: the userscript manager's own, which the page can't read. Memory only without it
    store: (function() {
      var memory = {};
      var hasStorage = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
      return {
        get: function(key, fallback) {
          if (!hasStorage) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback; }
          try {
            var raw = GM_getValue(key, null);
            return typeof raw === 'string' ? JSON.parse(raw) : fallback;
          } catch (error) { return fallback; }
        },
        set: function(key, value) {
          if (!hasStorage) { memory[key] = value; return; }
          try { GM_setValue(key, JSON.stringify(value)); } catch (error) { /* a reminder that can't be saved is not worth a failure */ }
        }
      };
    })(),

    // the watch page can't be read by a web page, only through the userscript manager, which is why this one is optional
    page: hasGM ? function(url) {
      return new Promise(function(resolve) {
        var finished = false;
        var request = null;
        function finish(value) {
          if (finished) { return; }
          finished = true;
          resolve(value);
        }
        // the answer is about 60% of the way into a page of over a megabyte, so reading stops as soon as it is there
        var marker = new RegExp(PLAYABILITY_MARKER);
        request = GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          anonymous: true,
          timeout: 15000,
          headers: { 'Accept-Language': 'en-US,en;q=0.9' },
          // only the browser extension looks at this one: it sends the page along once this has been read, not as it arrives
          progressWhen: PLAYABILITY_MARKER,
          onprogress: function(response) {
            var text = response && response.responseText;
            if (finished || response.status !== 200 || typeof text !== 'string' || !marker.test(text)) { return; }
            finish({ status: response.status, text: text, finalUrl: response.finalUrl });
            try { if (request && request.abort) { request.abort(); } } catch (error) { /* it's finished either way */ }
          },
          onload: function(response) { finish({ status: response.status, text: response.responseText, finalUrl: response.finalUrl }); },
          onerror: function() { finish(null); },
          ontimeout: function() { finish(null); }
        });
      });
    } : null
  };
}

function start(core, io) {
  io = io || makeIo(core);

  // found: what a scan found, for one playlist or all of them: {multi, scans: [{playlist, scan}], rows: [{item, playlist}], stopped}
  // stopLevel: 0 running, 1 stop checking (replacements for what was found are still looked for), 2 stop that too
  var state = { playlists: [], found: null, dupes: null, running: false, stopLevel: 0 };

  var host = el('div', { id: 'queup-dead-song-finder' });
  var root = host.attachShadow({ mode: 'open' });
  root.appendChild(el('style', { text: CSS }));

  var reminderDot = el('span', { class: 'dot', title: 'Some of your playlists have not been checked for a while' });
  reminderDot.hidden = true;
  var openButton = el('button', { class: 'open', title: 'Find songs in your playlists that can\'t be played anymore' }, [document.createTextNode('Dead songs'), reminderDot]);
  var panel = el('div', { class: 'panel' });
  panel.hidden = true;

  var closeButton = el('button', { class: 'close', text: 'x', title: 'Close' });
  var playlistSelect = el('select');
  var fromPage = el('input', { type: 'number', min: '1', value: '1' });
  var maxPages = el('input', { type: 'number', min: '1', max: '100', value: '50' });
  var scanButton = el('button', { class: 'primary', text: 'Scan' });
  var scanAllButton = el('button', { text: 'Scan all playlists', title: 'Checks every playlist, one after the other, from page 1' });
  var dupesButton = el('button', { text: 'Find duplicates', title: 'Looks through all your playlists for songs that are in them more than once. Nothing is checked on YouTube or SoundCloud, so it is quick.' });
  var stopButton = el('button', { text: 'Stop' });
  var bar = el('div', {}, [el('div')]);
  bar.className = 'bar';
  var status = el('div', { class: 'status', text: '' });
  var itemsBox = el('div', { class: 'items' });
  var pageOption = el('input', { type: 'checkbox' });
  pageOption.checked = io.store.get('watchPageCheck', true) !== false;
  var pageLabel = el('label', { class: 'check', title: 'The slowest part of a scan. Without it, deleted, private and embedding-off videos are still found, only videos YouTube blocks (usually by country) are missed.' }, [pageOption, el('span', { text: 'Also look for blocked videos (downloads about 0.8 MB per YouTube song)' })]);
  pageLabel.hidden = !io.page;
  var removeOption = el('input', { type: 'checkbox' });
  var removeLabel = el('label', { class: 'check' }, [removeOption, el('span', { text: 'Also remove dead songs that have no replacement' })]);
  var applyButton = el('button', { class: 'danger', text: 'Apply selected' });
  var copyButton = el('button', { text: 'Copy report' });
  var selectAllButton = el('button', { text: 'Select all' });
  var selectNoneButton = el('button', { text: 'Select none' });
  var selectedCount = el('span', { class: 'count', text: '' });
  var resumeText = el('div', { text: '' });
  var resumeButton = el('button', { class: 'primary', text: 'Resume it' });
  var discardButton = el('button', { text: 'Throw it away' });
  var resumeBox = el('div', { class: 'resume' }, [resumeText, el('div', {}, [resumeButton, discardButton])]);
  resumeBox.hidden = true;
  var savedText = el('div', { text: '' });
  var openSavedButton = el('button', { class: 'primary', text: 'Open it' });
  var throwSavedButton = el('button', { text: 'Throw the report away' });
  var savedBox = el('div', { class: 'resume' }, [savedText, el('div', {}, [openSavedButton, throwSavedButton])]);
  savedBox.hidden = true;
  var reminderLast = el('div', { class: 'why', text: '' });
  var reminderDue = el('div', { class: 'due', text: '' });
  var snoozeButton = el('button', { class: 'link', text: 'Remind me in a week' });
  var stopRemindingButton = el('button', { class: 'link', text: 'Stop reminding me' });
  var reminderBox = el('div', { class: 'reminder' }, [reminderLast, reminderDue, el('div', {}, [snoozeButton, stopRemindingButton])]);
  reminderBox.hidden = true;
  // shown instead of the box while reminders are off or paused, so there is a way back
  var reminderNote = el('div', { class: 'reminder-note' });
  var reminderNoteText = el('span', { text: '' });
  var remindAgainButton = el('button', { class: 'link', text: 'Turn reminders back on' });
  reminderNote.appendChild(reminderNoteText);
  reminderNote.appendChild(remindAgainButton);
  reminderNote.hidden = true;
  var removeDupesButton = el('button', { class: 'danger', text: 'Remove ticked copies' });
  var dupesCount = el('span', { class: 'count', text: '' });
  var dupesActions = el('div', {}, [removeDupesButton, dupesCount]);
  dupesActions.hidden = true;
  var resultsActions = el('div', {}, [removeLabel, el('div', {}, [selectAllButton, selectNoneButton, selectedCount]), applyButton, copyButton]);

  panel.appendChild(el('h2', {}, [el('span', { text: 'Dead song finder' }), closeButton]));
  panel.appendChild(el('p', { text: 'Checks your own playlists for songs that can\'t be played anymore, and finds songs that are clearly the same one. Nothing changes until you click Apply.' }));
  panel.appendChild(resumeBox);
  panel.appendChild(savedBox);
  panel.appendChild(reminderBox);
  panel.appendChild(reminderNote);
  panel.appendChild(el('label', { text: 'Playlist' }));
  panel.appendChild(playlistSelect);
  panel.appendChild(el('div', { class: 'row' }, [
    el('div', {}, [el('label', { text: 'Start at page (20 songs a page)' }), fromPage]),
    el('div', {}, [el('label', { text: 'Pages to check' }), maxPages])
  ]));
  panel.appendChild(pageLabel);
  panel.appendChild(el('div', {}, [scanButton, scanAllButton, dupesButton, stopButton]));
  panel.appendChild(bar);
  panel.appendChild(status);
  panel.appendChild(resultsActions);
  panel.appendChild(dupesActions);
  panel.appendChild(itemsBox);
  panel.appendChild(el('div', { class: 'tiny', text: 'Dead song finder ' + VERSION + '. It only talks to queup.net (your own playlists), YouTube and SoundCloud (is the song there). Nothing is sent anywhere else.' }));

  root.appendChild(openButton);
  root.appendChild(panel);

  function selectedPlaylist() {
    return state.playlists.filter(function(playlist) { return playlist.id === playlistSelect.value; })[0] || null;
  }

  function setStatus(text, fraction) {
    status.textContent = text;
    bar.firstChild.style.width = fraction === undefined ? '0' : Math.round(fraction * 100) + '%';
  }

  function refreshButtons() {
    scanButton.disabled = state.running || !selectedPlaylist();
    scanAllButton.disabled = state.running || state.playlists.length === 0;
    dupesButton.disabled = state.running || state.playlists.length === 0;
    stopButton.disabled = !state.running;
    var ticked = itemsBox.querySelectorAll('input[type=checkbox]:checked').length;
    var hasItems = !!(state.found && state.found.rows.length);
    applyButton.disabled = state.running || !hasItems || ticked === 0;
    copyButton.disabled = state.running || !state.found;
    selectedCount.textContent = hasItems ? ticked + ' selected' : '';
    selectAllButton.disabled = state.running || !hasItems;
    selectNoneButton.disabled = state.running || !hasItems || ticked === 0;
    resultsActions.hidden = !state.found || (!hasItems && !state.found.scans.length);
    var dupeTicks = state.dupes ? itemsBox.querySelectorAll('input[type=checkbox]:checked').length : 0;
    dupesActions.hidden = !state.dupes || state.dupes.copies.length === 0;
    removeDupesButton.disabled = state.running || dupeTicks === 0;
    dupesCount.textContent = state.dupes ? dupeTicks + ' ticked' : '';
    playlistSelect.disabled = state.running;
    refreshSaved();
  }

  /** offers to carry on a scan that was interrupted (the tab was closed, or it was stopped) */
  function refreshResume() {
    var saved = core.loadCheckpoint(io.store, Date.now());
    resumeBox.hidden = !saved || state.running;
    if (saved) { resumeText.textContent = core.describeCheckpoint(saved, Date.now()); }
  }

  /** offers the report of a finished scan that is saved, while no report is on screen */
  function refreshSaved() {
    var report = core.loadReport(io.store, Date.now());
    savedBox.hidden = !report || state.running || !!state.found;
    if (report) { savedText.textContent = core.describeReport(report, Date.now()); }
  }

  /** the dot on the button, and the lines about when playlists were last scanned */
  function refreshReminder() {
    var now = Date.now();
    var reminder = core.reminderStatus(io.store, now);
    var words = core.describeReminder(reminder, now);

    reminderDot.hidden = !reminder.show;
    reminderLast.textContent = words.last;
    reminderDue.textContent = words.due || '';
    reminderDue.hidden = !words.due;
    reminderBox.hidden = !reminder.show;
    reminderNote.hidden = reminder.show || !(reminder.off || reminder.snoozedUntil);
    reminderNoteText.textContent = reminder.off ? 'Reminders are off. ' : 'Reminders are paused until ' + new Date(reminder.snoozedUntil).toISOString().slice(0, 10) + '. ';
  }

  function clearItems() {
    while (itemsBox.firstChild) { itemsBox.removeChild(itemsBox.firstChild); }
  }

  /** a song's picture, or a box that says it is gone: a deleted video loses its picture too */
  function picture(song, title, onShown) {
    var url = core.pictureFor(song);
    var gone = function() { return el('div', { class: 'pic gone', text: 'picture gone', title: title }); };
    if (!url) { return gone(); }

    var image = el('img', { class: 'pic', alt: '', title: title, loading: 'lazy', referrerPolicy: 'no-referrer', src: url });
    var swap = function() { if (image.parentNode) { image.parentNode.replaceChild(gone(), image); } };
    image.onerror = swap;
    // for a video that is gone YouTube sends a small grey box (120 wide) instead of the picture, which is not a picture
    image.onload = function() {
      if (/\/(hq|mq|sd|maxres)default\.jpg$/.test(url) && image.naturalWidth > 0 && image.naturalWidth <= 120) { return swap(); }
      if (onShown) { onShown(); }
    };
    return image;
  }

  /** songs with no replacement can only be ticked when the option to remove them is on */
  function refreshBoxes() {
    itemsBox.querySelectorAll('input[type=checkbox]').forEach(function(box) {
      var row = state.found && state.found.rows[parseInt(box.dataset.index, 10)];
      if (!row) { return; }
      box.disabled = !row.item.replacement && !removeOption.checked;
      if (box.disabled) { box.checked = false; }
    });
    refreshButtons();
  }

  function showItems(found) {
    clearItems();

    found.rows.forEach(function(row, index) {
      var item = row.item;
      var box = el('input', { type: 'checkbox' });
      // only a sure replacement is ticked for the person, a possible one is looked at first
      box.checked = !!item.replacement && item.replacement.confidence !== 'possible';
      box.disabled = !item.replacement && !removeOption.checked;
      box.dataset.index = String(index);
      box.addEventListener('change', refreshButtons);

      var name = core.hasRealName(item.song) ? '"' + item.song.name + '"' : 'an unnamed song (' + item.song.fkid + ')';
      var what = el('div', { class: 'what' }, []);
      if (found.multi) { what.appendChild(el('div', { class: 'from', text: 'in "' + row.playlist.name + '"' })); }
      what.appendChild(el('div', { class: 'dead', text: name }));
      what.appendChild(el('div', { class: 'why', text: item.text }));

      // for a song with no replacement, links to look for it elsewhere: by name, and by picture once the picture has loaded
      var elsewhere = null;
      var onPicture = null;
      if (!item.replacement) {
        var looks = core.lookElsewhere(item.song);
        elsewhere = el('div', { class: 'why elsewhere' }, [document.createTextNode('Look elsewhere: ')]);
        var addLink = function(label, url) {
          elsewhere.appendChild(el('a', { text: label, href: url, target: '_blank', rel: 'noopener noreferrer' }));
          elsewhere.hidden = false;
        };
        elsewhere.hidden = true;
        looks.names.forEach(function(link) { addLink(link.label, link.url); });
        if (looks.imageSearch) { onPicture = function() { if (!elsewhere.imageDone) { elsewhere.imageDone = true; addLink('Search by picture', looks.imageSearch); } }; }
      }

      var pictures = [picture(item.song, 'the dead song', onPicture)];

      if (item.replacement) {
        var replacement = item.replacement;
        var link = core.songLink(replacement);
        if (replacement.otherSite) { what.appendChild(el('div', {}, [el('span', { class: 'badge possible', text: 'on ' + core.PLATFORM_NAMES[String(replacement.type).toLowerCase()] + ' instead' })])); }
        what.appendChild(el('div', {}, [document.createTextNode('instead: '), link
          ? el('a', { text: replacement.name, href: link, target: '_blank', rel: 'noopener noreferrer' })
          : document.createTextNode(replacement.name)]));

        // a length that is a lot different from the dead song's is in a warning colour
        var difference = core.lengthDifference(item.song, replacement);
        var far = difference && difference.level === 'far';
        what.appendChild(el('div', {
          class: 'why' + (far ? ' warn' : difference && difference.level === 'close' ? ' close' : ''),
          text: 'length: ' + core.compareLengths(item.song, replacement) + (far ? ', check this one' : '')
        }));

        if (replacement.confidence === 'possible') {
          what.appendChild(el('div', {}, [el('span', { class: 'badge possible', text: 'possible match, check it' })]));
          what.appendChild(el('div', { class: 'why', text: replacement.note }));
        }
        if (replacement.picture === 'same') { what.appendChild(el('span', { class: 'badge same', text: 'same cover picture' })); }
        if (replacement.picture === 'different') { what.appendChild(el('span', { class: 'badge different', text: 'different picture' })); }

        pictures.push(picture(replacement, 'the replacement'));
      } else {
        what.appendChild(el('div', { class: 'none', text: 'no replacement (' + item.none + ')' }));
        what.appendChild(elsewhere);

        // what the search found and why each result was not taken, so a "no" is never a mystery
        if (item.searched) {
          var lines = [el('summary', { text: 'What was looked at' }), el('div', { class: 'why', text: 'Searched for "' + item.searched + '"' + (item.tried.length ? ', ' + item.tried.length + ' results:' : ', and it found nothing.') })];
          item.tried.forEach(function(result) {
            lines.push(el('div', { class: 'why', text: '- ' + result.name + (result.length ? ' (' + core.formatLength(result.length) + ')' : '') + ': ' + result.verdict }));
          });
          what.appendChild(el('details', { class: 'tried' }, lines));
        }
      }

      itemsBox.appendChild(el('div', { class: 'item' }, [box, el('div', { class: 'pics' }, pictures), what]));
    });
  }

  /** what happened to each song, one line each, so a failure is never hidden in a summary */
  function showResults(results, multi) {
    clearItems();
    results.forEach(function(entry) {
      var result = entry.result;
      var good = result.status === 'replaced' || result.status === 'removed';
      var name = core.hasRealName(result.item.song) ? '"' + result.item.song.name + '"' : 'an unnamed song (' + result.item.song.fkid + ')';
      var lines = [];
      if (multi) { lines.push(el('div', { class: 'from', text: 'in "' + entry.playlist.name + '"' })); }
      lines.push(el('div', { class: good ? '' : 'dead', text: (good ? 'Done: ' : 'Problem: ') + name }));
      lines.push(el('div', { class: 'why', text: result.detail }));
      itemsBox.appendChild(el('div', { class: 'item' }, [el('div', { class: 'what' }, lines)]));
    });
    itemsBox.appendChild(el('div', { class: 'why', text: 'Scanning again after a reload shows what is in the playlists now.' }));
  }

  async function loadPlaylists() {
    setStatus('Loading your playlists...');
    var listed = await core.listPlaylists(io);
    if (listed.error) {
      setStatus(listed.error + '. Are you signed in to QueUp?');
      return;
    }

    state.playlists = listed.playlists;
    core.rememberPlaylists(io.store, state.playlists);
    refreshReminder();
    while (playlistSelect.firstChild) { playlistSelect.removeChild(playlistSelect.firstChild); }
    state.playlists.forEach(function(playlist) {
      var count = playlist.totalItems === null ? '' : ' (' + playlist.totalItems + (playlist.totalItems === 1 ? ' song)' : ' songs)');
      playlistSelect.appendChild(el('option', { value: playlist.id, text: playlist.name + count }));
    });
    setStatus(state.playlists.length ? 'Pick a playlist and click Scan, or Scan all playlists.' : 'You have no playlists.');
    refreshButtons();
  }

  /** about how long scanning these playlists takes, and what is checked: the pages given, a song a second or two */
  function estimate(playlists, pages) {
    var songs = playlists.reduce(function(total, playlist) {
      var size = playlist.totalItems === null ? pages * core.PAGE_SIZE : playlist.totalItems;
      return total + Math.min(size, pages * core.PAGE_SIZE);
    }, 0);
    return { songs: songs, minutes: Math.max(1, Math.ceil(songs * 1.6 / 60)) };
  }

  /** scans one playlist, or every playlist (multi), or carries on a saved scan */
  async function runScans(multi, saved) {
    if (state.running) { return; }

    var playlists;
    var from;
    var pages;
    io.usePage = pageOption.checked;

    if (saved) {
      // carrying on: the same playlists and pages as the scan that was interrupted
      playlists = saved.playlists.slice();
      from = saved.fromPage;
      pages = saved.maxPages;
      multi = saved.multi;
    } else {
      // an empty playlist has nothing to check
      playlists = multi ? state.playlists.filter(function(playlist) { return playlist.totalItems !== 0; }) : [selectedPlaylist()];
      if (!playlists[0]) { return; }

      from = multi ? 1 : Math.max(1, parseInt(fromPage.value, 10) || 1);
      pages = Math.min(100, Math.max(1, parseInt(maxPages.value, 10) || 50));

      if (multi) {
        var guess = estimate(playlists, pages);
        var ok = window.confirm('Scan all ' + playlists.length + ' playlists?\n\nAbout ' + guess.songs + ' songs, which takes roughly ' + guess.minutes + (guess.minutes === 1 ? ' minute' : ' minutes') + '. Up to ' + pages + ' pages (' + pages * core.PAGE_SIZE + ' songs) of each playlist are checked. You can press Stop at any time and keep what was found, and carry on later.\n\n' + (io.page && io.usePage ? 'Looking for blocked videos downloads up to about ' + Math.ceil(guess.songs * 0.8 / 100) * 100 + ' MB (untick the box under Pages to check to skip that).\n\n' : '') + 'Nothing is changed by a scan.');
        if (!ok) { return; }
      }
    }

    state.running = true;
    state.stopLevel = 0;
    state.found = null;
    state.dupes = null;
    clearItems();
    refreshButtons();
    refreshResume();

    var label = '';

    try {
      var all = await core.scanAll(io, playlists, {
        fromPage: from,
        maxPages: pages,
        resume: saved ? saved.resume : null,
        shouldStop: function() { return state.stopLevel >= 1; },
        shouldCancel: function() { return state.stopLevel >= 2; },
        // where the scan has got to is saved as it goes, so closing the tab does not lose it
        onCheckpoint: function(progress) { core.saveCheckpoint(io.store, { multi: multi, fromPage: from, maxPages: pages, playlists: playlists, resume: progress }, Date.now()); },
        onPlaylist: function(info) { label = multi ? 'Playlist ' + (info.index + 1) + ' of ' + info.total + ', "' + info.playlist.name + '": ' : ''; },
        onProgress: function(info) {
          if (info.stage === 'reading') { setStatus(label + 'Reading the playlist... ' + info.done + ' songs so far'); }
          if (info.stage === 'checking') { setStatus(label + 'Checking song ' + (info.done + 1) + ' of ' + info.total + ' (' + info.dead + ' dead so far)', info.done / info.total); }
          if (info.stage === 'searching') { setStatus(label + 'Looking for replacements ' + (info.done + 1) + ' of ' + info.total, info.done / info.total); }
        }
      });

      // a scan that stopped before the end can be carried on, one that finished has nothing left to do
      if (all.resume) {
        core.saveCheckpoint(io.store, { multi: multi, fromPage: from, maxPages: pages, playlists: playlists, resume: all.resume }, Date.now());
      } else {
        core.clearCheckpoint(io.store);
      }

      var rows = [];
      all.results.forEach(function(entry) {
        if (!entry.scan.error) { entry.scan.items.forEach(function(item) { rows.push({ item: item, playlist: entry.playlist }); }); }
      });
      // a playlist scanned from the first page to the end counts as scanned today
      if (from === 1) {
        all.results.forEach(function(entry) {
          if (!entry.scan.error && entry.scan.finished && !entry.scan.stopped) { core.recordScan(io.store, entry.playlist, Date.now()); }
        });
        refreshReminder();
      }
      state.found = { multi: multi, scans: all.results, rows: rows, stopped: all.stopped };
      showItems(state.found);
      var summary = summarize(state.found, playlists);
      setStatus(summary + (all.resume ? ' It can be carried on from the box at the top.' : ''), 1);
      // kept, so a reload doesn't lose what the scan found
      core.saveReport(io.store, state.found, summary, Date.now());

      // one playlist that was not finished: carry on from the next page next time
      var single = all.results[0] && all.results[0].scan;
      if (!multi && single && !single.error && !single.finished && !single.stopped) { fromPage.value = String(single.nextPage); }
    } catch (error) {
      setStatus('Sorry, something went wrong: ' + (error && error.message || error));
    }

    state.running = false;
    refreshButtons();
    refreshResume();
  }

  /** a group of copies: one line for each, with a box to take that copy out */
  function showDuplicates(dupes) {
    clearItems();
    dupes.copies = [];

    var addGroup = function(group, badgeText, badgeClass) {
      var lines = [el('div', {}, [el('span', { class: 'badge ' + badgeClass, text: badgeText })]), el('div', { class: 'dead', text: group.name })];
      group.copies.forEach(function(copy) {
        var box = el('input', { type: 'checkbox' });
        box.checked = copy.suggested;
        box.dataset.copy = String(dupes.copies.length);
        dupes.copies.push(copy);
        box.addEventListener('change', function() {
          // every copy of a song can't be ticked: the last one stays
          var boxes = lines.map(function(line) { return line.copyBox; }).filter(Boolean);
          if (boxes.length && boxes.every(function(one) { return one.checked; })) { box.checked = false; }
          refreshButtons();
        });

        var link = core.songLink(copy.song);
        var length = copy.song.length ? ' (' + core.formatLength(copy.song.length) + ')' : '';
        var label = el('label', { class: 'check copy' }, [box, el('span', {}, [
          document.createTextNode('in "' + copy.playlist.name + '"' + (core.PLATFORM_NAMES[String(copy.song.type).toLowerCase()] ? ', ' + core.PLATFORM_NAMES[String(copy.song.type).toLowerCase()] : '') + length + ' ')
        ])]);
        if (link) { label.lastChild.appendChild(el('a', { text: 'open', href: link, target: '_blank', rel: 'noopener noreferrer' })); }
        if (group.kind === 'similar' && copy.song.name !== group.name) { label.lastChild.appendChild(el('div', { class: 'why', text: copy.song.name })); }
        label.copyBox = box;
        lines.push(label);
      });
      itemsBox.appendChild(el('div', { class: 'item' }, [el('div', { class: 'what' }, lines)]));
    };

    dupes.exact.forEach(function(group) {
      var inOne = group.copies.every(function(copy) { return copy.playlist.id === group.copies[0].playlist.id; });
      addGroup(group, inOne ? 'twice in one playlist' : 'in ' + new Set(group.copies.map(function(copy) { return copy.playlist.id; })).size + ' playlists', 'same');
    });
    dupes.similar.forEach(function(group) { addGroup(Object.assign({ kind: 'similar' }, group), 'looks like the same song, different upload: check it', 'possible'); });
  }

  /** reads every playlist and lists the songs that are in more than one place */
  async function runDuplicates() {
    if (state.running || state.playlists.length === 0) { return; }

    state.running = true;
    state.stopLevel = 0;
    state.found = null;
    state.dupes = null;
    clearItems();
    refreshButtons();

    try {
      var got = await core.readAllPlaylists(io, state.playlists, {
        shouldStop: function() { return state.stopLevel >= 1; },
        onProgress: function(info) { setStatus('Playlist ' + (info.index + 1) + ' of ' + info.total + ', "' + info.playlist.name + '": read ' + info.done + ' songs', info.index / info.total); }
      });

      var groups = core.groupDuplicates(got.read);
      state.dupes = { exact: groups.exact, similar: groups.similar, copies: [] };
      showDuplicates(state.dupes);

      var text = 'Read ' + songsText(groups.songs) + ' in ' + got.read.length + ' playlists: ' + groups.exact.length + ' song' + (groups.exact.length === 1 ? ' is' : 's are') + ' in more than one place, ' + groups.similar.length + ' look' + (groups.similar.length === 1 ? 's' : '') + ' like another upload of the same song.';
      if (state.dupes.copies.length === 0) { text = 'Read ' + songsText(groups.songs) + ' in ' + got.read.length + ' playlists: no duplicates.'; }
      if (got.stopped) { text += ' Stopped before the end, so some playlists were not read.'; }
      if (got.failed.length) { text += ' Could not read: ' + got.failed.map(function(name) { return '"' + name + '"'; }).join(', ') + '.'; }
      if (state.dupes.copies.length) { text += ' Ticked copies are extra ones in the same playlist. Copies in other playlists are not ticked, playlists often share songs on purpose. One copy of every song always stays.'; }
      setStatus(text, 1);
    } catch (error) {
      setStatus('Sorry, something went wrong: ' + (error && error.message || error));
    }

    state.running = false;
    refreshButtons();
  }

  async function runRemoveDuplicates() {
    var dupes = state.dupes;
    if (!dupes || state.running) { return; }

    var ticked = {};
    itemsBox.querySelectorAll('input[type=checkbox]:checked').forEach(function(box) { ticked[box.dataset.copy] = true; });
    var isPicked = function(copy) { return !!ticked[String(dupes.copies.indexOf(copy))]; };
    var removals = core.safeRemovals(dupes.exact.concat(dupes.similar), isPicked);
    if (removals.length === 0) { return; }

    var names = {};
    removals.forEach(function(one) { names[one.playlist.id] = true; });
    if (!window.confirm('Take ' + removals.length + (removals.length === 1 ? ' extra copy' : ' extra copies') + ' out of ' + Object.keys(names).length + ' playlist' + (Object.keys(names).length === 1 ? '' : 's') + '?\n\nOne copy of every song stays. Nothing is added.')) { return; }

    state.running = true;
    state.stopLevel = 0;
    refreshButtons();

    try {
      var done = await core.removeCopies(io, removals, {
        shouldStop: function() { return state.stopLevel >= 1; },
        onProgress: function(info) { setStatus('Removing ' + (info.done + 1) + ' of ' + info.total + '...', info.done / info.total); }
      });

      var fine = done.results.filter(function(entry) { return entry.status === 'removed'; });
      var problems = done.results.filter(function(entry) { return entry.status === 'failed'; });
      var text = 'Done: ' + fine.length + ' of ' + removals.length + ' copies taken out.';
      var counts = Object.keys(done.totals).map(function(id) {
        var playlist = state.playlists.filter(function(one) { return one.id === id; })[0];
        return '"' + (playlist ? playlist.name : id) + '" has ' + done.totals[id] + ' songs now';
      });
      if (counts.length) { text += ' ' + counts.join(', ') + '.'; }
      if (problems.length) { text += ' Problems: ' + problems.map(function(entry) { return (core.hasRealName(entry.song) ? entry.song.name : entry.song.fkid) + ' in "' + entry.playlist.name + '": ' + entry.detail; }).join('; ') + '.'; }
      text += ' Reload QueUp to see the changes, and click Find duplicates again to look again.';
      setStatus(text, 1);
      state.dupes = null;
      clearItems();
    } catch (error) {
      setStatus('Sorry, something went wrong: ' + (error && error.message || error));
    }

    state.running = false;
    refreshButtons();
  }

  /** "1 song", "5 songs" */
  function songsText(count) {
    return count + (count === 1 ? ' song' : ' songs');
  }

  function summarize(found, asked) {
    var good = found.scans.filter(function(entry) { return !entry.scan.error; });
    var broken = found.scans.filter(function(entry) { return entry.scan.error; });
    var withReplacement = found.rows.filter(function(row) { return row.item.replacement; }).length;
    var scanned = good.reduce(function(total, entry) { return total + entry.scan.scanned; }, 0);
    var text;

    if (!found.multi) {
      if (broken.length) { return 'Sorry, ' + broken[0].scan.error; }
      var one = good[0];
      if (!one) { return 'That playlist is empty.'; }
      text = 'Checked ' + songsText(one.scan.scanned) + ' in "' + one.playlist.name + '": ' + found.rows.length + ' dead, ' + withReplacement + ' with a replacement.';
      if (one.scan.stopped) { text += ' Stopped: ' + one.scan.stopped + '.'; }
      if (!one.scan.finished && !one.scan.stopped) { text += ' There are more songs, the start page is set to ' + one.scan.nextPage + ' to carry on.'; }
      if (found.rows.length === 0 && !one.scan.stopped) { text += ' Nothing is dead here.'; }
      return text;
    }

    text = 'Checked ' + good.length + ' of ' + asked.length + ' playlists (' + songsText(scanned) + '): ' + found.rows.length + ' dead, ' + withReplacement + ' with a replacement.';
    if (found.stopped) { text += ' Stopped: ' + found.stopped + '.'; }
    var partial = good.filter(function(entry) { return !entry.scan.finished && !entry.scan.stopped; });
    if (partial.length) { text += ' Not checked to the end (scan each on its own to carry on): ' + partial.map(function(entry) { return '"' + entry.playlist.name + '" (to page ' + (entry.scan.nextPage - 1) + ')'; }).join(', ') + '.'; }
    if (broken.length) { text += ' Could not read: ' + broken.map(function(entry) { return '"' + entry.playlist.name + '"'; }).join(', ') + '.'; }
    if (found.rows.length === 0 && !found.stopped) { text += ' Nothing is dead.'; }
    return text;
  }

  async function runApply() {
    var found = state.found;
    if (!found || state.running) { return; }

    var chosen = [];
    itemsBox.querySelectorAll('input[type=checkbox]:checked').forEach(function(box) { chosen.push(found.rows[parseInt(box.dataset.index, 10)]); });
    if (chosen.length === 0) { return; }

    // the songs of each playlist together, in the order they were found
    var groups = [];
    var byId = {};
    chosen.forEach(function(row) {
      var group = byId[row.playlist.id];
      if (!group) { group = byId[row.playlist.id] = { playlist: row.playlist, items: [] }; groups.push(group); }
      group.items.push(row.item);
    });

    var removing = removeOption.checked;
    var withReplacement = chosen.filter(function(row) { return row.item.replacement; }).length;
    var where = groups.length === 1 ? 'in "' + groups[0].playlist.name + '"' : 'across ' + groups.length + ' playlists';
    var question = 'Swap in ' + withReplacement + ' replacement' + (withReplacement === 1 ? '' : 's') + ' ' + where + '?\n\nEach replacement is added first, and the dead song is only taken out once that worked.' +
      (removing ? '\n\nDead songs without a replacement will be REMOVED.' : '');
    if (!window.confirm(question)) { return; }

    state.running = true;
    state.stopLevel = 0;
    refreshButtons();

    try {
      var allResults = [];
      var totals = [];
      var totalFor = {};
      var offset = 0;

      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var done = await core.apply(io, group.playlist, group.items, {
          removeWithoutReplacement: removing,
          shouldStop: function() { return state.stopLevel >= 1; },
          onProgress: function(info) { setStatus('Swapping ' + (offset + info.done + 1) + ' of ' + chosen.length + '...', (offset + info.done) / chosen.length); }
        });
        done.results.forEach(function(result) { allResults.push({ result: result, playlist: group.playlist }); });
        if (done.totalItems !== null) { totals.push('"' + group.playlist.name + '" has ' + done.totalItems + ' songs now'); totalFor[group.playlist.id] = done.totalItems; }
        offset += group.items.length;
        if (state.stopLevel >= 1) { break; }
      }

      var fine = allResults.filter(function(entry) { return entry.result.status === 'replaced' || entry.result.status === 'removed'; }).length;
      var problems = allResults.filter(function(entry) { return entry.result.status === 'add-failed' || entry.result.status === 'remove-failed'; });
      var text;
      if (groups.length === 1) {
        text = 'Done: ' + fine + ' of ' + chosen.length + ' changed in "' + groups[0].playlist.name + '"' + (totalFor[groups[0].playlist.id] !== undefined ? ', it has ' + totalFor[groups[0].playlist.id] + ' songs now' : '') + '.';
      } else {
        text = 'Done: ' + fine + ' of ' + chosen.length + ' changed' + (totals.length ? ', ' + totals.join(', ') : '') + '.';
      }
      if (problems.length) {
        text += ' Problems: ' + problems.map(function(entry) {
          var song = entry.result.item.song;
          return (core.hasRealName(song) ? song.name : song.fkid) + ': ' + entry.result.detail;
        }).join('; ') + '.';
      }
      text += ' Reload QueUp to see the new playlist' + (groups.length === 1 ? '' : 's') + '.';
      setStatus(text, 1);

      core.dropFromReport(io.store, allResults.filter(function(entry) { return entry.result.status === 'replaced' || entry.result.status === 'removed'; })
        .map(function(entry) { return { playlistId: entry.playlist.id, entryId: entry.result.item.entryId }; }), Date.now());

      state.found = null;
      showResults(allResults, groups.length > 1);
    } catch (error) {
      setStatus('Sorry, something went wrong: ' + (error && error.message || error));
    }

    state.running = false;
    refreshButtons();
  }

  /** tick or untick every song that can be ticked, so picking just one is a click on Select none and one box */
  function setAll(on) {
    itemsBox.querySelectorAll('input[type=checkbox]').forEach(function(box) { if (!box.disabled) { box.checked = on; } });
    refreshButtons();
  }

  function copyReport() {
    if (!state.found) { return; }
    var text = core.reportTextAll({ results: state.found.scans });
    var done = function() { setStatus('The report is copied.'); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function() { setStatus('Could not copy, select the text yourself.'); });
    } else {
      var box = el('textarea', { value: text });
      root.appendChild(box);
      box.select();
      try { document.execCommand('copy'); done(); } catch (error) { setStatus('Could not copy.'); }
      root.removeChild(box);
    }
  }

  openButton.addEventListener('click', function() {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && state.playlists.length === 0 && !state.running) { loadPlaylists(); }
  });
  closeButton.addEventListener('click', function() { panel.hidden = true; });
  scanButton.addEventListener('click', function() { return runScans(false); });
  resumeButton.addEventListener('click', function() {
    var saved = core.loadCheckpoint(io.store, Date.now());
    if (saved) { return runScans(saved.multi, saved); }
    refreshResume();
  });
  openSavedButton.addEventListener('click', function() {
    var report = core.loadReport(io.store, Date.now());
    if (!report || state.running) { refreshSaved(); return; }

    var rows = [];
    var scans = report.entries.map(function(entry) {
      entry.scan.items.forEach(function(item) { rows.push({ item: item, playlist: entry.playlist }); });
      return { playlist: entry.playlist, scan: entry.scan };
    });
    state.found = { multi: report.multi, scans: scans, rows: rows, stopped: report.stopped };
    showItems(state.found);
    setStatus('Saved report (' + core.timeAgo(report.savedAt, Date.now()) + '): ' + report.summary + ' The playlists may have changed since.', 1);
    refreshButtons();
  });
  throwSavedButton.addEventListener('click', function() { core.clearReport(io.store); refreshSaved(); });
  discardButton.addEventListener('click', function() { core.clearCheckpoint(io.store); refreshResume(); });
  scanAllButton.addEventListener('click', function() { return runScans(true); });
  dupesButton.addEventListener('click', runDuplicates);
  removeDupesButton.addEventListener('click', runRemoveDuplicates);
  stopButton.addEventListener('click', function() {
    state.stopLevel = Math.min(2, state.stopLevel + 1);
    // the first stop still looks for replacements for what was found, which takes a moment, and a second one skips that
    setStatus(state.stopLevel === 1 ? 'Stopping. Looking for replacements for what was found so far, press Stop again to skip that.' : 'Stopping...');
  });
  applyButton.addEventListener('click', runApply);
  selectAllButton.addEventListener('click', function() { setAll(true); });
  selectNoneButton.addEventListener('click', function() { setAll(false); });
  removeOption.addEventListener('change', refreshBoxes);
  pageOption.addEventListener('change', function() { io.usePage = pageOption.checked; io.store.set('watchPageCheck', pageOption.checked); });
  snoozeButton.addEventListener('click', function() { core.snoozeReminder(io.store, Date.now()); refreshReminder(); });
  stopRemindingButton.addEventListener('click', function() { core.setReminderOff(io.store, true); refreshReminder(); });
  remindAgainButton.addEventListener('click', function() { core.setReminderOff(io.store, false); refreshReminder(); });
  copyButton.addEventListener('click', copyReport);
  playlistSelect.addEventListener('change', function() { state.found = null; state.dupes = null; clearItems(); fromPage.value = '1'; setStatus('Pick a playlist and click Scan, or Scan all playlists.'); refreshButtons(); });

  refreshButtons();
  refreshReminder();
  refreshResume();
  refreshSaved();
  document.documentElement.appendChild(host);
  return { host: host, root: root };
}

module.exports = { start: start, makeIo: makeIo, VERSION: VERSION };
