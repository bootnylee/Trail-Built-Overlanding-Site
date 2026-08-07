#!/usr/bin/env python3
"""
asin_lookup.py — Amazon ASIN verification tool for Trail Built Overland guardrails.

PART 1 of the affiliate-link guardrail system.

Uses Amazon Product Advertising API (PA-API 5.0) when credentials are available,
falls back to public Amazon page verification when they are not.

PA-API SETUP (one-time):
  1. Sign in to https://affiliate-program.amazon.com/
  2. Go to Tools → Product Advertising API → Manage Credentials
  3. Create an access key and note:
       - Access Key ID  → set as env var PAAPI_ACCESS_KEY
       - Secret Key     → set as env var PAAPI_SECRET_KEY
       - Associate Tag  → set as env var PAAPI_ASSOCIATE_TAG (e.g. trailbuiltove-20)
  4. Set PAAPI_REGION (default: us-east-1) and PAAPI_MARKETPLACE (default: www.amazon.com)

Without PA-API credentials, the tool falls back to scraping the public Amazon product
page to verify that the ASIN resolves and the title fuzzy-matches the expected name.
"""

import os
import re
import time
import json
import hashlib
import hmac
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# Configuration — set these environment variables to enable PA-API
# ─────────────────────────────────────────────────────────────────────────────
PAAPI_ACCESS_KEY    = os.environ.get("PAAPI_ACCESS_KEY", "")       # ← YOUR PA-API ACCESS KEY
PAAPI_SECRET_KEY    = os.environ.get("PAAPI_SECRET_KEY", "")       # ← YOUR PA-API SECRET KEY
PAAPI_ASSOCIATE_TAG = os.environ.get("PAAPI_ASSOCIATE_TAG", "trailbuiltove-20")
PAAPI_REGION        = os.environ.get("PAAPI_REGION", "us-east-1")
PAAPI_HOST          = "webservices.amazon.com"
PAAPI_URI           = "/paapi5/getitems"

# Fuzzy-match threshold: Amazon title must share this fraction of words with expected name
MATCH_THRESHOLD = 0.35   # intentionally lenient — catches completely wrong products

# Rate limiting: PA-API allows 1 request/second on the free tier
PAAPI_RATE_LIMIT_SECONDS = 1.1

_last_paapi_call = 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ─────────────────────────────────────────────────────────────────────────────
class ASINResult:
    def __init__(self, asin: str, expected_name: str, amazon_title: Optional[str],
                 resolves: bool, title_match: bool, match_score: float,
                 price: Optional[str], image_url: Optional[str],
                 source: str, error: Optional[str] = None):
        self.asin = asin
        self.expected_name = expected_name
        self.amazon_title = amazon_title
        self.resolves = resolves
        self.title_match = title_match
        self.match_score = match_score
        self.price = price
        self.image_url = image_url
        self.source = source   # "paapi" or "scrape"
        self.error = error

    @property
    def ok(self) -> bool:
        return self.resolves and self.title_match

    def to_dict(self) -> dict:
        return {
            "asin": self.asin,
            "expected_name": self.expected_name,
            "amazon_title": self.amazon_title,
            "resolves": self.resolves,
            "title_match": self.title_match,
            "match_score": round(self.match_score, 3),
            "price": self.price,
            "image_url": self.image_url,
            "source": self.source,
            "ok": self.ok,
            "error": self.error,
        }

    def __repr__(self):
        status = "✓" if self.ok else "✗"
        return (f"[{status}] {self.asin} | expected: {self.expected_name[:40]} | "
                f"amazon: {(self.amazon_title or 'NOT FOUND')[:40]} | "
                f"match: {self.match_score:.0%} | source: {self.source}")


# ─────────────────────────────────────────────────────────────────────────────
# Fuzzy title matching
# ─────────────────────────────────────────────────────────────────────────────
def _normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def _title_matches(expected: str, amazon_title: str, threshold: float = MATCH_THRESHOLD) -> tuple[bool, float]:
    """
    Return (matches, score). Uses word overlap + SequenceMatcher.
    Lenient by design — we want to catch completely wrong products,
    not penalize minor title variations (e.g. "Warn VR EVO 10-S" vs
    "WARN 103253 VR EVO 10-S Electric 12V DC Winch 10,000 lb").
    """
    if not amazon_title:
        return False, 0.0

    exp_norm = _normalize(expected)
    amz_norm = _normalize(amazon_title)

    # Word overlap score
    exp_words = set(exp_norm.split())
    amz_words = set(amz_norm.split())
    # Remove very short stop words
    stop = {'a', 'an', 'the', 'for', 'and', 'or', 'in', 'on', 'of', 'to', 'with', 'lb', 'lbs'}
    exp_words -= stop
    amz_words -= stop

    if not exp_words:
        return True, 1.0  # nothing to compare

    overlap = len(exp_words & amz_words) / len(exp_words)

    # Sequence similarity as secondary signal
    seq_score = SequenceMatcher(None, exp_norm, amz_norm).ratio()

    # Combined score: weight word overlap more heavily
    combined = (overlap * 0.7) + (seq_score * 0.3)
    return combined >= threshold, combined


# ─────────────────────────────────────────────────────────────────────────────
# PA-API 5.0 — AWS Signature V4 signing
# ─────────────────────────────────────────────────────────────────────────────
def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _get_signature_key(secret_key: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date    = _sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region  = _sign(k_date, region)
    k_service = _sign(k_region, service)
    k_signing = _sign(k_service, "aws4_request")
    return k_signing


def _paapi_lookup(asin: str) -> dict:
    """
    Call PA-API 5.0 GetItems for a single ASIN.
    Returns the parsed JSON response dict, or raises on error.
    """
    global _last_paapi_call

    # Rate limiting
    elapsed = time.time() - _last_paapi_call
    if elapsed < PAAPI_RATE_LIMIT_SECONDS:
        time.sleep(PAAPI_RATE_LIMIT_SECONDS - elapsed)

    payload = {
        "ItemIds": [asin],
        "Resources": [
            "ItemInfo.Title",
            "Offers.Listings.Price",
            "Images.Primary.Large",
        ],
        "PartnerTag": PAAPI_ASSOCIATE_TAG,
        "PartnerType": "Associates",
        "Marketplace": "www.amazon.com",
    }
    payload_json = json.dumps(payload)

    # Build canonical request
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    content_type = "application/json; charset=UTF-8"
    x_amz_target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems"

    headers_to_sign = {
        "content-encoding": "amz-1.0",
        "content-type": content_type,
        "host": PAAPI_HOST,
        "x-amz-date": amz_date,
        "x-amz-target": x_amz_target,
    }
    canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted(headers_to_sign.items()))
    signed_headers = ";".join(sorted(headers_to_sign.keys()))

    payload_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
    canonical_request = "\n".join([
        "POST", PAAPI_URI, "",
        canonical_headers, signed_headers, payload_hash
    ])

    credential_scope = f"{date_stamp}/{PAAPI_REGION}/ProductAdvertisingAPI/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    ])

    signing_key = _get_signature_key(PAAPI_SECRET_KEY, date_stamp, PAAPI_REGION, "ProductAdvertisingAPI")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={PAAPI_ACCESS_KEY}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req_headers = {
        "Authorization": authorization,
        "Content-Encoding": "amz-1.0",
        "Content-Type": content_type,
        "Host": PAAPI_HOST,
        "X-Amz-Date": amz_date,
        "X-Amz-Target": x_amz_target,
    }

    url = f"https://{PAAPI_HOST}{PAAPI_URI}"
    req = urllib.request.Request(url, data=payload_json.encode("utf-8"),
                                  headers=req_headers, method="POST")
    _last_paapi_call = time.time()

    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ─────────────────────────────────────────────────────────────────────────────
# Fallback: scrape public Amazon product page
# ─────────────────────────────────────────────────────────────────────────────
def _scrape_amazon(asin: str) -> tuple[Optional[str], Optional[str]]:
    """
    Fetch the public Amazon product page and extract the title.
    Returns (title, None) on success, (None, error_message) on failure.
    """
    url = f"https://www.amazon.com/dp/{asin}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        # Extract title from <span id="productTitle">
        m = re.search(r'id="productTitle"[^>]*>\s*([^<]{5,300})', html)
        if m:
            return m.group(1).strip(), None

        # Fallback: og:title meta tag
        m2 = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]{5,300})"', html)
        if m2:
            return m2.group(1).strip(), None

        # Check if it's a "page not found" or robot check
        if "robot" in html.lower() or "captcha" in html.lower():
            return None, "Amazon returned a bot-check page"
        if "Sorry, we just need to make sure you" in html:
            return None, "Amazon rate-limited the request"

        return None, "Title not found in page HTML"

    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, f"ASIN not found (HTTP 404)"
        return None, f"HTTP {e.code}: {e.reason}"
    except Exception as e:
        return None, str(e)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
def verify_asin(asin: str, expected_name: str) -> ASINResult:
    """
    Verify that an ASIN resolves to a live Amazon listing and that the
    returned title fuzzy-matches the expected product name.

    Uses PA-API when credentials are set, falls back to page scraping.
    """
    if not asin or not re.match(r'^[A-Z0-9]{10}$', asin):
        return ASINResult(
            asin=asin, expected_name=expected_name,
            amazon_title=None, resolves=False, title_match=False,
            match_score=0.0, price=None, image_url=None,
            source="none", error=f"Invalid ASIN format: '{asin}'"
        )

    # ── Try PA-API first ──────────────────────────────────────────────────────
    if PAAPI_ACCESS_KEY and PAAPI_SECRET_KEY:
        try:
            resp = _paapi_lookup(asin)
            items = resp.get("ItemsResult", {}).get("Items", [])
            if not items:
                errors = resp.get("Errors", [])
                err_msg = errors[0].get("Message", "No items returned") if errors else "No items returned"
                return ASINResult(
                    asin=asin, expected_name=expected_name,
                    amazon_title=None, resolves=False, title_match=False,
                    match_score=0.0, price=None, image_url=None,
                    source="paapi", error=err_msg
                )

            item = items[0]
            title = item.get("ItemInfo", {}).get("Title", {}).get("DisplayValue")
            price = (item.get("Offers", {})
                        .get("Listings", [{}])[0]
                        .get("Price", {})
                        .get("DisplayAmount"))
            image_url = (item.get("Images", {})
                            .get("Primary", {})
                            .get("Large", {})
                            .get("URL"))

            matches, score = _title_matches(expected_name, title or "")
            return ASINResult(
                asin=asin, expected_name=expected_name,
                amazon_title=title, resolves=True, title_match=matches,
                match_score=score, price=price, image_url=image_url,
                source="paapi"
            )
        except Exception as e:
            # PA-API failed — fall through to scrape
            pass

    # ── Fallback: scrape public page ─────────────────────────────────────────
    time.sleep(0.5)   # polite delay between scrape requests
    title, err = _scrape_amazon(asin)
    if err:
        return ASINResult(
            asin=asin, expected_name=expected_name,
            amazon_title=None, resolves=False, title_match=False,
            match_score=0.0, price=None, image_url=None,
            source="scrape", error=err
        )

    matches, score = _title_matches(expected_name, title or "")
    return ASINResult(
        asin=asin, expected_name=expected_name,
        amazon_title=title, resolves=True, title_match=matches,
        match_score=score, price=None, image_url=None,
        source="scrape"
    )


def verify_asins_bulk(products: list[dict], delay: float = 1.0) -> list[ASINResult]:
    """
    Verify a list of products. Each dict must have 'asin' and 'name' keys.
    Returns a list of ASINResult objects in the same order.
    """
    results = []
    for i, p in enumerate(products):
        asin = p.get("asin", "").strip()
        name = p.get("name", "").strip()
        if not asin:
            results.append(ASINResult(
                asin="", expected_name=name, amazon_title=None,
                resolves=False, title_match=False, match_score=0.0,
                price=None, image_url=None, source="none",
                error="No ASIN provided"
            ))
            continue
        result = verify_asin(asin, name)
        results.append(result)
        if i < len(products) - 1:
            time.sleep(delay)
    return results


# ─────────────────────────────────────────────────────────────────────────────
# CLI usage: python3 asin_lookup.py B07SJHVQTJ "Warn VR EVO 10-S Winch"
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python3 asin_lookup.py <ASIN> <expected_product_name>")
        print("       python3 asin_lookup.py B07SJHVQTJ 'Warn VR EVO 10-S Winch'")
        sys.exit(1)

    asin_arg = sys.argv[1]
    name_arg = " ".join(sys.argv[2:])
    result = verify_asin(asin_arg, name_arg)
    print(result)
    print(json.dumps(result.to_dict(), indent=2))
    sys.exit(0 if result.ok else 1)
