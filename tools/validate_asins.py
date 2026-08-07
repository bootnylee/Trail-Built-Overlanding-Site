#!/usr/bin/env python3
"""
validate_asins.py — Pre-publish ASIN validation gate for Trail Built Overland.

PART 2 of the affiliate-link guardrail system.

Run this script as part of the Netlify build command (see netlify.toml).
It scans every HTML article for product ASINs, verifies each one resolves
to a live Amazon listing with a matching title, and exits with code 1
(blocking the deploy) if any product fails.

Usage:
  python3 tools/validate_asins.py [--warn-only] [--output report.json]

Flags:
  --warn-only     Print failures but exit 0 (don't block deploy)
  --output FILE   Write JSON report to FILE (default: asin_validation_report.json)
  --article FILE  Validate a single article file only
  --skip-blank    Skip products with no ASIN (default: skip with a notice)
"""

import sys
import os
import re
import json
import argparse
import time
from pathlib import Path
from datetime import datetime

# Add tools dir to path so we can import asin_lookup
sys.path.insert(0, str(Path(__file__).parent))
from asin_lookup import verify_asin, ASINResult

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
ARTICLES_DIR = REPO_ROOT / "articles"
REPORT_FILE = REPO_ROOT / "asin_validation_report.json"

# ASINs that are intentionally blank (products with no Amazon listing)
# Add to this list when you knowingly have a product without an Amazon link
KNOWN_BLANK_ASINS = set()  # e.g. {"ARB Deluxe Skid Plate", "BDS 55055 Skid Plate"}

# Delay between Amazon requests (seconds) — be polite
REQUEST_DELAY = 1.5


# ─────────────────────────────────────────────────────────────────────────────
# Extract products from HTML
# ─────────────────────────────────────────────────────────────────────────────
def extract_products_from_html(html_path: Path) -> list[dict]:
    """
    Extract all product boxes from a buyer's guide HTML file.
    Returns list of dicts with keys: article, product_name, asin, h4
    """
    content = html_path.read_text(encoding="utf-8")
    products = []

    # Match product boxes: <div class="product-box" data-product="..." data-asin="...">
    # Handle both attribute orderings
    pattern = re.compile(
        r'<div[^>]*class="product-box"[^>]*data-product="([^"]*)"[^>]*data-asin="([^"]*)"',
    )
    pattern2 = re.compile(
        r'<div[^>]*class="product-box"[^>]*data-asin="([^"]*)"[^>]*data-product="([^"]*)"',
    )

    for m in pattern.finditer(content):
        products.append({
            "article": html_path.name,
            "product_name": m.group(1).strip(),
            "asin": m.group(2).strip(),
        })

    for m in pattern2.finditer(content):
        entry = {
            "article": html_path.name,
            "product_name": m.group(2).strip(),
            "asin": m.group(1).strip(),
        }
        # Avoid duplicates
        if not any(p["product_name"] == entry["product_name"] and
                   p["article"] == entry["article"] for p in products):
            products.append(entry)

    # Also check product-box-image structure (Group 1 articles use this)
    img_pattern = re.compile(
        r'<div[^>]*class="product-box"[^>]*data-product="([^"]*)"[^>]*data-asin="([^"]*)"'
        r'.*?<div class="product-box-image"><img[^>]*alt="([^"]*)"',
        re.DOTALL
    )
    # (already captured above via data-product/data-asin)

    return products


def extract_all_products(articles_dir: Path, single_file: Path = None) -> list[dict]:
    """Extract products from all buyer's guide articles."""
    if single_file:
        return extract_products_from_html(single_file)

    all_products = []
    for html_file in sorted(articles_dir.glob("best-*.html")):
        all_products.extend(extract_products_from_html(html_file))
    return all_products


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────
def validate_products(products: list[dict], warn_only: bool = False) -> dict:
    """
    Validate all products. Returns a report dict.
    """
    results = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "total": len(products),
        "passed": 0,
        "failed": 0,
        "skipped_blank": 0,
        "failures": [],
        "passes": [],
        "skipped": [],
    }

    print(f"\n{'='*60}")
    print(f"ASIN Validation Gate — Trail Built Overland")
    print(f"{'='*60}")
    print(f"Checking {len(products)} products across {len(set(p['article'] for p in products))} articles...")
    print(f"Mode: {'warn-only' if warn_only else 'blocking'}\n")

    for i, product in enumerate(products):
        asin = product["asin"]
        name = product["product_name"]
        article = product["article"]

        # Skip blank ASINs
        if not asin:
            if name in KNOWN_BLANK_ASINS:
                print(f"  ~ [{article}] {name}: blank ASIN (known, skipped)")
            else:
                print(f"  ~ [{article}] {name}: no ASIN (needs manual review)")
            results["skipped_blank"] += 1
            results["skipped"].append({"article": article, "product": name, "reason": "no_asin"})
            continue

        # Validate
        result = verify_asin(asin, name)

        if result.ok:
            print(f"  ✓ [{article}] {name} ({asin}) → {(result.amazon_title or '')[:50]}")
            results["passed"] += 1
            results["passes"].append({
                "article": article,
                "product": name,
                "asin": asin,
                "amazon_title": result.amazon_title,
                "match_score": result.match_score,
                "source": result.source,
            })
        else:
            issue = []
            if not result.resolves:
                issue.append(f"ASIN does not resolve ({result.error or 'not found'})")
            elif not result.title_match:
                issue.append(
                    f"title mismatch (score {result.match_score:.0%}): "
                    f"expected '{name}' but got '{result.amazon_title or 'N/A'}'"
                )
            issue_str = "; ".join(issue)
            print(f"  ✗ [{article}] {name} ({asin}): {issue_str}")
            results["failed"] += 1
            results["failures"].append({
                "article": article,
                "product": name,
                "asin": asin,
                "amazon_title": result.amazon_title,
                "match_score": result.match_score,
                "issue": issue_str,
                "source": result.source,
            })

        # Polite delay between requests
        if i < len(products) - 1:
            time.sleep(REQUEST_DELAY)

    return results


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Validate affiliate ASINs before deploy")
    parser.add_argument("--warn-only", action="store_true",
                        help="Print failures but exit 0 (don't block deploy)")
    parser.add_argument("--output", default=str(REPORT_FILE),
                        help="Path to write JSON report")
    parser.add_argument("--article", default=None,
                        help="Validate a single article file only")
    args = parser.parse_args()

    single_file = Path(args.article) if args.article else None
    products = extract_all_products(ARTICLES_DIR, single_file)

    if not products:
        print("No products found to validate.")
        sys.exit(0)

    report = validate_products(products, warn_only=args.warn_only)

    # Write report
    report_path = Path(args.output)
    report_path.write_text(json.dumps(report, indent=2))

    # Print summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"  Passed:  {report['passed']}")
    print(f"  Failed:  {report['failed']}")
    print(f"  Skipped: {report['skipped_blank']} (blank ASINs)")
    print(f"  Report:  {report_path}")

    if report["failures"]:
        print(f"\n⚠  {report['failed']} product(s) failed validation:")
        for f in report["failures"]:
            print(f"   • [{f['article']}] {f['product']} ({f['asin']}): {f['issue']}")

        if args.warn_only:
            print("\n⚠  warn-only mode: deploy proceeding despite failures.")
            sys.exit(0)
        else:
            print("\n✗  Deploy BLOCKED. Fix the above issues before publishing.")
            print("   To override (not recommended): add --warn-only flag to the build command.")
            sys.exit(1)
    else:
        print(f"\n✓  All products validated. Deploy proceeding.")
        sys.exit(0)


if __name__ == "__main__":
    main()
