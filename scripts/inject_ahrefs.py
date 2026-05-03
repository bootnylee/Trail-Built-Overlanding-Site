#!/usr/bin/env python3
"""
Inject Ahrefs analytics snippet into the <head> section of every HTML page.
Skips pages that already have it.
"""
from pathlib import Path
import re

REPO_ROOT = Path(__file__).parent.parent

AHREFS_SNIPPET = '<script src="https://analytics.ahrefs.com/analytics.js" data-key="j9FlobP0cqeKUsyYo3HRlw" async></script>'
MARKER = "analytics.ahrefs.com"

html_files = (
    list(REPO_ROOT.glob("*.html")) +
    list((REPO_ROOT / "articles").glob("*.html")) +
    list((REPO_ROOT / "categories").glob("*.html"))
)

injected = []
skipped  = []

for path in sorted(html_files):
    content = path.read_text(encoding="utf-8")

    if MARKER in content:
        skipped.append(path.name)
        continue

    # Insert before closing </head>
    new_content = re.sub(
        r'(</head>)',
        AHREFS_SNIPPET + r'\n\1',
        content,
        count=1,
        flags=re.IGNORECASE
    )

    if new_content == content:
        print(f"  WARNING: No </head> tag found in {path.name} — skipped")
        skipped.append(path.name)
        continue

    path.write_text(new_content, encoding="utf-8")
    injected.append(path.name)

print(f"\n✅ Ahrefs snippet injected into {len(injected)} file(s):")
for f in injected:
    print(f"   + {f}")

if skipped:
    print(f"\n⏭  Skipped {len(skipped)} file(s) (already present or no </head>):")
    for f in skipped:
        print(f"   - {f}")
