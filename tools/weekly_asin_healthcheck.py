#!/usr/bin/env python3
"""
weekly_asin_healthcheck.py — Weekly ASIN health-check across all three sites.

PART 3 of the affiliate-link guardrail system.

Validates every affiliate ASIN on TrailBuilt, SilkierStrands, and PauseAndFlourish.
Sends a concise email report to Kyle via Gmail (uses the Gmail MCP connector).

Designed to run as a scheduled Manus task every Monday at 8:00 AM PT.

Usage:
  python3 tools/weekly_asin_healthcheck.py [--dry-run]

  --dry-run: Run checks but don't send email; print report to stdout instead.

Sites checked:
  - TrailBuilt Overland (trailbuiltoverland.com) — static HTML, ASINs in data-asin attrs
  - SilkierStrands (silkierstrands.com) — React app, ASINs in products.ts
  - PauseAndFlourish (pauseandflourish.com) — React app, ASINs in products.ts

Configuration:
  Set PAAPI_ACCESS_KEY, PAAPI_SECRET_KEY, PAAPI_ASSOCIATE_TAG for PA-API.
  Without them, falls back to public page scraping (slower, may hit rate limits).
"""

import sys
import os
import re
import json
import time
import argparse
from pathlib import Path
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# Site configurations — update paths if repos are cloned elsewhere
# ─────────────────────────────────────────────────────────────────────────────
SITES = [
    {
        "name": "Trail Built Overland",
        "url": "https://trailbuiltoverland.com",
        "repo": Path("/home/ubuntu/trail-built-overland"),
        "type": "static_html",
        "affiliate_tag": "trailbuiltove-20",
    },
    {
        "name": "SilkierStrands",
        "url": "https://silkierstrands.com",
        "repo": Path("/home/ubuntu/silkierstrands"),
        "type": "react_products_ts",
        "affiliate_tag": "silkierstrands-20",
        "products_file": "client/src/lib/products.ts",
    },
    {
        "name": "PauseAndFlourish",
        "url": "https://pauseandflourish.com",
        "repo": Path("/home/ubuntu/pauseandflourish"),
        "type": "react_products_ts",
        "affiliate_tag": "pauseandflourish-20",
        "products_file": "client/src/lib/products.ts",
    },
]

# Add tools dir to path
sys.path.insert(0, str(Path(__file__).parent))
from asin_lookup import verify_asin

REQUEST_DELAY = 1.5


# ─────────────────────────────────────────────────────────────────────────────
# Product extraction per site type
# ─────────────────────────────────────────────────────────────────────────────
def extract_static_html_products(repo: Path) -> list[dict]:
    """Extract ASINs from static HTML buyer's guide articles."""
    products = []
    articles_dir = repo / "articles"
    if not articles_dir.exists():
        return products

    for html_file in sorted(articles_dir.glob("best-*.html")):
        content = html_file.read_text(encoding="utf-8")
        # data-product + data-asin pattern
        for m in re.finditer(
            r'<div[^>]*class="product-box"[^>]*data-product="([^"]*)"[^>]*data-asin="([^"]*)"',
            content
        ):
            name, asin = m.group(1).strip(), m.group(2).strip()
            if asin:
                products.append({"article": html_file.name, "name": name, "asin": asin})
        # reversed attribute order
        for m in re.finditer(
            r'<div[^>]*class="product-box"[^>]*data-asin="([^"]*)"[^>]*data-product="([^"]*)"',
            content
        ):
            asin, name = m.group(1).strip(), m.group(2).strip()
            if asin and not any(p["name"] == name and p["article"] == html_file.name for p in products):
                products.append({"article": html_file.name, "name": name, "asin": asin})
    return products


def extract_react_products(repo: Path, products_file: str) -> list[dict]:
    """Extract ASINs from a React products.ts file."""
    products = []
    ts_path = repo / products_file
    if not ts_path.exists():
        return products

    content = ts_path.read_text(encoding="utf-8")

    # Match product objects: look for asin: "XXXXXXXXXX" near name: "..."
    # Pattern: find all objects with both name and asin fields
    obj_pattern = re.compile(
        r'\{[^{}]*?name:\s*["\']([^"\']{3,100})["\'][^{}]*?asin:\s*["\']([A-Z0-9]{10})["\'][^{}]*?\}',
        re.DOTALL
    )
    for m in obj_pattern.finditer(content):
        name, asin = m.group(1).strip(), m.group(2).strip()
        products.append({"article": products_file, "name": name, "asin": asin})

    # Also try reversed order (asin before name)
    obj_pattern2 = re.compile(
        r'\{[^{}]*?asin:\s*["\']([A-Z0-9]{10})["\'][^{}]*?name:\s*["\']([^"\']{3,100})["\'][^{}]*?\}',
        re.DOTALL
    )
    for m in obj_pattern2.finditer(content):
        asin, name = m.group(1).strip(), m.group(2).strip()
        if not any(p["asin"] == asin and p["name"] == name for p in products):
            products.append({"article": products_file, "name": name, "asin": asin})

    return products


def extract_site_products(site: dict) -> list[dict]:
    """Extract all products from a site based on its type."""
    repo = site["repo"]
    if not repo.exists():
        print(f"  ⚠ Repo not found: {repo}")
        return []

    if site["type"] == "static_html":
        return extract_static_html_products(repo)
    elif site["type"] == "react_products_ts":
        return extract_react_products(repo, site.get("products_file", "client/src/lib/products.ts"))
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────
def validate_site(site: dict) -> dict:
    """Validate all products for one site. Returns a site report dict."""
    print(f"\n  Checking {site['name']} ({site['url']})...")
    products = extract_site_products(site)
    print(f"  Found {len(products)} products with ASINs")

    site_report = {
        "site": site["name"],
        "url": site["url"],
        "total": len(products),
        "passed": 0,
        "failed": 0,
        "failures": [],
    }

    for i, p in enumerate(products):
        result = verify_asin(p["asin"], p["name"])
        if result.ok:
            site_report["passed"] += 1
        else:
            site_report["failed"] += 1
            issue = []
            if not result.resolves:
                issue.append(f"ASIN not found ({result.error or 'delisted'})")
            elif not result.title_match:
                issue.append(
                    f"title mismatch ({result.match_score:.0%}): "
                    f"got '{(result.amazon_title or 'N/A')[:60]}'"
                )
            site_report["failures"].append({
                "article": p.get("article", ""),
                "product": p["name"],
                "asin": p["asin"],
                "issue": "; ".join(issue),
                "amazon_title": result.amazon_title,
            })
            print(f"    ✗ {p['name']} ({p['asin']}): {'; '.join(issue)}")

        if i < len(products) - 1:
            time.sleep(REQUEST_DELAY)

    return site_report


# ─────────────────────────────────────────────────────────────────────────────
# Email report formatting
# ─────────────────────────────────────────────────────────────────────────────
def format_email_report(site_reports: list[dict], run_date: str) -> tuple[str, str]:
    """Returns (subject, body_html) for the weekly health-check email."""
    total_products = sum(r["total"] for r in site_reports)
    total_failed = sum(r["failed"] for r in site_reports)
    total_passed = sum(r["passed"] for r in site_reports)

    status_emoji = "✅" if total_failed == 0 else "⚠️"
    subject = f"{status_emoji} Weekly Affiliate Link Health-Check — {run_date}"

    lines = [
        f"<h2>Weekly Affiliate Link Health-Check</h2>",
        f"<p><strong>Run date:</strong> {run_date}</p>",
        f"<p><strong>Total products checked:</strong> {total_products} "
        f"({total_passed} passed, {total_failed} failed)</p>",
    ]

    if total_failed == 0:
        lines.append("<p>✅ <strong>All affiliate links are healthy.</strong> No action required.</p>")
    else:
        lines.append(f"<p>⚠️ <strong>{total_failed} product(s) need attention.</strong></p>")

    for r in site_reports:
        lines.append(f"<h3>{r['site']} ({r['url']})</h3>")
        lines.append(f"<p>{r['passed']}/{r['total']} products OK</p>")
        if r["failures"]:
            lines.append("<table border='1' cellpadding='4' style='border-collapse:collapse'>")
            lines.append("<tr><th>Article</th><th>Product</th><th>ASIN</th><th>Issue</th></tr>")
            for f in r["failures"]:
                lines.append(
                    f"<tr>"
                    f"<td>{f['article']}</td>"
                    f"<td>{f['product']}</td>"
                    f"<td><a href='https://www.amazon.com/dp/{f[\"asin\"]}'>{f['asin']}</a></td>"
                    f"<td>{f['issue']}</td>"
                    f"</tr>"
                )
            lines.append("</table>")
        else:
            lines.append("<p>✅ No issues.</p>")

    lines.append("<hr><p><small>Sent by Trail Built Overland affiliate guardrail system.</small></p>")
    body = "\n".join(lines)
    return subject, body


def format_plain_report(site_reports: list[dict], run_date: str) -> str:
    """Plain-text version of the report for stdout/dry-run."""
    total_failed = sum(r["failed"] for r in site_reports)
    total_passed = sum(r["passed"] for r in site_reports)
    total = sum(r["total"] for r in site_reports)

    lines = [
        f"Weekly Affiliate Link Health-Check — {run_date}",
        f"{'='*60}",
        f"Total: {total} products | Passed: {total_passed} | Failed: {total_failed}",
        "",
    ]
    for r in site_reports:
        lines.append(f"--- {r['site']} ---")
        lines.append(f"  {r['passed']}/{r['total']} OK")
        for f in r["failures"]:
            lines.append(f"  ✗ [{f['article']}] {f['product']} ({f['asin']}): {f['issue']}")
        lines.append("")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Weekly ASIN health-check across all sites")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run checks but print report instead of emailing")
    args = parser.parse_args()

    run_date = datetime.utcnow().strftime("%Y-%m-%d")
    print(f"Weekly ASIN Health-Check — {run_date}")
    print(f"{'='*60}")

    site_reports = []
    for site in SITES:
        report = validate_site(site)
        site_reports.append(report)

    # Save JSON report
    report_path = Path("/home/ubuntu/trail-built-overland/asin_healthcheck_report.json")
    full_report = {
        "run_date": run_date,
        "sites": site_reports,
        "total_failed": sum(r["failed"] for r in site_reports),
    }
    report_path.write_text(json.dumps(full_report, indent=2))
    print(f"\nReport saved to: {report_path}")

    subject, body_html = format_email_report(site_reports, run_date)
    plain = format_plain_report(site_reports, run_date)

    if args.dry_run:
        print(f"\n{'='*60}")
        print("DRY RUN — email not sent. Report:")
        print(f"{'='*60}")
        print(plain)
        return

    # Send email via Gmail MCP
    # The Gmail MCP connector is enabled in this Manus project.
    # This script is designed to be run inside a Manus scheduled task
    # where the Gmail connector is available.
    total_failed = sum(r["failed"] for r in site_reports)
    print(f"\n{'='*60}")
    print(plain)
    print(f"{'='*60}")
    print(f"\nEmail report ready. Subject: {subject}")
    print("(Email will be sent by the Manus scheduled task via Gmail connector)")

    # Return the report content so the Manus task can send it
    return subject, body_html, plain


if __name__ == "__main__":
    main()
