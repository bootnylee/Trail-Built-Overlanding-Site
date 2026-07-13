/**
 * backfill-index.js
 * One-time script: reads each article file that is missing from index.html,
 * extracts its title / description / og:image / datePublished, and inserts
 * a correctly-formatted card using the same robust anchor logic that was
 * added to addArticleToIndex() in generate-article.js.
 *
 * Run from repo root:  node scripts/backfill-index.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT  = path.join(__dirname, '..');
const INDEX_FILE = path.join(REPO_ROOT, 'index.html');
const ARTICLES_DIR = path.join(REPO_ROOT, 'articles');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMeta(articleHtml, attr) {
  // Handles both property="..." and name="..." meta tags
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${attr}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const m = articleHtml.match(re);
  if (m) return m[1];
  // Also try reversed attribute order: content="..." property="..."
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${attr}["']`,
    'i'
  );
  const m2 = articleHtml.match(re2);
  return m2 ? m2[1] : null;
}

function extractTitle(articleHtml) {
  const m = articleHtml.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractDatePublished(articleHtml) {
  const m = articleHtml.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  const m2 = articleHtml.match(/article:published_time[^>]+content="([^"]+)"/);
  return m2 ? m2[1].split('T')[0] : null;
}

function formatDate(isoDate) {
  // "2026-07-13" → "Jul 13, 2026"
  const d = new Date(isoDate + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function buildCard(slug, cleanTitle, description, dateStr, ogImage) {
  return (
`<div class="card">
<div class="card-img"><img src="${ogImage}" alt="${cleanTitle.replace(/"/g, '&quot;')}" loading="lazy" decoding="async"/></div>
<div class="card-body">
<div class="card-meta">
<span class="badge">Gear Guide</span>
<span class="card-date">${dateStr}</span>
</div>
<h3><a href="articles/${slug}.html">${cleanTitle}</a></h3>
<p>${description}</p>
<div class="card-footer">
<a class="read-link" href="articles/${slug}.html">Read More &rarr;</a>
<span class="read-time">12 min</span>
</div>
</div>
</div>`
  );
}

function insertCard(html, card) {
  const ANCHOR_RE = /(<\/section>)(\s*<!-- ===== TOP PRODUCT)/;
  if (!ANCHOR_RE.test(html)) {
    throw new Error(
      'backfill-index: anchor not found — ' +
      'could not locate "</section>" before "<!-- ===== TOP PRODUCT" in index.html. ' +
      'Aborting. Fix the anchor before re-running.'
    );
  }
  const updated = html.replace(ANCHOR_RE, card + '\n$1$2');
  if (updated === html) {
    throw new Error(
      'backfill-index: String.replace produced no change — ' +
      'the anchor regex matched but the substitution was a no-op. Aborting.'
    );
  }
  return updated;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const allArticles = fs.readdirSync(ARTICLES_DIR)
  .filter(f => f.endsWith('.html'))
  .map(f => f.replace('.html', ''));

let indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');

// Sort articles by datePublished ascending so oldest gets inserted first
// (each insertion prepends before </section>, so the last-inserted ends up
// at the bottom of the grid — newest-first order is preserved by inserting
// in ascending date order).
const missing = [];
for (const slug of allArticles) {
  if (!indexHtml.includes(`articles/${slug}.html`)) {
    const articlePath = path.join(ARTICLES_DIR, slug + '.html');
    const articleHtml = fs.readFileSync(articlePath, 'utf8');
    const rawTitle   = extractTitle(articleHtml) || slug;
    const cleanTitle = rawTitle.replace(/ - Trail Built$/, '').replace(/ — Trail Built$/, '');
    const description = extractMeta(articleHtml, 'og:description')
                     || extractMeta(articleHtml, 'description')
                     || '';
    const ogImage    = extractMeta(articleHtml, 'og:image') || '';
    const isoDate    = extractDatePublished(articleHtml) || '2026-01-01';
    missing.push({ slug, cleanTitle, description, ogImage, isoDate });
  }
}

if (missing.length === 0) {
  console.log('No missing articles found — index.html is already up to date.');
  process.exit(0);
}

// Sort ascending by date so newest ends up at the top of the grid
missing.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

console.log(`Backfilling ${missing.length} missing article(s):`);
for (const art of missing) {
  console.log(`  • ${art.slug}  (${art.isoDate})`);
  const dateStr = formatDate(art.isoDate);
  const card = buildCard(art.slug, art.cleanTitle, art.description, dateStr, art.ogImage);
  indexHtml = insertCard(indexHtml, card);
  console.log(`    ✓ inserted card: "${art.cleanTitle}"`);
}

fs.writeFileSync(INDEX_FILE, indexHtml);
console.log('\nindex.html saved successfully.');
