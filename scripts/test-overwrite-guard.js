#!/usr/bin/env node
/**
 * Test: overwrite guard fires on the REAL code path in generate-article.js.
 *
 * Strategy
 * --------
 * The test is fully decoupled from live site content. It creates a temporary
 * articles directory, writes a dummy article into it, then spawns
 * generate-article.js with ARTICLES_DIR pointed at the temp dir and --topic
 * chosen so that topicToSlug(topic) matches the dummy article's slug. The
 * script is invoked with a fake GROQ_API_KEY so it passes the key-presence
 * check, but the overwrite guard runs BEFORE any network call is made, so no
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
const fs            = require('fs');
const os            = require('os');
const path          = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const SCRIPT       = path.join(__dirname, 'generate-article.js');
const { topicToSlug } = require(SCRIPT);
const TEST_TOPIC   = 'overwrite guard self test';        // synthetic topic
const TEST_SLUG    = topicToSlug(TEST_TOPIC);            // derived via real helper

// ── Set up an isolated temp articles directory with a dummy article ──────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-guard-test-'));
fs.writeFileSync(
  path.join(tmpDir, `${TEST_SLUG}.html`),
  '<!DOCTYPE html><html><body>dummy article for overwrite-guard test</body></html>\n'
);

let result;
try {
  // ── Run the real script against the temp directory ─────────────────────────
  result = spawnSync(
    process.execPath,                          // same node binary
    [SCRIPT, '--topic', TEST_TOPIC],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Point the generator at the isolated temp dir so the test never
        // depends on (or touches) the live articles/ content.
        ARTICLES_DIR: tmpDir,
        // Provide a syntactically valid but fake key so the key-presence check
        // passes; the guard fires before any HTTP request is made.
        GROQ_API_KEY: 'gsk_test_fake_key_for_overwrite_guard_test',
      },
    }
  );
} finally {
  // ── Clean up the temp directory regardless of outcome ──────────────────────
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

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
