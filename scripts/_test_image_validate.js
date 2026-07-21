#!/usr/bin/env node
/**
 * Quick smoke test for the validateImageUrl / resolveValidImageUrl functions.
 * Not committed to the repo — run locally only.
 * Usage: node scripts/_test_image_validate.js
 */
const https = require('https');

const UNSPLASH_FALLBACKS = [
  'https://images.unsplash.com/photo-1533591380348-14193f1de18f?w=1200&q=80',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80',
  'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=1200&q=80',
  'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80',
  'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80',
  'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&q=80',
  'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1200&q=80',
];

const DEAD_URL = 'https://images.unsplash.com/photo-1534536297917?w=1200&q=80';

function validateImageUrl(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : require('http');
      const req = mod.request(
        { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'HEAD', timeout: 8000 },
        (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            validateImageUrl(res.headers.location).then(resolve);
          } else {
            resolve(res.statusCode === 200);
          }
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
}

async function main() {
  console.log('\n=== Testing dead URL rejection ===');
  const deadOk = await validateImageUrl(DEAD_URL);
  if (deadOk) {
    console.error(`FAIL: Dead URL returned 200 — it may have been restored: ${DEAD_URL}`);
  } else {
    console.log(`PASS: Dead URL correctly rejected (non-200): ${DEAD_URL}`);
  }

  console.log('\n=== Testing fallback pool ===');
  let allOk = true;
  for (const url of UNSPLASH_FALLBACKS) {
    const ok = await validateImageUrl(url);
    const status = ok ? '✅ OK  ' : '❌ DEAD';
    console.log(`  ${status}  ${url}`);
    if (!ok) allOk = false;
  }

  console.log('\n=== Summary ===');
  if (!deadOk && allOk) {
    console.log('All checks passed. Dead URL rejected; all fallbacks live.');
    process.exit(0);
  } else {
    if (deadOk) console.error('WARNING: Dead URL is now returning 200 — update the test.');
    if (!allOk) console.error('ERROR: One or more fallback URLs are dead — update UNSPLASH_FALLBACKS.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
