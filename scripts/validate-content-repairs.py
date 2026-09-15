#!/usr/bin/env python3
"""Validate Trail Built's TB-CONTENT-0915 published-content repair contract.

This validator is intentionally scoped to the repaired legacy articles. It enforces
that no unresolved table value or reader-facing image-deferral copy can be emitted
there, and that every product-card image has a traceable asset-manifest record.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ARTICLE_DIR = ROOT / "articles"
MANIFEST_PATH = ROOT / "data" / "product-image-manifest.json"
TARGET_ARTICLES = (
    "best-overlanding-air-compressors.html",
    "best-diesel-vs-gasoline-for-overlanding.html",
    "best-skid-plates-for-off-road-trucks.html",
    "best-overlanding-camp-chairs-and-tables.html",
    "best-overlanding-headlamps-and-lanterns.html",
    "best-overlanding-solar-power-setup-guide.html",
)
PLACEHOLDER_PHRASES = (
    "This verified product is intentionally text-first",
    "pending a current approved product image",
    "until a current approved product image is available",
    "because the existing committed Renogy image is a different foldable suitcase configuration",
)


def error(messages: list[str], message: str) -> None:
    messages.append(message)


def validate_manifest(messages: list[str]) -> dict[str, dict]:
    if not MANIFEST_PATH.exists():
        error(messages, f"Missing required asset manifest: {MANIFEST_PATH.relative_to(ROOT)}")
        return {}
    try:
        document = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        error(messages, f"Asset manifest is invalid JSON: {exc}")
        return {}

    entries = document.get("assets")
    if not isinstance(entries, list):
        error(messages, "Asset manifest must expose an 'assets' list")
        return {}

    by_path: dict[str, dict] = {}
    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            error(messages, f"Asset manifest entry {index} must be an object")
            continue
        for key in ("path", "source", "license"):
            value = entry.get(key)
            if not isinstance(value, str) or not value.strip():
                error(messages, f"Asset manifest entry {index} is missing a non-empty '{key}'")
        path = entry.get("path")
        source = entry.get("source")
        if not isinstance(path, str) or not path:
            continue
        if path in by_path:
            error(messages, f"Asset manifest has a duplicate path entry: {path}")
        by_path[path] = entry
        local_path = ROOT / path
        if not local_path.exists():
            error(messages, f"Asset manifest path does not exist: {path}")
            continue
        try:
            with Image.open(local_path) as image:
                image.verify()
        except Exception as exc:  # noqa: BLE001
            error(messages, f"Asset manifest image cannot be read: {path} ({exc})")
        if not isinstance(source, str) or urlparse(source).scheme != "https":
            error(messages, f"Asset manifest source must be an HTTPS URL: {path}")
    return by_path


def main() -> int:
    messages: list[str] = []
    manifest = validate_manifest(messages)
    checked_boxes = 0
    for filename in TARGET_ARTICLES:
        page = ARTICLE_DIR / filename
        if not page.exists():
            error(messages, f"Missing target article: articles/{filename}")
            continue
        text = page.read_text(encoding="utf-8")
        if ">undefined<" in text.replace("\n", ""):
            error(messages, f"articles/{filename}: contains an unresolved literal 'undefined' value")
        for phrase in PLACEHOLDER_PHRASES:
            if phrase in text:
                error(messages, f"articles/{filename}: contains reader-facing image-deferral copy: {phrase}")

        soup = BeautifulSoup(text, "html.parser")
        for position, box in enumerate(soup.select(".product-box"), start=1):
            checked_boxes += 1
            title = box.select_one("h4")
            name = title.get_text(" ", strip=True) if title else f"product box {position}"
            image = box.select_one(".product-box-image img")
            if image is None:
                error(messages, f"articles/{filename}: {name} has no canonical product image")
                continue
            src = image.get("src", "").strip()
            if not src.startswith("../assets/product-images/"):
                error(messages, f"articles/{filename}: {name} has a noncanonical local image path: {src}")
                continue
            asset_path = src.removeprefix("../")
            entry = manifest.get(asset_path)
            if entry is None:
                error(messages, f"articles/{filename}: {name} image lacks an asset-manifest entry: {asset_path}")
                continue
            article_paths = entry.get("articles", [])
            if filename not in article_paths:
                error(messages, f"articles/{filename}: {name} image manifest does not declare article coverage")
            alt = image.get("alt", "").strip()
            if len(alt.split()) < 3:
                error(messages, f"articles/{filename}: {name} image alt text is not descriptive")

    if messages:
        print("Content-repair validation failed:", file=sys.stderr)
        for message in messages:
            print(f"- {message}", file=sys.stderr)
        return 1
    print(f"Content-repair validation passed: {len(TARGET_ARTICLES)} articles and {checked_boxes} product boxes verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
