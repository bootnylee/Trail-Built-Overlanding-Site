import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}

function isExternal(ref) {
  return /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('mailto:') || ref.startsWith('tel:') || ref.startsWith('#');
}

function normalizeRef(ref) {
  return ref.split('#')[0].split('?')[0].trim();
}

function isLikelyImageRef(ref) {
  return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(normalizeRef(ref));
}

function validImage(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 32) return { ok: false, reason: `too small (${buf.length} bytes)` };
  const head = buf.subarray(0, 32).toString('latin1');
  if (head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.includes('<body')) {
    return { ok: false, reason: 'HTML/404 placeholder, not an image' };
  }
  const ext = path.extname(filePath).toLowerCase();
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const gif = buf.subarray(0, 6).toString('ascii').startsWith('GIF');
  const webp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const svg = buf.subarray(0, 256).toString('utf8').includes('<svg');
  const avif = buf.subarray(4, 12).toString('ascii').includes('ftypavif');
  const ok = { '.png': png, '.jpg': jpg, '.jpeg': jpg, '.gif': gif, '.webp': webp, '.svg': svg, '.avif': avif }[ext];
  return ok ? { ok: true } : { ok: false, reason: `invalid ${ext || 'image'} signature` };
}

walk(root);

const refs = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const relFile = path.relative(root, file);
  const attrRegex = /(?:src|href|content)=["']([^"']+)["']/gi;
  const styleRegex = /url\(["']?([^"')]+)["']?\)/gi;
  for (const regex of [attrRegex, styleRegex]) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const raw = match[1].replaceAll('&amp;', '&');
      const clean = normalizeRef(raw);
      if (!clean || isExternal(clean) || !isLikelyImageRef(clean)) continue;
      refs.push({ file, relFile, ref: raw, clean });
    }
  }
}

const unique = new Map();
for (const item of refs) {
  const base = item.clean.startsWith('/') ? root : path.dirname(item.file);
  const abs = path.resolve(base, item.clean.replace(/^\//, ''));
  const key = `${item.relFile}|${item.clean}`;
  unique.set(key, { ...item, abs });
}

const missing = [];
const invalid = [];
for (const item of unique.values()) {
  if (!fs.existsSync(item.abs)) {
    missing.push(item);
    continue;
  }
  const check = validImage(item.abs);
  if (!check.ok) invalid.push({ ...item, reason: check.reason });
}

console.log(`Asset audit: ${htmlFiles.length} HTML files scanned; ${unique.size} local image references checked.`);
if (missing.length) {
  console.log('\nMissing local images:');
  for (const item of missing) console.log(`- ${item.relFile}: ${item.ref} -> ${path.relative(root, item.abs)}`);
}
if (invalid.length) {
  console.log('\nInvalid local images:');
  for (const item of invalid) console.log(`- ${item.relFile}: ${item.ref} -> ${path.relative(root, item.abs)} (${item.reason})`);
}
if (missing.length || invalid.length) {
  console.error(`Asset audit failed: ${missing.length} missing, ${invalid.length} invalid.`);
  process.exit(1);
}
console.log('Asset audit passed: no missing or invalid local image references.');
