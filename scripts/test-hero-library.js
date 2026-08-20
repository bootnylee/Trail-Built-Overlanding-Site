#!/usr/bin/env node
const assert = require('assert');
const { loadHeroLibrary, selectHeroImage } = require('./generate-article');

const library = loadHeroLibrary();
assert.strictEqual(Object.keys(library).length, 11, 'expected eleven curated hero categories');
for (const [name, category] of Object.entries(library)) {
  assert(category.images.length >= 3 && category.images.length <= 5, `${name} must have 3–5 images`);
  assert(category.images.every(url => url.startsWith('https://images.pexels.com/')), `${name} contains a non-Pexels URL`);
}

const navigationFirst = selectHeroImage('best overlanding GPS and navigation devices');
const navigationSecond = selectHeroImage('best overlanding GPS and navigation devices');
assert.strictEqual(navigationFirst.category, 'navigation');
assert.deepStrictEqual(navigationFirst, navigationSecond, 'same topic must select same deterministic hero');
assert.strictEqual(selectHeroImage('best overlanding solar power setup guide').category, 'power-electrical');
assert.strictEqual(selectHeroImage('best overlanding camp kitchens').category, 'camp-kitchen');
assert.strictEqual(selectHeroImage('unclassified expedition philosophy').category, 'general-overlanding');

console.log(`hero library OK: ${Object.keys(library).length} categories; GPS hero=${navigationFirst.primary}`);
