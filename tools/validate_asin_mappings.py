#!/usr/bin/env python3
"""Non-blocking context-aware Amazon ASIN mapping validator for Trail Built Overland.

The validator scans every repository HTML file for amazon.com/dp/<ASIN> links and
compares each linked Amazon product title with the product context visible on the
page. It is intentionally report-only: DEAD, MISMATCH, and INCONCLUSIVE findings
are emitted to JSON and stdout, but the process exits successfully so scheduled
reporting never blocks a deployment.

When available, the script uses the same Amazon Creators API credentials as the
price-sync workflow. Public-page lookup is a conservative fallback: HTTP 403,
CAPTCHA, bot checks, rate limits, and other ambiguous responses are INCONCLUSIVE,
never a MISMATCH or DEAD finding.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REPORT = REPO_ROOT / "asin_mapping_report.json"
ASIN_LINK_RE = re.compile(
    r"https?://(?:www\.)?amazon\.com/(?:[^\"'\s>]+/)?dp/([A-Z0-9]{10})(?:[/?#&]|$)",
    re.IGNORECASE,
)
TITLE_RE = re.compile(r'id=["\']productTitle["\'][^>]*>\s*([^<]{3,500})', re.IGNORECASE)
OG_TITLE_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]+content=["\']([^"\']{3,500})',
    re.IGNORECASE,
)

MATCH_THRESHOLD = 0.48
REQUEST_DELAY_SECONDS = 1.05
STOP_WORDS = {
    "a", "an", "and", "at", "by", "for", "from", "in", "on", "of", "or", "the", "to", "with",
    "amazon", "buy", "check", "click", "deal", "details", "get", "here", "learn", "more", "now",
    "price", "shop", "view", "your", "you", "lb", "lbs", "oz", "pack", "why", "we", "like", "it",
}
GENERIC_CONTEXTS = {
    "amazon", "buy", "buy now", "buy on amazon", "check price", "check price on amazon",
    "click here", "learn more", "shop now", "view on amazon", "view price",
}

# Direct Amazon links on vehicle-specific build guides must not resolve to a
# title that expressly names a different vehicle platform. Generic accessories
# remain valid when the Amazon title names no vehicle at all.
BUILD_GUIDE_VEHICLES = {
    "articles/4runner-5th-gen-overland-build-guide.html": "4runner",
    "articles/ford-bronco-overland-build-guide.html": "bronco",
    "articles/jeep-wrangler-overland-build-guide.html": "wrangler",
    "articles/toyota-tacoma-overland-build-guide.html": "tacoma",
}
VEHICLE_TITLE_ALIASES = {
    "4runner": ("4runner", "4 runner"),
    "bronco": ("bronco",),
    "wrangler": ("wrangler", "jlu", "jl jeep", "jk jeep"),
    "tacoma": ("tacoma",),
    "tundra": ("tundra",),
    "gladiator": ("gladiator",),
    "ranger": ("ranger",),
    "f150": ("f150", "f 150"),
    "f250": ("f250", "f 250"),
    "colorado": ("colorado",),
    "canyon": ("canyon",),
    "ram": ("ram 1500", "ram 2500", "ram truck"),
}


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def normalise(value: str) -> str:
    value = unicodedata.normalize("NFKD", clean_text(value))
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", value.lower())).strip()
    # Normalize common manufacturer and model-spacing variants while retaining
    # the underlying product identity requirement for every other token.
    value = re.sub(r"\bbfg\b", "bfgoodrich", value)
    value = re.sub(r"\bbp\s+51\b", "bp51", value)
    value = re.sub(r"\bgen(\d+)\b", r"gen \1", value)
    return value


def canonical_token(token: str) -> str:
    # Singularize only simple English plurals; it prevents title variants such
    # as "Pillow" versus "Pillows" from masking a valid brand/product match.
    return token[:-1] if len(token) > 3 and token.endswith("s") and not token.endswith("ss") else token


def title_vehicle_context(title: str) -> set[str]:
    """Return explicit vehicle platforms named in an Amazon product title."""
    normalised_title = normalise(title)
    found: set[str] = set()
    for vehicle, aliases in VEHICLE_TITLE_ALIASES.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", normalised_title):
                found.add(vehicle)
                break
    return found


def vehicle_fitment_mismatch(page: str, title: str) -> tuple[str, set[str], bool]:
    """Flag only explicit cross-platform titles on a vehicle-specific build guide."""
    expected_vehicle = BUILD_GUIDE_VEHICLES.get(page, "")
    title_vehicles = title_vehicle_context(title)
    mismatch = bool(expected_vehicle and title_vehicles and expected_vehicle not in title_vehicles)
    return expected_vehicle, title_vehicles, mismatch


def meaningful_context(value: str) -> bool:
    normalised = normalise(value)
    return bool(normalised and normalised not in GENERIC_CONTEXTS and len(product_tokens(value)) >= 2)


def product_tokens(value: str) -> list[str]:
    return [
        canonical_token(token)
        for token in normalise(value).split()
        if len(token) > 1 and token not in STOP_WORDS
    ]


def score_title_match(context_name: str, amazon_title: str) -> tuple[float, list[str], bool]:
    """Return score, matched tokens, and threshold verdict using brand and product tokens."""
    context_tokens = product_tokens(context_name)
    title_tokens = set(product_tokens(amazon_title))
    if not context_tokens or not title_tokens:
        return 0.0, [], False

    context_set = set(context_tokens)
    matched = sorted(context_set & title_tokens)
    full_overlap = len(matched) / len(context_set)

    # The first meaningful token is normally the brand. Treat it as a separate
    # signal so a completely cross-wired brand cannot pass on a generic noun.
    brand_token = context_tokens[0]
    brand_match = 1.0 if brand_token in title_tokens else 0.0
    product_set = set(context_tokens[1:])
    product_overlap = (len(product_set & title_tokens) / len(product_set)) if product_set else full_overlap
    sequence_score = SequenceMatcher(None, normalise(context_name), normalise(amazon_title)).ratio()

    score = (0.40 * full_overlap) + (0.30 * product_overlap) + (0.20 * brand_match) + (0.10 * sequence_score)
    return round(score, 3), matched, score >= MATCH_THRESHOLD


class LinkContextParser(HTMLParser):
    """Extract Amazon links with anchor, heading, and product-card context."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[dict[str, Any]] = []
        self.links: list[dict[str, str]] = []
        self.last_heading = ""
        self.heading_capture: Optional[dict[str, Any]] = None
        self.active_anchor: Optional[dict[str, Any]] = None

    @staticmethod
    def _is_product_card(attrs: dict[str, str]) -> bool:
        classes = attrs.get("class", "").lower()
        return any(term in classes for term in ("product-card", "product-box", "product-item", "product-tile", "product-row"))

    @staticmethod
    def _attr_context(attrs: dict[str, str]) -> str:
        for key in ("data-product", "data-product-name", "data-name", "data-title"):
            value = clean_text(attrs.get(key, ""))
            if meaningful_context(value):
                return value
        return ""

    def _nearest_card(self) -> Optional[dict[str, Any]]:
        for entry in reversed(self.stack):
            if entry.get("is_product_card"):
                return entry
        return None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, Optional[str]]]) -> None:
        attrs = {key.lower(): (value or "") for key, value in attrs_list}
        entry = {
            "tag": tag.lower(),
            "attrs": attrs,
            "is_product_card": self._is_product_card(attrs),
            "title": self._attr_context(attrs),
        }
        self.stack.append(entry)

        if tag.lower() in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.heading_capture = {"tag": tag.lower(), "parts": []}

        if tag.lower() == "a":
            href = html.unescape(attrs.get("href", ""))
            match = ASIN_LINK_RE.search(href)
            if match:
                card = self._nearest_card()
                self.active_anchor = {
                    "asin": match.group(1).upper(),
                    "anchor_parts": [],
                    "nearest_heading": self.last_heading,
                    "card": card,
                }

    def handle_data(self, data: str) -> None:
        if self.heading_capture is not None:
            self.heading_capture["parts"].append(data)
        if self.active_anchor is not None:
            self.active_anchor["anchor_parts"].append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.heading_capture is not None and self.heading_capture["tag"] == tag:
            heading = clean_text(" ".join(self.heading_capture["parts"]))
            if heading:
                self.last_heading = heading
                for entry in reversed(self.stack):
                    if entry.get("is_product_card") and not entry.get("title"):
                        entry["title"] = heading
                        break
            self.heading_capture = None

        if tag == "a" and self.active_anchor is not None:
            anchor_text = clean_text(" ".join(self.active_anchor["anchor_parts"]))
            card = self.active_anchor.get("card")
            card_title = clean_text(card.get("title", "")) if card else ""
            heading = clean_text(self.active_anchor.get("nearest_heading", ""))
            context_name = next(
                (candidate for candidate in (card_title, anchor_text, heading) if meaningful_context(candidate)),
                "",
            )
            self.links.append(
                {
                    "asin": self.active_anchor["asin"],
                    "context_name": context_name,
                    "anchor_text": anchor_text,
                    "nearest_heading": heading,
                    "product_card_title": card_title,
                }
            )
            self.active_anchor = None

        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break


@dataclass
class LookupResult:
    verdict: str
    title: Optional[str]
    source: str
    detail: str


class CreatorsClient:
    """Minimal Creators API client aligned to the existing price-sync secret names."""

    LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
    COGNITO_TOKEN_URL = "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token"
    GETITEMS_URL = "https://creatorsapi.amazon/catalog/v1/getItems"

    def __init__(self, credential_id: str, credential_secret: str, partner_tag: str) -> None:
        self.credential_id = credential_id
        self.credential_secret = credential_secret
        self.partner_tag = partner_tag
        self.token: Optional[str] = None
        self.token_expiry = 0.0

    @staticmethod
    def _request(url: str, data: bytes, headers: dict[str, str]) -> tuple[int, str]:
        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", errors="replace")
        except Exception as error:  # Network failures are reported as inconclusive upstream.
            return 0, json.dumps({"error": str(error)})

    @staticmethod
    def _safe_json(body: str) -> dict[str, Any]:
        try:
            parsed = json.loads(body)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _token_v3(self) -> tuple[Optional[str], str]:
        payload = json.dumps(
            {
                "grant_type": "client_credentials",
                "client_id": self.credential_id,
                "client_secret": self.credential_secret,
                "scope": "creatorsapi::default",
            }
        ).encode("utf-8")
        status, body = self._request(self.LWA_TOKEN_URL, payload, {"Content-Type": "application/json"})
        data = self._safe_json(body)
        token = data.get("access_token") if status == 200 else None
        if token:
            self.token_expiry = time.time() + int(data.get("expires_in", 3600)) - 60
            return str(token), ""
        return None, f"LwA token response HTTP {status or 'network'}: {data.get('error', 'unavailable')}"

    def _token_v2(self) -> tuple[Optional[str], str]:
        payload = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "creatorsapi/default"}).encode("utf-8")
        basic = base64.b64encode(f"{self.credential_id}:{self.credential_secret}".encode("utf-8")).decode("ascii")
        status, body = self._request(
            self.COGNITO_TOKEN_URL,
            payload,
            {"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
        )
        data = self._safe_json(body)
        token = data.get("access_token") if status == 200 else None
        if token:
            self.token_expiry = time.time() + int(data.get("expires_in", 3600)) - 60
            return str(token), ""
        return None, f"Cognito token response HTTP {status or 'network'}: {data.get('error', 'unavailable')}"

    def _access_token(self) -> tuple[Optional[str], str]:
        if self.token and time.time() < self.token_expiry:
            return self.token, ""
        token, detail = self._token_v3()
        if token:
            self.token = token
            return token, ""
        token, fallback_detail = self._token_v2()
        if token:
            self.token = token
            return token, ""
        return None, f"{detail}; {fallback_detail}"

    def lookup(self, asin: str) -> LookupResult:
        token, token_detail = self._access_token()
        if not token:
            return LookupResult("INCONCLUSIVE", None, "creators_api", token_detail)
        payload = json.dumps(
            {
                "itemIds": [asin],
                "itemIdType": "ASIN",
                "marketplace": "www.amazon.com",
                "partnerTag": self.partner_tag,
                "resources": ["itemInfo.title"],
            }
        ).encode("utf-8")
        status, body = self._request(
            self.GETITEMS_URL,
            payload,
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "x-marketplace": "www.amazon.com"},
        )
        data = self._safe_json(body)
        if status != 200:
            return LookupResult("INCONCLUSIVE", None, "creators_api", f"GetItems HTTP {status or 'network'}")
        items = data.get("itemsResult", {}).get("items", [])
        if items:
            title = items[0].get("itemInfo", {}).get("title", {}).get("displayValue")
            if title:
                return LookupResult("LIVE", clean_text(str(title)), "creators_api", "")
        error = (data.get("errors") or [{}])[0]
        code = str(error.get("code", ""))
        message = str(error.get("message", "No item title returned"))
        combined = f"{code} {message}".lower()
        if "notfound" in combined or "not found" in combined or "itemnotaccessible" in combined or "item not accessible" in combined:
            return LookupResult("DEAD", None, "creators_api", message)
        return LookupResult("INCONCLUSIVE", None, "creators_api", message)


def scrape_lookup(asin: str) -> LookupResult:
    url = f"https://www.amazon.com/dp/{asin}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = response.status
            page = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return LookupResult("DEAD", None, "scrape", "Amazon product page returned HTTP 404")
        if error.code in {403, 429}:
            return LookupResult("INCONCLUSIVE", None, "scrape", f"Amazon returned HTTP {error.code} (bot/rate block)")
        return LookupResult("INCONCLUSIVE", None, "scrape", f"Amazon returned HTTP {error.code}")
    except Exception as error:
        return LookupResult("INCONCLUSIVE", None, "scrape", f"Amazon request failed: {error}")

    page_lower = page.lower()
    if status in {403, 429} or "captcha" in page_lower or "robot check" in page_lower or "sorry, we just need to make sure" in page_lower:
        return LookupResult("INCONCLUSIVE", None, "scrape", "Amazon returned a bot-check or rate-limit page")
    title_match = TITLE_RE.search(page) or OG_TITLE_RE.search(page)
    if title_match:
        return LookupResult("LIVE", clean_text(title_match.group(1)), "scrape", "")
    return LookupResult("INCONCLUSIVE", None, "scrape", "Amazon page did not expose a product title")


def extract_links(html_file: Path) -> list[dict[str, str]]:
    parser = LinkContextParser()
    try:
        parser.feed(html_file.read_text(encoding="utf-8", errors="replace"))
        parser.close()
    except Exception as error:
        return [
            {
                "asin": "",
                "context_name": "",
                "anchor_text": "",
                "nearest_heading": "",
                "product_card_title": "",
                "parse_error": str(error),
            }
        ]
    return parser.links


def lookup_title(asin: str, client: Optional[CreatorsClient], offline: bool) -> LookupResult:
    if offline:
        return LookupResult("INCONCLUSIVE", None, "offline", "Offline mode requested")
    if client is not None:
        api_result = client.lookup(asin)
        if api_result.verdict in {"LIVE", "DEAD"}:
            return api_result
        # API auth/service failures fall back to the public page. The eventual
        # scraper result remains conservative for bot blocks and throttling.
    return scrape_lookup(asin)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Amazon ASIN mappings against visible HTML product context")
    parser.add_argument("--output", default=str(DEFAULT_REPORT), help="JSON report path")
    parser.add_argument("--offline", action="store_true", help="Parse links without calling Amazon; all lookups are inconclusive")
    parser.add_argument("--max-links", type=int, default=0, help="Optional cap for controlled local smoke tests")
    args = parser.parse_args()

    html_files = sorted(
        path for path in REPO_ROOT.rglob("*.html") if ".git" not in path.parts and "node_modules" not in path.parts
    )
    extracted: list[dict[str, Any]] = []
    parse_errors: list[dict[str, str]] = []
    for html_file in html_files:
        relative = html_file.relative_to(REPO_ROOT).as_posix()
        for link in extract_links(html_file):
            if link.get("parse_error"):
                parse_errors.append({"page": relative, "detail": link["parse_error"]})
                continue
            link["page"] = relative
            extracted.append(link)

    if args.max_links > 0:
        extracted = extracted[: args.max_links]

    credential_id = os.environ.get("CREATORS_CREDENTIAL_ID", "") or os.environ.get("CREATORS_API_CLIENT_ID", "")
    credential_secret = os.environ.get("CREATORS_CREDENTIAL_SECRET", "") or os.environ.get("CREATORS_API_CLIENT_SECRET", "")
    partner_tag = os.environ.get("PAAPI_PARTNER_TAG", "") or os.environ.get("CREATORS_API_PARTNER_TAG", "")
    client = CreatorsClient(credential_id, credential_secret, partner_tag) if all((credential_id, credential_secret, partner_tag)) else None

    print("=" * 72)
    print("ASIN Mapping Validation — Trail Built Overland (blocking gate)")
    print("=" * 72)
    print(f"HTML files scanned: {len(html_files)} | Amazon links found: {len(extracted)}")
    print(f"Lookup source: {'Amazon Creators API with scrape fallback' if client else 'public Amazon scrape fallback'}")

    cache: dict[str, LookupResult] = {}
    findings: list[dict[str, Any]] = []
    for index, link in enumerate(extracted):
        asin = link["asin"]
        context_name = link["context_name"]
        if asin not in cache:
            cache[asin] = lookup_title(asin, client, args.offline)
            if index < len(extracted) - 1 and not args.offline:
                time.sleep(REQUEST_DELAY_SECONDS)
        lookup = cache[asin]
        finding: dict[str, Any] = {
            "page": link["page"],
            "asin": asin,
            "context_name": context_name,
            "anchor_text": link["anchor_text"],
            "nearest_heading": link["nearest_heading"],
            "product_card_title": link["product_card_title"],
            "expected_vehicle": "",
            "amazon_title_vehicles": [],
            "amazon_title": lookup.title,
            "score": None,
            "matched_tokens": [],
            "source": lookup.source,
            "verdict": lookup.verdict,
            "detail": lookup.detail,
        }
        if lookup.verdict == "LIVE":
            expected_vehicle, title_vehicles, cross_platform = vehicle_fitment_mismatch(
                link["page"], lookup.title or ""
            )
            finding["expected_vehicle"] = expected_vehicle
            finding["amazon_title_vehicles"] = sorted(title_vehicles)
            if cross_platform:
                finding["verdict"] = "MISMATCH"
                finding["detail"] = (
                    f"Vehicle-fitment mismatch: the {expected_vehicle} build guide links to an Amazon title "
                    f"explicitly naming {', '.join(sorted(title_vehicles))}"
                )
            elif not meaningful_context(context_name):
                finding["verdict"] = "INCONCLUSIVE"
                finding["detail"] = "No sufficiently specific product context was available near the link"
            else:
                score, matched_tokens, matches = score_title_match(context_name, lookup.title or "")
                finding["score"] = score
                finding["matched_tokens"] = matched_tokens
                finding["verdict"] = "MATCH" if matches else "MISMATCH"
                if not matches:
                    finding["detail"] = f"Context/title score {score:.0%} is below the {MATCH_THRESHOLD:.0%} threshold"
        findings.append(finding)
        title_preview = (finding["amazon_title"] or finding["detail"] or "").replace("\n", " ")[:72]
        score_text = "—" if finding["score"] is None else f"{finding['score']:.0%}"
        print(f"{finding['verdict']:<12} | {finding['page']} | {asin} | {score_text:>4} | {context_name[:42]} | {title_preview}")

    counts = {verdict: sum(1 for item in findings if item["verdict"] == verdict) for verdict in ("MATCH", "MISMATCH", "DEAD", "INCONCLUSIVE")}
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "validator": "tools/validate_asin_mappings.py",
        "non_blocking": False,
        "threshold": MATCH_THRESHOLD,
        "html_files_scanned": len(html_files),
        "links_found": len(extracted),
        "unique_asins": len(cache),
        "lookup_mode": "creators_api_with_scrape_fallback" if client else "scrape_fallback_only",
        "summary": {
            **counts,
            "parse_errors": len(parse_errors),
            "vehicle_fitment_mismatches": sum(
                "Vehicle-fitment mismatch:" in item.get("detail", "") for item in findings
            ),
        },
        "parse_errors": parse_errors,
        "findings": findings,
    }
    report_path = Path(args.output)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("-" * 72)
    print(
        f"SUMMARY | match={counts['MATCH']} mismatch={counts['MISMATCH']} "
        f"dead={counts['DEAD']} inconclusive={counts['INCONCLUSIVE']} | report={report_path}"
    )
    blocking_findings = counts["MISMATCH"] + counts["DEAD"] + counts["INCONCLUSIVE"] + len(parse_errors)
    if blocking_findings:
        print(f"BLOCKED | {blocking_findings} unresolved, dead, mismatched, or unparsable direct product destination(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as unexpected_error:
        print(f"BLOCKED | validator internal error: {unexpected_error}", file=sys.stderr)
        raise SystemExit(1)
