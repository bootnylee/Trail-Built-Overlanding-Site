#!/usr/bin/env node
/**
 * scripts/check-links.js
 * Affiliate-link and image health checker for Trail-Built, SilkierStrands, and PauseAndFlourish.
 *
 * Usage: node scripts/check-links.js
 *
 * Handles two source shapes:
 *   1. HTML shape (articles/*.html) — extracts Amazon /dp/{ASIN} links and <img src> URLs
 *   2. products.ts shape (client/src/lib/products.ts) — extracts asin:, imageUrl:,
 *      amazonImageUrl:, and heroImage: fields
 *
 * Classification:
 *   OK          — HTTP 200 (resource exists)
 *   BROKEN      — HTTP 404 or 410 (resource genuinely gone)
 *   INCONCLUSIVE — 403/429/503/CAPTCHA/timeout/network-error (bot-blocked or unreachable;
 *                  NOT proof the link is dead)
 *
 * NOTE: Amazon product-page links (amazon.com/dp/…) will almost always return INCONCLUSIVE
 * because Amazon aggressively blocks automated requests. This is expected behaviour and does
 * NOT indicate the links are broken. Image CDN URLs (m.media-amazon.com, etc.) are the
 * reliable signal and are checked first.
 *
 * Static-analysis warnings (no network):
 *   - Duplicate ASINs in silkierstrands products.ts
 *   - Unsplash stock-photo URLs in products data (not real product images)
 */

import fs   from 'fs';
import path from 'path';
import https from 'https';
import { URL, fileURLToPath } from 'url';

// ─── Configuration ────────────────────────────────────────────────────────────
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const TIMEOUT_MS    = 10_000;  // 10 s per request
const RETRY_DELAY   = 2_000;   // 2 s before the single retry
const BETWEEN_DELAY = 1_500;   // 1.5 s between distinct URLs (courtesy)

// Known duplicate ASINs in silkierstrands products.ts (static analysis only)
const KNOWN_SS_DUPLICATES = [
  'B004INUWX0',
  'B00BB8ZIRK',
  'B00C3HQB9C',
  'B0BQ8P9LS2',
  'B0CRG6S7W8',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Perform a single GET request.
 * Returns 'OK', 'BROKEN', or 'INCONCLUSIVE'.
 */
function doGet(urlString, depth = 0) {
  return new Promise(resolve => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return resolve('INCONCLUSIVE');
    }

    const options = {
      hostname : parsed.hostname,
      port     : parsed.port || 443,
      path     : parsed.pathname + parsed.search,
      method   : 'GET',
      headers  : {
        'User-Agent'      : USER_AGENT,
        'Accept'          : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language' : 'en-US,en;q=0.9',
        'Accept-Encoding' : 'gzip, deflate, br',
        'Connection'      : 'keep-alive',
        'Cache-Control'   : 'no-cache',
      },
      timeout: TIMEOUT_MS,
    };

    const req = https.request(options, res => {
      const code = res.statusCode;
      // Drain the body so the socket is freed
      res.on('data', () => {});
      res.on('end', () => {
        if (code === 200 || (code >= 201 && code < 300)) {
          resolve('OK');
        } else if (code === 404 || code === 410) {
          resolve('BROKEN');
        } else if (code >= 301 && code <= 308 && res.headers.location && depth < 3) {
          // Follow one level of redirect
          let loc = res.headers.location;
          if (!loc.startsWith('http')) {
            loc = new URL(loc, urlString).href;
          }
          doGet(loc, depth + 1).then(resolve);
        } else {
          // 403, 429, 503, etc. — bot-blocked or server error
          resolve('INCONCLUSIVE');
        }
      });
    });

    req.on('error', () => resolve('INCONCLUSIVE'));
    req.on('timeout', () => { req.destroy(); resolve('INCONCLUSIVE'); });
    req.end();
  });
}

/**
 * Check a URL: one attempt, then one retry after RETRY_DELAY if INCONCLUSIVE.
 * Deduplicates by URL within a single run.
 */
const urlCache = new Map();

async function checkUrl(urlString) {
  if (urlCache.has(urlString)) {
    return urlCache.get(urlString);
  }
  let status = await doGet(urlString);
  if (status === 'INCONCLUSIVE') {
    await sleep(RETRY_DELAY);
    status = await doGet(urlString);
  }
  urlCache.set(urlString, status);
  return status;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/** Walk a directory tree and return all *.html file paths. */
function walkHtml(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walkHtml(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/**
 * Extract items from HTML files in articles/.
 * Returns array of { type, value, url, file, line }.
 */
function extractFromHtml(cwd) {
  const articlesDir = path.join(cwd, 'articles');
  if (!fs.existsSync(articlesDir)) return [];

  const items = [];
  const seenAsins = new Set();

  for (const file of walkHtml(articlesDir)) {
    const rel = path.relative(cwd, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];

      // Amazon /dp/ affiliate links
      const dpRe = /amazon\.com\/dp\/([A-Z0-9]{10})/g;
      let m;
      while ((m = dpRe.exec(ln)) !== null) {
        const asin = m[1];
        if (!seenAsins.has(asin)) {
          seenAsins.add(asin);
          items.push({
            type  : 'asin',
            value : asin,
            url   : `https://www.amazon.com/dp/${asin}`,
            file  : rel,
            line  : i + 1,
          });
        }
      }

      // Amazon /s? search links
      const searchRe = /href="(https:\/\/www\.amazon\.com\/s\?[^"]+)"/g;
      while ((m = searchRe.exec(ln)) !== null) {
        items.push({
          type  : 'amazon-search',
          value : m[1],
          url   : m[1],
          file  : rel,
          line  : i + 1,
        });
      }

      // <img src="..."> external URLs
      const srcRe = /src="(https:\/\/[^"]+)"/g;
      while ((m = srcRe.exec(ln)) !== null) {
        const url = m[1];
        if (
          !url.includes('googletagmanager') &&
          !url.includes('ahrefs') &&
          !url.includes('analytics.js')
        ) {
          items.push({
            type  : 'image',
            value : url,
            url   : url,
            file  : rel,
            line  : i + 1,
          });
        }
      }
    }
  }
  return items;
}

/**
 * Extract items from client/src/lib/products.ts.
 * Returns array of { type, value, url, file, line }.
 */
function extractFromProductsTs(cwd) {
  const tsFile = path.join(cwd, 'client', 'src', 'lib', 'products.ts');
  if (!fs.existsSync(tsFile)) return [];

  const rel   = path.relative(cwd, tsFile);
  const lines = fs.readFileSync(tsFile, 'utf8').split('\n');
  const items = [];
  const seenAsins = new Set();

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    // asin: "B0XXXXXXXXX"
    const asinM = ln.match(/asin:\s*"([A-Z0-9]{10})"/);
    if (asinM) {
      const asin = asinM[1];
      items.push({
        type  : 'asin',
        value : asin,
        url   : `https://www.amazon.com/dp/${asin}`,
        file  : rel,
        line  : i + 1,
        isDuplicate: seenAsins.has(asin),
      });
      seenAsins.add(asin);
    }

    // imageUrl / amazonImageUrl / heroImage: "https://..."
    const imgM = ln.match(/(imageUrl|amazonImageUrl|heroImage):\s*"(https:\/\/[^"]+)"/);
    if (imgM) {
      items.push({
        type     : 'image',
        field    : imgM[1],
        value    : imgM[2],
        url      : imgM[2],
        file     : rel,
        line     : i + 1,
      });
    }
  }
  return items;
}

/**
 * Static analysis: duplicate ASINs in silkierstrands products.ts.
 * Returns array of warning objects.
 */
function staticDuplicateCheck(cwd) {
  if (!cwd.includes('silkierstrands')) return [];

  const tsFile = path.join(cwd, 'client', 'src', 'lib', 'products.ts');
  if (!fs.existsSync(tsFile)) return [];

  const lines = fs.readFileSync(tsFile, 'utf8').split('\n');
  const warnings = [];

  for (const targetAsin of KNOWN_SS_DUPLICATES) {
    const occurrences = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`asin: "${targetAsin}"`)) {
        let name = '(name not found)';
        for (let j = i; j >= Math.max(0, i - 25); j--) {
          const nm = lines[j].match(/name:\s*"([^"]+)"/);
          if (nm) { name = nm[1]; break; }
        }
        occurrences.push({ line: i + 1, name });
      }
    }
    if (occurrences.length > 1) {
      warnings.push({
        asin       : targetAsin,
        occurrences: occurrences,
        message    : `ASIN ${targetAsin} appears ${occurrences.length}× under different product names`,
      });
    }
  }
  return warnings;
}

/**
 * Static analysis: Unsplash stock-photo URLs in products data.
 * Returns array of { url, file, line }.
 */
function staticUnsplashCheck(items) {
  return items
    .filter(it => it.type === 'image' && it.value.includes('images.unsplash.com'))
    .map(it => ({ url: it.value, file: it.file, line: it.line }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`check-links.js — running in: ${cwd}`);
  console.log(`${'='.repeat(60)}\n`);

  // Detect repo type
  const hasArticles   = fs.existsSync(path.join(cwd, 'articles'));
  const hasProductsTs = fs.existsSync(path.join(cwd, 'client', 'src', 'lib', 'products.ts'));

  if (!hasArticles && !hasProductsTs) {
    console.error('ERROR: Neither articles/ nor client/src/lib/products.ts found in cwd.');
    process.exit(1);
  }

  // Extract all items
  let items = [];
  if (hasArticles)   items = items.concat(extractFromHtml(cwd));
  if (hasProductsTs) items = items.concat(extractFromProductsTs(cwd));

  console.log(`Extracted ${items.length} raw items (ASINs + images + search links)\n`);

  // Static analysis
  const duplicateWarnings = staticDuplicateCheck(cwd);
  const unsplashWarnings  = staticUnsplashCheck(items);

  // ── Network checks ──────────────────────────────────────────────────────────
  // Deduplicate by URL for network checks, but keep all source locations
  const urlToItems = new Map();
  for (const item of items) {
    if (!urlToItems.has(item.url)) urlToItems.set(item.url, []);
    urlToItems.get(item.url).push(item);
  }

  const summary = { OK: 0, BROKEN: 0, INCONCLUSIVE: 0 };
  const broken  = [];
  const allResults = [];

  let idx = 0;
  const total = urlToItems.size;

  for (const [url, srcItems] of urlToItems) {
    idx++;
    const label = srcItems[0].type === 'asin'
      ? `[ASIN ${srcItems[0].value}]`
      : `[IMG]`;
    process.stdout.write(`[${idx}/${total}] ${label} ${url.slice(0, 80)} ... `);

    const status = await checkUrl(url);
    console.log(status);

    summary[status]++;
    allResults.push({
      url,
      status,
      sources: srcItems.map(it => ({
        file  : it.file,
        line  : it.line,
        type  : it.type,
        value : it.value,
      })),
    });

    if (status === 'BROKEN') {
      for (const src of srcItems) {
        broken.push({
          type  : src.type,
          value : src.value,
          url   : url,
          file  : src.file,
          line  : src.line,
        });
      }
    }

    await sleep(BETWEEN_DELAY);
  }

  // ── Build report ────────────────────────────────────────────────────────────
  const report = {
    generatedAt  : new Date().toISOString(),
    repoPath     : cwd,
    note         : [
      'INCONCLUSIVE means the server returned 403/429/503 or timed out (bot-blocked).',
      'This is NOT proof the link is dead. Amazon product pages almost always return',
      'INCONCLUSIVE because Amazon blocks automated requests. Image CDN URLs on',
      'm.media-amazon.com are the reliable signal for whether product images are live.',
    ].join(' '),
    summary,
    broken,
    allResults,
    staticAnalysis: {
      duplicateAsins : duplicateWarnings,
      unsplashImages : unsplashWarnings,
    },
  };

  fs.writeFileSync('link-report.json', JSON.stringify(report, null, 2));
  console.log('\nlink-report.json written.\n');

  // ── Print summary ────────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    LINK-CHECKER SUMMARY                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  OK           : ${String(summary.OK).padEnd(40)}║`);
  console.log(`║  BROKEN       : ${String(summary.BROKEN).padEnd(40)}║`);
  console.log(`║  INCONCLUSIVE : ${String(summary.INCONCLUSIVE).padEnd(40)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  NOTE: INCONCLUSIVE ≠ broken. Amazon product pages are   ║');
  console.log('║  bot-blocked and will always show INCONCLUSIVE. Image     ║');
  console.log('║  CDN URLs (m.media-amazon.com) are the reliable signal.  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (broken.length > 0) {
    console.log('\n⚠  BROKEN ITEMS:');
    for (const b of broken) {
      console.log(`   [${b.type.toUpperCase()}] ${b.value}`);
      console.log(`   URL  : ${b.url}`);
      console.log(`   File : ${b.file}:${b.line}`);
      console.log('');
    }
  } else {
    console.log('\n✓  No BROKEN items found.');
  }

  if (duplicateWarnings.length > 0) {
    console.log('\n⚠  STATIC: Duplicate ASINs in products.ts:');
    for (const d of duplicateWarnings) {
      console.log(`   ${d.message}`);
      for (const occ of d.occurrences) {
        console.log(`     Line ${occ.line}: "${occ.name}"`);
      }
    }
  }

  if (unsplashWarnings.length > 0) {
    console.log('\n⚠  STATIC: Unsplash stock-photo URLs (not real product images):');
    for (const u of unsplashWarnings) {
      console.log(`   ${u.url}`);
      console.log(`   File : ${u.file}:${u.line}`);
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
