import json, re
from datetime import date

with open('/home/ubuntu/trail-built-overland/seo-audit-report.json') as f:
    d = json.load(f)

pages = d.get('pages', [])
all_issues = d.get('issues', [])
all_warnings = d.get('warnings', [])
all_passed = d.get('passed', [])

total = len(pages)
issue_count = sum(len(p['issues']) for p in pages)
warn_count = sum(len(p['warnings']) for p in pages)
pass_count = sum(len(p['passed']) for p in pages)

# Group by type
types = {}
for p in pages:
    t = p.get('type', 'unknown')
    types.setdefault(t, {'count':0,'issues':0,'warnings':0,'passed':0,'pages':[]})
    types[t]['count'] += 1
    types[t]['issues'] += len(p['issues'])
    types[t]['warnings'] += len(p['warnings'])
    types[t]['passed'] += len(p['passed'])
    types[t]['pages'].append(p)

print(f"TOTAL_PAGES={total}")
print(f"ISSUE_COUNT={issue_count}")
print(f"WARN_COUNT={warn_count}")
print(f"PASS_COUNT={pass_count}")
print()

# Amazon link totals
amz_links = 0
for p in pages:
    for item in p.get('passed', []):
        m = re.search(r'All (\d+) Amazon links', item)
        if m:
            amz_links += int(m.group(1))
print(f"TOTAL_AMAZON_LINKS={amz_links}")

# Pages with warnings
print("\n=== PAGES WITH WARNINGS ===")
for p in pages:
    if p['warnings']:
        print(f"  {p['url']}")
        for w in p['warnings']:
            print(f"    ⚠️  {w}")

# Pages with issues
print("\n=== PAGES WITH ISSUES ===")
found = False
for p in pages:
    if p['issues']:
        found = True
        print(f"  {p['url']}")
        for i in p['issues']:
            print(f"    ❌ {i}")
if not found:
    print("  None — all pages are issue-free!")

# Per-type summary
print("\n=== BY PAGE TYPE ===")
for t, v in sorted(types.items()):
    pct = round(v['passed'] / (v['passed'] + v['issues'] + v['warnings']) * 100, 1) if (v['passed'] + v['issues'] + v['warnings']) > 0 else 0
    print(f"  {t}: {v['count']} pages | ❌ {v['issues']} issues | ⚠️  {v['warnings']} warnings | ✅ {v['passed']} passed ({pct}%)")

# Full page list
print("\n=== FULL PAGE STATUS ===")
for p in pages:
    if p['issues']:
        status = '❌'
    elif p['warnings']:
        status = '⚠️ '
    else:
        status = '✅'
    print(f"  {status} [{p.get('type','?')}] {p['url']}")

# Title length distribution
print("\n=== TITLE LENGTHS ===")
for p in pages:
    for item in p.get('passed', []):
        m = re.search(r'Title OK \((\d+) chars\)', item)
        if m:
            chars = int(m.group(1))
            bar = '█' * (chars // 5)
            print(f"  {chars:3d} chars {bar} {p['url'].split('/')[-1]}")

# Meta description length distribution
print("\n=== META DESCRIPTION LENGTHS ===")
for p in pages:
    for item in p.get('passed', []):
        m = re.search(r'Meta description OK \((\d+) chars\)', item)
        if m:
            chars = int(m.group(1))
            bar = '█' * (chars // 10)
            print(f"  {chars:3d} chars {bar} {p['url'].split('/')[-1]}")
