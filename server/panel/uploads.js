'use strict';
// Penyimpanan foto produk di DATA_DIR/uploads. Jenis berkas ditentukan dari isi (magic bytes), bukan dari header klien.
const fs = require('fs');
const path = require('path');
const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'uploads');
fs.mkdirSync(DIR, { recursive: true });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const kind = (b) => (b.length < 16 ? null : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b.subarray(0, 8).equals(PNG) ? 'png' : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : null);
module.exports = { DIR, kind, NAME_RE: /^[a-f0-9]{24}\.(jpg|png|webp)$/ };
