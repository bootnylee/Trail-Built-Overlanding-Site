#!/usr/bin/env node
/**
 * Test: overwrite guard throws when target file already exists and --force is absent.
 * This script replicates only the guard logic from main() — no Groq calls needed.
 */

const fs   = require('fs');
const path = require('path');

const ARTICLES_DIR = path.join(__dirname, '..', 'articles');

// Simulate picking an already-published slug
const slug     = 'best-hi-lift-jack-alternatives';
const outPath  = path.join(ARTICLES_DIR, `${slug}.html`);
const forceFlag = process.argv.includes('--force');

console.log(`Target file : ${outPath}`);
console.log(`File exists : ${fs.existsSync(outPath)}`);
console.log(`--force flag: ${forceFlag}`);
console.log('');

if (fs.existsSync(outPath) && !forceFlag) {
  // Replicate the exact throw from the patched main()
  const err = new Error(
    `OVERWRITE GUARD: ${outPath} already exists. ` +
    'Pass --force to overwrite an existing article.'
  );
  console.error('Guard fired correctly:');
  console.error(err.message);
  process.exit(1);
} else {
  console.log('Guard did NOT fire (file absent or --force supplied).');
}
