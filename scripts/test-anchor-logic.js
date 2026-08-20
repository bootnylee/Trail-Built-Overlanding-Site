#!/usr/bin/env node
/**
 * Verifies that generated homepage cards are prepended inside the canonical
 * reviews grid, preserving the three-across layout and newest-first behavior.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const GRID_MARKER = '<div class="grid-3">';
let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗  ${label}${detail ? `: ${detail}` : ''}`);
    failed += 1;
  }
}

function reviewsGridInsertionPoint(html) {
  const reviewsStart = html.indexOf('<section id="reviews">');
  const gridStart = reviewsStart === -1 ? -1 : html.indexOf(GRID_MARKER, reviewsStart);
  if (gridStart === -1) throw new Error('canonical reviews grid not found');
  return gridStart + GRID_MARKER.length;
}

const html = fs.readFileSync(INDEX_FILE, 'utf8');

console.log('\nTest 1: canonical reviews grid exists');
const insertionPoint = (() => {
  try { return reviewsGridInsertionPoint(html); }
  catch (error) { assert('reviews grid anchor resolves', false, error.message); return -1; }
})();
assert('reviews grid anchor resolves', insertionPoint !== -1);

console.log('\nTest 2: insertion prepends inside the reviews grid');
const dummyCard = '<div class="card"><p>TEST CARD</p></div>';
const updated = html.slice(0, insertionPoint) + `\n${dummyCard}` + html.slice(insertionPoint);
const gridAfterInsertion = updated.indexOf(GRID_MARKER) + GRID_MARKER.length;
assert('updated HTML changes', updated !== html);
assert('dummy card is immediately inside grid', updated.indexOf(dummyCard) === gridAfterInsertion + 1);
assert('top-product section remains after reviews', updated.indexOf('<!-- ===== TOP PRODUCT PICKS ===== -->') > updated.indexOf(dummyCard));

console.log('\nTest 3: missing reviews grid blocks insertion');
let threw = false;
try { reviewsGridInsertionPoint('<html><body></body></html>'); } catch { threw = true; }
assert('missing grid throws', threw);

console.log('\nTest 4: duplicate guard source remains valid');
assert('existing article slug is present', html.includes('articles/best-overlanding-recovery-gear.html'));

console.log('\nTest 5: homepage card listing is newest-first and complete');
const reviewsStart = html.indexOf('<section id="reviews">');
const reviewsEnd = html.indexOf('</section>', reviewsStart);
const reviews = html.slice(reviewsStart, reviewsEnd);
const cardSlugs = [...reviews.matchAll(/<h3><a href="articles\/([^"/]+)\.html">/g)].map(match => match[1]);
const uniqueSlugs = [...new Set(cardSlugs)];
const articlesDir = path.join(__dirname, '..', 'articles');
assert('review listing has unique canonical cards', cardSlugs.length >= 6 && cardSlugs.length === uniqueSlugs.length, `${cardSlugs.length} review cards / ${uniqueSlugs.length} unique slugs`);
const dates = cardSlugs.map(slug => {
  const article = fs.readFileSync(path.join(articlesDir, `${slug}.html`), 'utf8');
  return article.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1] || '';
});
assert('card publish dates descend', dates.every((date, index) => index === 0 || dates[index - 1] >= date), dates.join(', '));
assert('all grid-card images request 600px sources', !/<div class="card-img"><img[^>]+w=1200/.test(reviews));

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All tests passed.');
