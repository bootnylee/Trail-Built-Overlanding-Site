# Trail Built Overlanding — Image Selection Strategy

## Overview

This document defines the two-source image strategy for trailbuiltoverland.com, mirroring the SilkierStrands model. Every image on the site falls into one of two categories: **product images** (from Amazon CDN) or **contextual/hero images** (from Unsplash).

---

## Source 1: Amazon CDN — Product Card Images

**Used for:** Product cards, comparison tables, gear listings in articles and category pages.

**URL format:**
```
https://m.media-amazon.com/images/I/{IMAGE_CODE}._SL500_.jpg
```

**Size variants:**
| Use case | Size suffix | Approx. px |
|---|---|---|
| Product card thumbnail | `._SL500_.jpg` | 500×500 |
| Article hero product | `._SL1500_.jpg` | 1500×1500 |
| Comparison table | `._SL300_.jpg` | 300×300 |

**How to find the image code:**
1. Go to the Amazon product page
2. Right-click the main product image → "Open image in new tab"
3. The URL will be: `https://m.media-amazon.com/images/I/71abc123XY._AC_SL1500_.jpg`
4. The image code is `71abc123XY` (everything between `/I/` and `._`)

**Implementation:**
```html
<!-- Option A: Direct URL (preferred for known products) -->
<img src="https://m.media-amazon.com/images/I/71abc123XY._SL500_.jpg"
     alt="WARN VR EVO 10-S Winch with synthetic rope"
     loading="lazy"
     decoding="async"
     width="500" height="500">

<!-- Option B: data-amazon-img attribute (auto-injected by js/amazon.js) -->
<img data-amazon-img="71abc123XY"
     alt="WARN VR EVO 10-S Winch with synthetic rope"
     width="500" height="500">
```

**Alt text standard:**
- Format: `{Product Name} {key feature or variant}`
- Example: `"WARN VR EVO 10-S Winch with synthetic rope"`
- Never: `"product image"`, `"image"`, empty string

---

## Source 2: Unsplash — Hero & Article Banner Images

**Used for:** Page hero backgrounds, article banner images, category page headers.

**URL format:**
```
https://images.unsplash.com/photo-{ID}?auto=format&fit=crop&w=1200&q=80
```

**Size variants:**
| Use case | Width param | Quality |
|---|---|---|
| Article hero (full width) | `w=1200` | `q=80` |
| Category page header | `w=1200` | `q=80` |
| Homepage hero | `w=1600` | `q=85` |
| Card thumbnail | `w=600` | `q=75` |

**How to find the photo ID:**
1. Search Unsplash (unsplash.com) for the relevant subject
2. Click the photo → the URL will be `unsplash.com/photos/{ID}`
3. Use that ID in the URL above

**Preferred search terms for overlanding content:**
| Content type | Unsplash search terms |
|---|---|
| Recovery gear | "off road recovery", "4x4 stuck mud", "overlanding trail" |
| Winches | "truck winch", "4x4 winch", "off road recovery" |
| Fridges/coolers | "camping fridge", "overlanding camp", "camp kitchen" |
| Solar/power | "solar panel camping", "van solar", "overlanding power" |
| Lighting | "off road lights", "night trail driving", "overlanding night" |
| Rooftop tents | "rooftop tent", "overlanding camp", "4x4 camping" |
| Build guides | "jeep wrangler trail", "4runner offroad", "bronco overlanding" |

**Implementation:**
```html
<img src="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1200&q=80"
     alt="Overlanding vehicle on rocky mountain trail at sunset"
     loading="lazy"
     decoding="async"
     width="1200" height="630">
```

**Alt text standard:**
- Describe the scene, not the source
- Format: `{Subject} {action/context} {setting}`
- Example: `"Lifted 4Runner on rocky desert trail with mountains in background"`
- Never: `"unsplash image"`, `"hero image"`, empty string

---

## Image Requirements Checklist

Every image on the site must meet all of the following:

| Requirement | Standard |
|---|---|
| `loading` attribute | `loading="lazy"` (except above-the-fold images) |
| `decoding` attribute | `decoding="async"` |
| `alt` attribute | Non-empty, descriptive (see standards above) |
| `width` + `height` attributes | Always set to prevent layout shift (CLS) |
| Product images | Unique per product — no two products share the same image code |
| Hero images | Contextually relevant to the article topic |
| Format | JPEG via Amazon CDN or Unsplash (no PNG for photos) |
| Max file size | N/A (CDN-served, no local images except favicon) |

---

## Adding Images to New Articles

When the article generator (`scripts/generate-article.js`) creates a new article:

1. **Hero image:** Use Unsplash with a topic-relevant search term. Add `auto=format&fit=crop&w=1200&q=80` params.
2. **Product images:** Use `https://m.media-amazon.com/images/I/{CODE}._SL500_.jpg` for each product. Find the image code from the Amazon product page.
3. **Validate:** Run `python3 scripts/validate-products.py` to confirm no duplicate image codes.

---

## Preconnect Hints (already in all page `<head>` sections)

```html
<link rel="preconnect" href="https://images.unsplash.com">
<link rel="preconnect" href="https://m.media-amazon.com">
```

These are already present in all page templates. Do not remove them.

---

## Known Image Codes (current product inventory)

| Product | ASIN | Image Code |
|---|---|---|
| WARN VR EVO 10-S Winch | B07SJHVQTJ | 71Qe3VbHJyL |
| MaxTrax MKII Recovery Boards | B01K2AH3F2 | 71ZxqFjJMkL |
| Dometic CFX3 55 Fridge | B083G3NBNZ | 71abc123XYL |
| Renogy 200W Flexible Solar | B07FGC1N3J | 71def456ABL |
| Garmin inReach Mini 2 | B09QS1BC5N | 71ghi789CDL |
| Baja Designs Squadron Pro | B01KT0BF04 | 71jkl012EFL |
| ARB Twin Compressor | B0B9S6YX5N | 71mno345GHL |
| Bilstein 5100 Shocks | B0GF9XC4HC | 71pqr678IJL |
| BFG KO2 Tires 285/75R17 | B07F6ZTV6J | 71stu901KLL |
| iKamper Skycamp Mini RTT | B0CBNKJXQR | 71vwx234MNL |

*Note: Image codes above are placeholders. Replace with actual codes from Amazon product pages.*
*Run `python3 scripts/validate-products.py --live` to verify all image codes are live.*
