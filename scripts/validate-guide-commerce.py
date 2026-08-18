#!/usr/bin/env python3
"""Fail the build if a Trail Built buyer guide drifts from the commerce template.

This production gate deliberately uses only Python's standard library. The local
standardizer may use a third-party parser, but Netlify validates the already-
committed HTML without needing any external Python package.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).resolve().parents[1]
ARTICLES = REPO / "articles"
TAG = "trailbuiltove-20"
CONCEPT_GUIDES = {"best-diesel-vs-gasoline-for-overlanding.html"}


def attr_value(attrs: str, name: str) -> str:
    match = re.search(rf"\b{re.escape(name)}\s*=\s*(['\"])(.*?)\1", attrs, re.I | re.S)
    return match.group(2) if match else ""


def json_ld(raw: str) -> list[dict]:
    parsed = []
    pattern = re.compile(
        r"<script\b(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.I | re.S
    )
    for node in pattern.finditer(raw):
        if attr_value(node.group("attrs"), "type").lower() != "application/ld+json":
            continue
        try:
            data = json.loads(node.group("body").strip())
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON-LD: {exc}") from exc
        if isinstance(data, dict):
            parsed.append(data)
    return parsed


def amazon_anchors(raw: str):
    for match in re.finditer(r"<a\b(?P<attrs>[^>]*)>", raw, re.I | re.S):
        attrs = match.group("attrs")
        href = attr_value(attrs, "href")
        if "amazon.com" in href:
            yield attrs, href


def product_box_asins(raw: str):
    # The standardized builder outputs class + data-asin on product blocks.
    for match in re.finditer(r"<div\b(?P<attrs>[^>]*)>", raw, re.I | re.S):
        attrs = match.group("attrs")
        class_name = attr_value(attrs, "class")
        asin = attr_value(attrs, "data-asin").upper()
        if asin and ("product-box" in class_name or "product-card" in class_name):
            yield asin, match.end()


def main() -> int:
    failures: list[str] = []
    for path in sorted(ARTICLES.glob("best-*.html")):
        raw = path.read_text(encoding="utf-8")
        label = path.name

        if "guide-comparison-table" not in raw:
            failures.append(f"{label}: missing comparison table")
        if "guide-rating" in raw or re.search(r">\s*Rating\s*<", raw, re.I) or "Editorial assessment" in raw:
            failures.append(f"{label}: contains a removed Rating column or placeholder assessment text")
        if 'src="../js/guide-commerce.js"' not in raw:
            failures.append(f"{label}: missing guide commerce renderer")

        try:
            parsed_schemas = json_ld(raw)
        except ValueError as exc:
            failures.append(f"{label}: {exc}")
            continue
        types = [schema.get("@type", "") for schema in parsed_schemas]
        for required in ("Article", "BreadcrumbList", "FAQPage"):
            if required not in types:
                failures.append(f"{label}: missing {required} JSON-LD")

        itemlists = [schema for schema in parsed_schemas if schema.get("@type") == "ItemList"]
        if label not in CONCEPT_GUIDES and not itemlists:
            failures.append(f"{label}: missing ItemList JSON-LD")
        if label not in CONCEPT_GUIDES:
            for list_item in itemlists[0].get("itemListElement", []):
                product = list_item.get("item", {})
                if product.get("@type") != "Product" or not product.get("name"):
                    failures.append(f"{label}: ItemList contains a non-Product item")
                if product.get("review", {}).get("@type") != "Review":
                    failures.append(f"{label}: Product '{product.get('name', 'unknown')}' missing editorial Review schema")
                # AggregateRating requires genuine review inputs and is emitted
                # only by the dormant user-review component when activated.
                if "aggregateRating" in product:
                    failures.append(f"{label}: Product '{product.get('name', 'unknown')}' has static aggregateRating")

        if label not in CONCEPT_GUIDES and "data-guide-sticky=" not in raw:
            failures.append(f"{label}: missing mobile sticky CTA")

        for asin, offset in product_box_asins(raw):
            # A 5 KB window safely covers one product block and avoids parsing a
            # custom DOM in the production build image.
            block = raw[offset:offset + 5000]
            if not re.search(rf"https://www\.amazon\.com/dp/{re.escape(asin)}\?tag={re.escape(TAG)}", block, re.I):
                failures.append(f"{label}: product ASIN {asin} is missing an in-block direct CTA")

        for attrs, href in amazon_anchors(raw):
            match = re.search(r"amazon\.com/dp/([A-Z0-9]{10})", href, re.I)
            if not match:
                failures.append(f"{label}: non-direct Amazon link: {href}")
                continue
            tag = parse_qs(urlparse(href).query).get("tag", [""])[0]
            rel = set(attr_value(attrs, "rel").lower().split())
            target = attr_value(attrs, "target")
            if tag != TAG:
                failures.append(f"{label}: wrong associate tag for {match.group(1)}")
            if not {"sponsored", "nofollow"}.issubset(rel):
                failures.append(f"{label}: Amazon link {match.group(1)} missing sponsored nofollow")
            if target != "_blank":
                failures.append(f"{label}: Amazon link {match.group(1)} missing target=_blank")

    if failures:
        print("Buyer-guide commerce gate failed:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("Buyer-guide commerce gate passed for all guides.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
