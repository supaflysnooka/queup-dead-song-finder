'use strict';
/**
 * Draws the extension's icons (extension/icons/icon-16.png, 48, 128): a blue disc with a white play triangle and a
 * slash through it, for "a song that can't be played". Run it again only to change the picture.
 *
 *   node tools/make-extension-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buffer) {
  var crc = 0xffffffff;
  for (var i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (var k = 0; k < 8; k++) { crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** the colour of a point of the picture, as [r, g, b, a], where x and y go from 0 to 1 */
function colourAt(x, y) {
  var dx = x - 0.5;
  var dy = y - 0.5;
  if (dx * dx + dy * dy > 0.47 * 0.47) { return [0, 0, 0, 0]; }

  // a slash from the bottom left to the top right
  var slash = Math.abs(x + y - 1) < 0.06 && x > 0.18 && x < 0.82;
  // a play triangle
  var inTriangle = x > 0.36 && x < 0.7 && Math.abs(y - 0.5) < (0.7 - x) * 0.85 && (0.7 - x) > 0;
  if (slash) { return [255, 255, 255, 255]; }
  if (inTriangle) { return [255, 255, 255, 255]; }
  return [59, 130, 246, 255];
}

function png(size) {
  var samples = 4;
  var rows = [];
  for (var py = 0; py < size; py++) {
    var row = Buffer.alloc(1 + size * 4);
    for (var px = 0; px < size; px++) {
      var sum = [0, 0, 0, 0];
      for (var sy = 0; sy < samples; sy++) {
        for (var sx = 0; sx < samples; sx++) {
          var c = colourAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          // average with the colour weighted by how see-through each sample is
          sum[0] += c[0] * c[3]; sum[1] += c[1] * c[3]; sum[2] += c[2] * c[3]; sum[3] += c[3];
        }
      }
      var alpha = sum[3] / (samples * samples);
      row[1 + px * 4] = sum[3] ? Math.round(sum[0] / sum[3]) : 0;
      row[2 + px * 4] = sum[3] ? Math.round(sum[1] / sum[3]) : 0;
      row[3 + px * 4] = sum[3] ? Math.round(sum[2] / sum[3]) : 0;
      row[4 + px * 4] = Math.round(alpha);
    }
    rows.push(row);
  }

  var header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bits for each colour
  header[9] = 6;   // red, green, blue and alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

if (require.main === module) {
  var folder = path.join(__dirname, '..', 'extension', 'icons');
  fs.mkdirSync(folder, { recursive: true });
  [16, 48, 128].forEach(function(size) {
    fs.writeFileSync(path.join(folder, 'icon-' + size + '.png'), png(size));
    console.log('wrote icon-' + size + '.png');
  });
}

module.exports = { png: png };
