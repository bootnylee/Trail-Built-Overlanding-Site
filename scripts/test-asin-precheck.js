#!/usr/bin/env node
/**
 * Local behavioral test for the pre-publish ASIN guard.
 * No network access or credentials are required.
 */

const assert = require('assert');
const { validateBodyAsins } = require('./generate-article');

const LIVE_POOL_ASIN = 'B07SJHVQTJ';
const NON_POOL_ASIN = 'B000000000';

const pool = new Map([
  [LIVE_POOL_ASIN, {
    asin: LIVE_POOL_ASIN,
    name: 'Verified Recovery Boards',
    tags: ['recovery', 'traction'],
  }],
]);

function productHtml(asin) {
  return `<div class="product-box" data-asin="${asin}"><a href="https://www.amazon.com/dp/${asin}?tag=trailbuiltove-20">Check Price</a></div>`;
}

async function run() {
  const calls = [];
  const liveVerifier = {
    verifyAsin: async asin => {
      calls.push(asin);
      return { status: 'LIVE', source: 'creators_api', image_url: `https://example.invalid/${asin}.jpg`, reason: '' };
    },
  };

  const accepted = await validateBodyAsins(productHtml(LIVE_POOL_ASIN), pool, liveVerifier);
  assert.deepStrictEqual(accepted, { ok: [LIVE_POOL_ASIN], failed: [] });
  assert.deepStrictEqual(calls, [LIVE_POOL_ASIN]);

  calls.length = 0;
  const nonPool = await validateBodyAsins(productHtml(NON_POOL_ASIN), pool, liveVerifier);
  assert.deepStrictEqual(nonPool.ok, []);
  assert.deepStrictEqual(nonPool.failed, [`${NON_POOL_ASIN}: not in verified product pool`]);
  assert.deepStrictEqual(calls, []);

  const inconclusiveVerifier = {
    verifyAsin: async asin => ({
      status: 'INCONCLUSIVE',
      source: 'creators_api',
      reason: `${asin} returned no items after retry`,
    }),
  };
  const failedLiveCheck = await validateBodyAsins(productHtml(LIVE_POOL_ASIN), pool, inconclusiveVerifier);
  assert.deepStrictEqual(failedLiveCheck.ok, []);
  assert.deepStrictEqual(
    failedLiveCheck.failed,
    [`${LIVE_POOL_ASIN}: INCONCLUSIVE (${LIVE_POOL_ASIN} returned no items after retry)`]
  );

  console.log('ASIN precheck tests passed: live pool ASIN accepted; non-pool and inconclusive ASINs blocked.');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
