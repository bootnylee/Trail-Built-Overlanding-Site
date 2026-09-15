#!/usr/bin/env node
/**
 * Verify that a single account-level AssociateNotEligible response stops the
 * price sync immediately, emits one actionable line, and leaves catalog data
 * unchanged. The test uses only mocked HTTP responses.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, "price-sync-report.json");
const productsPath = path.join(root, "js", "products-data.js");
const originalReport = fs.readFileSync(reportPath, "utf8");
const originalProducts = fs.readFileSync(productsPath, "utf8");
const originalFetch = global.fetch;
const originalError = console.error;
const originalEnv = {
  clientId: process.env.CREATORS_API_CLIENT_ID,
  clientSecret: process.env.CREATORS_API_CLIENT_SECRET,
  partnerTag: process.env.CREATORS_API_PARTNER_TAG,
  asinValidate: process.env.ASIN_VALIDATE,
};

const calls = [];
const errors = [];

try {
  process.env.CREATORS_API_CLIENT_ID = "test-client-id";
  process.env.CREATORS_API_CLIENT_SECRET = "test-client-secret";
  process.env.CREATORS_API_PARTNER_TAG = "trailbuiltove-20";
  process.env.ASIN_VALIDATE = "warn";

  const { ASSOCIATE_NOT_ELIGIBLE_LOG_LINE, main } = await import("./fetch-prices.js");

  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://api.amazon.com/auth/o2/token") {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200 });
    }
    if (String(url) === "https://creatorsapi.amazon/catalog/v1/getItems") {
      return new Response(
        JSON.stringify({
          type: "AccessDeniedException",
          reason: "AssociateNotEligible",
          message: "Your account does not currently meet the eligibility requirements.",
        }),
        { status: 403 }
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  console.error = (message) => errors.push(String(message));

  await main();

  assert.equal(calls.filter((url) => url === "https://api.amazon.com/auth/o2/token").length, 1);
  assert.equal(calls.filter((url) => url === "https://creatorsapi.amazon/catalog/v1/getItems").length, 1);
  assert.deepEqual(errors, [ASSOCIATE_NOT_ELIGIBLE_LOG_LINE]);
  assert.equal(fs.readFileSync(productsPath, "utf8"), originalProducts);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.mode, "account-ineligible");
  assert.equal(report.accountEligibility.reason, "AssociateNotEligible");
  assert.equal(report.accountEligibility.skipDownstreamAsinLookups, true);
  assert.equal(report.batchErrors.length, 1);

  console.log("Price-sync eligibility short-circuit test passed.");
} finally {
  fs.writeFileSync(reportPath, originalReport, "utf8");
  fs.writeFileSync(productsPath, originalProducts, "utf8");
  global.fetch = originalFetch;
  console.error = originalError;
  if (originalEnv.clientId === undefined) delete process.env.CREATORS_API_CLIENT_ID;
  else process.env.CREATORS_API_CLIENT_ID = originalEnv.clientId;
  if (originalEnv.clientSecret === undefined) delete process.env.CREATORS_API_CLIENT_SECRET;
  else process.env.CREATORS_API_CLIENT_SECRET = originalEnv.clientSecret;
  if (originalEnv.partnerTag === undefined) delete process.env.CREATORS_API_PARTNER_TAG;
  else process.env.CREATORS_API_PARTNER_TAG = originalEnv.partnerTag;
  if (originalEnv.asinValidate === undefined) delete process.env.ASIN_VALIDATE;
  else process.env.ASIN_VALIDATE = originalEnv.asinValidate;
}
