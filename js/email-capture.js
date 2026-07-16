/**
 * Trail Built Overlanding — Email Capture
 *
 * Submits email signups to /.netlify/functions/subscribe (server-side).
 * No API keys are stored or transmitted client-side.
 *
 * Public API (window.TBOEmailCapture):
 *   submitEmailSignup(email, style, source)  → Promise<{ok, error?}>
 *   triggerLeadMagnetDownload(style)
 *   persistRigStyle(style)
 *   getPersistedRigStyle()                   → string|null
 *   LEAD_MAGNET_PDFS                         → {truck,suv,jeep,van}
 *   RIG_STYLE_LABELS                         → {truck,suv,jeep,van}
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const STORAGE_KEY_STYLE   = "tbo_rig_style";
const STORAGE_KEY_EMAIL   = "tbo_subscriber_email";
const STORAGE_KEY_SIGNUPS = "tbo_local_signups";

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
  try { localStorage.setItem(STORAGE_KEY_STYLE, style); } catch (e) {}
}

// ── Utility: get persisted rig style ─────────────────────────────────────────
function getPersistedRigStyle() {
  try { return localStorage.getItem(STORAGE_KEY_STYLE) || null; } catch (e) { return null; }
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
      ts: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY_SIGNUPS, JSON.stringify(existing.slice(-50)));
    localStorage.setItem(STORAGE_KEY_EMAIL, email);
  } catch (e) {}
}

// ── Utility: trigger lead magnet download ─────────────────────────────────────
function triggerLeadMagnetDownload(style) {
  const pdfPath = LEAD_MAGNET_PDFS[style];
  if (!pdfPath) return;
  const a = document.createElement("a");
  a.href = pdfPath;
  a.download = pdfPath.split("/").pop();
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}

// ── Server-side subscribe via Netlify Function ────────────────────────────────
async function submitToNetlifyFunction(email) {
  try {
    const res = await fetch("/.netlify/functions/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) return { ok: true };
    return { ok: false, error: data.error || "Subscription failed. Please try again." };
  } catch (e) {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }
}

// ── Main submit function ───────────────────────────────────────────────────────
/**
 * Submit an email signup with rig style tagging.
 * @param {string} email   - Subscriber email address
 * @param {string} style   - Rig style key: "truck" | "suv" | "jeep" | "van"
 * @param {string} source  - Signup source: "quiz" | "homepage" | "article"
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function submitEmailSignup(email, style, source = "unknown") {
  // Always persist locally first
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

  // Submit via server-side Netlify function (no API keys client-side)
  return await submitToNetlifyFunction(email);
}

// ── Export for use in quiz.html, main.js, and article pages ──────────────────
window.TBOEmailCapture = {
  submitEmailSignup,
  triggerLeadMagnetDownload,
  persistRigStyle,
  getPersistedRigStyle,
  LEAD_MAGNET_PDFS,
  RIG_STYLE_LABELS,
};
