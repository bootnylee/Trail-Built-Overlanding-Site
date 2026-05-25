#!/usr/bin/env python3
"""Pre-push validation for TrailBuiltOverland product and category images.

This script is intentionally conservative. It validates the portions of the site most
likely to create bad user experience and affiliate-review compliance issues:

1. Product review/card images must not use generic remote stock-photo URLs.
2. Homepage category-link images must use local, existing assets.
3. Local image assets must exist and be readable by Pillow.
4. Alt text must be product/category-specific enough to support manual review.
5. The audit report is regenerated on every run for reviewer visibility.
"""
from __future__ import annotations

import csv
import hashlib
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "reports"
REPORT_DIR.mkdir(exist_ok=True)

HTML_FILES = sorted(list(ROOT.glob("*.html")) + list((ROOT / "articles").glob("*.html")) + list((ROOT / "categories").glob("*.html")))
PRODUCT_SELECTORS = [".product-box", ".product-card", ".product-item", ".gear-card"]
GENERIC_REMOTE_HOSTS = {
    "images.unsplash.com",
    "source.unsplash.com",
    "plus.unsplash.com",
    "images.pexels.com",
    "cdn.pixabay.com",
}
MIN_ALT_WORDS = 3


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def is_remote(src: str) -> bool:
    return bool(urlparse(src).scheme in {"http", "https"})


def normalize_src(page: Path, src: str) -> Path | None:
    if not src or is_remote(src) or src.startswith("data:"):
        return None
    return (page.parent / src).resolve()


def normalize_title(text: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    stop = {"the", "and", "with", "for", "pair", "front", "rear", "inch", "in", "lb", "lbs"}
    return " ".join(t for t in text.split() if t not in stop)


def get_card_title(card) -> str:
    for selector in ["h4", "h3", "h2", ".product-title", "strong"]:
        found = card.select_one(selector)
        if found:
            return found.get_text(" ", strip=True)
    return card.get("data-product", "").strip()


def image_hash(path: Path) -> str:
    with path.open("rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def validate_local_image(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return False, "local image file does not exist"
    if path.suffix.lower() == ".svg":
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:500].lower()
        except Exception as exc:  # noqa: BLE001
            return False, f"svg image cannot be read: {exc}"
        if "<svg" not in head:
            return False, "svg image does not contain an <svg> element"
        return True, "ok"
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            width, height = im.size
        if width < 80 or height < 80:
            return False, f"image dimensions too small ({width}x{height})"
    except Exception as exc:  # noqa: BLE001 - validation should capture exact failure
        return False, f"image cannot be opened: {exc}"
    return True, "ok"


def extract_product_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen = set()
    for page in HTML_FILES:
        soup = BeautifulSoup(page.read_text(encoding="utf-8", errors="ignore"), "html.parser")
        page_rel = rel(page)
        for selector in PRODUCT_SELECTORS:
            for card in soup.select(selector):
                # Homepage category cards share a similar visual pattern but are audited separately.
                if "category-card" in (card.get("class") or []):
                    continue
                img = card.find("img")
                if not img:
                    continue
                href = ""
                link = card.find("a", href=True)
                if link:
                    href = link["href"]
                asin = ""
                match = re.search(r"/dp/([A-Z0-9]{10})", href)
                if match:
                    asin = match.group(1)
                row = {
                    "file": page_rel,
                    "selector": selector,
                    "asin": asin,
                    "title": get_card_title(card),
                    "alt": img.get("alt", "").strip(),
                    "src": img.get("src", "").strip(),
                }
                key = (row["file"], row["selector"], row["title"], row["src"])
                if key in seen:
                    continue
                seen.add(key)
                rows.append(row)
    return rows


def extract_category_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    index = ROOT / "index.html"
    soup = BeautifulSoup(index.read_text(encoding="utf-8", errors="ignore"), "html.parser")
    for card in soup.select("a.category-card"):
        img = card.find("img")
        title = card.find(["h2", "h3", "h4"])
        rows.append({
            "file": "index.html",
            "href": card.get("href", ""),
            "title": title.get_text(" ", strip=True) if title else card.get_text(" ", strip=True),
            "alt": img.get("alt", "").strip() if img else "",
            "src": img.get("src", "").strip() if img else "",
        })
    return rows


def write_tsv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    failures: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    product_rows = extract_product_rows()
    category_rows = extract_category_rows()
    write_tsv(REPORT_DIR / "actual-product-image-inventory.tsv", product_rows, ["file", "selector", "asin", "title", "alt", "src"])
    write_tsv(REPORT_DIR / "category-link-image-inventory.tsv", category_rows, ["file", "href", "title", "alt", "src"])

    product_hashes: dict[str, list[dict[str, str]]] = defaultdict(list)
    category_sources = set()

    for row in product_rows:
        src = row["src"]
        context = f"{row['file']} :: {row['title']}"
        if not src:
            failures.append({**row, "issue": "missing product image src"})
            continue
        parsed = urlparse(src)
        if parsed.netloc in GENERIC_REMOTE_HOSTS:
            failures.append({**row, "issue": "product card uses generic stock-photo host instead of verified product image"})
            continue
        if is_remote(src):
            warnings.append({**row, "issue": "remote product image; manually confirm license/source remains stable"})
            continue
        local_path = normalize_src(ROOT / row["file"], src)
        ok, message = validate_local_image(local_path) if local_path else (False, "invalid local image path")
        if not ok:
            failures.append({**row, "issue": message})
            continue
        if row["alt"] and len(row["alt"].split()) < MIN_ALT_WORDS:
            failures.append({**row, "issue": "alt text is too generic for product verification"})
        product_hashes[image_hash(local_path)].append({**row, "normalized_title": normalize_title(row["title"])})

    for row in category_rows:
        src = row["src"]
        if not src:
            failures.append({**row, "issue": "missing category-link image src"})
            continue
        if is_remote(src):
            failures.append({**row, "issue": "category-link image must be a verified local category/product image, not a remote stock photo"})
            continue
        local_path = normalize_src(ROOT / row["file"], src)
        ok, message = validate_local_image(local_path) if local_path else (False, "invalid local image path")
        if not ok:
            failures.append({**row, "issue": message})
            continue
        if src in category_sources:
            failures.append({**row, "issue": "duplicate category-link image source"})
        category_sources.add(src)
        if len(row["alt"].split()) < MIN_ALT_WORDS:
            failures.append({**row, "issue": "category-link alt text is too generic"})

    # Reused exact image bytes can be legitimate when the exact same product is mentioned
    # on multiple pages. Flag materially different titles as warnings for human review,
    # without blocking emergency content updates.
    for digest, rows in product_hashes.items():
        title_groups = {r["normalized_title"] for r in rows if r["normalized_title"]}
        if len(rows) > 1 and len(title_groups) > 1:
            warnings.append({
                "file": ", ".join(sorted({r["file"] for r in rows})[:4]),
                "title": " | ".join(sorted({r["title"] for r in rows})[:4]),
                "src": digest[:12],
                "issue": "same image bytes reused across different product titles; verify intentionally same product/variant",
            })

    failure_fields = sorted({key for row in failures for key in row.keys()} | {"issue"})
    warning_fields = sorted({key for row in warnings for key in row.keys()} | {"issue"})
    if failures:
        write_tsv(REPORT_DIR / "image-validation-failures.tsv", failures, failure_fields)
    else:
        (REPORT_DIR / "image-validation-failures.tsv").write_text("issue\n", encoding="utf-8")
    if warnings:
        write_tsv(REPORT_DIR / "image-validation-warnings.tsv", warnings, warning_fields)
    else:
        (REPORT_DIR / "image-validation-warnings.tsv").write_text("issue\n", encoding="utf-8")

    print(f"Product images checked: {len(product_rows)}")
    print(f"Category-link images checked: {len(category_rows)}")
    print(f"Failures: {len(failures)}")
    print(f"Warnings: {len(warnings)}")
    print("Reports written to reports/actual-product-image-inventory.tsv, reports/category-link-image-inventory.tsv, reports/image-validation-failures.tsv, and reports/image-validation-warnings.tsv")
    if failures:
        print("\nImage validation failed. First failures:", file=sys.stderr)
        for row in failures[:20]:
            print(f"- {row.get('file', '')} | {row.get('title', row.get('href', ''))} | {row.get('issue', '')} | {row.get('src', '')}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
