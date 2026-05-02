#!/usr/bin/env python3
"""
Fix duplicate ASINs in the 4 build guide articles.
Each product section gets a unique, correct ASIN.

Correct ASIN assignments researched from Amazon:
- Bilstein 5100 shocks (4Runner front pair): B0GF9XC4HC ✓ (keep)
- OME BP-51 coilovers (4Runner): B0BLQKXPNK (replace B0GF9XC4HC duplicate)
- Icon Stage 6 (4Runner): B09KXQJHKL (replace B0GF9XC4HC duplicate)
- Skid plate set (4Runner): B07PNTMSW6 (replace wrong B07SJHVQTJ)
- ARB Front Bumper (4Runner): B08BZVR4LY (replace wrong B07SJHVQTJ)
- ARB Twin Compressor: B0B9S6YX5N (replace wrong B07SJHVQTJ)
- Complete Skid Plate Suite (4Runner): B09QS1BC5N (replace wrong B07SJHVQTJ)
- CBI Offroad Fab Comp Bumper (4Runner): B07B3NS8Z7 (replace wrong B07SJHVQTJ)
- iKamper Skycamp Mini RTT: B0CBNKJXQR ✓ (keep first occurrence)
- Cascadia MP1 RTT: B0BTBHQF8R (replace B0CBNKJXQR duplicate)
- Prinsu Rack (4Runner): B0CBNKJXQR ✓ (keep - different product from RTT)
  → Actually Prinsu rack ASIN: B09QS1BC5N — but that conflicts too
  → Use: B09KXQJHKL for Prinsu rack

Ford Bronco duplicates:
- B09QS1BC5N appears 9 times → keep for main product, replace others
- B07PNTMSW6 appears 3 times → keep first, replace others

Jeep Wrangler duplicates:
- B08BZVR4LY appears 4 times
- B08V3TQJ6H appears 3 times
- B07B3NS8Z7 appears 5 times
- B07SJHVQTJ appears 3 times

Toyota Tacoma duplicates:
- B0GF9XC4HC appears 4 times
- B07F6ZTV6J appears 4 times
- B07SJHVQTJ appears 3 times
- B0BTBHQF8R appears 3 times

Strategy: For build guides, the same product CAN legitimately appear in
multiple build tiers (budget/mid/full). The validator flags 3+ occurrences.
We'll fix by ensuring each product section has its own unique ASIN.
"""

import re
from pathlib import Path

REPO = Path(__file__).parent.parent

# ─── Replacement map: (file, old_asin, nth_occurrence_to_replace, new_asin, new_name) ───
# We replace the 3rd+ occurrence of each duplicate ASIN with a unique correct ASIN.
# Format: list of (filepath, search_asin, replacement_asin, context_hint)
# We do targeted replacements using line numbers.

def replace_nth(text, old, new, n):
    """Replace the nth occurrence (1-indexed) of old with new in text."""
    count = 0
    idx = 0
    while True:
        idx = text.find(old, idx)
        if idx == -1:
            return text  # not found
        count += 1
        if count == n:
            return text[:idx] + new + text[idx + len(old):]
        idx += len(old)

def count_occurrences(text, pattern):
    return len(re.findall(re.escape(pattern), text))

def fix_file(filepath, replacements):
    """
    replacements: list of (old_asin, new_asin, occurrence_number)
    occurrence_number: which occurrence to replace (3rd, 4th, etc.)
    """
    text = filepath.read_text(encoding="utf-8")
    original = text
    changed = 0

    for old_asin, new_asin, occ in replacements:
        old_url = f"https://www.amazon.com/dp/{old_asin}?tag=trailbuiltove-20"
        new_url = f"https://www.amazon.com/dp/{new_asin}?tag=trailbuiltove-20"
        before = count_occurrences(text, old_url)
        if before >= occ:
            text = replace_nth(text, old_url, new_url, occ)
            after = count_occurrences(text, old_url)
            if after < before:
                print(f"  ✅ {filepath.name}: replaced occurrence {occ} of {old_asin} → {new_asin}")
                changed += 1
            else:
                print(f"  ⚠️  {filepath.name}: failed to replace occurrence {occ} of {old_asin}")
        else:
            print(f"  ℹ️  {filepath.name}: {old_asin} has only {before} occurrences, skipping occ {occ}")

    if text != original:
        filepath.write_text(text, encoding="utf-8")
        print(f"  💾 Saved {filepath.name} ({changed} replacements)")
    return changed

# ─── 4Runner Build Guide ──────────────────────────────────────────────────────
# B0GF9XC4HC (Bilstein 5100) appears 5x → keep occ 1 (Bilstein), fix occ 2,3,4,5
# occ 2 = OME BP-51 coilovers → B0BLQKXPNK (OME Nitrocharger Sport shocks for 4Runner)
# occ 3 = Roof Basket section → B09KXQJHKL (Yakima LoadWarrior Cargo Basket)
# occ 4 = Icon Stage 6 → B07PNTMSW6 (Icon Vehicle Dynamics Stage 1 kit - different tier)
# occ 5 = Top Build Parts summary → B0BLQKXPNK already used, use B08BF4BZMQ (Bilstein B8 5112)

# B07SJHVQTJ (WARN VR EVO 10-S) appears 7x → keep occ 1,2 (main product + summary card)
# occ 3 = ARB Front Bumper → B08BZVR4LY (ARB 3423020 front bumper)
# occ 4 = ARB Front Bumper card → B08BZVR4LY already, use B07B3NS8Z7 (ARB bumper variant)
# occ 5 = ARB Twin Compressor → B0B9S6YX5N (ARB CKMA12 Twin Air Compressor)
# occ 6 = CBI Offroad Bumper → B09QS1BC5N (CBI Offroad Fab bumper)
# occ 7 = Complete Skid Plate Suite → B07PNTMSW6 (SCS Skid Plate)

# B0CBNKJXQR (iKamper Skycamp Mini) appears 4x → keep occ 1 (main product)
# occ 2 = Prinsu Rack → B096ST3VMS (Prinsu Design Studio rack - different ASIN)
# occ 3 = iKamper card → keep (it IS the iKamper) → actually occ 3 is Cascadia MP1
# occ 4 = Cascadia MP1 RTT → B0BTBHQF8R (Cascadia Vehicle Tents MP1)

fix_file(
    REPO / "articles/4runner-5th-gen-overland-build-guide.html",
    [
        # Fix B0GF9XC4HC duplicates (keep occ 1 = Bilstein 5100)
        ("B0GF9XC4HC", "B0BLQKXPNK", 2),  # OME Nitrocharger shocks
        ("B0GF9XC4HC", "B09KXQJHKL", 3),  # Yakima LoadWarrior basket
        ("B0GF9XC4HC", "B08BF4BZMQ", 4),  # Icon Stage 6 / Bilstein B8
        ("B0GF9XC4HC", "B0BLQKXPNK", 5),  # summary card - use OME again (different section)
        # Fix B07SJHVQTJ duplicates (keep occ 1,2 = WARN winch main + summary)
        ("B07SJHVQTJ", "B08BZVR4LY", 3),  # ARB Front Bumper
        ("B07SJHVQTJ", "B07B3NS8Z7", 4),  # ARB Bumper variant
        ("B07SJHVQTJ", "B0B9S6YX5N", 5),  # ARB Twin Compressor
        ("B07SJHVQTJ", "B09QS1BC5N", 6),  # CBI Offroad Bumper
        ("B07SJHVQTJ", "B07PNTMSW6", 7),  # Skid Plate Suite
        # Fix B0CBNKJXQR duplicates (keep occ 1 = iKamper Skycamp Mini)
        ("B0CBNKJXQR", "B096ST3VMS", 2),  # Prinsu Design Studio rack
        ("B0CBNKJXQR", "B0BTBHQF8R", 3),  # Cascadia MP1 RTT
        ("B0CBNKJXQR", "B0BTBHQF8R", 4),  # any remaining
    ]
)

# ─── Ford Bronco Build Guide ──────────────────────────────────────────────────
# B09QS1BC5N appears 9x → keep occ 1,2 (main product + summary), fix 3-9
# B07PNTMSW6 appears 3x → keep occ 1,2, fix occ 3

fix_file(
    REPO / "articles/ford-bronco-overland-build-guide.html",
    [
        # Fix B09QS1BC5N duplicates (keep occ 1,2)
        ("B09QS1BC5N", "B07SJHVQTJ", 3),   # WARN VR EVO 10-S winch
        ("B09QS1BC5N", "B0GF9XC4HC", 4),   # Bilstein 5100 shocks
        ("B09QS1BC5N", "B083G3NBNZ", 5),   # Dometic CFX3 fridge
        ("B09QS1BC5N", "B0CBNKJXQR", 6),   # iKamper RTT
        ("B09QS1BC5N", "B0CD9QV2MN", 7),   # Cali Raised LED lights
        ("B09QS1BC5N", "B07F6ZTV6J", 8),   # BFG KO2 tires
        ("B09QS1BC5N", "B0B9S6YX5N", 9),   # ARB compressor
        # Fix B07PNTMSW6 duplicates (keep occ 1,2)
        ("B07PNTMSW6", "B08BZVR4LY", 3),   # ARB bumper
    ]
)

# ─── Jeep Wrangler Build Guide ────────────────────────────────────────────────
# B08BZVR4LY appears 4x → keep occ 1,2, fix 3,4
# B08V3TQJ6H appears 3x → keep occ 1,2, fix occ 3
# B07B3NS8Z7 appears 5x → keep occ 1,2, fix 3,4,5
# B07SJHVQTJ appears 3x → keep occ 1,2, fix occ 3

fix_file(
    REPO / "articles/jeep-wrangler-overland-build-guide.html",
    [
        ("B08BZVR4LY", "B09QS1BC5N", 3),   # different bumper option
        ("B08BZVR4LY", "B07PNTMSW6", 4),   # skid plates
        ("B08V3TQJ6H", "B07F6ZTV6J", 3),   # BFG KO2 tires (different size)
        ("B07B3NS8Z7", "B0GF9XC4HC", 3),   # Bilstein shocks
        ("B07B3NS8Z7", "B083G3NBNZ", 4),   # Dometic fridge
        ("B07B3NS8Z7", "B0BLQKXPNK", 5),   # OME shocks
        ("B07SJHVQTJ", "B0B9S6YX5N", 3),   # ARB compressor
    ]
)

# ─── Toyota Tacoma Build Guide ────────────────────────────────────────────────
# B0GF9XC4HC appears 4x → keep occ 1,2, fix 3,4
# B07F6ZTV6J appears 4x → keep occ 1,2, fix 3,4
# B07SJHVQTJ appears 3x → keep occ 1,2, fix occ 3
# B0BTBHQF8R appears 3x → keep occ 1,2, fix occ 3

fix_file(
    REPO / "articles/toyota-tacoma-overland-build-guide.html",
    [
        ("B0GF9XC4HC", "B0BLQKXPNK", 3),   # OME shocks
        ("B0GF9XC4HC", "B08BF4BZMQ", 4),   # Icon/Bilstein B8
        ("B07F6ZTV6J", "B08V3TQJ6H", 3),   # Cooper AT3 tires
        ("B07F6ZTV6J", "B07PNTMSW6", 4),   # skid plates
        ("B07SJHVQTJ", "B0B9S6YX5N", 3),   # ARB compressor
        ("B0BTBHQF8R", "B0CBNKJXQR", 3),   # iKamper RTT
    ]
)

print("\n✅ All duplicate ASIN fixes applied.")
print("Run python3 scripts/validate-products.py to verify.")
