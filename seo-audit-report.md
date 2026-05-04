# Trail Built Overlanding — SEO Audit Report

**Date:** May 4, 2026
**Pages Audited:** 25

---

## Executive Summary

The Trail Built Overlanding site is in excellent SEO health. Out of 25 pages audited across the site (articles, categories, and static pages), there are **0 critical issues** and only **3 minor warnings** localized to a single article. The site successfully passes 266 individual SEO checks, resulting in a **98.8% overall pass rate**.

All affiliate links are properly tagged, JSON-LD structured data is present on all required pages, and the `sitemap.xml` correctly references all 25 URLs with the proper domain.

---

## Audit Overview by Page Type

| Page Type | Count | Issues ❌ | Warnings ⚠️ | Passed ✅ | Pass Rate |
|---|---|---|---|---|---|
| **Static Pages** | 5 | 0 | 0 | 51 | 100.0% |
| **Category Pages** | 8 | 0 | 0 | 88 | 100.0% |
| **Article Pages** | 12 | 0 | 3 | 127 | 97.7% |
| **Total** | **25** | **0** | **3** | **266** | **98.8%** |

---

## Detailed Findings

### ❌ Critical Issues (0)
There are **zero critical issues** across the entire site. All pages have:
- A single `<h1>` tag
- A valid canonical URL pointing to `trailbuiltoverland.com`
- A `robots` meta tag (`index, follow`)
- No broken placeholder (`href="#"`) links

### ⚠️ Warnings (3)
There are 3 minor warnings, all located on a single article:
`/articles/best-overlanding-water-storage-and-filtration.html`
1. **Missing `og:title`**
2. **Missing `og:description`**
3. **Missing `og:image`**

*Recommendation: These OpenGraph tags should be added to ensure the article displays correctly when shared on social media platforms like Facebook, Twitter, and Pinterest.*

---

## Affiliate Link Health

The audit verified that all Amazon links across the site correctly include the `trailbuiltove-20` associate tag. 

**Total Amazon Affiliate Links:** 198

**Distribution by Top Articles:**
- `ford-bronco-overland-build-guide.html`: 26 links
- `jeep-wrangler-overland-build-guide.html`: 19 links
- `toyota-tacoma-overland-build-guide.html`: 18 links
- `best-overlanding-recovery-gear.html`: 10 links

---

## Metadata Length Analysis

Search engines generally prefer title tags between 50-60 characters and meta descriptions between 150-160 characters.

### Title Tags
The vast majority of titles fall perfectly within the optimal range.
- **Optimal (45-65 chars):** 23 pages
- **Too Short (< 45 chars):** 2 pages (`quiz.html`, `best-overlanding-first-aid-kit-essentials.html`)

### Meta Descriptions
Meta descriptions are exceptionally well-optimized, with most sitting right at the 140-155 character sweet spot.
- **Optimal (140-160 chars):** 20 pages
- **Too Short (< 120 chars):** 3 pages (e.g., `lighting.html`, `best-overlanding-water-storage-and-filtration.html`)

---

## Technical SEO Validation

The following technical checks passed successfully across the site:

1. **Sitemap & Robots:** `robots.txt` correctly references the sitemap, and `sitemap.xml` contains all 25 URLs.
2. **Structured Data:** `JSON-LD` schema is present on all article pages, correctly identifying them as `Article` types with `Product` and `Review` schema where applicable.
3. **Canonicalization:** No mismatch between `.html` and extensionless URLs.
