/**
 * Netlify Function: subscribe
 *
 * Adds a subscriber to the Trail Built Klaviyo list.
 * Credentials are read exclusively from Netlify environment variables —
 * they are never committed, logged, or returned in any response.
 *
 * Required env vars (set in Netlify dashboard → Site configuration → Env vars):
 *   KLAVIYO_API_KEY — a private Klaviyo API key with profile, list, and subscription write scopes
 *
 * EmailOctopus configuration remains available for rollback and is deliberately
 * not used by this live handler.
 *
 * Request:  POST /.netlify/functions/subscribe
 *           Content-Type: application/json
 *           Body: { "email": "subscriber@example.com" }
 *
 * Response 200: { "ok": true }
 * Response 400: { "ok": false, "error": "<friendly message or service error code>" }
 * Response 500: { "ok": false, "error": "configuration-missing" }
 */

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2026-07-15";
const KLAVIYO_LIST_ID = "RG559L";

// Retained for the documented EmailOctopus rollback path. Do not remove these
// environment-variable reads without an approved rollback-plan change.
const EMAILOCTOPUS_API_KEY = process.env.EMAILOCTOPUS_API_KEY;
const EMAILOCTOPUS_LIST_ID = process.env.EMAILOCTOPUS_LIST_ID;
const EMAILOCTOPUS_API_BASE = "https://api.emailoctopus.com";

function klaviyoHeaders(apiKey) {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
  };
}

async function responseData(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function errorCode(response, data) {
  return (
    (typeof data?.errors?.[0]?.code === "string" && data.errors[0].code) ||
    (typeof data?.errors?.[0]?.title === "string" && data.errors[0].title) ||
    String(response.status)
  );
}

exports.handler = async function (event) {
  // Only accept POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  // Parse and validate request body
  let email;
  try {
    const body = JSON.parse(event.body || "{}");
    email = (body.email || "").trim().toLowerCase();
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Invalid request body" }),
    };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Please enter a valid email address." }),
    };
  }

  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) {
    console.error("[subscribe] KLAVIYO_API_KEY is not configured");
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "configuration-missing" }),
    };
  }

  let klaviyoResponse;
  try {
    klaviyoResponse = await fetch(`${KLAVIYO_API_BASE}/profile-subscription-bulk-create-jobs/`, {
      method: "POST",
      headers: klaviyoHeaders(apiKey),
      body: JSON.stringify({
        data: {
          type: "profile-subscription-bulk-create-job",
          attributes: {
            profiles: {
              data: [
                {
                  type: "profile",
                  attributes: {
                    email,
                    subscriptions: {
                      email: {
                        marketing: { consent: "SUBSCRIBED" },
                      },
                    },
                  },
                },
              ],
            },
          },
          relationships: {
            list: {
              data: { type: "list", id: KLAVIYO_LIST_ID },
            },
          },
        },
      }),
    });
  } catch (err) {
    console.error("[subscribe] Klaviyo network error:", err.message);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Could not reach email service. Please try again." }),
    };
  }

  if (klaviyoResponse.ok) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }

  const klaviyoData = await responseData(klaviyoResponse);
  const serviceErrorCode = errorCode(klaviyoResponse, klaviyoData);
  console.error("[subscribe] Klaviyo error status:", klaviyoResponse.status, "code:", serviceErrorCode);
  return {
    statusCode: klaviyoResponse.status >= 400 && klaviyoResponse.status < 500 ? 400 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: serviceErrorCode }),
  };
};
