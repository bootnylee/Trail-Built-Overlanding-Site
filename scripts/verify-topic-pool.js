#!/usr/bin/env node
/**
 * Diagnostic script — verify topic-pool deduplication after the fix.
 * Prints: pool size, published count, eligible count, and which slugs are excluded.
 * Run: node scripts/verify-topic-pool.js
 */

const fs   = require('fs');
const path = require('path');

const ARTICLES_DIR = path.join(__dirname, '..', 'articles');

const TOPIC_POOL = [
  // Gear Reviews — Year 1
  'best overlanding air compressors',
  'best winches for Toyota 4Runner',
  'overlanding solar power setup guide',
  'best skid plates for off-road trucks',
  'overlanding water storage and filtration',
  'best off-road tires for overlanding',
  'vehicle communication gear for overlanding',
  'best overlanding camp kitchens',
  'how to build a truck bed sleeping platform',
  'best hi-lift jack alternatives',
  'overlanding first aid kit essentials',
  'best roof rack brands for overlanding',
  'best overlanding GPS and navigation devices',
  'diesel vs gasoline for overlanding',
  'best overlanding suspension upgrades',
  'overlanding packing list complete guide',
  'best portable power stations for overlanding',
  'how to choose overlanding recovery boards',
  'best overlanding trailers and teardrops',
  // Gear Reviews — Year 2
  'best overlanding sleeping bags and quilts',
  'best overlanding camp chairs and tables',
  'best overlanding headlamps and lanterns',
  'best overlanding water filters and purifiers',
  'best overlanding fire starters and camp stoves',
  'best overlanding satellite communicators',
  'best overlanding tool kits and recovery bags',
  'best overlanding traction boards comparison',
  'best overlanding snorkels and intake systems',
  'best overlanding dual battery systems',
  'best overlanding cargo management systems',
  'best overlanding shower and hygiene solutions',
  'best overlanding maps and navigation apps',
  'best overlanding dog gear and pet safety',
  'best overlanding tow straps and kinetic ropes',
  'best overlanding CB radios and communication',
  'best overlanding awnings and shade systems',
  'best overlanding ground tents vs rooftop tents',
  'best overlanding solar generators and power banks',
  'best overlanding dash cams and trail cameras',
];

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Build the set of published slugs (no hyphen mangling — exact match)
const publishedSlugs = new Set(
  fs.readdirSync(ARTICLES_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => f.slice(0, -5))
);

// Map each topic to its derived slug
const poolWithSlugs = TOPIC_POOL.map(t => ({
  topic: t,
  slug: slugify('best-' + t).replace(/^best-best-/, 'best-'),
}));

const eligible = poolWithSlugs.filter(({ slug }) => !publishedSlugs.has(slug));
const excluded = poolWithSlugs.filter(({ slug }) =>  publishedSlugs.has(slug));

console.log('=== Topic Pool Verification ===');
console.log(`Pool size      : ${TOPIC_POOL.length}`);
console.log(`Published count: ${publishedSlugs.size}`);
console.log(`Eligible count : ${eligible.length}`);
console.log('');
console.log('Excluded (already published):');
excluded.forEach(({ topic, slug }) => console.log(`  [x] ${slug}  <-- "${topic}"`));
console.log('');
console.log('Eligible (unpublished):');
eligible.forEach(({ topic, slug }) => console.log(`  [ ] ${slug}  <-- "${topic}"`));
