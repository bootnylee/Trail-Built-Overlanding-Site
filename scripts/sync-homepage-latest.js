#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "index.html");
const ARTICLES_DIR = path.join(ROOT, "articles");

function extractDatePublished(articleHtml, slug) {
  const jsonLd = articleHtml.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/i);
  if (jsonLd) return jsonLd[1];
  const openGraph = articleHtml.match(/article:published_time[^>]+content="(\d{4}-\d{2}-\d{2})/i);
  if (openGraph) return openGraph[1];
  throw new Error(`No datePublished metadata found for articles/${slug}.html`);
}

function extractBalancedDiv(html, start) {
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, tagPattern.lastIndex);
  }
  throw new Error("Unbalanced card markup in homepage latest section");
}

function extractCards(sectionHtml) {
  const cards = [];
  let offset = 0;
  while (true) {
    const start = sectionHtml.indexOf('<div class="card">', offset);
    if (start === -1) break;
    const markup = extractBalancedDiv(sectionHtml, start);
    const slugMatch = markup.match(/href="articles\/([^"?#]+)\.html"/i);
    if (!slugMatch) throw new Error("Homepage latest card is missing an article link");
    cards.push({ slug: slugMatch[1], markup });
    offset = start + markup.length;
  }
  if (!cards.length) throw new Error("No homepage latest cards found");
  return cards;
}

function dateForSlug(slug) {
  const articlePath = path.join(ARTICLES_DIR, `${slug}.html`);
  if (!fs.existsSync(articlePath)) throw new Error(`Homepage card targets missing article: ${slug}`);
  return extractDatePublished(fs.readFileSync(articlePath, "utf8"), slug);
}

function syncLatestSection() {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const sectionStart = html.indexOf('<section id="reviews">');
  const nextSection = html.indexOf('<!-- ===== TOP PRODUCT', sectionStart);
  if (sectionStart === -1 || nextSection === -1) {
    throw new Error("Could not locate homepage latest section boundaries");
  }
  const section = html.slice(sectionStart, nextSection);
  const firstGrid = section.indexOf('<div class="grid-3">');
  if (firstGrid === -1) throw new Error("Could not locate homepage latest grid");

  const cards = extractCards(section).map((card) => ({ ...card, datePublished: dateForSlug(card.slug) }));
  const slugs = new Set();
  for (const card of cards) {
    if (slugs.has(card.slug)) throw new Error(`Duplicate homepage latest card: ${card.slug}`);
    slugs.add(card.slug);
  }
  cards.sort((a, b) => b.datePublished.localeCompare(a.datePublished) || a.slug.localeCompare(b.slug));

  const prefix = section.slice(0, firstGrid);
  const synchronizedSection = `${prefix}<div class="grid-3">\n${cards.map((card) => card.markup).join("\n")}\n</div>\n</div>\n</section>\n`;
  const updated = html.slice(0, sectionStart) + synchronizedSection + html.slice(nextSection);
  fs.writeFileSync(INDEX_PATH, updated);
  console.log(`Synchronized ${cards.length} homepage latest cards newest-first by datePublished.`);
  console.log(cards.map((card) => `${card.datePublished}\t${card.slug}`).join("\n"));
}

syncLatestSection();
