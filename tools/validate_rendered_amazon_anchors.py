#!/usr/bin/env python3
"""Fail the build when rendered HTML contains a malformed Amazon destination.

Every Amazon anchor in public HTML must use /dp/{10-character ASIN} and carry the
configured affiliate tag. This deliberately scans all published HTML, not only
product-card data, to catch orphaned CTAs left behind after content removals.
"""
from __future__ import annotations

import argparse
import html as html_module
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TAG = "trailbuiltove-20"
ASIN_PATH = re.compile(r"^/dp/[A-Z0-9]{10}(?:/|$)", re.I)


@dataclass
class Anchor:
    file: Path
    line: int
    href: str


class AnchorParser(HTMLParser):
    def __init__(self, source_file: Path):
        super().__init__(convert_charrefs=True)
        self.source_file = source_file
        self.anchors: list[Anchor] = []

    def handle_starttag(self, tag: str, attrs):
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.anchors.append(Anchor(self.source_file, self.getpos()[0], html_module.unescape(href)))


def is_amazon_url(href: str) -> bool:
    host = (urlparse(href).hostname or "").lower()
    return host == "amazon.com" or host.endswith(".amazon.com")


def validate(anchor: Anchor, affiliate_tag: str) -> str | None:
    parsed = urlparse(anchor.href)
    if not is_amazon_url(anchor.href):
        return None
    if not ASIN_PATH.match(parsed.path):
        return "Amazon destination must use /dp/{10-character ASIN}"
    tag = (parse_qs(parsed.query).get("tag") or [""])[0]
    if tag != affiliate_tag:
        return f"Amazon destination must carry affiliate tag '{affiliate_tag}'"
    return None


def public_html_files(root: Path) -> list[Path]:
    ignored = {".git", "node_modules", "dist", "reports", "tools", "scripts", "tests"}
    return [
        path for path in root.rglob("*.html")
        if not any(part in ignored for part in path.relative_to(root).parts)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate all rendered Trail Built Amazon anchors")
    parser.add_argument("--root", type=Path, default=REPO_ROOT)
    parser.add_argument("--affiliate-tag", default=DEFAULT_TAG)
    args = parser.parse_args()
    root = args.root.resolve()

    anchors: list[Anchor] = []
    for source_file in public_html_files(root):
        html = source_file.read_text(encoding="utf-8", errors="ignore")
        parser = AnchorParser(source_file)
        parser.feed(html)
        anchors.extend(parser.anchors)

    amazon = [anchor for anchor in anchors if is_amazon_url(anchor.href)]
    failures = [(anchor, validate(anchor, args.affiliate_tag)) for anchor in amazon]
    failures = [(anchor, issue) for anchor, issue in failures if issue]
    direct = len(amazon) - len(failures)

    print("Rendered Amazon Anchor Gate")
    print(f"HTML files checked: {len(public_html_files(root))}")
    print(f"Amazon anchors:     {len(amazon)}")
    print(f"Tagged /dp/ anchors:{direct}")
    print(f"Non-conforming:     {len(failures)}")
    for anchor, issue in failures:
        print(f"  - {anchor.file.relative_to(root)}:{anchor.line}: {issue} — {anchor.href}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
