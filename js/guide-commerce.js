/*
 * Trail Built buyer-guide commerce layer.
 *
 * Product names and direct ASIN links remain server-rendered in each guide.
 * This module only renders catalog fields when the most recent Amazon Creators
 * API sync is fresh; it never manufactures a price, availability state, or
 * merchandising badge in the browser.
 */
(function () {
  "use strict";

  var FRESHNESS_MS = 24 * 60 * 60 * 1000;

  function catalogIsFresh() {
    var timestamp = window.TrailBuiltLastSyncedAt;
    if (!timestamp) return false;
    var time = new Date(timestamp).getTime();
    return Number.isFinite(time) && Date.now() - time >= 0 && Date.now() - time < FRESHNESS_MS;
  }

  function productFor(asin) {
    return window.TrailBuiltProducts && asin ? window.TrailBuiltProducts[asin] : null;
  }

  function renderPrice(element, product, fresh) {
    if (!fresh || !product || !product.priceDisplay || Number(product.price) <= 0) {
      element.hidden = true;
      element.textContent = "";
      return;
    }
    element.hidden = false;
    element.textContent = product.priceDisplay;
  }

  function renderAvailability(element, product, fresh) {
    if (!fresh || !product || !product.availability) {
      element.hidden = true;
      element.textContent = "";
      return;
    }
    element.hidden = false;
    var price = element.parentElement && element.parentElement.querySelector("[data-catalog-price]");
    var hasVisiblePrice = price && !price.hidden && price.textContent;
    element.textContent = hasVisiblePrice ? " · " + product.availability : product.availability;
  }

  function renderBadge(element, product, fresh) {
    // The Creators API does not expose Amazon's Choice or Best Seller labels.
    // Show a badge only if a future official catalog response supplies one.
    if (!fresh || !product || !product.merchandisingBadge) {
      element.hidden = true;
      element.textContent = "";
      return;
    }
    element.hidden = false;
    element.textContent = product.merchandisingBadge;
  }

  function renderCatalogFields() {
    var fresh = catalogIsFresh();
    document.querySelectorAll("[data-catalog-price]").forEach(function (element) {
      renderPrice(element, productFor(element.getAttribute("data-asin")), fresh);
    });
    document.querySelectorAll("[data-catalog-availability]").forEach(function (element) {
      renderAvailability(element, productFor(element.getAttribute("data-asin")), fresh);
    });
    document.querySelectorAll("[data-catalog-badge]").forEach(function (element) {
      renderBadge(element, productFor(element.getAttribute("data-asin")), fresh);
    });
  }

  function configureStickyCta() {
    var sticky = document.querySelector("[data-guide-sticky]");
    if (!sticky) return;
    var cta = sticky.querySelector("a[href*='amazon.com/dp/']");
    if (!cta) sticky.hidden = true;
  }

  function init() {
    renderCatalogFields();
    configureStickyCta();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
