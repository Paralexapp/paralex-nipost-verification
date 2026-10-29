'use strict';
// Usage: npm run logo -- path/to/logo.png   (PNG or JPG). Writes lib/logo.js so the logo is bundled.
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage: npm run logo -- path/to/logo.png'); process.exit(1); }
const buf = fs.readFileSync(file);
const png = buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const jpg = buf[0] === 0xff && buf[1] === 0xd8;
if (!png && !jpg) { console.error('The logo must be a PNG or JPG file.'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'logo.js'),
  "'use strict';\nmodule.exports = '" + buf.toString('base64') + "';\n");
console.log('Logo saved to lib/logo.js (' + Math.round(buf.length / 1024) + ' KB)');
