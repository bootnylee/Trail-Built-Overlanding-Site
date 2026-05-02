/**
 * TrailBuiltOverland.com — Price History & Badge System
 * Modeled on SilkierStrands priceHistory.ts
 *
 * Tracks price history for featured products and renders
 * All-Time Low / Price Drop / Good Deal badges on product cards.
 *
 * Update prices monthly (1st of each month) by editing the
 * `priceHistoryData` object below.
 *
 * Badge logic:
 *   All-Time Low  — currentPrice <= lowestPrice * 1.05
 *   Price Drop    — currentPrice is ≥10% below averagePrice
 *   Good Deal     — currentPrice is 5–10% below averagePrice
 *   (no badge)    — currentPrice is within 5% of averagePrice
 */

const priceHistoryData = {
  // WARN VR EVO 10-S Winch
  "B07SJHVQTJ": {
    asin: "B07SJHVQTJ",
    name: "WARN VR EVO 10-S Winch",
    currentPrice: 950,
    lowestPrice: 879,
    highestPrice: 1049,
    averagePrice: 965,
    history: [
      { date: "2025-11-01", price: 1049 },
      { date: "2025-12-01", price: 989 },
      { date: "2026-01-01", price: 950 },
      { date: "2026-02-01", price: 950 },
      { date: "2026-03-01", price: 979 },
      { date: "2026-04-01", price: 950 },
      { date: "2026-05-01", price: 950 },
    ],
    lastUpdated: "2026-05-01",
  },

  // MaxTrax MKII Recovery Boards
  "B00HYCVSW6": {
    asin: "B00HYCVSW6",
    name: "MaxTrax MKII Recovery Boards",
    currentPrice: 270,
    lowestPrice: 239,
    highestPrice: 299,
    averagePrice: 272,
    history: [
      { date: "2025-11-01", price: 299 },
      { date: "2025-12-01", price: 279 },
      { date: "2026-01-01", price: 270 },
      { date: "2026-02-01", price: 270 },
      { date: "2026-03-01", price: 265 },
      { date: "2026-04-01", price: 270 },
      { date: "2026-05-01", price: 270 },
    ],
    lastUpdated: "2026-05-01",
  },

  // Dometic CFX3 55 Fridge
  "B083G3NBNZ": {
    asin: "B083G3NBNZ",
    name: "Dometic CFX3 55 Fridge/Freezer",
    currentPrice: 1099,
    lowestPrice: 949,
    highestPrice: 1199,
    averagePrice: 1085,
    history: [
      { date: "2025-11-01", price: 1199 },
      { date: "2025-12-01", price: 1099 },
      { date: "2026-01-01", price: 999 },
      { date: "2026-02-01", price: 1049 },
      { date: "2026-03-01", price: 1099 },
      { date: "2026-04-01", price: 1099 },
      { date: "2026-05-01", price: 1099 },
    ],
    lastUpdated: "2026-05-01",
  },

  // Dometic CFX3 35 Fridge
  "B085MM9B2D": {
    asin: "B085MM9B2D",
    name: "Dometic CFX3 35 Fridge/Freezer",
    currentPrice: 699,
    lowestPrice: 599,
    highestPrice: 799,
    averagePrice: 695,
    history: [
      { date: "2025-11-01", price: 799 },
      { date: "2025-12-01", price: 699 },
      { date: "2026-01-01", price: 649 },
      { date: "2026-02-01", price: 699 },
      { date: "2026-03-01", price: 699 },
      { date: "2026-04-01", price: 699 },
      { date: "2026-05-01", price: 699 },
    ],
    lastUpdated: "2026-05-01",
  },

  // Renogy 200W Solar Panel
  "B07GWFNMDP": {
    asin: "B07GWFNMDP",
    name: "Renogy 200W Solar Panel",
    currentPrice: 180,
    lowestPrice: 149,
    highestPrice: 220,
    averagePrice: 182,
    history: [
      { date: "2025-11-01", price: 220 },
      { date: "2025-12-01", price: 195 },
      { date: "2026-01-01", price: 180 },
      { date: "2026-02-01", price: 175 },
      { date: "2026-03-01", price: 180 },
      { date: "2026-04-01", price: 180 },
      { date: "2026-05-01", price: 180 },
    ],
    lastUpdated: "2026-05-01",
  },
};

// ── Badge logic ───────────────────────────────────────────────────────────────

/**
 * Returns a badge object or null for a given ASIN.
 * @param {string} asin
 * @param {number} [overridePrice] - Optional current price override
 * @returns {{ type: string, label: string, cssClass: string } | null}
 */
function getPriceBadge(asin, overridePrice) {
  const data = priceHistoryData[asin];
  if (!data) return null;

  const current = overridePrice !== undefined ? overridePrice : data.currentPrice;
  const { lowestPrice, averagePrice } = data;

  if (current <= lowestPrice * 1.05) {
    return { type: "atl",  label: "All-Time Low", cssClass: "price-badge price-badge-atl" };
  }
  if (current <= averagePrice * 0.90) {
    return { type: "drop", label: "Price Drop",   cssClass: "price-badge price-badge-drop" };
  }
  if (current <= averagePrice * 0.95) {
    return { type: "deal", label: "Good Deal",    cssClass: "price-badge price-badge-deal" };
  }
  return null;
}

/**
 * Returns the full price history for an ASIN, or null.
 * @param {string} asin
 */
function getPriceHistoryForAsin(asin) {
  return priceHistoryData[asin] || null;
}

/**
 * Returns price trend direction for an ASIN.
 * @param {string} asin
 * @returns {"dropping" | "rising" | "stable" | null}
 */
function getPriceTrend(asin) {
  const data = priceHistoryData[asin];
  if (!data || data.history.length < 2) return null;

  const sorted = [...data.history].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-3);
  if (recent.length < 2) return "stable";

  const first = recent[0].price;
  const last  = recent[recent.length - 1].price;
  const change = (last - first) / first;

  if (change <= -0.05) return "dropping";
  if (change >= 0.05)  return "rising";
  return "stable";
}

// ── Auto-inject badges on page load ──────────────────────────────────────────
/**
 * Scans the page for elements with [data-asin] and injects price badges.
 * Add data-asin="B07SJHVQTJ" to any product card to get automatic badges.
 */
function injectPriceBadges() {
  document.querySelectorAll("[data-asin]").forEach(el => {
    const asin = el.getAttribute("data-asin");
    const badge = getPriceBadge(asin);
    if (!badge) return;

    // Find the price element inside the card (looks for .product-price or .price)
    const priceEl = el.querySelector(".product-price, .price, [class*='price']");
    if (priceEl) {
      const badgeEl = document.createElement("span");
      badgeEl.className = badge.cssClass;
      badgeEl.textContent = badge.label;
      priceEl.appendChild(badgeEl);
    }
  });
}

// Run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectPriceBadges);
} else {
  injectPriceBadges();
}
