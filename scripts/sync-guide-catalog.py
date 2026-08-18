#!/usr/bin/env python3
"""Ensure every verified buyer-guide ASIN has a record in js/products-data.js.

The script intentionally adds only direct `/dp/<ASIN>?tag=trailbuiltove-20`
product-card destinations. It does not create affiliate links or invent product
attributes; the subsequent Amazon Creators API sync is the source of title,
price, availability, and buy-box data.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ARTICLES = REPO / "articles"
PRODUCTS = REPO / "js" / "products-data.js"
TAG = "trailbuiltove-20"


def attr(attrs: str, name: str) -> str:
    match = re.search(rf"\b{re.escape(name)}\s*=\s*(['\"])(.*?)\1", attrs, re.I | re.S)
    return html.unescape(match.group(2)).strip() if match else ""


def direct_asins(block: str) -> set[str]:
    return {
        match.group(1).upper()
        for match in re.finditer(
            rf"https://www\.amazon\.com/dp/([A-Z0-9]{{10}})\?tag={re.escape(TAG)}",
            block,
            re.I,
        )
    }


def guide_products() -> dict[str, str]:
    records: dict[str, str] = {}
    # Product boxes include data-product. Their serialized markup is compact, so
    # a bounded look-ahead is used only to locate links belonging to that box.
    pattern = re.compile(r"<div\b(?P<attrs>[^>]*)>", re.I | re.S)
    for page in sorted(ARTICLES.glob("best-*.html")):
        raw = page.read_text(encoding="utf-8")
        for match in pattern.finditer(raw):
            attrs = match.group("attrs")
            classes = attr(attrs, "class")
            name = attr(attrs, "data-product")
            if not name or ("product-box" not in classes and "product-card" not in classes):
                continue
            # The next opening product box bounds the current card safely enough
            # for Trail Built's repeated product-card markup.
            next_card = raw.find('<div class="product-box', match.end() + 1)
            if next_card == -1:
                next_card = raw.find('<div class="product-card', match.end() + 1)
            block = raw[match.end(): next_card if next_card != -1 else match.end() + 12000]
            for asin in direct_asins(block):
                records.setdefault(asin, name)
    return records


def existing_asins(source: str) -> set[str]:
    return {match.group(1).upper() for match in re.finditer(r'^\s*"([A-Z0-9]{10})"\s*:', source, re.M)}


def main() -> int:
    source = PRODUCTS.read_text(encoding="utf-8")
    existing = existing_asins(source)
    missing = [(asin, name) for asin, name in guide_products().items() if asin not in existing]
    if not missing:
        print("Guide catalog manifest is current; no verified ASIN records added.")
        return 0

    records = []
    for asin, name in sorted(missing):
        records.append(
            f'  "{asin}": {{\n'
            f'    asin: "{asin}",\n'
            f'    name: {json.dumps(name, ensure_ascii=False)},\n'
            f'    price: 0.00,\n'
            f'    priceDisplay: ""\n'
            f'  }}'
        )
    insertion = ",\n\n".join(records)
    marker = "\n};\n/**\n * ISO timestamp"
    if marker not in source:
        raise RuntimeError("Could not locate TrailBuiltProducts object boundary")
    source = source.replace(marker, ",\n\n" + insertion + marker, 1)
    PRODUCTS.write_text(source, encoding="utf-8")
    print(f"Added {len(missing)} verified guide ASIN record(s) to products-data.js")
    for asin, name in missing:
        print(f"  {asin} | {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
