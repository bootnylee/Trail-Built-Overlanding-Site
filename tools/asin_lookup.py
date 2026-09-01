#!/usr/bin/env python3
"""
asin_lookup.py — Amazon ASIN verification tool for Trail Built Overland guardrails.

PART 1 of the affiliate-link guardrail system.

Uses the Amazon Creators API (OAuth 2.0 / Login with Amazon) when credentials
are available, falls back to public Amazon page scraping when they are not.

CREATORS API SETUP (one-time):
  1. Sign in to https://affiliate-program.amazon.com/creatorsapi
  2. Create an application and note:
       - Client ID     → set as env var CREATORS_API_CLIENT_ID
       - Client Secret → set as env var CREATORS_API_CLIENT_SECRET
  3. Set CREATORS_API_PARTNER_TAG to your affiliate tag (e.g. trailbuiltove-20)

Credential reference: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl

Without Creators API credentials, the tool falls back to scraping the public Amazon
product page to verify that the ASIN resolves and the title fuzzy-matches the
expected name.
"""

import base64
import os
import re
import time
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# Configuration — set these environment variables to enable Creators API
# ─────────────────────────────────────────────────────────────────────────────
# Use only the current Amazon Creators API environment variables. Legacy PA-API
# variable names are intentionally unsupported so obsolete credentials cannot
# silently reactivate a deprecated integration.
CREATORS_API_CLIENT_ID = os.environ.get("CREATORS_API_CLIENT_ID", "")
CREATORS_API_CLIENT_SECRET = os.environ.get("CREATORS_API_CLIENT_SECRET", "")
# Creators API app is registered to this store; site affiliate links keep their own tags.
API_PARTNER_TAG = "trailbuiltove-20"
CONFIGURED_PARTNER_TAG = os.environ.get("CREATORS_API_PARTNER_TAG", "")
CREATORS_API_MARKETPLACE   = os.environ.get("CREATORS_API_MARKETPLACE", "www.amazon.com")

# OAuth 2.0 token endpoints. New Creators API credentials use v3 LwA;
# existing credentials may still require the v2 Cognito exchange used by the
# established daily price-sync client.
CREATORS_API_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
CREATORS_API_COGNITO_TOKEN_URL = "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token"
# Creators API base URL (global)
CREATORS_API_BASE_URL  = "https://creatorsapi.amazon"
CREATORS_API_GETITEMS  = f"{CREATORS_API_BASE_URL}/catalog/v1/getItems"
CREATORS_API_SEARCHITEMS = f"{CREATORS_API_BASE_URL}/catalog/v1/searchItems"

# Fuzzy-match threshold: Amazon title must share this fraction of words with expected name
MATCH_THRESHOLD = 0.35   # intentionally lenient — catches completely wrong products

# Token cache (in-process; refreshed when expired)
_token_cache: dict = {"token": None, "expires_at": 0.0}

# Rate limiting: be polite to both the API and the scrape fallback
_last_api_call = 0.0
_partner_tag_warning_emitted = False
API_RATE_LIMIT_SECONDS = 1.1
# A full-site validation can temporarily reach Amazon's per-client request quota.
# Retry only HTTP 429 responses after a conservative server cooldown; all other
# lookup failures remain blocking so unverified products cannot be published.
CREATORS_API_MAX_429_RETRIES = 3
CREATORS_API_429_BACKOFF_SECONDS = 60


# ─────────────────────────────────────────────────────────────────────────────
# Result class
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
        self.source = source   # "creators_api" or "scrape"
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
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    # Normalize common editorial shorthand to Amazon-title vocabulary.
    text = re.sub(r'\bbfg\b', 'bfgoodrich', text)
    text = re.sub(r'\b(\d+)s\b', r'\1', text)
    return re.sub(r'\s+', ' ', text).strip()


def _title_matches(expected: str, amazon_title: str,
                   threshold: float = MATCH_THRESHOLD) -> tuple[bool, float]:
    """
    Return (matches, score). Uses word overlap + SequenceMatcher.
    Lenient by design — catches completely wrong products without penalising
    minor title variations (e.g. "Warn VR EVO 10-S" vs
    "WARN 103253 VR EVO 10-S Electric 12V DC Winch 10,000 lb").
    """
    if not amazon_title:
        return False, 0.0

    exp_norm = _normalize(expected)
    amz_norm = _normalize(amazon_title)

    stop = {'a', 'an', 'the', 'for', 'and', 'or', 'in', 'on', 'of', 'to',
            'with', 'lb', 'lbs', 'by', 'at', 'from', 'shop', 'check', 'view',
            'buy', 'price', 'amazon'}
    exp_words = set(w for w in exp_norm.split() if len(w) > 1 and w not in stop)
    amz_words = set(w for w in amz_norm.split() if len(w) > 1 and w not in stop)

    if not exp_words:
        return True, 1.0

    overlap = len(exp_words & amz_words) / len(exp_words)
    seq_score = SequenceMatcher(None, exp_norm, amz_norm).ratio()
    combined = (overlap * 0.7) + (seq_score * 0.3)
    return combined >= threshold, combined


# ─────────────────────────────────────────────────────────────────────────────
# Creators API — OAuth 2.0 token management
# ─────────────────────────────────────────────────────────────────────────────
def _warn_partner_tag_mismatch() -> None:
    """Warn once without exposing any configured environment value."""
    global _partner_tag_warning_emitted
    if not _partner_tag_warning_emitted and CONFIGURED_PARTNER_TAG and CONFIGURED_PARTNER_TAG != API_PARTNER_TAG:
        print(
            "WARNING: configured Creators API partner tag differs from the app registration; "
            "using trailbuiltove-20 for API requests.",
            file=sys.stderr,
        )
        _partner_tag_warning_emitted = True


def _oauth_error_detail(error: Exception) -> str:
    """Return the exact OAuth status/body without ever including submitted credentials."""
    if isinstance(error, urllib.error.HTTPError):
        body = error.read().decode("utf-8", errors="replace").strip()
        return f"HTTP {error.code} {error.reason}: {body}"
    return f"{type(error).__name__}: {error}"


def _get_access_token() -> str:
    """Return a cached Creators API token, supporting both documented credential generations."""
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    def request_token(url: str, data: bytes, headers: dict[str, str]) -> str:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
        token = payload.get("access_token")
        if not token:
            raise RuntimeError("token response did not include access_token")
        expires_in = int(payload.get("expires_in", 3600))
        _token_cache["token"] = token
        _token_cache["expires_at"] = now + expires_in
        return token

    v3_payload = json.dumps({
        "grant_type": "client_credentials",
        "client_id": CREATORS_API_CLIENT_ID,
        "client_secret": CREATORS_API_CLIENT_SECRET,
        "scope": "creatorsapi::default",
    }).encode("utf-8")
    try:
        return request_token(
            CREATORS_API_TOKEN_URL,
            v3_payload,
            {"Content-Type": "application/json"},
        )
    except Exception as v3_error:
        basic = base64.b64encode(
            f"{CREATORS_API_CLIENT_ID}:{CREATORS_API_CLIENT_SECRET}".encode("utf-8")
        ).decode("ascii")
        v2_payload = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "scope": "creatorsapi/default",
        }).encode("utf-8")
        try:
            return request_token(
                CREATORS_API_COGNITO_TOKEN_URL,
                v2_payload,
                {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": f"Basic {basic}",
                },
            )
        except Exception as v2_error:
            raise RuntimeError(
                "Creators API authentication failed with both supported credential flows; "
                f"v3={_oauth_error_detail(v3_error)}; "
                f"v2={_oauth_error_detail(v2_error)}"
            ) from v2_error


def _creators_api_lookup(asin: str) -> dict:
    """
    Call Creators API GetItems for a single ASIN.
    Returns the parsed JSON response dict, or raises on error.

    Endpoint: POST https://creatorsapi.amazon/catalog/v1/getItems
    Auth: Bearer token (OAuth 2.0 client_credentials via LwA)
    Docs: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
    """
    global _last_api_call
    _warn_partner_tag_mismatch()

    # Rate limiting
    elapsed = time.time() - _last_api_call
    if elapsed < API_RATE_LIMIT_SECONDS:
        time.sleep(API_RATE_LIMIT_SECONDS - elapsed)

    token = _get_access_token()

    payload = json.dumps({
        "itemIds": [asin],
        "itemIdType": "ASIN",
        "marketplace": CREATORS_API_MARKETPLACE,
        "partnerTag": API_PARTNER_TAG,
        "resources": [
            "itemInfo.title",
            "images.primary.large",
            "offersV2.listings.price",
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        CREATORS_API_GETITEMS,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-marketplace": CREATORS_API_MARKETPLACE,
        },
        method="POST",
    )
    _last_api_call = time.time()

    for attempt in range(CREATORS_API_MAX_429_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt >= CREATORS_API_MAX_429_RETRIES:
                raise
            retry_after = error.headers.get("Retry-After", "").strip()
            try:
                cooldown = max(int(retry_after), CREATORS_API_429_BACKOFF_SECONDS)
            except ValueError:
                cooldown = CREATORS_API_429_BACKOFF_SECONDS * (attempt + 1)
            time.sleep(cooldown)
            _last_api_call = time.time()

    raise RuntimeError("Creators API retry loop ended without a response")


def search_catalog_items(query: str, item_count: int = 10) -> list[dict]:
    """Search the official Amazon catalog for exact-SKU remediation candidates.

    This is intentionally unavailable without Creators API credentials.  The caller
    must apply its own strict brand/line/form/size identity check before any relink.
    No scraped search result is ever used to choose a replacement ASIN.
    """
    if not (CREATORS_API_CLIENT_ID and CREATORS_API_CLIENT_SECRET) or not query.strip():
        return []
    global _last_api_call
    _warn_partner_tag_mismatch()
    elapsed = time.time() - _last_api_call
    if elapsed < API_RATE_LIMIT_SECONDS:
        time.sleep(API_RATE_LIMIT_SECONDS - elapsed)
    token = _get_access_token()
    payload = json.dumps({
        "keywords": query.strip(),
        "itemCount": max(1, min(int(item_count), 10)),
        "searchIndex": "All",
        "availability": "IncludeOutOfStock",
        "marketplace": CREATORS_API_MARKETPLACE,
        "partnerTag": API_PARTNER_TAG,
        "resources": ["itemInfo.title", "itemInfo.features", "itemInfo.productInfo"],
    }).encode("utf-8")
    req = urllib.request.Request(
        CREATORS_API_SEARCHITEMS,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-marketplace": CREATORS_API_MARKETPLACE,
        },
        method="POST",
    )
    _last_api_call = time.time()
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return []
    return list((data.get("searchResult") or {}).get("items") or [])


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
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        m = re.search(r'id="productTitle"[^>]*>\s*([^<]{5,300})', html)
        if m:
            return m.group(1).strip(), None

        m2 = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]{5,300})"', html)
        if m2:
            return m2.group(1).strip(), None

        if "robot" in html.lower() or "captcha" in html.lower():
            return None, "Amazon returned a bot-check page"
        if "Sorry, we just need to make sure you" in html:
            return None, "Amazon rate-limited the request"

        return None, "Title not found in page HTML"

    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, "ASIN not found (HTTP 404)"
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

    Uses Creators API when CREATORS_API_CLIENT_ID and CREATORS_API_CLIENT_SECRET
    are set; falls back to public page scraping otherwise.
    """
    if not asin or not re.match(r'^[A-Z0-9]{10}$', asin):
        return ASINResult(
            asin=asin, expected_name=expected_name,
            amazon_title=None, resolves=False, title_match=False,
            match_score=0.0, price=None, image_url=None,
            source="none", error=f"Invalid ASIN format: '{asin}'"
        )

    # ── Try Creators API first ────────────────────────────────────────────────
    if CREATORS_API_CLIENT_ID and CREATORS_API_CLIENT_SECRET:
        try:
            resp = _creators_api_lookup(asin)
            # Official GetItems responses use itemResults.items; retain the
            # previous spelling solely for compatibility with archived fixtures.
            items = resp.get("itemResults", {}).get("items", []) or resp.get("itemsResult", {}).get("items", [])

            if not items:
                errors = resp.get("errors", [])
                err_msg = (errors[0].get("message", "No items returned")
                           if errors else "No items returned")
                return ASINResult(
                    asin=asin, expected_name=expected_name,
                    amazon_title=None, resolves=False, title_match=False,
                    match_score=0.0, price=None, image_url=None,
                    source="creators_api", error=err_msg
                )

            item = items[0]
            title = (item.get("itemInfo", {})
                        .get("title", {})
                        .get("displayValue"))
            # offersV2 structure
            listings = (item.get("offersV2", {}) or {}).get("listings", []) or []
            price = (listings[0].get("price", {}).get("money", {}).get("displayAmount")
                     if listings else None)
            image_url = (item.get("images", {})
                            .get("primary", {})
                            .get("large", {})
                            .get("url") if item.get("images") else None)

            matches, score = _title_matches(expected_name, title or "")
            return ASINResult(
                asin=asin, expected_name=expected_name,
                amazon_title=title, resolves=True, title_match=matches,
                match_score=score, price=price, image_url=image_url,
                source="creators_api"
            )
        except Exception as e:
            # Credentials were supplied, so silently degrading to bot-prone
            # scraping would make a deployment outcome non-deterministic.
            return ASINResult(
                asin=asin, expected_name=expected_name,
                amazon_title=None, resolves=False, title_match=False,
                match_score=0.0, price=None, image_url=None,
                source="creators_api", error=f"Creators API lookup failed: {e}"
            )

    # ── Fallback: scrape public page only when no API credentials exist ──────
    time.sleep(0.5)
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
# CLI: python3 tools/asin_lookup.py B07SJHVQTJ "Warn VR EVO 10-S Winch"
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python3 tools/asin_lookup.py <ASIN> <expected_product_name>")
        print("       python3 tools/asin_lookup.py B07SJHVQTJ 'Warn VR EVO 10-S Winch'")
        sys.exit(1)

    asin_arg = sys.argv[1]
    name_arg = " ".join(sys.argv[2:])
    result = verify_asin(asin_arg, name_arg)
    print(result)
    print(json.dumps(result.to_dict(), indent=2))
    sys.exit(0 if result.ok else 1)
