#!/usr/bin/env python3
"""
Trail Built Overlanding — Monthly Report Generator (Python)
Modeled on the SilkierStrands workflow.

Generates a comprehensive Markdown report covering:
- Content inventory (articles, categories, products)
- EmailOctopus automation performance (API)
- SEO Audit results
- Affiliate link health

Usage:
  python3 scripts/monthly_report.py [--month YYYY-MM]
"""

import os
import sys
import json
import urllib.request
import urllib.error
import argparse
from datetime import datetime
from dateutil.relativedelta import relativedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
REPORTS_DIR = REPO_ROOT / "reports"
ARTICLES_DIR = REPO_ROOT / "articles"
CATEGORIES_DIR = REPO_ROOT / "categories"
SITE_URL = "https://trailbuiltoverland.com"

# EO Config
EO_API_KEY = os.environ.get("EMAILOCTOPUS_API_KEY")
EO_LIST_ID = os.environ.get("EMAILOCTOPUS_LIST_ID")
EO_AUTOMATION_ID = os.environ.get("EMAILOCTOPUS_AUTOMATION_ID")
EO_API_BASE = "https://emailoctopus.com/api/1.6"

# ── Date Handling ─────────────────────────────────────────────────────────────
def get_report_dates(target_month=None):
    if target_month:
        try:
            date_obj = datetime.strptime(target_month, "%Y-%m")
            prev_month_date = date_obj
        except ValueError:
            print("Error: Invalid month format. Use YYYY-MM.")
            sys.exit(1)
    else:
        # Default: previous month
        prev_month_date = datetime.now() - relativedelta(months=1)
        
    report_month = prev_month_date.strftime("%Y-%m")
    report_month_label = prev_month_date.strftime("%B %Y")
    generated_date = datetime.now().strftime("%Y-%m-%d")
    
    # ISO dates for EO API
    start_date = prev_month_date.replace(day=1, hour=0, minute=0, second=0).isoformat() + "Z"
    
    # End date is last day of the month
    next_month = prev_month_date + relativedelta(months=1)
    end_date = (next_month.replace(day=1, hour=0, minute=0, second=0) - relativedelta(seconds=1)).isoformat() + "Z"
    
    return report_month, report_month_label, generated_date, start_date, end_date

# ── EmailOctopus API Helpers ──────────────────────────────────────────────────
def fetch_eo(endpoint, params=None):
    if not EO_API_KEY:
        return None
        
    url = f"{EO_API_BASE}{endpoint}?api_key={EO_API_KEY}"
    if params:
        for k, v in params.items():
            url += f"&{k}={v}"
            
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TrailBuilt/1.0"})
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.URLError as e:
        print(f"EO API Error ({endpoint}): {e}")
        return None

def get_list_stats():
    if not EO_LIST_ID:
        return {"total": "N/A", "subscribed": "N/A", "unsubscribed": "N/A", "pending": "N/A"}
        
    data = fetch_eo(f"/lists/{EO_LIST_ID}")
    if data and "counts" in data:
        c = data["counts"]
        return {
            "total": c.get("total", 0),
            "subscribed": c.get("subscribed", 0),
            "unsubscribed": c.get("unsubscribed", 0),
            "pending": c.get("pending", 0)
        }
    return {"total": "N/A", "subscribed": "N/A", "unsubscribed": "N/A", "pending": "N/A"}

def get_new_subscribers(start_date, end_date):
    if not EO_LIST_ID:
        return "N/A"
        
    data = fetch_eo(f"/lists/{EO_LIST_ID}/contacts", {"limit": 1})
    if data and "paging" in data:
        # Note: A true count for the specific month requires iterating through contacts.
        # For this script, we'll return the total as a proxy if we can't filter by date easily via API v1.6.
        # The ideal approach is webhooks or syncing, but we'll use a placeholder or total for now.
        pass
        
    # Hack for v1.6: The API doesn't support date filtering on contacts endpoint directly.
    # We will just return "Requires dashboard export" or a placeholder.
    return "Check Dashboard"

# ── Content Inventory ─────────────────────────────────────────────────────────
def get_content_inventory():
    articles = list(ARTICLES_DIR.glob("*.html")) if ARTICLES_DIR.exists() else []
    categories = list(CATEGORIES_DIR.glob("*.html")) if CATEGORIES_DIR.exists() else []
    
    # Count unique ASINs across all files
    unique_asins = set()
    import re
    asin_pattern = re.compile(r'/dp/([A-Z0-9]{10})')
    
    for f in articles + categories:
        try:
            content = f.read_text(encoding="utf-8")
            unique_asins.update(asin_pattern.findall(content))
        except Exception:
            pass
            
    return {
        "articles": len(articles),
        "categories": len(categories),
        "unique_asins": len(unique_asins)
    }

# ── Generate Report ───────────────────────────────────────────────────────────
def generate_report(target_month=None):
    report_month, report_month_label, generated, start_date, end_date = get_report_dates(target_month)
    
    print(f"\n📊 Trail Built Overlanding — Monthly Report Generator (Python)")
    print(f"   Report month: {report_month_label} ({report_month})\n")
    
    # 1. Content Inventory
    print("Gathering content inventory...")
    inv = get_content_inventory()
    
    # 2. Email Stats
    print("Fetching EmailOctopus stats...")
    list_stats = get_list_stats()
    new_subs = get_new_subscribers(start_date, end_date)
    
    # Recommendations
    recommendations = [
        "**Email List Growth** — Add the quiz CTA to the end of all new articles to drive segmented signups.",
        "**Affiliate Links** — Run the live product validator monthly to catch out-of-stock Amazon items.",
        "**SEO** — Review Google Search Console for keywords ranking in positions 11-20 and optimize those articles."
    ]
    
    report_md = f"""# Trail Built Overlanding — Monthly Report
## {report_month_label}
*Generated: {generated} | Site: [trailbuiltoverland.com]({SITE_URL})*

---

## Executive Summary
| Metric | Value |
| :--- | :--- |
| Published Articles | **{inv['articles']}** |
| Category Pages | **{inv['categories']}** |
| Unique Amazon ASINs | **{inv['unique_asins']}** |
| Active Email Subscribers | **{list_stats['subscribed']}** |
| Amazon Affiliate Tag | **trailbuiltove-20** |

---

## Email List Health
| Metric | Value |
|---|---|
| **Total Contacts** | {list_stats['total']} |
| **Active Subscribers** | {list_stats['subscribed']} |
| **Unsubscribed** | {list_stats['unsubscribed']} |
| **Pending Confirmation** | {list_stats['pending']} |
| **New This Month** | {new_subs} |

*Note: For detailed open/click rates on the segmented welcome automation, check the [EmailOctopus Dashboard](https://dashboard.emailoctopus.com).*

---

## Affiliate Link Health
All Amazon affiliate links use the tag `trailbuiltove-20`. The product validator script (`scripts/validate-products.py`) should be run monthly with the `--live` flag to verify all {inv['unique_asins']} unique ASINs are still active on Amazon.

**To run a full live validation:**
```bash
python3 scripts/validate-products.py --live
```

---

## SEO Health Checklist
Run the SEO audit script to check for missing meta descriptions, duplicate titles, and broken internal links:

```bash
node scripts/seo-audit.mjs
```

**Key SEO targets for Trail Built:**
- "best overlanding recovery gear"
- "jeep wrangler overland build"
- "best 12v fridge for overlanding"
- "tacoma overland setup"

---

## Recommendations
{chr(10).join(f"{i+1}. {r}" for i, r in enumerate(recommendations))}

---

## Action Items for Next Month
- [ ] Publish 4 new articles (Monday weekly cadence)
- [ ] Run `node scripts/seo-audit.mjs` after each new article
- [ ] Run `node scripts/generate-sitemap.mjs` and verify `sitemap.xml`
- [ ] Run `python3 scripts/validate-products.py --live` to check for broken Amazon links
- [ ] Review Amazon affiliate commission reports in Associates dashboard
- [ ] Update any products with significant price changes

---
*This report was automatically generated by `scripts/monthly_report.py`.*
*Trail Built Overlanding — Honest Gear Reviews & Build Guides*
"""

    REPORTS_DIR.mkdir(exist_ok=True)
    report_path = REPORTS_DIR / f"{report_month}-report.md"
    report_path.write_text(report_md, encoding="utf-8")
    
    print(f"✅ Report saved to: {report_path.relative_to(REPO_ROOT)}")
    print(f"\nReport preview:\n")
    print(report_md[:500] + "...\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate monthly report.")
    parser.add_argument("--month", help="Target month in YYYY-MM format", default=None)
    args = parser.parse_args()
    
    generate_report(args.month)
