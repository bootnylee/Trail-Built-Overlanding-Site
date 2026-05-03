#!/usr/bin/env python3
"""
Inject Google Analytics gtag.js snippet immediately after <head>
on every HTML page in the site. Skips pages that already have it.
"""
from pathlib import Path
import re

REPO_ROOT = Path(__file__).parent.parent

GTAG_SNIPPET = """<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-GX99D9KWL0"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-GX99D9KWL0');
</script>"""

MARKER = "G-GX99D9KWL0"

# Collect all HTML files (root, articles/, categories/)
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

    # Insert immediately after <head> (case-insensitive)
    new_content = re.sub(
        r'(<head\b[^>]*>)',
        r'\1\n' + GTAG_SNIPPET,
        content,
        count=1,
        flags=re.IGNORECASE
    )

    if new_content == content:
        print(f"  WARNING: No <head> tag found in {path.name} — skipped")
        skipped.append(path.name)
        continue

    path.write_text(new_content, encoding="utf-8")
    injected.append(path.name)

print(f"\n✅ GA4 tag injected into {len(injected)} file(s):")
for f in injected:
    print(f"   + {f}")

if skipped:
    print(f"\n⏭  Skipped {len(skipped)} file(s) (already present or no <head>):")
    for f in skipped:
        print(f"   - {f}")
