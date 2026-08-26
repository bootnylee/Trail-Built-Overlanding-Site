#!/usr/bin/env python3
"""Consolidate the overlapping portable-power guides without creating new copy.

The only product exclusive to the legacy pair is copied verbatim from its existing,
verified product card into the canonical guide. Retired guide cards are removed
from listing pages so a canonical card is never duplicated; remaining link targets
are normalized to the retained URL.
"""
from __future__ import annotations

from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARTICLES = ROOT / "articles"
CANONICAL = ARTICLES / "best-overlanding-solar-generators-and-power-banks.html"
LEGACY = ARTICLES / "best-overlanding-solar-and-power.html"
UNIQUE_ASIN = "B093BB5JKF"
CANONICAL_URL = "articles/best-overlanding-solar-generators-and-power-banks.html"
LEGACY_URLS = (
    "articles/best-overlanding-solar-and-power.html",
    "articles/best-portable-power-stations-for-overlanding.html",
)


def merge_verified_product() -> bool:
    canonical = BeautifulSoup(CANONICAL.read_text(encoding="utf-8"), "html.parser")
    if canonical.select_one(f'.product-box[data-asin="{UNIQUE_ASIN}"]'):
        return False

    legacy = BeautifulSoup(LEGACY.read_text(encoding="utf-8"), "html.parser")
    source_box = legacy.select_one(f'.product-box[data-asin="{UNIQUE_ASIN}"]')
    if source_box is None:
        raise RuntimeError(f"Could not find verified source product card {UNIQUE_ASIN}")

    top_picks = canonical.select_one("h2#top-picks")
    if top_picks is None:
        raise RuntimeError("Canonical guide has no top-picks insertion point")

    # The copied node preserves its existing product name, editorial text, image,
    # ASIN, and direct tagged Amazon CTA exactly as it appeared in the source guide.
    top_picks.insert_after(source_box)
    CANONICAL.write_text(str(canonical), encoding="utf-8")
    return True


def is_listing_card(node) -> bool:
    classes = node.get("class") or []
    return any(value in {"card", "article-card", "post-card"} for value in classes)


def normalize_links() -> int:
    changed = 0
    pages = [
        *ROOT.glob("*.html"),
        *ARTICLES.glob("*.html"),
        *(ROOT / "categories").glob("*.html"),
        *(ROOT / "newsletters").glob("*.html"),
    ]
    legacy_hrefs = {legacy for legacy in LEGACY_URLS}
    legacy_hrefs.update({f"../{legacy}" for legacy in LEGACY_URLS})

    for path in pages:
        raw = path.read_text(encoding="utf-8")
        soup = BeautifulSoup(raw, "html.parser")
        removed_cards = set()
        changed_here = False

        for anchor in list(soup.find_all("a", href=True)):
            if not anchor.attrs or not anchor.has_attr("href"):
                continue
            if anchor["href"] not in legacy_hrefs:
                continue
            card = anchor.find_parent(lambda tag: tag.name in {"div", "article"} and is_listing_card(tag))
            if card is not None:
                marker = id(card)
                if marker not in removed_cards:
                    card.decompose()
                    removed_cards.add(marker)
                    changed_here = True
            else:
                anchor["href"] = f"../{CANONICAL_URL}" if anchor["href"].startswith("../") else CANONICAL_URL
                changed_here = True

        updated = str(soup) if changed_here else raw
        # Quiz and other structured page data carry internal routes outside anchors.
        for legacy in LEGACY_URLS:
            updated = updated.replace(legacy, CANONICAL_URL)
            updated = updated.replace(f"../{legacy}", f"../{CANONICAL_URL}")
        if updated != raw:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    return changed


merged = merge_verified_product()
updated_links = normalize_links()
print(f"Portable-power consolidation: product merged={merged}; internal HTML files updated={updated_links}.")
