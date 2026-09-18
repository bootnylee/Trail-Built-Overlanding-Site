#!/usr/bin/env node
/**
 * Covers the weekly newsletter article selection (NEWSLETTER-0918).
 *
 * Why this test exists
 * --------------------
 * SS and P&F went two weeks without a newsletter: their scan read one record
 * type only, and the resulting skip exited 0 every Tuesday, indistinguishable
 * from "we already sent the newest thing". Trail Built is a static site — every
 * page in articles/ is scanned, so it has no equivalent blind spot and there is
 * no separate comparison collection here — but it shared the silent skip.
 *
 * What it asserts, against the real script on a synthetic articles/ fixture:
 *   1. the newest dated article is selected                          -> /articles/<slug>.html
 *   2. a same-day tie is broken deterministically by slug ascending  (both directions)
 *   3. a corpus older than the stall threshold fails LOUDLY          -> exit 1 + CONTENT_STALLED
 *   4. "already sent the newest stem" stays quiet                    -> exit 0 + ALREADY_STAGED
 *
 * Tautology proof: drop the stall gate and case 3 fails (exit 0, no
 * CONTENT_STALLED); break the slug tie-break and case 2 fails.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "prepare-weekly-newsletter.mjs");
const TODAY = "2026-09-18";
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-selection-"));

function articlePage({ slug, title, publishDate }) {
  const url = `https://trailbuiltoverland.com/articles/${slug}.html`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description: "A deliberately long enough description sentence so the excerpt builder keeps it intact.",
    image: { "@type": "ImageObject", url: "https://images.example.com/hero.jpg" },
    datePublished: publishDate,
    url,
  };
  return `<!doctype html>
<html lang="en"><head>
<link rel="canonical" href="${url}" />
<meta name="description" content="A deliberately long enough description sentence so the excerpt builder keeps it intact." />
<meta property="og:title" content="${title}" />
<meta property="og:image" content="https://images.example.com/hero.jpg" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body><p>A deliberately long enough body paragraph so the excerpt builder has a second sentence to work with here.</p></body></html>
`;
}

let caseIndex = 0;
function run({ articles, preStage = null }) {
  const label = `case-${++caseIndex}`;
  const articlesDir = path.join(workspace, `${label}-articles`);
  const outputDir = path.join(workspace, label);
  fs.mkdirSync(articlesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  for (const article of articles) fs.writeFileSync(path.join(articlesDir, `${article.slug}.html`), articlePage(article), "utf8");
  if (preStage) fs.writeFileSync(path.join(outputDir, `${preStage}.html`), "staged earlier", "utf8");

  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NEWSLETTER_NOW: TODAY,
      NEWSLETTER_ARTICLES_DIR: articlesDir,
      NEWSLETTER_OUTPUT_DIR: outputDir,
      NEWSLETTER_COMMIT: "false",
      NEWSLETTER_TEST_MODE: "",
      GITHUB_ACTIONS: "",
      GITHUB_OUTPUT: "",
    },
  });
  return { ...result, outputDir, staged: fs.readdirSync(outputDir) };
}

const fresh = "2026-09-14";

// 1. Newest dated article wins.
{
  const r = run({
    articles: [
      { slug: "zzz-older-guide", title: "ZZZ Older Guide", publishDate: "2026-09-07" },
      { slug: "aaa-newest-guide", title: "AAA Newest Guide", publishDate: fresh },
    ],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CTA_URL: https:\/\/[^/]+\/articles\/aaa-newest-guide\.html/);
  const html = fs.readFileSync(path.join(r.outputDir, `${fresh}-aaa-newest-guide.html`), "utf8");
  assert.match(html, /Read the full guide/);
  console.log("PASS newest article is selected");
}

// 2. Same-day tie -> lowest slug wins, in either file order.
{
  const first = run({
    articles: [
      { slug: "zzz-tied-guide", title: "ZZZ Tied Guide", publishDate: fresh },
      { slug: "aaa-tied-guide", title: "AAA Tied Guide", publishDate: fresh },
    ],
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /articles\/aaa-tied-guide\.html/);

  const second = run({
    articles: [
      { slug: "aaa-tied-guide", title: "AAA Tied Guide", publishDate: fresh },
      { slug: "mmm-tied-guide", title: "MMM Tied Guide", publishDate: fresh },
    ],
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /articles\/aaa-tied-guide\.html/);
  console.log("PASS same-day tie breaks deterministically on slug");
}

// 3. Nothing newer than the stall threshold -> loud failure, nothing staged.
{
  const r = run({
    articles: [{ slug: "aaa-stale-guide", title: "AAA Stale Guide", publishDate: "2026-08-24" }],
  });
  assert.equal(r.status, 1, `expected a non-zero exit, got ${r.status}`);
  assert.match(r.stderr, /NEWSLETTER_PREP_FAILED: CONTENT_STALLED/);
  assert.match(r.stderr, /25 days old/);
  assert.match(r.stderr, /authoring\/content-pipeline failure/);
  assert.deepEqual(r.staged, []);
  console.log("PASS stalled corpus fails loudly");
}

// 4. Newest stem already staged -> quiet no-op, exit 0.
{
  const r = run({
    articles: [{ slug: "aaa-newest-guide", title: "AAA Newest Guide", publishDate: fresh }],
    preStage: `${fresh}-aaa-newest-guide`,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ALREADY_STAGED/);
  assert.doesNotMatch(r.stdout, /NEWSLETTER_PREPARED/);
  console.log("PASS already-sent week stays quiet");
}

fs.rmSync(workspace, { recursive: true, force: true });
console.log("ALL PASS scripts/test-weekly-newsletter-selection.mjs");
