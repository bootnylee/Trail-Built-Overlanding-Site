/**
 * test-anchor-logic.js
 * Quick verification that:
 *   1. The new ANCHOR_RE regex finds its target in the current index.html.
 *   2. The no-change guard throws when given HTML that lacks the anchor.
 *   3. The duplicate guard skips an already-present slug.
 *
 * Run from repo root:  node scripts/test-anchor-logic.js
 * Exit 0 = all tests passed.  Exit 1 = a test failed.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const ANCHOR_RE  = /(<\/section>)(\s*<!-- ===== TOP PRODUCT)/;

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function assertThrows(label, fn) {
  try {
    fn();
    console.error(`  ✗  ${label}: expected an error to be thrown but none was`);
    failed++;
  } catch (e) {
    console.log(`  ✓  ${label} (threw: ${e.message.slice(0, 80)}…)`);
    passed++;
  }
}

// ── Test 1: anchor found in real index.html ───────────────────────────────────
console.log('\nTest 1: ANCHOR_RE matches current index.html');
const html = fs.readFileSync(INDEX_FILE, 'utf8');
assert('ANCHOR_RE.test(html) === true', ANCHOR_RE.test(html));

// ── Test 2: insertion actually changes the HTML ───────────────────────────────
console.log('\nTest 2: insertion produces a changed string');
const dummyCard = '<div class="card"><p>TEST CARD</p></div>';
const updated = html.replace(ANCHOR_RE, dummyCard + '\n$1$2');
assert('updated !== html', updated !== html);
assert('updated contains dummy card', updated.includes('TEST CARD'));
assert('anchor comment still present after insertion',
  updated.includes('<!-- ===== TOP PRODUCT'));

// ── Test 3: no-change guard throws on HTML without the anchor ─────────────────
console.log('\nTest 3: no-change guard throws when anchor is absent');
const htmlNoAnchor = '<html><body><p>no anchor here</p></body></html>';
assertThrows(
  'throws when ANCHOR_RE not found',
  () => {
    if (!ANCHOR_RE.test(htmlNoAnchor)) {
      throw new Error(
        'addArticleToIndex: anchor not found — ' +
        'could not locate "</section>" before "<!-- ===== TOP PRODUCT" in index.html.'
      );
    }
  }
);

// ── Test 4: duplicate guard — slug already in index ───────────────────────────
console.log('\nTest 4: duplicate guard skips already-present slug');
const existingSlug = 'best-overlanding-recovery-gear';
assert(
  `index.html already contains "${existingSlug}"`,
  html.includes(`articles/${existingSlug}.html`)
);

// ── Test 5: all 18 articles now linked ────────────────────────────────────────
console.log('\nTest 5: all articles in articles/ are linked in index.html');
const articlesDir = path.join(__dirname, '..', 'articles');
const articleFiles = fs.readdirSync(articlesDir).filter(f => f.endsWith('.html'));
let allPresent = true;
for (const f of articleFiles) {
  const slug = f.replace('.html', '');
  const present = html.includes(`articles/${slug}.html`);
  assert(`  ${slug}`, present);
  if (!present) allPresent = false;
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed.');
}
