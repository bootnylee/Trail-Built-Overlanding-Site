#!/usr/bin/env node
/**
 * Test: overwrite guard fires on the REAL code path in generate-article.js.
 *
 * Strategy
 * --------
 * We spawn generate-article.js as a child process with --topic set to an
 * already-published topic ('hi-lift jack alternatives').  The script is
 * invoked with a fake GROQ_API_KEY so it passes the key-presence check, but
 * the overwrite guard runs BEFORE any network call is made (Finding 2), so no
 * real Groq request is ever attempted.
 *
 * Expected outcome
 * ----------------
 *   • Process exits non-zero.
 *   • stderr contains the string 'OVERWRITE GUARD'.
 *
 * Tautology proof
 * ---------------
 * This test WILL FAIL if the guard block is removed from main(), because the
 * script would then proceed to the Groq call, fail with a network/auth error
 * that does NOT contain 'OVERWRITE GUARD', and the assertion would reject it.
 */

'use strict';

const { spawnSync } = require('child_process');
const path          = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const SCRIPT      = path.join(__dirname, 'generate-article.js');
const TEST_TOPIC  = 'hi-lift jack alternatives';   // already published

// ── Run the real script ───────────────────────────────────────────────────────
const result = spawnSync(
  process.execPath,                          // same node binary
  [SCRIPT, '--topic', TEST_TOPIC],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Provide a syntactically valid but fake key so the key-presence check
      // passes; the guard fires before any HTTP request is made.
      GROQ_API_KEY: 'gsk_test_fake_key_for_overwrite_guard_test',
    },
  }
);

// ── Assertions ────────────────────────────────────────────────────────────────
let passed = true;

// 1. Process must exit non-zero.
if (result.status === 0) {
  console.error('FAIL: expected non-zero exit code, got 0');
  passed = false;
} else {
  console.log(`PASS: process exited with code ${result.status} (non-zero)`);
}

// 2. stderr must contain 'OVERWRITE GUARD'.
const stderr = result.stderr || '';
if (!stderr.includes('OVERWRITE GUARD')) {
  console.error('FAIL: stderr does not contain "OVERWRITE GUARD"');
  console.error('--- stderr ---');
  console.error(stderr || '(empty)');
  console.error('--- stdout ---');
  console.error(result.stdout || '(empty)');
  passed = false;
} else {
  console.log('PASS: stderr contains "OVERWRITE GUARD"');
  console.log('--- stderr excerpt ---');
  // Print only the relevant line to avoid leaking any key material.
  stderr.split('\n')
    .filter(l => l.includes('OVERWRITE GUARD'))
    .forEach(l => console.log(' ', l));
}

// ── Result ────────────────────────────────────────────────────────────────────
if (passed) {
  console.log('\nAll assertions passed. Overwrite guard is wired to the real code path.');
  process.exit(0);
} else {
  console.error('\nOne or more assertions FAILED.');
  process.exit(1);
}
