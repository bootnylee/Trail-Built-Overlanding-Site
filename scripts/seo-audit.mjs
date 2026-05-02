// TrailBuiltOverland.com — SEO Audit Script
// Run: node scripts/seo-audit.mjs
// Validates all HTML pages for critical SEO elements and writes a report.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REPORT_FILE = resolve(ROOT, "seo-audit-report.json");
const BASE_URL = "https://trailbuiltoverland.com";

const issues   = [];
const warnings = [];
const passed   = [];

// ── Helper: extract meta content ─────────────────────────────────────────────
function getMeta(html, name) {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"))
         || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"));
  return m ? m[1] : null;
}
function getOg(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
         || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
  return m ? m[1] : null;
}
function getTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}
function getCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
         || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m ? m[1] : null;
}

// ── Collect all HTML files ────────────────────────────────────────────────────
const htmlFiles = [];

// Root pages
["index.html", "reviews.html", "build-guides.html", "quiz.html", "about.html"].forEach(f => {
  const p = resolve(ROOT, f);
  if (existsSync(p)) htmlFiles.push({ path: p, url: `/${f}`, type: "static" });
});

// Category pages
if (existsSync(resolve(ROOT, "categories"))) {
  readdirSync(resolve(ROOT, "categories")).filter(f => f.endsWith(".html")).forEach(f => {
    htmlFiles.push({ path: resolve(ROOT, "categories", f), url: `/categories/${f}`, type: "category" });
  });
}

// Article pages
if (existsSync(resolve(ROOT, "articles"))) {
  readdirSync(resolve(ROOT, "articles")).filter(f => f.endsWith(".html")).forEach(f => {
    htmlFiles.push({ path: resolve(ROOT, "articles", f), url: `/articles/${f}`, type: "article" });
  });
}

console.log(`\n🔍 Auditing ${htmlFiles.length} HTML pages...\n`);

// ── Per-page checks ───────────────────────────────────────────────────────────
const pageResults = htmlFiles.map(({ path, url, type }) => {
  const html = readFileSync(path, "utf-8");
  const pageIssues   = [];
  const pageWarnings = [];
  const pagePassed   = [];

  // Title
  const title = getTitle(html);
  if (!title) {
    pageIssues.push("Missing <title> tag");
  } else if (title.length > 65) {
    pageWarnings.push(`Title too long (${title.length} chars): "${title.substring(0, 60)}..."`);
  } else if (title.length < 20) {
    pageWarnings.push(`Title too short (${title.length} chars): "${title}"`);
  } else {
    pagePassed.push(`Title OK (${title.length} chars)`);
  }

  // Meta description
  const desc = getMeta(html, "description");
  if (!desc) {
    pageIssues.push("Missing meta description");
  } else if (desc.length > 160) {
    pageWarnings.push(`Meta description too long (${desc.length} chars)`);
  } else if (desc.length < 80) {
    pageWarnings.push(`Meta description too short (${desc.length} chars)`);
  } else {
    pagePassed.push(`Meta description OK (${desc.length} chars)`);
  }

  // Canonical
  const canonical = getCanonical(html);
  if (!canonical) {
    pageIssues.push("Missing canonical URL");
  } else if (!canonical.startsWith(BASE_URL)) {
    pageIssues.push(`Canonical uses wrong domain: ${canonical}`);
  } else {
    pagePassed.push("Canonical URL present and correct");
  }

  // OG tags
  const ogTitle = getOg(html, "title");
  const ogDesc  = getOg(html, "description");
  const ogImage = getOg(html, "image");
  if (!ogTitle) pageWarnings.push("Missing og:title");
  else pagePassed.push("og:title present");
  if (!ogDesc) pageWarnings.push("Missing og:description");
  else pagePassed.push("og:description present");
  if (!ogImage) pageWarnings.push("Missing og:image");
  else pagePassed.push("og:image present");

  // Robots meta
  const robots = getMeta(html, "robots");
  if (!robots) pageWarnings.push("Missing robots meta tag");
  else pagePassed.push("robots meta present");

  // H1
  const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
  if (h1Count === 0) pageIssues.push("No H1 tag found");
  else if (h1Count > 1) pageWarnings.push(`Multiple H1 tags (${h1Count})`);
  else pagePassed.push("Single H1 tag");

  // Amazon affiliate tag
  const amazonLinks = html.match(/amazon\.com\/dp\/[A-Z0-9]+/g) || [];
  const untaggedLinks = amazonLinks.filter(l => !html.includes(`${l}?tag=`) && !html.includes(`${l}&tag=`));
  if (untaggedLinks.length > 0) {
    pageIssues.push(`${untaggedLinks.length} Amazon link(s) missing affiliate tag`);
  } else if (amazonLinks.length > 0) {
    pagePassed.push(`All ${amazonLinks.length} Amazon links have affiliate tag`);
  }

  // Broken placeholder links
  const placeholderLinks = (html.match(/href="#"/g) || []).length;
  if (placeholderLinks > 0) {
    pageWarnings.push(`${placeholderLinks} placeholder href="#" link(s) found`);
  } else {
    pagePassed.push("No placeholder href='#' links");
  }

  // Schema / structured data
  const hasSchema = html.includes("application/ld+json");
  if (!hasSchema) pageWarnings.push("No JSON-LD structured data found");
  else pagePassed.push("JSON-LD structured data present");

  return { url, type, issues: pageIssues, warnings: pageWarnings, passed: pagePassed };
});

// ── Aggregate ─────────────────────────────────────────────────────────────────
let totalIssues = 0, totalWarnings = 0, totalPassed = 0;
pageResults.forEach(r => {
  totalIssues   += r.issues.length;
  totalWarnings += r.warnings.length;
  totalPassed   += r.passed.length;
  r.issues.forEach(i => issues.push(`[${r.url}] ${i}`));
  r.warnings.forEach(w => warnings.push(`[${r.url}] ${w}`));
  r.passed.forEach(p => passed.push(`[${r.url}] ${p}`));
});

// ── robots.txt check ──────────────────────────────────────────────────────────
const robotsPath = resolve(ROOT, "robots.txt");
if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, "utf-8");
  if (robots.includes("Sitemap:")) passed.push("robots.txt references sitemap");
  else warnings.push("robots.txt exists but does not reference sitemap");
} else {
  issues.push("robots.txt is missing");
}

// ── sitemap.xml check ─────────────────────────────────────────────────────────
const sitemapPath = resolve(ROOT, "sitemap.xml");
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, "utf-8");
  const urlCount = (sitemap.match(/<url>/g) || []).length;
  if (!sitemap.includes(BASE_URL)) {
    issues.push(`sitemap.xml does not use correct domain (${BASE_URL})`);
  } else if (urlCount < 10) {
    warnings.push(`sitemap.xml only has ${urlCount} URLs — may be incomplete`);
  } else {
    passed.push(`sitemap.xml has ${urlCount} URLs with correct domain`);
  }
} else {
  issues.push("sitemap.xml is missing — run generate-sitemap.mjs");
}

// ── Report ────────────────────────────────────────────────────────────────────
const report = {
  generated: new Date().toISOString(),
  summary: {
    pages: htmlFiles.length,
    issues: totalIssues,
    warnings: totalWarnings,
    passed: totalPassed,
  },
  issues,
  warnings,
  passed,
  pages: pageResults,
};

writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");

console.log("═══════════════════════════════════════");
console.log("  TrailBuilt SEO Audit Report");
console.log("═══════════════════════════════════════");
console.log(`  Pages audited: ${htmlFiles.length}`);
console.log(`  ❌ Issues:     ${totalIssues}`);
console.log(`  ⚠️  Warnings:   ${totalWarnings}`);
console.log(`  ✅ Passed:     ${totalPassed}`);
console.log("═══════════════════════════════════════\n");

if (issues.length > 0) {
  console.log("❌ ISSUES (must fix):");
  issues.forEach(i => console.log(`   ${i}`));
  console.log();
}
if (warnings.length > 0) {
  console.log("⚠️  WARNINGS (should fix):");
  warnings.forEach(w => console.log(`   ${w}`));
  console.log();
}

console.log(`📄 Full report saved to: ${REPORT_FILE}\n`);
