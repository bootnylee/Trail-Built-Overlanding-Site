/**
 * Netlify Function: subscribe
 *
 * Adds a subscriber to the Trail Built Overlanding EmailOctopus list.
 * Uses the EmailOctopus API v2 (https://api.emailoctopus.com).
 * Credentials are read exclusively from Netlify environment variables —
 * they are never committed, logged, or returned in any response.
 *
 * Required env vars (set in Netlify dashboard → Site configuration → Env vars):
 *   EMAILOCTOPUS_API_KEY   — your EmailOctopus v2 API key
 *   EMAILOCTOPUS_LIST_ID   — the target list ID (UUID format)
 *
 * Request:  POST /.netlify/functions/subscribe
 *           Content-Type: application/json
 *           Body: { "email": "subscriber@example.com" }
 *
 * Response 200: { "ok": true }
 * Response 400: { "ok": false, "error": "<friendly message or EO error code>" }
 * Response 500: { "ok": false, "error": "configuration-missing" }
 */

exports.handler = async function (event) {
  // Only accept POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  // Validate env vars — return a clean error, never crash
  const apiKey = process.env.EMAILOCTOPUS_API_KEY;
  const listId = process.env.EMAILOCTOPUS_LIST_ID;
  if (!apiKey || !listId) {
    console.error("[subscribe] Missing EMAILOCTOPUS_API_KEY or EMAILOCTOPUS_LIST_ID env vars");
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "configuration-missing" }),
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

  // Call EmailOctopus API v2
  // Docs: https://emailoctopus.com/api-documentation/v2#tag/Contact/operation/postListsListIdContacts
  // Auth: Bearer token in Authorization header — API key is never placed in the request body
  const eoUrl = `https://api.emailoctopus.com/lists/${listId}/contacts`;

  let eoRes, eoData;
  try {
    eoRes = await fetch(eoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        email_address: email,
        status: "subscribed",
      }),
    });
    eoData = await eoRes.json();
  } catch (err) {
    console.error("[subscribe] EmailOctopus network error:", err.message);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Could not reach email service. Please try again." }),
    };
  }

  // 2xx → success
  if (eoRes.ok) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }

  // 409 already-exists → treat as success (idempotent subscribe)
  if (
    eoRes.status === 409 &&
    typeof eoData?.type === "string" &&
    eoData.type.includes("already-exists")
  ) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }

  // All other non-2xx responses → surface the HTTP status and EO error type
  // Never log or return the API key, list ID, or request body
  const errorCode =
    (typeof eoData?.type === "string"
      ? eoData.type.split("/").pop()
      : null) ||
    String(eoRes.status);
  console.error("[subscribe] EmailOctopus error status:", eoRes.status, "type:", errorCode);
  return {
    statusCode: eoRes.status >= 400 && eoRes.status < 500 ? 400 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: errorCode }),
  };
};
