/**
 * Trail Built — User Review Feature
 * ──────────────────────────────────
 * This module is DORMANT by default.
 *
 * FEATURE FLAG: The entire feature is controlled by a single constant at the
 * top of this file: REVIEWS_ENABLED.
 *
 * When REVIEWS_ENABLED = false (default):
 *   - No UI is rendered
 *   - No AggregateRating schema is emitted
 *   - The .user-reviews-section div stays hidden via CSS
 *
 * When REVIEWS_ENABLED = true:
 *   - The review form and display section become visible
 *   - Submitted reviews are stored in localStorage (per page slug)
 *   - Reviews marked as approved in the moderation panel are displayed
 *   - AggregateRating schema is injected ONLY when ≥1 approved review exists
 *   - The aggregate score is computed strictly from genuine submitted ratings
 *
 * STORAGE: localStorage (client-side, per-browser).
 * Key format: "tbo_reviews_<slug>" where slug is the URL pathname slug.
 * Each review object: { id, name, rating, text, date, approved, pending }
 *
 * MODERATION: Open /admin/reviews.html (password-protected via sessionStorage)
 * to approve or delete reviews before they appear publicly.
 *
 * TO ENABLE: Change REVIEWS_ENABLED to true below, then redeploy.
 * See the activation checklist in the repo README for full steps.
 */

// ── FEATURE FLAG ─────────────────────────────────────────────────────────────
const REVIEWS_ENABLED = false;
// ─────────────────────────────────────────────────────────────────────────────

// Storage key prefix
const STORAGE_PREFIX = 'tbo_reviews_';

/**
 * Get the page slug from the current URL pathname.
 * e.g. /articles/best-overlanding-winches.html → best-overlanding-winches
 */
function getPageSlug() {
  const path = window.location.pathname;
  const filename = path.split('/').pop().replace('.html', '') || 'index';
  return filename;
}

/**
 * Load all reviews for the current page from localStorage.
 * Returns an array of review objects.
 */
function loadReviews(slug) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Save reviews array to localStorage.
 */
function saveReviews(slug, reviews) {
  try {
    localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(reviews));
  } catch (e) {
    console.warn('Trail Built reviews: localStorage write failed', e);
  }
}

/**
 * Generate a simple unique ID for a review.
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Render star HTML (filled/empty) for a given rating (1–5).
 */
function renderStars(rating, cssClass) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="${i <= rating ? 'star-filled' : 'star-empty'}">&#9733;</span>`;
  }
  return html;
}

/**
 * Compute aggregate rating from approved reviews.
 * Returns { average, count } or null if no approved reviews.
 */
function computeAggregate(reviews) {
  const approved = reviews.filter(r => r.approved && !r.pending);
  if (approved.length === 0) return null;
  const sum = approved.reduce((acc, r) => acc + r.rating, 0);
  return {
    average: Math.round((sum / approved.length) * 10) / 10,
    count: approved.length,
  };
}

/**
 * Inject AggregateRating schema into the page <head>.
 * Only called when there are ≥1 approved reviews.
 * The schema is computed strictly from genuine submitted ratings.
 */
function injectAggregateRatingSchema(aggregate, pageTitle, pageUrl) {
  // Remove any existing AggregateRating schema first
  document.querySelectorAll('script[data-tbo-aggregate]').forEach(el => el.remove());

  if (!aggregate || aggregate.count === 0) return;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": pageTitle,
    "url": pageUrl,
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": aggregate.average.toFixed(1),
      "reviewCount": aggregate.count,
      "bestRating": "5",
      "worstRating": "1"
    }
  };

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.setAttribute('data-tbo-aggregate', 'true');
  script.textContent = JSON.stringify(schema, null, 2);
  document.head.appendChild(script);
}

/**
 * Render the aggregate bar (score + stars + count).
 */
function renderAggregateBar(container, aggregate) {
  if (!aggregate) {
    container.innerHTML = '<p class="review-aggregate-count">No reviews yet. Be the first to share your experience.</p>';
    return;
  }
  const starsHtml = renderStars(Math.round(aggregate.average));
  container.innerHTML = `
    <div class="review-aggregate-score">${aggregate.average.toFixed(1)}</div>
    <div>
      <div class="review-aggregate-stars">${starsHtml}</div>
      <div class="review-aggregate-count">${aggregate.count} reader review${aggregate.count !== 1 ? 's' : ''}</div>
    </div>
  `;
}

/**
 * Render the list of approved reviews.
 */
function renderReviewList(container, reviews) {
  const approved = reviews.filter(r => r.approved && !r.pending);
  if (approved.length === 0) {
    container.innerHTML = '<p style="color:var(--muted); font-size:0.88rem;">No approved reviews yet.</p>';
    return;
  }
  // Sort newest first
  const sorted = [...approved].sort((a, b) => new Date(b.date) - new Date(a.date));
  container.innerHTML = sorted.map(r => `
    <div class="review-card-user">
      <div class="review-card-header">
        <span class="review-card-name">${escapeHtml(r.name)}</span>
        <span class="review-card-stars">${renderStars(r.rating)}</span>
        <span class="review-card-date">${formatDate(r.date)}</span>
      </div>
      <p class="review-card-text">${escapeHtml(r.text)}</p>
    </div>
  `).join('');
}

/**
 * Escape HTML to prevent XSS in user-submitted content.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an ISO date string to a readable short date.
 */
function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

/**
 * Initialize the star picker interaction.
 */
function initStarPicker(pickerEl, ratingInput) {
  const buttons = pickerEl.querySelectorAll('.star-btn');
  let selectedRating = 0;

  buttons.forEach((btn, idx) => {
    const val = idx + 1;

    btn.addEventListener('mouseenter', () => {
      buttons.forEach((b, i) => b.classList.toggle('active', i < val));
    });

    btn.addEventListener('mouseleave', () => {
      buttons.forEach((b, i) => b.classList.toggle('active', i < selectedRating));
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      selectedRating = val;
      ratingInput.value = val;
      buttons.forEach((b, i) => b.classList.toggle('active', i < val));
    });
  });
}

/**
 * Main init function — called on DOMContentLoaded.
 */
function initUserReviews() {
  if (!REVIEWS_ENABLED) return;

  // Signal to CSS that reviews are enabled
  document.body.setAttribute('data-reviews-enabled', 'true');

  const section = document.querySelector('.user-reviews-section');
  if (!section) return;

  const slug = getPageSlug();
  let reviews = loadReviews(slug);

  // DOM refs
  const aggregateBar   = section.querySelector('.review-aggregate-bar');
  const reviewList     = section.querySelector('.review-list');
  const form           = section.querySelector('.review-form');
  const ratingInput    = section.querySelector('input[name="rating"]');
  const nameInput      = section.querySelector('input[name="reviewer-name"]');
  const textInput      = section.querySelector('textarea[name="review-text"]');
  const submitBtn      = section.querySelector('.review-form-submit');
  const formMessage    = section.querySelector('.review-form-message');
  const starPicker     = section.querySelector('.star-picker');

  if (starPicker && ratingInput) {
    initStarPicker(starPicker, ratingInput);
  }

  // Initial render
  const aggregate = computeAggregate(reviews);
  if (aggregateBar) renderAggregateBar(aggregateBar, aggregate);
  if (reviewList)   renderReviewList(reviewList, reviews);

  // Inject AggregateRating schema if there are approved reviews
  if (aggregate) {
    injectAggregateRatingSchema(
      aggregate,
      document.title,
      window.location.href
    );
  }

  // Form submission
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const name   = (nameInput?.value || '').trim();
      const rating = parseInt(ratingInput?.value || '0', 10);
      const text   = (textInput?.value || '').trim();

      // Validation
      if (!name || name.length < 2) {
        nameInput?.focus();
        return;
      }
      if (rating < 1 || rating > 5) {
        starPicker?.querySelector('.star-btn')?.focus();
        return;
      }
      if (!text || text.length < 10) {
        textInput?.focus();
        return;
      }

      // Create review object — pending moderation by default
      const review = {
        id:       generateId(),
        name:     name.slice(0, 80),
        rating:   rating,
        text:     text.slice(0, 1000),
        date:     new Date().toISOString(),
        approved: false,  // must be approved in moderation panel before display
        pending:  true,
      };

      reviews = loadReviews(slug); // reload in case of concurrent tab
      reviews.push(review);
      saveReviews(slug, reviews);

      // Show confirmation
      if (submitBtn)   { submitBtn.disabled = true; submitBtn.textContent = 'Submitted'; }
      if (formMessage) { formMessage.textContent = 'Thanks! Your review is pending moderation and will appear once approved.'; formMessage.classList.add('visible'); }
      form.reset();
      if (ratingInput) ratingInput.value = '0';
      if (starPicker)  starPicker.querySelectorAll('.star-btn').forEach(b => b.classList.remove('active'));
    });
  }
}

// ── Run on DOM ready ──────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUserReviews);
} else {
  initUserReviews();
}

// ── Export for moderation panel ───────────────────────────────────────────────
window.TBOReviews = {
  REVIEWS_ENABLED,
  STORAGE_PREFIX,
  loadReviews,
  saveReviews,
  computeAggregate,
  getPageSlug,
};
