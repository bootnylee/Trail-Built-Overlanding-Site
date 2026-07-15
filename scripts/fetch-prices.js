#!/usr/bin/env node
/**
 * scripts/fetch-prices.js — Amazon Creators API price sync
 *
 * Reads every ASIN key from js/products-data.js, calls the Amazon
 * Creators API GetItems in batches of 10 ASINs (resources: offersV2.listings.price,
 * images.primary.large), throttled to 1 request/second with exponential backoff
 * on HTTP 429, then rewrites products-data.js in place, updating ONLY:
 *   - price:        <number>            (from offersV2.listings[0].price.money.amount)
 *   - priceDisplay: "<displayAmount>"   (from offersV2.listings[0].price.money.displayAmount)
 * Note: Trail-Built image management is handled separately via data-amazon-img attributes
 * and image-code URLs; image fields are not present in products-data.js and are not
 * written by this script.
 * All other fields and file formatting are preserved exactly.
 *
 * ASINs that return errors or have no offer are flagged in price-sync-report.json
 * and left unchanged — never deleted.
 *
 * Credentials are read STRICTLY from environment variables:
 *   CREATORS_CREDENTIAL_ID, CREATORS_CREDENTIAL_SECRET, PAAPI_PARTNER_TAG
 * They are never logged, printed, or written to disk.
 *
 * Auth auto-detects credential version:
 *   v3.x (LwA):    POST https://api.amazon.com/auth/o2/token
 *                  JSON body, scope "creatorsapi::default"
 *   v2.x (Cognito) fallback: POST https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token
 *                  form-encoded with Basic auth, scope "creatorsapi/default"
 * Token is cached in-process with a 60s expiry buffer.
 *
 * Usage:
 *   node scripts/fetch-prices.js             # live sync (requires env vars)
 *   node scripts/fetch-prices.js --dry-run   # uses local mock fixture, no network;
 *                                             # STRICTLY READ-ONLY: products-data.js is never
 *                                             # modified, proposed changes go only into
 *                                             # price-sync-report.json
 *
 * Systemic-failure guard: if mode is live and updatedCount is 0 and every ASIN
 * is flagged, the script exits non-zero so the workflow fails loudly.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Configuration ───────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PRODUCTS_FILE = path.join(REPO_ROOT, "js", "products-data.js");
const REPORT_FILE = path.join(REPO_ROOT, "price-sync-report.json");
const FIXTURE_FILE = path.join(__dirname, "fixtures", "paapi-getitems-mock.json");

const CREATORS_API_BASE = "https://creatorsapi.amazon";
const GETITEMS_PATH = "/catalog/v1/getItems";
const MARKETPLACE = "www.amazon.com";

// v3.x LwA token endpoint (try first — new credentials issued as v3.x)
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const LWA_SCOPE = "creatorsapi::default";

// v2.x Cognito token endpoint (fallback for older credentials)
const COGNITO_TOKEN_URL = "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token";
const COGNITO_SCOPE = "creatorsapi/default";

const BATCH_SIZE = 10;
const REQUEST_INTERVAL_MS = 1000; // 1 request per second
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000; // 2s, 4s, 8s, 16s, 32s
const TOKEN_EXPIRY_BUFFER_MS = 60_000; // 60s buffer before expiry

// Request images.primary.large for completeness even though Trail-Built
// doesn't store image URLs in products-data.js (images are managed via
// data-amazon-img attributes and image-code URLs in the frontend).
const RESOURCES = ["offersV2.listings.price", "images.primary.large"];

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Credentials (env only — never logged, never hardcoded) ─────────────────

function getCredentials() {
  const credentialId = process.env.CREATORS_CREDENTIAL_ID;
  const credentialSecret = process.env.CREATORS_CREDENTIAL_SECRET;
  const partnerTag = process.env.PAAPI_PARTNER_TAG;
  if (!credentialId || !credentialSecret || !partnerTag) {
    console.error(
      "ERROR: Missing required environment variables. " +
        "CREATORS_CREDENTIAL_ID, CREATORS_CREDENTIAL_SECRET, and PAAPI_PARTNER_TAG must all be set."
    );
    process.exit(1);
  }
  return { credentialId, credentialSecret, partnerTag };
}

// ─── OAuth2 token cache ───────────────────────────────────────────────────────

let _tokenCache = null; // { accessToken, expiresAt }

async function getAccessToken(credentials) {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.accessToken;
  }

  // Try v3.x (LwA) first — new credentials are issued as v3.x
  try {
    return await fetchToken_v3(credentials);
  } catch (err) {
    const code = err.errorCode ?? "";
    if (code === "invalid_client" || code === "unauthorized_client") {
      console.log(`  v3.x LwA token failed (${code}) — falling back to v2.x Cognito`);
    } else {
      console.log(`  v3.x LwA token error: ${code || err.message} — trying v2.x Cognito`);
    }
  }

  // Fallback: v2.x (Cognito)
  return await fetchToken_v2(credentials);
}

async function fetchToken_v3(credentials) {
  const body = JSON.stringify({
    grant_type: "client_credentials",
    client_id: credentials.credentialId,
    client_secret: credentials.credentialSecret,
    scope: LWA_SCOPE,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `v3.x token HTTP ${res.status}: ${data.error_description ?? data.error ?? "unknown"}`
    );
    err.errorCode = data.error ?? "";
    throw err;
  }
  if (!data.access_token) {
    throw new Error("v3.x token response missing access_token");
  }

  const expiresIn = (data.expires_in ?? 3600) - TOKEN_EXPIRY_BUFFER_MS / 1000;
  _tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  console.log("  OAuth2 token acquired (v3.x LwA)");
  return data.access_token;
}

async function fetchToken_v2(credentials) {
  const basicAuth = Buffer.from(
    `${credentials.credentialId}:${credentials.credentialSecret}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: COGNITO_SCOPE,
  }).toString();

  const res = await fetch(COGNITO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `v2.x token HTTP ${res.status}: ${data.error_description ?? data.error ?? "unknown"}`
    );
    err.errorCode = data.error ?? "";
    throw err;
  }
  if (!data.access_token) {
    throw new Error("v2.x token response missing access_token");
  }

  const expiresIn = (data.expires_in ?? 3600) - TOKEN_EXPIRY_BUFFER_MS / 1000;
  _tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  console.log("  OAuth2 token acquired (v2.x Cognito)");
  return data.access_token;
}

// ─── Creators API GetItems call with throttle + exponential backoff ──────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns { body, httpStatus, errorCodes } where:
 *   body        — parsed JSON response (may contain itemsResult and/or errors)
 *   httpStatus  — numeric HTTP status code (always captured)
 *   errorCodes  — array of error code strings from the response (never credential material)
 */
async function getItems(credentials, asins) {
  const accessToken = await getAccessToken(credentials);

  const payload = JSON.stringify({
    itemIds: asins,
    partnerTag: credentials.partnerTag,
    partnerType: "Associates",
    resources: RESOURCES,
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${CREATORS_API_BASE}${GETITEMS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-marketplace": MARKETPLACE,
      },
      body: payload,
    });

    const httpStatus = res.status;

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        return { body: {}, httpStatus, errorCodes: ["TooManyRequests"] };
      }
      const backoff = BACKOFF_BASE_MS * 2 ** attempt;
      console.log(
        `  429 TooManyRequests — backing off ${backoff / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(backoff);
      continue;
    }

    const body = await res.json().catch(() => ({}));

    // Extract error codes ONLY — never log messages (may contain request details).
    const errorCodes = [];
    if (!res.ok) {
      // Top-level 4xx/5xx error body
      if (body.code) errorCodes.push(body.code);
      if (body.error) errorCodes.push(body.error);
      if (body.__type) errorCodes.push(body.__type.split("#").pop());
      if (Array.isArray(body.errors)) {
        for (const e of body.errors) {
          if (e.code) errorCodes.push(e.code);
        }
      }
      if (errorCodes.length === 0) errorCodes.push(`HTTP_${httpStatus}`);
      console.error(
        `  Creators API HTTP ${httpStatus} — error codes: ${errorCodes.join(", ")}`
      );
    } else if (Array.isArray(body.errors) && body.errors.length > 0) {
      // Partial per-item errors within a 200 response
      for (const e of body.errors) {
        if (e.code) errorCodes.push(e.code);
      }
    }

    return { body, httpStatus, errorCodes };
  }
}

// ─── Fixture loading for --dry-run ───────────────────────────────────────────

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE_FILE, "utf8");
  return JSON.parse(raw);
}

// ─── Extract ASINs from products-data.js ─────────────────────────────────────
// products-data.js uses the pattern: "ASIN0123456": { ... }

function extractAsins(source) {
  const asins = new Set();
  const regex = /"([A-Z0-9]{10})":\s*\{/g;
  let m;
  while ((m = regex.exec(source)) !== null) {
    asins.add(m[1]);
  }
  return [...asins];
}

// ─── Parse Creators API GetItems responses into { asin: { price, display, image } }

function indexResponse(response, priceMap, errorMap) {
  // Partial per-item errors (Creators API uses lowercase: errors[].code, errors[].message)
  for (const err of response?.errors ?? []) {
    const asinMatch = /([A-Z0-9]{10})/i.exec(err.message ?? "");
    if (asinMatch) {
      errorMap.set(asinMatch[1], err.code ?? "Unknown");
    }
  }
  // Items (Creators API camelCase: itemsResult.items[])
  for (const item of response?.itemsResult?.items ?? []) {
    const asin = item.asin;
    if (!asin) continue;
    const listing = item.offersV2?.listings?.[0];
    const money = listing?.price?.money;
    const image = item.images?.primary?.large?.url ?? null;
    if (money?.amount != null && money?.displayAmount) {
      priceMap.set(asin, {
        amount: money.amount,
        display: money.displayAmount,
        image, // captured but not written to products-data.js for Trail-Built
      });
    } else {
      errorMap.set(asin, "NoOffer");
    }
  }
}

// ─── Rewrite products-data.js in place (only price values change) ────────────
// Trail-Built products-data.js uses "ASIN": { ... } object key pattern.
// Image fields are not present in products-data.js and are not written.

function updateProductBlocks(source, priceMap) {
  const updated = new Set();
  const asinRe = /"([A-Z0-9]{10})":\s*\{/g;

  let result = "";
  let cursor = 0;
  let m;
  while ((m = asinRe.exec(source)) !== null) {
    const asin = m[1];
    const data = priceMap.get(asin);
    if (!data) continue;
    if (data.amount == null || !data.display) continue;

    // Find the enclosing object block
    const asinPos = m.index;
    let open = source.indexOf("{", asinPos);
    let depth = 1;
    let close = -1;
    for (let i = open + 1; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (open === -1 || close === -1) continue;

    let block = source.slice(open, close + 1);
    const numStr = data.amount.toFixed(2);
    const nb = block
      .replace(/(\bprice:\s*)[0-9]+(?:\.[0-9]+)?(,)/, (_, p1, p2) => `${p1}${numStr}${p2}`)
      .replace(/(\bpriceDisplay:\s*")[^"]*(")/, (_, p1, p2) => `${p1}${data.display}${p2}`);

    if (nb !== block) {
      result += source.slice(cursor, open) + nb;
      cursor = close + 1;
      updated.add(asin);
    }
  }
  result += source.slice(cursor);
  return { source: result, updated };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const source = fs.readFileSync(PRODUCTS_FILE, "utf8");
  const asins = extractAsins(source);
  console.log(`Found ${asins.length} unique ASINs in products-data.js`);

  const priceMap = new Map();
  const errorMap = new Map();
  // batchErrors captures per-batch HTTP status and error codes for the report.
  // Never contains credential material or full request headers.
  const batchErrors = [];

  if (DRY_RUN) {
    console.log("DRY RUN: using mock GetItems fixture — no network calls, no credentials required.");
    const fixtures = loadFixture();
    for (const response of fixtures.responses) {
      indexResponse(response, priceMap, errorMap);
    }
  } else {
    const credentials = getCredentials();
    const totalBatches = Math.ceil(asins.length / BATCH_SIZE);
    for (let i = 0; i < asins.length; i += BATCH_SIZE) {
      const batch = asins.slice(i, i + BATCH_SIZE);
      const batchNum = i / BATCH_SIZE + 1;
      console.log(`Fetching batch ${batchNum}/${totalBatches} (${batch.length} ASINs)`);
      try {
        const { body, httpStatus, errorCodes } = await getItems(credentials, batch);

        if (httpStatus !== 200 && errorCodes.length > 0) {
          batchErrors.push({ batchNum, httpStatus, errorCodes });
          for (const asin of batch) {
            if (!priceMap.has(asin) && !errorMap.has(asin)) {
              errorMap.set(asin, errorCodes[0]);
            }
          }
        }

        // Always run indexResponse — it handles partial 200 errors too
        indexResponse(body, priceMap, errorMap);
      } catch (err) {
        console.error(`  Batch ${batchNum} failed: ${err.message}`);
        batchErrors.push({ batchNum, httpStatus: null, errorCodes: ["BatchRequestFailed"] });
        for (const asin of batch) {
          if (!priceMap.has(asin) && !errorMap.has(asin)) {
            errorMap.set(asin, "BatchRequestFailed");
          }
        }
      }
      if (i + BATCH_SIZE < asins.length) await sleep(REQUEST_INTERVAL_MS);
    }
  }

  // Any ASIN with no data and no explicit error is unreturned → flag it.
  for (const asin of asins) {
    if (!priceMap.has(asin) && !errorMap.has(asin)) {
      errorMap.set(asin, "NotReturned");
    }
  }

  const { source: newSource, updated } = updateProductBlocks(source, priceMap);
  if (DRY_RUN) {
    // DRY RUN is strictly read-only: products-data.js is NEVER rewritten. All
    // proposed changes are recorded in price-sync-report.json only.
    console.log(
      "DRY RUN: products-data.js left untouched; proposed changes written to price-sync-report.json only."
    );
  } else if (newSource !== source) {
    fs.writeFileSync(PRODUCTS_FILE, newSource, "utf8");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: DRY_RUN ? "dry-run" : "live",
    totalAsins: asins.length,
    updatedCount: updated.size,
    updated: [...updated].sort(),
    proposedChanges: DRY_RUN
      ? [...updated].sort().map((asin) => {
          const data = priceMap.get(asin);
          return {
            asin,
            newPrice: data?.amount ?? null,
            newPriceDisplay: data?.display ?? null,
          };
        })
      : undefined,
    flagged: [...errorMap.entries()]
      .map(([asin, reason]) => ({ asin, reason, action: "left unchanged" }))
      .sort((a, b) => a.asin.localeCompare(b.asin)),
    batchErrors: batchErrors.length > 0 ? batchErrors : undefined,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    `Updated ${updated.size} product(s); flagged ${errorMap.size} ASIN(s) — see price-sync-report.json`
  );

  // ── Systemic-failure guard ────────────────────────────────────────────────
  // If live mode returned 0 updates and every ASIN is flagged, the API is
  // returning errors for all items — fail loudly instead of committing a
  // useless report.
  if (!DRY_RUN && updated.size === 0 && errorMap.size === asins.length && asins.length > 0) {
    const uniqueCodes = [...new Set(batchErrors.flatMap((b) => b.errorCodes))];
    console.error(
      `SYSTEMIC FAILURE: live sync updated 0/${asins.length} ASINs. ` +
        `All ASINs flagged. Error codes: ${uniqueCodes.join(", ") || "none captured"}. ` +
        `Check Creators API credentials and Associates account eligibility.`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
