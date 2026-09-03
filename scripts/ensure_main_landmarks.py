#!/usr/bin/env python3
"""Ensure every public non-quiz Trail Built HTML page has exactly one main landmark."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_TOP_LEVEL = {"admin", "newsletters", "email-templates", "node_modules", ".git"}


def public_non_quiz_pages() -> list[Path]:
    pages: list[Path] = []
    for page in ROOT.rglob("*.html"):
        relative = page.relative_to(ROOT)
        if relative.parts[0] in EXCLUDED_TOP_LEVEL:
            continue
        if page.name.lower() == "quiz.html":
            continue
        if relative.parts[0] not in {"articles", "categories"} and len(relative.parts) != 1:
            continue
        pages.append(page)
    return sorted(pages)


def add_landmark(html: str, label: str) -> str:
    if re.search(r"<main\b", html, re.I):
        return html
    header = re.search(r"</header\s*>", html, re.I)
    body = re.search(r"<body\b[^>]*>", html, re.I)
    if not body:
        raise ValueError(f"{label}: missing body element")
    start = header.end() if header else body.end()
    footer = re.search(r"<footer\b", html[start:], re.I)
    end = start + footer.start() if footer else html.lower().rfind("</body>")
    if end <= start:
        raise ValueError(f"{label}: unable to locate main content boundary")
    return f"{html[:start]}\n<main id=\"main-content\">{html[start:end]}\n</main>\n{html[end:]}"


def main_count(html: str) -> int:
    return len(re.findall(r"<main\b", html, re.I))


def main() -> int:
    check_only = "--check" in sys.argv
    changed: list[str] = []
    failures: list[str] = []
    for page in public_non_quiz_pages():
        html = page.read_text(encoding="utf-8")
        if check_only:
            count = main_count(html)
            if count != 1:
                failures.append(f"{page.relative_to(ROOT)} has {count} main landmarks")
            continue
        updated = add_landmark(html, str(page.relative_to(ROOT)))
        if updated != html:
            page.write_text(updated, encoding="utf-8")
            changed.append(str(page.relative_to(ROOT)))
        count = main_count(updated)
        if count != 1:
            failures.append(f"{page.relative_to(ROOT)} has {count} main landmarks")
    if failures:
        print("MAIN_LANDMARKS=FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("MAIN_LANDMARKS=PASS")
    print(f"PAGES_CHECKED={len(public_non_quiz_pages())}")
    if not check_only:
        print(f"PAGES_UPDATED={len(changed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
