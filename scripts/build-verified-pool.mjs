#!/usr/bin/env node
/**
 * Build Trail Built's controlled product pool from every current direct-ASIN site reference.
 *
 * Default mode performs static extraction only and marks entries pending-verification.
 * Add --verify in an environment with Creators API credentials to confirm each ASIN via
 * the official catalog, with the same paced and retrying lookup client used by generation.
 * Inconclusive API evidence remains pending; it is never labelled dead by this builder.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAsinVerifier, getCreatorsCredentials } = require('./asin-verification.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXTRACTOR = path.join(REPO_ROOT, 'tools', 'validate_asins.py');
const OUTPUT_FILE = path.join(REPO_ROOT, 'data', 'verified-products.json');
const AFFILIATE_TAG = process.env.AMAZON_ASSOCIATE_TAG || 'trailbuiltove-20';
const VERIFY = process.argv.includes('--verify');
const STOP_WORDS = new Set([
  'a', 'all', 'and', 'best', 'built', 'check', 'for', 'from', 'gear', 'guide', 'in',
  'kit', 'of', 'on', 'overlanding', 'price', 'review', 'the', 'to', 'trail', 'with',
]);

function slugWords(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function cleanTags(...values) {
  return [...new Set(values.flatMap(slugWords).filter(word => word.length > 1 && !STOP_WORDS.has(word)))].slice(0, 10);
}

function categoryFor(record) {
  const file = record.file || '';
  if (file.startsWith('categories/')) {
    return path.basename(file, '.html').replace(/-/g, ' ');
  }
  if (file.startsWith('articles/')) {
    return path.basename(file, '.html').replace(/-/g, ' ');
  }
  return 'overlanding gear';
}

function chooseName(records) {
  return [...records]
    .map(record => record.product.trim())
    .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
}

function runStaticExtractor() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'trail-built-pool-'));
  const reportFile = path.join(tempDir, 'asin-static-report.json');
  try {
    execFileSync(process.env.PYTHON || 'python3', [EXTRACTOR, '--static-only', '--output', reportFile], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    return JSON.parse(readFileSync(reportFile, 'utf8'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildSeedProducts(records) {
  const grouped = new Map();
  for (const record of records) {
    if (record.destination_type !== 'asin' || !/^[A-Z0-9]{10}$/.test(record.asin || '')) continue;
    if (!grouped.has(record.asin)) grouped.set(record.asin, []);
    grouped.get(record.asin).push(record);
  }

  return [...grouped.entries()]
    .map(([asin, sources]) => {
      const name = chooseName(sources);
      const categories = [...new Set(sources.map(categoryFor))].sort();
      return {
        asin,
        name,
        category: categories[0] || 'overlanding gear',
        tags: cleanTags(name, ...categories),
        affiliate_url: `https://www.amazon.com/dp/${asin}?tag=${AFFILIATE_TAG}`,
        verification_status: 'pending-verification',
        sources: [...new Set(sources.map(source => source.file))].sort(),
      };
    })
    .sort((a, b) => a.asin.localeCompare(b.asin));
}

async function verifyProducts(products) {
  const credentials = getCreatorsCredentials();
  if (!credentials.clientId || !credentials.clientSecret || !credentials.partnerTag) {
    throw new Error('--verify requires Creators API credentials in environment variables.');
  }
  const verifier = createAsinVerifier({ credentials });
  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    const result = await verifier.verifyAsin(product.asin);
    product.verification_status = result.status === 'LIVE' ? 'verified' : 'pending-verification';
    product.verification_source = result.source;
    if (result.title) product.amazon_title = result.title;
    if (result.status !== 'LIVE') product.verification_note = result.reason || 'Creators API result was inconclusive';
    console.log(`[verified-pool] ${index + 1}/${products.length} ${product.asin}: ${product.verification_status}`);
  }
}

async function main() {
  if (!existsSync(EXTRACTOR)) throw new Error(`Site extractor not found: ${EXTRACTOR}`);
  const report = runStaticExtractor();
  const products = buildSeedProducts(report.products || []);
  if (products.length === 0) throw new Error('No direct ASINs were found in current site references.');
  if (VERIFY) await verifyProducts(products);

  mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: 'tools/validate_asins.py --static-only site-wide direct-ASIN extraction',
    verification_mode: VERIFY ? 'Creators API verification requested' : 'pending verification; weekly precheck verifies at runtime',
    products,
  };
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[verified-pool] Wrote ${products.length} product(s) to ${path.relative(REPO_ROOT, OUTPUT_FILE)}.`);
}

main().catch(error => {
  console.error(`[verified-pool] ${error.message}`);
  process.exit(1);
});
