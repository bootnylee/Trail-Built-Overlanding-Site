/**
 * Netlify Function: subscribe
 *
 * Adds a subscriber to the Trail Built Overlanding EmailOctopus list.
 * Credentials are read exclusively from Netlify environment variables —
 * they are never committed, logged, or returned in any response.
 *
 * Required env vars (set in Netlify dashboard → Site configuration → Env vars):
 *   EMAILOCTOPUS_API_KEY   — your EmailOctopus API key
 *   EMAILOCTOPUS_LIST_ID   — the target list ID (UUID format)
 *
 * Request:  POST /.netlify/functions/subscribe
 *           Content-Type: application/json
 *           Body: { "email": "subscriber@example.com" }
 *
 * Response 200: { "ok": true }
 * Response 400: { "ok": false, "error": "<friendly message>" }
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

  // Call EmailOctopus API v1.6
  // Docs: https://emailoctopus.com/api-documentation/lists/create-contact
  const eoUrl = `https://emailoctopus.com/api/1.6/lists/${listId}/contacts`;
  const eoPayload = {
    api_key: apiKey,
    email_address: email,
    status: "SUBSCRIBED",
  };

  let eoRes, eoData;
  try {
    eoRes = await fetch(eoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eoPayload),
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

  // Handle already-subscribed as success
  if (eoData?.error?.code === "MEMBER_EXISTS_WITH_EMAIL_ADDRESS") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }

  // Handle other API errors
  if (eoData?.error || !eoRes.ok) {
    const code = eoData?.error?.code || "UNKNOWN";
    console.error("[subscribe] EmailOctopus error code:", code);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Subscription failed. Please try again." }),
    };
  }

  // Success
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
