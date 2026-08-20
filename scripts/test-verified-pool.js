#!/usr/bin/env node
/**
 * Local tests for product-pool integrity and Creators API result classification.
 * No external network or credentials are used.
 */

const assert = require('assert');
const path = require('path');
const { loadVerifiedPool } = require('./generate-article');
const { createAsinVerifier } = require('./asin-verification');

const POOL_FILE = path.join(__dirname, '..', 'data', 'verified-products.json');

async function run() {
  const poolDocument = require(POOL_FILE);
  assert.ok(poolDocument.products.length > 0, 'seed pool must contain products');
  assert.ok(poolDocument.products.every(product => (
    /^[A-Z0-9]{10}$/.test(product.asin)
    && product.name
    && Array.isArray(product.tags)
    && product.affiliate_url === `https://www.amazon.com/dp/${product.asin}?tag=trailbuiltove-20`
    && product.verification_status === 'pending-verification'
  )), 'seed entries must be complete pending-verification direct-ASIN records');
  assert.strictEqual(loadVerifiedPool(POOL_FILE, false).size, poolDocument.products.length);
  assert.throws(
    () => loadVerifiedPool(POOL_FILE, true),
    /No runtime-verified product entries are available/,
    'CI mode must reject a pool that has not been runtime verified'
  );

  const noCredentials = await createAsinVerifier({
    credentials: { clientId: '', clientSecret: '', partnerTag: 'trailbuiltove-20' },
  }).verifyAsin('B07SJHVQTJ');
  assert.strictEqual(noCredentials.status, 'INCONCLUSIVE');

  const requests = [];
  const liveVerifier = createAsinVerifier({
    credentials: { clientId: 'id', clientSecret: 'secret', partnerTag: 'trailbuiltove-20' },
    requestIntervalMs: 0,
    sleepFn: async () => {},
    request: async request => {
      requests.push(request);
      if (request.hostname === 'api.amazon.com') {
        return { status: 200, body: JSON.stringify({ access_token: 'test-token', expires_in: 3600 }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          itemResults: { items: [{ asin: 'B07SJHVQTJ', itemInfo: { title: { displayValue: 'Verified Test Product' } }, images: { primary: { large: { url: 'https://example.invalid/verified-test-product.jpg' } } } }] },
        }),
      };
    },
  });
  const live = await liveVerifier.verifyAsin('B07SJHVQTJ');
  assert.strictEqual(live.status, 'LIVE');
  assert.strictEqual(live.image_url, 'https://example.invalid/verified-test-product.jpg');
  const catalogRequest = JSON.parse(requests[1].body);
  assert.deepStrictEqual(catalogRequest.resources, ['itemInfo.title', 'images.primary.large']);
  assert.deepStrictEqual(requests.map(request => request.hostname), ['api.amazon.com', 'creatorsapi.amazon']);

  const emptyVerifier = createAsinVerifier({
    credentials: { clientId: 'id', clientSecret: 'secret', partnerTag: 'trailbuiltove-20' },
    requestIntervalMs: 0,
    lookupAttempts: 1,
    request: async request => {
      if (request.hostname === 'api.amazon.com') {
        return { status: 200, body: JSON.stringify({ access_token: 'test-token', expires_in: 3600 }) };
      }
      return { status: 200, body: JSON.stringify({ itemResults: { items: [] } }) };
    },
  });
  const noItems = await emptyVerifier.verifyAsin('B07SJHVQTJ');
  assert.strictEqual(noItems.status, 'INCONCLUSIVE');
  assert.strictEqual(noItems.reason, 'No items returned');

  console.log('Verified-pool tests passed: seed integrity, CI verification requirement, LIVE, and INCONCLUSIVE paths.');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
