#!/usr/bin/env python3
"""Validate Trail Built affiliate destinations against visible product labels.

Coverage includes index.html, all article pages, and category pages. Every product
destination must be a direct Amazon /dp/ ASIN link. Direct ASIN links are validated
against live Amazon titles; Amazon search URLs are prohibited and fail validation.

Usage:
  python3 tools/validate_asins.py [--static-only] [--output FILE]
  python3 tools/validate_asins.py --article articles/example.html
"""
from __future__ import annotations

import argparse
import html as html_module
import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))
from asin_lookup import verify_asin

REPO_ROOT = Path(__file__).parent.parent
AFFILIATE_TAG = "trailbuiltove-20"
REQUEST_DELAY = 1.25
ASIN_PATTERN = re.compile(r"/dp/([A-Z0-9]{10})(?:[/?#]|$)")
VALID_ASIN = re.compile(r"^[A-Z0-9]{10}$")
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
IGNORED_WORDS = {
    "a", "an", "the", "for", "and", "or", "in", "on", "of", "to", "with", "by", "at", "from",
    "shop", "check", "view", "buy", "price", "amazon", "gear", "best", "overlanding", "kit", "set",
}
GENERIC_LABELS = {"check price", "check price on amazon", "view on amazon", "buy on amazon", "amazon"}


class Node:
    def __init__(self, tag: str, attrs: dict[str, str], parent: "Node | None"):
        self.tag = tag.lower()
        self.attrs = {key.lower(): value or "" for key, value in attrs.items()}
        self.parent = parent
        self.children: list[Node] = []
        self.text: list[str] = []

    @property
    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def descendants(self):
        for child in self.children:
            yield child
            yield from child.descendants()

    def text_content(self) -> str:
        parts = list(self.text)
        for child in self.children:
            parts.append(child.text_content())
        return clean(" ".join(parts))

    def first_heading(self) -> str:
        for node in self.descendants():
            if node.tag in {"h3", "h4", "h5"}:
                value = node.text_content()
                if value:
                    return value
        return ""


class DomBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("document", {}, None)
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs), self.stack[-1])
        self.stack[-1].children.append(node)
        if tag.lower() not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.stack[-1].text.append(data)


def clean(value: str) -> str:
    return " ".join(html_module.unescape(value or "").split())


def normalize(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).split())


def content_words(value: str) -> set[str]:
    return {word for word in normalize(value).split() if len(word) > 1 and word not in IGNORED_WORDS}


def anchor_destination(node: Node) -> tuple[str, str]:
    href = html_module.unescape(node.attrs.get("href", ""))
    asin_match = ASIN_PATTERN.search(href)
    if asin_match:
        return "asin", asin_match.group(1)
    parsed = urlparse(href)
    if parsed.hostname and parsed.hostname.endswith("amazon.com") and parsed.path == "/s":
        return "search", href
    return "", ""


def node_is_inside(node: Node, class_name: str) -> bool:
    current = node.parent
    while current:
        if class_name in current.classes:
            return True
        current = current.parent
    return False


def add_product(records: list[dict], seen: set, source_file: Path, label: str, destination_type: str, destination: str, context: str):
    label = clean(label)
    if not label or not destination:
        return
    key = (str(source_file.relative_to(REPO_ROOT)), label, destination_type, destination, context)
    if key in seen:
        return
    seen.add(key)
    records.append({
        "file": str(source_file.relative_to(REPO_ROOT)),
        "product": label,
        "destination_type": destination_type,
        "asin": destination if destination_type == "asin" else "",
        "url": f"https://www.amazon.com/dp/{destination}" if destination_type == "asin" else destination,
        "context": context,
    })


def extract_from_card(card: Node, source_file: Path, records: list[dict], seen: set):
    label = clean(card.attrs.get("data-product", "")) or card.first_heading()
    if not label:
        return
    nodes = [card, *card.descendants()]
    for node in nodes:
        data_asin = node.attrs.get("data-asin", "")
        if VALID_ASIN.fullmatch(data_asin):
            add_product(records, seen, source_file, label, "asin", data_asin, "product-card")
        data_search = html_module.unescape(node.attrs.get("data-search-query", ""))
        if data_search:
            add_product(records, seen, source_file, label, "search", data_search, "product-card")
        if node.tag == "a":
            kind, value = anchor_destination(node)
            if kind:
                add_product(records, seen, source_file, label, kind, value, "product-card")


def extract_from_html(source_file: Path) -> list[dict]:
    parser = DomBuilder()
    parser.feed(source_file.read_text(encoding="utf-8"))
    records: list[dict] = []
    seen: set = set()
    all_nodes = [parser.root, *parser.root.descendants()]

    for node in all_nodes:
        if node.tag == "div" and ({"product-box", "product-card"} & node.classes):
            extract_from_card(node, source_file, records, seen)

    for node in all_nodes:
        if node.tag != "div" or "sidebar-product" not in node.classes:
            continue
        for child in node.descendants():
            if child.tag != "a":
                continue
            kind, value = anchor_destination(child)
            if kind:
                add_product(records, seen, source_file, child.text_content(), kind, value, "sidebar")

    for node in all_nodes:
        if node.tag != "a" or node_is_inside(node, "product-box") or node_is_inside(node, "product-card") or node_is_inside(node, "sidebar-product"):
            continue
        kind, value = anchor_destination(node)
        if not kind:
            continue
        label = node.text_content()
        if normalize(label) in GENERIC_LABELS or len(content_words(label)) < 2:
            continue
        add_product(records, seen, source_file, label, kind, value, "standalone-promo")

    return records


def source_files(single_file: str | None) -> list[Path]:
    if single_file:
        path = Path(single_file)
        return [path if path.is_absolute() else REPO_ROOT / path]
    files = [REPO_ROOT / "index.html"]
    files.extend(sorted((REPO_ROOT / "articles").glob("*.html")))
    files.extend(sorted((REPO_ROOT / "categories").glob("*.html")))
    return [path for path in files if path.exists()]


def validate_search(record: dict) -> tuple[bool, str, str]:
    parsed = urlparse(record["url"])
    query = parse_qs(parsed.query)
    target = (query.get("k") or [""])[0]
    tag = (query.get("tag") or [""])[0]
    if not (parsed.scheme == "https" and parsed.hostname and parsed.hostname.endswith("amazon.com") and parsed.path == "/s"):
        return False, "search destination is not an Amazon product search", target
    if tag != AFFILIATE_TAG:
        return False, f"wrong affiliate tag '{tag or 'missing'}'", target
    expected_words = content_words(record["product"])
    query_words = content_words(target)
    overlap = len(expected_words & query_words)
    required = 1 if len(expected_words) <= 2 else 2
    if overlap < required:
        return False, f"search query does not sufficiently match visible product label (overlap {overlap}/{len(expected_words)})", target
    return True, "targeted Amazon search query matches visible product label", target


def validate_records(records: list[dict], static_only: bool) -> dict:
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "site-wide HTML product cards, sidebars, and named promotional links",
        "total": len(records),
        "direct_asins": sum(record["destination_type"] == "asin" for record in records),
        "search_fallbacks": sum(record["destination_type"] == "search" for record in records),
        "passed": 0,
        "failed": 0,
        "title_mismatches": 0,
        "dead_asins": 0,
        "search_destination_issues": 0,
        "unverified_live_checks": 0,
        "products": [],
    }
    for index, record in enumerate(records):
        result = dict(record)
        if record["destination_type"] == "search":
            result.update({
                "status": "FAIL",
                "issue": "Amazon search destinations are prohibited; a live direct /dp/ ASIN is required",
                "search_query": parse_qs(urlparse(record["url"]).query).get("k", [""])[0],
            })
            report["failed"] += 1
            report["search_destination_issues"] += 1
            report["products"].append(result)
            continue

        if static_only:
            result.update({"status": "UNVERIFIED", "issue": "static-only run: Amazon title not requested"})
            report["unverified_live_checks"] += 1
            report["products"].append(result)
            continue

        live = verify_asin(record["asin"], record["product"])
        result.update({
            "status": "PASS" if live.ok else "FAIL",
            "amazon_title": live.amazon_title,
            "match_score": live.match_score,
            "source": live.source,
            "issue": live.error or "",
        })
        if live.ok:
            report["passed"] += 1
        else:
            report["failed"] += 1
            if not live.resolves:
                report["dead_asins"] += 1
                result["issue"] = live.error or "ASIN did not resolve"
            elif not live.title_match:
                report["title_mismatches"] += 1
                result["issue"] = f"title mismatch: expected '{record['product']}' but got '{live.amazon_title or 'N/A'}'"
        report["products"].append(result)
        if index < len(records) - 1:
            time.sleep(REQUEST_DELAY)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate affiliate product destinations across Trail Built")
    parser.add_argument("--static-only", action="store_true", help="Validate extraction and search links without live Amazon title lookups")
    parser.add_argument("--output", default=str(REPO_ROOT / "asin_validation_report.json"), help="JSON report path")
    parser.add_argument("--article", help="Validate one HTML file relative to repository root")
    args = parser.parse_args()

    files = source_files(args.article)
    records = [record for source_file in files for record in extract_from_html(source_file)]
    report = validate_records(records, static_only=args.static_only)
    report["files_checked"] = [str(path.relative_to(REPO_ROOT)) for path in files]

    output = Path(args.output)
    if not output.is_absolute():
        output = REPO_ROOT / output
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print("\nAffiliate Product-Destination Consistency Check")
    print("=" * 56)
    print(f"Files checked:      {len(files)}")
    print(f"Product slots:      {report['total']}")
    print(f"Direct ASINs:       {report['direct_asins']}")
    print(f"Search fallbacks:   {report['search_fallbacks']}")
    print(f"Passed:             {report['passed']}")
    print(f"Failed:             {report['failed']}")
    print(f"Title mismatches:   {report['title_mismatches']}")
    print(f"Dead ASINs:         {report['dead_asins']}")
    print(f"Search-link issues: {report['search_destination_issues']}")
    print(f"Unverified:         {report['unverified_live_checks']}")
    print(f"Report:             {output}")

    if report["failed"]:
        print("\nFailures:")
        for item in report["products"]:
            if item["status"] == "FAIL":
                print(f"  - [{item['file']}] {item['product']} -> {item.get('asin') or item.get('url')}: {item['issue']}")

    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
