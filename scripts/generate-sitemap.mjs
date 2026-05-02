// TrailBuiltOverland.com — Sitemap Generator
// Run: node scripts/generate-sitemap.mjs
// Generates /sitemap.xml from all article and category pages
// Called automatically by the GitHub Actions weekly workflow after each new article.

import { writeFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITEMAP_FILE = resolve(ROOT, "sitemap.xml");
const BASE_URL = "https://trailbuiltoverland.com";
const TODAY = new Date().toISOString().split("T")[0];

// ── Static pages ──────────────────────────────────────────────────────────────
const staticPages = [
  { url: "/",                  priority: "1.0", changefreq: "weekly"  },
  { url: "/reviews.html",      priority: "0.9", changefreq: "weekly"  },
  { url: "/build-guides.html", priority: "0.9", changefreq: "weekly"  },
  { url: "/quiz.html",         priority: "0.8", changefreq: "monthly" },
  { url: "/about.html",        priority: "0.5", changefreq: "monthly" },
];

// ── Category pages ─────────────────────────────────────────────────────────────
const categoryPages = existsSync(resolve(ROOT, "categories"))
  ? readdirSync(resolve(ROOT, "categories"))
      .filter(f => f.endsWith(".html"))
      .map(f => ({
        url: `/categories/${f}`,
        priority: "0.8",
        changefreq: "weekly",
      }))
  : [];

// ── Article pages ──────────────────────────────────────────────────────────────
const articlePages = existsSync(resolve(ROOT, "articles"))
  ? readdirSync(resolve(ROOT, "articles"))
      .filter(f => f.endsWith(".html"))
      .map(f => ({
        url: `/articles/${f}`,
        priority: "0.7",
        changefreq: "monthly",
      }))
  : [];

// ── Build XML ─────────────────────────────────────────────────────────────────
const allPages = [...staticPages, ...categoryPages, ...articlePages];

const urlEntries = allPages
  .map(
    ({ url, priority, changefreq }) => `  <url>
    <loc>${BASE_URL}${url}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
  )
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;

writeFileSync(SITEMAP_FILE, xml, "utf-8");

console.log(`\n✅ Sitemap generated: ${allPages.length} URLs`);
console.log(`   Static:     ${staticPages.length}`);
console.log(`   Categories: ${categoryPages.length}`);
console.log(`   Articles:   ${articlePages.length}`);
console.log(`   Saved to:   ${SITEMAP_FILE}\n`);
