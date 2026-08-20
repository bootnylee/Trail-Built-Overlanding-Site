#!/usr/bin/env node
const assert = require('assert');
const {
  loadHeroLibrary,
  loadUsedHeroImageKeys,
  heroImageKey,
  selectHeroImage,
} = require('./generate-article');

const library = loadHeroLibrary();
assert.strictEqual(Object.keys(library).length, 11, 'expected eleven curated hero categories');
for (const [name, category] of Object.entries(library)) {
  assert.strictEqual(category.images.length, 3, `${name} must provide exactly three reviewed future candidates`);
  assert(category.images.every(url => url.startsWith('https://images.pexels.com/')), `${name} contains a non-Pexels URL`);
}

const used = loadUsedHeroImageKeys();
const navigationFirst = selectHeroImage('best overlanding GPS and navigation devices', library, used);
const navigationSecond = selectHeroImage('best overlanding GPS and navigation devices', library, used);
assert.strictEqual(navigationFirst.category, 'navigation');
assert.deepStrictEqual(navigationFirst, navigationSecond, 'same topic must select a deterministic unused hero');
assert(!used.has(heroImageKey(navigationFirst.primary)), 'navigation primary must be unused');
assert(navigationFirst.fallbacks.every(url => !used.has(heroImageKey(url))), 'navigation fallbacks must be unused');
for (const topic of [
  'best overlanding solar power setup guide',
  'best overlanding camp kitchens',
  'best overlanding water filters and purifiers',
  'best overlanding satellite communicators',
  'best off-road tires for overlanding',
  'best overlanding cargo management systems',
  'best overlanding headlamps and lanterns',
  'unclassified expedition philosophy',
]) {
  const selection = selectHeroImage(topic, library, used);
  assert(!used.has(heroImageKey(selection.primary)), `${topic} selected an already-used hero`);
  assert(selection.fallbacks.every(url => !used.has(heroImageKey(url))), `${topic} has a used fallback`);
}
assert.strictEqual(selectHeroImage('best overlanding solar power setup guide', library, used).category, 'power-electrical');
assert.strictEqual(selectHeroImage('best overlanding camp kitchens', library, used).category, 'camp-kitchen');
assert.strictEqual(selectHeroImage('unclassified expedition philosophy', library, used).category, 'general-overlanding');
console.log(`hero library OK: ${Object.keys(library).length} categories; ${used.size} existing editorial identities excluded`);
