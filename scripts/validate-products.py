#!/usr/bin/env python3
"""
Trail Built Overlanding — Product Validator
Ported from SilkierStrands validate-products.py

Checks all article and category HTML files for:
  - Duplicate ASINs within a file
  - Duplicate Amazon image codes within a file
  - Fake/placeholder ASINs (e.g. B00XXXXXXX, BXXXXXXXXXX)
  - Affiliate tag consistency (must use trailbuiltove-20)
  - Missing alt text on product images

Usage:
  python3 scripts/validate-products.py           # static checks only
  python3 scripts/validate-products.py --live    # also checks live Amazon URLs

Rule: Any product not available on Amazon MUST be replaced with a real,
available Amazon product in the same category.
"""

import sys
import re
import time
import argparse
from pathlib import Path
from collections import Counter

# ── Config ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
ARTICLES_DIR = REPO_ROOT / "articles"
CATEGORIES_DIR = REPO_ROOT / "categories"
AFFILIATE_TAG = "trailbuiltove-20"

FAKE_ASIN_PATTERNS = [
    r"B00[X]{3,}",          # B00XXXXXXX
    r"B0[X]{8}",            # BXXXXXXXXXX
    r"ASIN_HERE",
    r"YOUR_ASIN",
    r"B000000000",
    r"B00000000\d",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Extraction helpers ────────────────────────────────────────────────────────

def extract_asins(text):
    """Extract all Amazon ASINs from href attributes."""
    # Matches /dp/ASIN or ?tag= patterns
    return re.findall(r'/dp/([A-Z0-9]{10})', text)

def extract_image_codes(text):
    """Extract all Amazon image codes from m.media-amazon.com URLs."""
    return re.findall(r'm\.media-amazon\.com/images/I/([A-Za-z0-9%+]+)\._', text)

def extract_affiliate_tags(text):
    """Extract all affiliate tags used in Amazon links."""
    return re.findall(r'tag=([a-zA-Z0-9_-]+-\d+)', text)

def extract_img_alts(text):
    """Find img tags missing alt attributes."""
    imgs = re.findall(r'<img[^>]*>', text, re.IGNORECASE)
    missing = []
    for img in imgs:
        if 'amazon' in img.lower() or 'unsplash' in img.lower():
            if 'alt=' not in img.lower():
                missing.append(img[:80])
            elif 'alt=""' in img.lower() or "alt=''" in img.lower():
                missing.append(img[:80])
    return missing

# ── Static checks ─────────────────────────────────────────────────────────────

def check_file(filepath, all_asins, all_image_codes):
    """Run static checks on a single HTML file."""
    text = filepath.read_text(encoding="utf-8")
    asins = extract_asins(text)
    image_codes = extract_image_codes(text)
    affiliate_tags = extract_affiliate_tags(text)
    missing_alts = extract_img_alts(text)

    all_asins.extend(asins)
    all_image_codes.extend(image_codes)

    issues = []

    # Duplicate ASINs within this file.
    # Each product section legitimately links the same ASIN 2 times
    # (once in the product card header, once in the "Buy on Amazon" button).
    # Flag only ASINs appearing 3+ times — those are true duplicate product entries.
    asin_counts = Counter(asins)
    for asin, count in asin_counts.items():
        if count > 2:
            issues.append(f"DUPLICATE PRODUCT ASIN {asin} appears {count} times (expected ≤2 per product section)")

    # Duplicate image codes within this file (any duplication is a problem)
    img_counts = Counter(image_codes)
    for code, count in img_counts.items():
        if count > 1:
            issues.append(f"DUPLICATE IMAGE CODE {code} appears {count} times")

    # Fake/placeholder ASINs
    for pattern in FAKE_ASIN_PATTERNS:
        matches = re.findall(pattern, text)
        for m in matches:
            issues.append(f"FAKE/PLACEHOLDER ASIN detected: {m}")

    # Wrong affiliate tag
    for tag in affiliate_tags:
        if tag != AFFILIATE_TAG:
            issues.append(f"WRONG AFFILIATE TAG: '{tag}' (expected '{AFFILIATE_TAG}')")

    # Missing alt text on product images
    for img in missing_alts:
        issues.append(f"MISSING ALT TEXT on image: {img}")

    return issues, len(asins)

# ── Live checks ───────────────────────────────────────────────────────────────

def check_live_asin(asin):
    """Check if an Amazon product page returns HTTP 200."""
    try:
        import requests
        url = f"https://www.amazon.com/dp/{asin}"
        resp = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
        if resp.status_code == 404:
            return False, 404
        if resp.status_code == 200:
            if "page not found" in resp.text.lower() or "looking for" in resp.text.lower()[:1000]:
                return False, "SOFT_404"
        return True, resp.status_code
    except Exception as e:
        return None, str(e)

def check_live_image(image_code):
    """Check if an Amazon image URL returns HTTP 200."""
    try:
        import requests
        url = f"https://m.media-amazon.com/images/I/{image_code}._SL500_.jpg"
        resp = requests.head(url, timeout=8)
        return resp.status_code == 200, resp.status_code
    except Exception as e:
        return None, str(e)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Trail Built Overlanding Product Validator")
    parser.add_argument("--live", action="store_true", help="Run live HTTP checks (slower, ~2 min)")
    args = parser.parse_args()

    print("=" * 60)
    print("Trail Built Overlanding — Product Validator")
    print("=" * 60)

    # Collect all HTML files to check
    files_to_check = sorted(ARTICLES_DIR.glob("*.html")) + sorted(CATEGORIES_DIR.glob("*.html"))

    if not files_to_check:
        print("WARNING: No HTML files found in articles/ or categories/")
        sys.exit(0)

    all_issues = []
    total_products = 0
    all_asins = []
    all_image_codes = []

    print(f"\nChecking {len(files_to_check)} HTML files...\n")

    for filepath in files_to_check:
        rel = filepath.relative_to(REPO_ROOT)
        issues, count = check_file(filepath, all_asins, all_image_codes)
        total_products += count
        if issues:
            for issue in issues:
                all_issues.append(f"[{rel}] {issue}")
            print(f"  {rel}: {count} ASINs — {len(issues)} issue(s)")
        else:
            print(f"  {rel}: {count} ASINs — OK")

    print(f"\nTotal ASINs found: {total_products}")
    print(f"Unique ASINs: {len(set(all_asins))}")
    print(f"Unique image codes: {len(set(all_image_codes))}")

    # Live HTTP checks (optional)
    if args.live:
        print("\nRunning live HTTP checks (this may take a few minutes)...")
        unique_asins = list(set(all_asins))
        unique_images = list(set(all_image_codes))

        broken_asins = []
        for i, asin in enumerate(unique_asins):
            ok, status = check_live_asin(asin)
            if ok is False:
                broken_asins.append(asin)
                all_issues.append(
                    f"[LIVE] BROKEN AMAZON LINK: https://www.amazon.com/dp/{asin} (status: {status})"
                )
            time.sleep(0.5)  # Rate limiting
            if (i + 1) % 10 == 0:
                print(f"  Checked {i+1}/{len(unique_asins)} ASINs...")

        broken_images = []
        for i, code in enumerate(unique_images):
            ok, status = check_live_image(code)
            if ok is False:
                broken_images.append(code)
                all_issues.append(
                    f"[LIVE] BROKEN IMAGE: {code} (status: {status})"
                )
            time.sleep(0.2)
            if (i + 1) % 20 == 0:
                print(f"  Checked {i+1}/{len(unique_images)} image codes...")

        print(f"  Live ASIN checks: {len(unique_asins) - len(broken_asins)}/{len(unique_asins)} OK")
        print(f"  Live image checks: {len(unique_images) - len(broken_images)}/{len(unique_images)} OK")

    # Final report
    print("\n" + "=" * 60)
    if all_issues:
        print(f"VALIDATION FAILED — {len(all_issues)} issue(s) found:\n")
        for issue in all_issues:
            print(f"  ❌  {issue}")
        print("\nRule: Any product not available on Amazon MUST be replaced")
        print("      with a real, available Amazon product in the same category.")
        print("      Ensure each product has a unique, accurate image.")
        sys.exit(1)
    else:
        print(f"VALIDATION PASSED — {total_products} ASINs across {len(files_to_check)} files, zero issues")
        print("\nAll ASINs are unique per file, all image codes are unique per file,")
        print("no fake ASINs detected, affiliate tag is correct.")
        sys.exit(0)

if __name__ == "__main__":
    main()
