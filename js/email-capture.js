/**
 * Trail Built — Email Capture & Segmentation Module
 * ──────────────────────────────────────────────────
 * Handles:
 *   1. Quiz result email capture with rig-style tagging
 *   2. Provider-agnostic storage (localStorage + configurable API hook)
 *   3. Lead magnet PDF delivery (matched to rig style)
 *   4. Homepage newsletter form submission
 *   5. Style persistence in localStorage for future targeting
 *
 * ── CONFIGURATION ──────────────────────────────────────────────────────────
 * All provider credentials live in the TBO_EMAIL_CONFIG object below.
 * Replace the placeholder values to activate a real provider.
 *
 * SUPPORTED PROVIDERS (set TBO_EMAIL_CONFIG.provider):
 *   "emailoctopus"  — EmailOctopus API v1.2
 *   "mailchimp"     — Mailchimp Marketing API v3
 *   "convertkit"    — ConvertKit API v3
 *   "none"          — Store locally only (default; safe for launch)
 *
 * See the README / activation checklist for full wiring instructions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  CONFIGURATION — edit these values to activate a real email provider   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const TBO_EMAIL_CONFIG = {

  // ── Active provider ─────────────────────────────────────────────────────
  // Options: "emailoctopus" | "mailchimp" | "convertkit" | "none"
  // "none" stores submissions in localStorage only; safe for launch.
  provider: "none",   // ← CHANGE THIS when you wire a provider

  // ── EmailOctopus ─────────────────────────────────────────────────────────
  // Docs: https://emailoctopus.com/api-documentation
  emailoctopus: {
    apiKey:  "REPLACE_WITH_YOUR_EMAILOCTOPUS_API_KEY",   // ← your EO API key
    listId:  "REPLACE_WITH_YOUR_EMAILOCTOPUS_LIST_ID",   // ← your EO list ID
    // Tag field name in your EO list (create a custom field named "rig_style")
    rigStyleField: "rig_style",
  },

  // ── Mailchimp ─────────────────────────────────────────────────────────────
  // Docs: https://mailchimp.com/developer/marketing/api/list-members/
  mailchimp: {
    apiKey:     "REPLACE_WITH_YOUR_MAILCHIMP_API_KEY",   // ← format: key-us1
    listId:     "REPLACE_WITH_YOUR_MAILCHIMP_LIST_ID",   // ← audience ID
    serverPrefix: "us1",                                  // ← e.g. us1, us6
    // Merge tag name for rig style (create a merge tag named RIG_STYLE)
    rigStyleMergeTag: "RIG_STYLE",
  },

  // ── ConvertKit ────────────────────────────────────────────────────────────
  // Docs: https://developers.convertkit.com/
  convertkit: {
    apiKey:   "REPLACE_WITH_YOUR_CONVERTKIT_API_KEY",    // ← CK API key
    formId:   "REPLACE_WITH_YOUR_CONVERTKIT_FORM_ID",    // ← form ID
    // Tag IDs per rig style (create tags in CK and paste their IDs here)
    tagIds: {
      truck:  "REPLACE_WITH_CK_TAG_ID_TRUCK",
      suv:    "REPLACE_WITH_CK_TAG_ID_SUV",
      jeep:   "REPLACE_WITH_CK_TAG_ID_JEEP",
      van:    "REPLACE_WITH_CK_TAG_ID_VAN",
    },
  },

  // ── Netlify Forms fallback ────────────────────────────────────────────────
  // If provider = "none", submissions are also POSTed to Netlify Forms
  // (works automatically if the site is hosted on Netlify — no config needed).
  // Set to false to disable Netlify Forms fallback.
  netlifyForms: true,

};
// ╚══════════════════════════════════════════════════════════════════════════╝


// ── Constants ─────────────────────────────────────────────────────────────────
const STORAGE_KEY_STYLE    = "tbo_rig_style";       // persisted rig style
const STORAGE_KEY_EMAIL    = "tbo_subscriber_email"; // persisted email
const STORAGE_KEY_SIGNUPS  = "tbo_local_signups";    // local signup log

// ── Lead magnet PDF map (rig style → download path) ───────────────────────────
const LEAD_MAGNET_PDFS = {
  truck: "/downloads/checklist-truck-builder.pdf",
  suv:   "/downloads/checklist-4x4-expedition.pdf",
  jeep:  "/downloads/checklist-rock-crawler.pdf",
  van:   "/downloads/checklist-van-lifer.pdf",
};

// ── Segment labels (for display and tagging) ──────────────────────────────────
const RIG_STYLE_LABELS = {
  truck: "Truck Builder",
  suv:   "4x4 Expedition",
  jeep:  "Rock Crawler",
  van:   "Van Lifer",
};

// ── Utility: persist rig style ────────────────────────────────────────────────
function persistRigStyle(style) {
  try {
    localStorage.setItem(STORAGE_KEY_STYLE, style);
  } catch (e) {}
}

// ── Utility: get persisted rig style ─────────────────────────────────────────
function getPersistedRigStyle() {
  try {
    return localStorage.getItem(STORAGE_KEY_STYLE) || null;
  } catch (e) { return null; }
}

// ── Utility: log signup locally ───────────────────────────────────────────────
function logSignupLocally(email, style, source) {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY_SIGNUPS) || "[]");
    existing.push({
      email,
      style,
      label: RIG_STYLE_LABELS[style] || style,
      source,
      date: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY_SIGNUPS, JSON.stringify(existing));
    localStorage.setItem(STORAGE_KEY_EMAIL, email);
  } catch (e) {}
}

// ── Utility: trigger lead magnet download ─────────────────────────────────────
function triggerLeadMagnetDownload(style) {
  const pdfPath = LEAD_MAGNET_PDFS[style];
  if (!pdfPath) return;

  // Create a temporary anchor and click it
  const a = document.createElement("a");
  a.href = pdfPath;
  a.download = pdfPath.split("/").pop();
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}

// ── Netlify Forms submission ───────────────────────────────────────────────────
async function submitToNetlifyForms(email, style, source) {
  if (!TBO_EMAIL_CONFIG.netlifyForms) return { ok: false };
  try {
    const body = new URLSearchParams({
      "form-name": "tbo-newsletter",
      email,
      rig_style: style,
      source,
    });
    const res = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── EmailOctopus API submission ────────────────────────────────────────────────
async function submitToEmailOctopus(email, style) {
  const cfg = TBO_EMAIL_CONFIG.emailoctopus;
  const url = `https://emailoctopus.com/api/1.2/lists/${cfg.listId}/contacts`;
  try {
    const payload = {
      api_key: cfg.apiKey,
      email_address: email,
      fields: {
        [cfg.rigStyleField]: RIG_STYLE_LABELS[style] || style,
      },
      status: "SUBSCRIBED",
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) {
      // MEMBER_EXISTS is acceptable — update their tag
      if (data.error.code === "MEMBER_EXISTS") return { ok: true, existed: true };
      return { ok: false, error: data.error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Mailchimp API submission ───────────────────────────────────────────────────
async function submitToMailchimp(email, style) {
  const cfg = TBO_EMAIL_CONFIG.mailchimp;
  // NOTE: Mailchimp API requires server-side calls due to CORS.
  // This client-side call will fail in production unless you proxy it.
  // Recommended: use a Netlify Function at /.netlify/functions/subscribe
  // See the activation checklist for the proxy function template.
  const url = `https://${cfg.serverPrefix}.api.mailchimp.com/3.0/lists/${cfg.listId}/members`;
  try {
    const payload = {
      email_address: email,
      status: "subscribed",
      merge_fields: {
        [cfg.rigStyleMergeTag]: RIG_STYLE_LABELS[style] || style,
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa("anystring:" + cfg.apiKey),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.status === 400 && data.title === "Member Exists") return { ok: true, existed: true };
    if (!res.ok) return { ok: false, error: data.detail || data.title };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── ConvertKit API submission ──────────────────────────────────────────────────
async function submitToConvertKit(email, style) {
  const cfg = TBO_EMAIL_CONFIG.convertkit;
  const url = `https://api.convertkit.com/v3/forms/${cfg.formId}/subscribe`;
  try {
    const tagId = cfg.tagIds[style];
    const payload = {
      api_key: cfg.apiKey,
      email,
      tags: tagId ? [tagId] : [],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: data.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Main submit function ───────────────────────────────────────────────────────
/**
 * Submit an email signup with rig style tagging.
 * @param {string} email     - Subscriber email address
 * @param {string} style     - Rig style key: "truck" | "suv" | "jeep" | "van"
 * @param {string} source    - Signup source: "quiz" | "homepage" | "article"
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function submitEmailSignup(email, style, source = "unknown") {
  // Always persist locally
  persistRigStyle(style);
  logSignupLocally(email, style, source);

  // Fire GA4 event if available
  if (typeof gtag === "function") {
    gtag("event", "newsletter_signup", {
      rig_style: style,
      rig_style_label: RIG_STYLE_LABELS[style] || style,
      source,
    });
  }

  // Submit to configured provider
  let result = { ok: false };
  switch (TBO_EMAIL_CONFIG.provider) {
    case "emailoctopus":
      result = await submitToEmailOctopus(email, style);
      break;
    case "mailchimp":
      result = await submitToMailchimp(email, style);
      break;
    case "convertkit":
      result = await submitToConvertKit(email, style);
      break;
    case "none":
    default:
      // Fall through to Netlify Forms below
      result = { ok: true };
      break;
  }

  // Always try Netlify Forms as a backup capture layer
  if (TBO_EMAIL_CONFIG.netlifyForms) {
    submitToNetlifyForms(email, style, source); // fire-and-forget
  }

  return result;
}

// ── Export for use in quiz.html and main.js ───────────────────────────────────
window.TBOEmailCapture = {
  submitEmailSignup,
  triggerLeadMagnetDownload,
  persistRigStyle,
  getPersistedRigStyle,
  LEAD_MAGNET_PDFS,
  RIG_STYLE_LABELS,
  TBO_EMAIL_CONFIG,
};
