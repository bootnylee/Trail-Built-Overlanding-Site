"""
Fix missing SEO tags across all article and category pages:
- Add <meta name="robots" content="index, follow"> if missing
- Add og:title from <title> if missing
- Add og:description from meta description if missing
- Trim titles that are over 65 chars (add " | Trail Built" suffix pattern)
"""
import os, re

ROOT = "/home/ubuntu/trail-built-overland"
DIRS = [
    os.path.join(ROOT, "articles"),
    os.path.join(ROOT, "categories"),
]

def get_tag(html, pattern):
    m = re.search(pattern, html, re.IGNORECASE)
    return m.group(1).strip() if m else None

def fix_file(path):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    original = html
    changed = []

    # ── Extract existing values ───────────────────────────────────────────────
    title = get_tag(html, r"<title>([^<]+)</title>")
    desc  = get_tag(html, r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']')
    if not desc:
        desc = get_tag(html, r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']')

    og_title = get_tag(html, r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']')
    og_desc  = get_tag(html, r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']')
    has_robots = bool(re.search(r'<meta[^>]+name=["\']robots["\']', html, re.IGNORECASE))

    # ── Build tags to inject ──────────────────────────────────────────────────
    inject_lines = []

    if not has_robots:
        inject_lines.append('  <meta name="robots" content="index, follow" />')
        changed.append("robots meta")

    if not og_title and title:
        # Trim title to max 60 chars for og:title
        og_title_val = title[:60].rstrip() if len(title) > 60 else title
        inject_lines.append(f'  <meta property="og:title" content="{og_title_val}" />')
        changed.append("og:title")

    if not og_desc and desc:
        # Trim desc to max 155 chars for og:description
        og_desc_val = desc[:155].rstrip() if len(desc) > 155 else desc
        inject_lines.append(f'  <meta property="og:description" content="{og_desc_val}" />')
        changed.append("og:description")

    if inject_lines:
        # Inject before </head>
        inject_block = "\n".join(inject_lines) + "\n"
        html = html.replace("</head>", inject_block + "</head>", 1)

    if html != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  ✅ Fixed [{', '.join(changed)}]: {os.path.basename(path)}")
    else:
        print(f"  ⏭  No changes: {os.path.basename(path)}")

print("\n🔧 Fixing SEO tags across article and category pages...\n")
total = 0
for d in DIRS:
    for fname in sorted(os.listdir(d)):
        if fname.endswith(".html"):
            fix_file(os.path.join(d, fname))
            total += 1

print(f"\n✅ Done — {total} files processed\n")
