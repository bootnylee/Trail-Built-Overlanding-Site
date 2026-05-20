#!/usr/bin/env node
/**
 * quality-gate.mjs
 * Pre-push quality gate for Trail Built Overlanding.
 * Checks all HTML files for known issues before a commit is pushed.
 * Exits with code 1 (blocking) if any CRITICAL issues are found.
 * Exits with code 0 if only warnings are found (non-blocking).
 *
 * Usage:
 *   node scripts/quality-gate.mjs              # check all HTML files
 *   node scripts/quality-gate.mjs --file path  # check a single file
 *   node scripts/quality-gate.mjs --strict     # treat warnings as errors
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ── Configuration ─────────────────────────────────────────────────────────────

const CRITICAL_CHECKS = [
  // Emoji that must never appear in published HTML
  {
    id: 'emoji-avatar',
    description: 'Emoji or HTML entity in avatar div',
    pattern: /<div class="avatar">[^<]*(?:&#127\d{3}|🏔|🏐|🏕|⛺|🌎|🧭)[^<]*<\/div>/,
    message: 'Avatar contains emoji/entity — use branded SVG avatar instead',
  },
  {
    id: 'emoji-hero',
    description: 'Emoji placeholder in article-img-hero (no real image)',
    pattern: /<div class="article-img-hero">[^<]*(?:🏔|🌄|🏕|⛺|🌲)[^<]*<\/div>/,
    message: 'article-img-hero contains emoji instead of a real <img> tag',
  },
  {
    id: 'emoji-card-img',
    description: 'Emoji placeholder in card-img (no real image)',
    pattern: /<div class="card-img">[^<]*(?:🏔|🌄|🏕|⛺|🌲)[^<]*<\/div>/,
    message: 'card-img contains emoji instead of a real <img> tag',
  },
  {
    id: 'emoji-social-instagram',
    description: 'Emoji in Instagram social link',
    pattern: /aria-label="Instagram"[^>]*>[^<]*(?:📷|📸|🤳)/,
    message: 'Instagram link uses emoji — replace with SVG icon',
  },
  {
    id: 'emoji-social-youtube',
    description: 'Emoji in YouTube social link',
    pattern: /aria-label="YouTube"[^>]*>[^<]*(?:▶|📺|🎥)/,
    message: 'YouTube link uses emoji — replace with SVG icon',
  },
  {
    id: 'emoji-social-pinterest',
    description: 'Emoji in Pinterest social link',
    pattern: /aria-label="Pinterest"[^>]*>[^<]*📌/,
    message: 'Pinterest link uses emoji — replace with SVG icon',
  },
  {
    id: 'emoji-share-facebook',
    description: 'Wrong emoji in Facebook share button',
    pattern: /class="share-btn share-facebook"[^>]*>[^<]*(?:📚|👍|📘)/,
    message: 'Facebook share button uses wrong emoji — replace with SVG icon',
  },
  {
    id: 'emoji-share-pinterest',
    description: 'Emoji in Pinterest share button',
    pattern: /class="share-btn share-pinterest"[^>]*>[^<]*📌/,
    message: 'Pinterest share button uses emoji — replace with SVG icon',
  },
  {
    id: 'emoji-share-copy',
    description: 'Emoji in copy-link share button',
    pattern: /class="share-btn share-copy"[^>]*>[^<]*🔗/,
    message: 'Copy link button uses emoji — replace with SVG icon',
  },
  {
    id: 'emoji-hamburger',
    description: 'Hamburger menu uses ☰ character or &#9776; entity',
    pattern: /class="menu-toggle"[^>]*>(?:☰|&#9776;)/,
    message: 'Menu toggle uses ☰ character — replace with SVG hamburger icon',
  },
  {
    id: 'emoji-back-to-top',
    description: 'Back-to-top button uses ⇧ or &#8679; entity',
    pattern: /class="back-to-top"[^>]*>(?:⇧|&#8679;|↑|&#8593;)/,
    message: 'Back-to-top button uses arrow character — replace with SVG icon',
  },
  {
    id: 'broken-unsplash-url',
    description: 'Broken or placeholder Unsplash URL',
    pattern: /unsplash\.com\/photo-(?:5e3F4oU5HcU|PLACEHOLDER|YOUR_PHOTO|example)/i,
    message: 'Broken/placeholder Unsplash URL found — use a real photo ID',
  },
  {
    id: 'bare-hash-link',
    description: 'Bare href="#" placeholder link',
    pattern: /href="#"(?!\w)/,
    message: 'Bare href="#" placeholder link found — link to a real page or section',
  },
  {
    id: 'wrong-domain-canonical',
    description: 'Canonical URL points to wrong domain',
    pattern: /rel="canonical"[^>]*href="https?:\/\/(?!trailbuiltoverland\.com)/,
    message: 'Canonical URL does not point to trailbuiltoverland.com',
  },
  {
    id: 'wrong-domain-sitemap',
    description: 'Sitemap entry with wrong domain',
    filename: 'sitemap.xml',
    pattern: /<loc>https?:\/\/(?!trailbuiltoverland\.com)/,
    message: 'sitemap.xml contains a URL that does not use trailbuiltoverland.com',
  },
  {
    id: 'missing-og-image',
    description: 'Missing og:image meta tag',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      if (file.includes('email-templates')) return null;
      if (!content.includes('og:image')) {
        return 'Missing <meta property="og:image"> tag';
      }
      return null;
    },
  },
  {
    id: 'missing-canonical',
    description: 'Missing canonical link tag',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      if (file.includes('email-templates')) return null;
      if (!content.includes('rel="canonical"')) {
        return 'Missing <link rel="canonical"> tag';
      }
      return null;
    },
  },
  {
    id: 'missing-ga4',
    description: 'Missing Google Analytics GA4 tag',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      if (file.includes('email-templates')) return null;
      if (!content.includes('G-GX99D9KWL0')) {
        return 'Missing Google Analytics GA4 tag (G-GX99D9KWL0)';
      }
      return null;
    },
  },
  {
    id: 'missing-ahrefs',
    description: 'Missing Ahrefs analytics tag',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      if (file.includes('email-templates')) return null;
      if (!content.includes('analytics.ahrefs.com')) {
        return 'Missing Ahrefs analytics tag';
      }
      return null;
    },
  },
  {
    id: 'duplicate-h1',
    description: 'Multiple H1 tags on the same page',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      const h1Matches = content.match(/<h1[\s>]/gi) || [];
      if (h1Matches.length > 1) {
        return `${h1Matches.length} H1 tags found — only 1 allowed per page`;
      }
      return null;
    },
  },
];

const WARNING_CHECKS = [
  {
    id: 'title-too-long',
    description: 'Page title over 65 characters',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      const match = content.match(/<title>([^<]+)<\/title>/);
      if (match && match[1].length > 65) {
        return `Title is ${match[1].length} chars (max 65): "${match[1].substring(0, 50)}..."`;
      }
      return null;
    },
  },
  {
    id: 'description-too-long',
    description: 'Meta description over 160 characters',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      const match = content.match(/name="description"[^>]*content="([^"]+)"/);
      if (match && match[1].length > 160) {
        return `Description is ${match[1].length} chars (max 160)`;
      }
      return null;
    },
  },
  {
    id: 'missing-alt-text',
    description: 'Image tag missing alt attribute',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      const imgWithoutAlt = (content.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
      if (imgWithoutAlt > 0) {
        return `${imgWithoutAlt} <img> tag(s) missing alt attribute`;
      }
      return null;
    },
  },
  {
    id: 'amazon-tag-missing',
    description: 'Amazon affiliate link missing associate tag',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      const amazonLinks = content.match(/amazon\.com\/[^"'\s]*/g) || [];
      const untagged = amazonLinks.filter(l => !l.includes('tag=') && !l.includes('trailbuiltove'));
      if (untagged.length > 0) {
        return `${untagged.length} Amazon link(s) missing affiliate tag`;
      }
      return null;
    },
  },
  {
    id: 'missing-robots-meta',
    description: 'Missing robots meta tag',
    test: (content, file) => {
      if (!file.endsWith('.html')) return null;
      if (file.includes('email-templates')) return null;
      if (!content.includes('name="robots"')) {
        return 'Missing <meta name="robots"> tag';
      }
      return null;
    },
  },
];

// ── File scanner ──────────────────────────────────────────────────────────────

function getHtmlFiles(targetFile) {
  if (targetFile) {
    return [path.resolve(targetFile)];
  }
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (entry === '.git' || entry === 'node_modules') continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.html') || entry === 'sitemap.xml') {
        files.push(full);
      }
    }
  }
  walk(REPO);
  return files;
}

function runChecks(filePath, content, checks) {
  const results = [];
  const relPath = path.relative(REPO, filePath);
  const filename = path.basename(filePath);

  for (const check of checks) {
    // Skip file-specific checks for other files
    if (check.filename && check.filename !== filename) continue;

    let message = null;

    if (check.test) {
      message = check.test(content, relPath);
    } else if (check.pattern) {
      if (check.pattern.test(content)) {
        message = check.message;
      }
    }

    if (message) {
      results.push({ id: check.id, file: relPath, message });
    }
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const targetFile = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

  const files = getHtmlFiles(targetFile);
  let allCritical = [];
  let allWarnings = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    allCritical.push(...runChecks(filePath, content, CRITICAL_CHECKS));
    allWarnings.push(...runChecks(filePath, content, WARNING_CHECKS));
  }

  const totalFiles = files.length;
  const totalChecks = totalFiles * (CRITICAL_CHECKS.length + WARNING_CHECKS.length);

  console.log('\n══════════════════════════════════════════════');
  console.log('  Trail Built Overlanding — Quality Gate');
  console.log('══════════════════════════════════════════════');
  console.log(`  Files scanned:   ${totalFiles}`);
  console.log(`  Checks run:      ${totalChecks}`);
  console.log(`  Critical issues: ${allCritical.length}`);
  console.log(`  Warnings:        ${allWarnings.length}`);
  console.log('══════════════════════════════════════════════\n');

  if (allCritical.length > 0) {
    console.log('❌ CRITICAL ISSUES (blocking push):\n');
    // Group by file
    const byFile = {};
    for (const issue of allCritical) {
      if (!byFile[issue.file]) byFile[issue.file] = [];
      byFile[issue.file].push(issue);
    }
    for (const [file, issues] of Object.entries(byFile)) {
      console.log(`  📄 ${file}`);
      for (const issue of issues) {
        console.log(`     ❌ [${issue.id}] ${issue.message}`);
      }
      console.log('');
    }
  }

  if (allWarnings.length > 0) {
    console.log('⚠️  WARNINGS (non-blocking):\n');
    const byFile = {};
    for (const w of allWarnings) {
      if (!byFile[w.file]) byFile[w.file] = [];
      byFile[w.file].push(w);
    }
    for (const [file, warns] of Object.entries(byFile)) {
      console.log(`  📄 ${file}`);
      for (const w of warns) {
        console.log(`     ⚠️  [${w.id}] ${w.message}`);
      }
      console.log('');
    }
  }

  const hasBlockingIssues = allCritical.length > 0 || (strict && allWarnings.length > 0);

  if (hasBlockingIssues) {
    console.log('══════════════════════════════════════════════');
    console.log('  ❌ QUALITY GATE FAILED — push blocked');
    console.log('  Fix all critical issues before pushing.');
    console.log('══════════════════════════════════════════════\n');
    process.exit(1);
  } else {
    console.log('══════════════════════════════════════════════');
    console.log('  ✅ QUALITY GATE PASSED');
    if (allWarnings.length > 0) {
      console.log(`  ${allWarnings.length} warning(s) noted — push allowed.`);
    } else {
      console.log('  Zero issues. All checks passed.');
    }
    console.log('══════════════════════════════════════════════\n');
    process.exit(0);
  }
}

main();
