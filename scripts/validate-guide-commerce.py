#!/usr/bin/env python3
"""Fail the build if a Trail Built buyer guide drifts from the commerce template."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

REPO = Path(__file__).resolve().parents[1]
ARTICLES = REPO / "articles"
TAG = "trailbuiltove-20"
CONCEPT_GUIDES = {"best-diesel-vs-gasoline-for-overlanding.html"}


def schemas(soup: BeautifulSoup) -> list[dict]:
    parsed = []
    for node in soup.select("script[type='application/ld+json']"):
        try:
            data = json.loads(node.get_text())
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON-LD: {exc}") from exc
        if isinstance(data, dict):
            parsed.append(data)
    return parsed


def main() -> int:
    failures = []
    for path in sorted(ARTICLES.glob("best-*.html")):
        soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        label = path.name
        if not soup.select_one(".guide-comparison-table"):
            failures.append(f"{label}: missing comparison table")
        if not soup.select_one("script[src='../js/guide-commerce.js']"):
            failures.append(f"{label}: missing guide commerce renderer")
        try:
            parsed_schemas = schemas(soup)
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
                # No fabricated aggregate rating may be emitted by this template.
                if "aggregateRating" in product:
                    failures.append(f"{label}: Product '{product.get('name', 'unknown')}' has static aggregateRating")
        if label not in CONCEPT_GUIDES and not soup.select_one("[data-guide-sticky]"):
            failures.append(f"{label}: missing mobile sticky CTA")
        for box in soup.select(".product-box[data-asin], .product-card[data-asin]"):
            asin = box.get("data-asin", "")
            cta = box.select_one(f"a[href*='amazon.com/dp/{asin}']")
            if asin and not cta:
                failures.append(f"{label}: product ASIN {asin} is missing an in-block direct CTA")
        for anchor in soup.select("a[href*='amazon.com']"):
            href = anchor.get("href", "")
            match = re.search(r"amazon\.com/dp/([A-Z0-9]{10})", href, re.I)
            if not match:
                failures.append(f"{label}: non-direct Amazon link: {href}")
                continue
            tag = parse_qs(urlparse(href).query).get("tag", [""])[0]
            rel = set(anchor.get("rel", []))
            if tag != TAG:
                failures.append(f"{label}: wrong associate tag for {match.group(1)}")
            if not {"sponsored", "nofollow"}.issubset(rel):
                failures.append(f"{label}: Amazon link {match.group(1)} missing sponsored nofollow")
            if anchor.get("target") != "_blank":
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
