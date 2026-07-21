import fs from 'fs';
import path from 'path';

const root = process.cwd();
const htmlFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git','node_modules'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.isFile() && p.endsWith('.html')) htmlFiles.push(p);
  }
}
walk(root);

const errors = [];
const affected = [
  'articles/best-overlanding-first-aid-kit-essentials.html',
  'articles/best-overlanding-water-storage-and-filtration.html',
  'articles/best-vehicle-communication-gear-for-overlanding.html'
].map(p => path.join(root, p));

for (const file of htmlFiles) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  if (/(#x1D54F;|&#x1D54F;|&#120143;|𝕏 Twitter)/.test(text)) {
    errors.push(`${rel}: malformed X/Twitter share text found`);
  }
}

for (const file of affected) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const boxes = [...text.matchAll(/<div class="product-box"[\s\S]*?(?=<div class="product-box"|<h2 id="faq"|<p>We ran|<p>When choosing|<\/article>)/g)];
  if (boxes.length < 5) errors.push(`${rel}: expected at least 5 product boxes, found ${boxes.length}`);
  for (const [i, m] of boxes.entries()) {
    const box = m[0];
    if (!/class="product-box-image"/.test(box)) errors.push(`${rel}: product box ${i + 1} missing product image wrapper`);
    if (!/<img [^>]*src="\.\.\/assets\/product-images\//.test(box)) errors.push(`${rel}: product box ${i + 1} missing local product image src`);
    if (!/<img [^>]*alt="[^"]{12,}"/.test(box)) errors.push(`${rel}: product box ${i + 1} missing descriptive image alt text`);
    if (!/href="https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=trailbuiltove-20"/.test(box)) errors.push(`${rel}: product box ${i + 1} missing direct tagged Amazon dp link`);
    if (/amazon\.com\/s\?k=/.test(box)) errors.push(`${rel}: product box ${i + 1} still uses generic Amazon search link`);
  }
}

const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
for (const selector of ['.grid-3 > .card', '.card-footer', '.review-card', '.comparison-card', '.guide-card', '.product-box-image']) {
  if (!css.includes(selector)) errors.push(`css/style.css: missing ${selector} quality-layout rule`);
}
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const reviewsSection = index.match(/<section id="reviews"[\s\S]*?<\/section>/)?.[0] || '';
const homepageCards = [...reviewsSection.matchAll(/class="card"/g)].length;
if (homepageCards < 6) errors.push(`index.html: expected at least 6 homepage gear-review cards, found ${homepageCards}`);
if (/<a[^>]*class="review-card"[\s\S]*<a[^>]*class="review-card"/.test(index)) {
  errors.push('index.html: detected nested review-card anchors');
}
if (homepageCards > 20) {
  errors.push(`index.html: possible nested or duplicated homepage cards detected (${homepageCards} card markers)`);
}

if (errors.length) {
  console.error('Quality check failed:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Quality check passed: ${htmlFiles.length} HTML files scanned; product cards, share text, and card layout guards are valid.`);
