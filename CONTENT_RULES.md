# Content Generation Rules — Trail Built Overland

**Version:** 1.0 | **Effective:** 2026-08-07 | **Applies to:** All buyer's guides and product reviews

These rules are mandatory for any AI-assisted or human content generation on this site.
They exist to prevent phantom part numbers, wrong affiliate links, and product mismatches
from reaching readers.

---

## Rule 1: Part Numbers and Model Numbers Must Come from a Real Catalog Lookup

**Never state a specific model number, part number, or SKU in an article unless it was retrieved from a verified source.**

Acceptable sources (in order of preference):
1. Amazon Product Advertising API (PA-API) — the system of record
2. The manufacturer's official product catalog page (URL must be accessible)
3. A live Amazon product listing (ASIN must be confirmed)

If a specific model number cannot be verified from one of the above sources, use a **generic descriptor** instead.

| ✅ Correct | ❌ Incorrect |
|---|---|
| "Warn's VR EVO 10-S winch" (verified ASIN B07SJHVQTJ) | "Warn 703 High-Lift Jack" (phantom — Warn doesn't make jacks) |
| "a high-capacity ARB skid plate" | "ARB RS6614 skid plate" (fabricated part number) |
| "the Smittybilt X2O 10,000 lb winch" (verified) | "Smittybilt 76899 skid plate" (wrong ASIN, different product) |

---

## Rule 2: Every Amazon Affiliate Link Must Use a Verified ASIN

Before adding or updating a `data-asin` attribute or `href` to an Amazon product:

1. **Look up the ASIN** using `tools/asin_lookup.py`:
   ```bash
   python3 tools/asin_lookup.py B07SJHVQTJ "Warn VR EVO 10-S Winch"
   ```
2. **Confirm the Amazon title fuzzy-matches** the product name in the article (≥35% word overlap)
3. **If no ASIN can be verified**, leave `data-asin=""` and `href=""` — do not use a placeholder ASIN

**Never reuse an ASIN from another product as a placeholder.** A wrong ASIN sends readers to the wrong product and earns commission on a product you didn't recommend.

---

## Rule 3: Pre-Publish Validation Is Mandatory

The Netlify build runs `tools/validate_asins.py` automatically. This script:
- Scans every product box in every buyer's guide
- Verifies each ASIN resolves to a live Amazon listing
- Checks that the Amazon title matches the product name
- **Blocks the deploy** if any product fails

To add a product with no Amazon listing (e.g., ARB direct-only products), add its name to the `KNOWN_BLANK_ASINS` set in `tools/validate_asins.py` so the gate skips it intentionally.

To run validation manually before pushing:
```bash
python3 tools/validate_asins.py --warn-only
```

---

## Rule 4: Weekly Health-Check Monitors All Three Sites

Every Monday at 8:00 AM PT, an automated health-check runs across:
- trailbuiltoverland.com
- silkierstrands.com
- pauseandflourish.com

It re-validates every ASIN for delistings, title changes, and mismatches, and emails a report to Kyle. If you receive a health-check email with failures, fix them before the next publish cycle.

---

## Rule 5: Product Name Format in HTML

When writing a product box, the `data-product` attribute and `<h4>` heading must match:

```html
<!-- ✅ Correct -->
<div class="product-box" data-product="Warn VR EVO 10-S Winch" data-asin="B07SJHVQTJ">
  <h4>Warn VR EVO 10-S Winch</h4>

<!-- ❌ Incorrect — data-product and h4 disagree -->
<div class="product-box" data-product="Warn 703" data-asin="B0B4V6H9C2">
  <h4>Warn 703 High-Lift Jack</h4>
```

---

## Quick Reference: ASIN Validation Commands

```bash
# Verify a single ASIN
python3 tools/asin_lookup.py B07SJHVQTJ "Warn VR EVO 10-S Winch"

# Validate all articles (warn-only, won't block)
python3 tools/validate_asins.py --warn-only

# Validate a single article
python3 tools/validate_asins.py --article articles/best-overlanding-winches.html

# Run the weekly health-check manually (dry run, no email)
python3 tools/weekly_asin_healthcheck.py --dry-run
```

---

## PA-API Setup (One-Time, Enables Faster + More Reliable Validation)

1. Log in to https://affiliate-program.amazon.com/
2. Go to **Tools → Product Advertising API → Manage Credentials**
3. Create credentials and set these environment variables in Netlify:
   - `PAAPI_ACCESS_KEY` — your PA-API access key ID
   - `PAAPI_SECRET_KEY` — your PA-API secret key
   - `PAAPI_ASSOCIATE_TAG` — `trailbuiltove-20`
4. Also set them locally in your `.env` file for running validation scripts manually

Without PA-API credentials, validation falls back to public Amazon page scraping
(slower, may occasionally hit rate limits, but functionally equivalent).
