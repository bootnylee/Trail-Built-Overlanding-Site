#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RAW_UNSPLASH_IDS = [
  "1677739115529",
  "1768352841913",
  "1749441184544",
  "1543365618",
  "1602038187785",
  "1772308005714",
  "1770096171602",
  "1650866155994",
].map((id) => `photo-${id}`);

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "newsletters", "admin", "author"].includes(entry.name)) return [];
      return htmlFiles(fullPath);
    }
    return entry.name.endsWith(".html") ? [fullPath] : [];
  });
}

function normalizeSource(source) {
  return source.replace(/&amp;/g, "&").replace(/[?#].*$/, "");
}

function extractEditorialSources(html) {
  const sources = new Set();
  for (const match of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) {
    sources.add(normalizeSource(match[1]));
  }
  for (const match of html.matchAll(/<div[^>]+(?:article-header|card-img)[^>]*>[\s\S]{0,500}?<img[^>]+src=["']([^"']+)["']/gi)) {
    sources.add(normalizeSource(match[1]));
  }
  for (const match of html.matchAll(/<div[^>]+article-header[^>]+background-image:\s*url\(["']?([^"')]+)["']?\)/gi)) {
    sources.add(normalizeSource(match[1]));
  }
  return sources;
}

const sourcePages = new Map();
const violations = [];
for (const file of htmlFiles(ROOT)) {
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  const html = fs.readFileSync(file, "utf8");
  for (const id of RAW_UNSPLASH_IDS) {
    if (html.includes(id)) violations.push(`${relative}: prohibited raw Unsplash source ${id}`);
  }
  if (relative !== "articles/toyota-tacoma-overland-build-guide.html" && html.includes("toyota-tacoma-overland-build-guide-hero")) {
    violations.push(`${relative}: prohibited misused Tacoma hero asset`);
  }
  for (const source of extractEditorialSources(html)) {
    if (!sourcePages.has(source)) sourcePages.set(source, []);
    sourcePages.get(source).push(relative);
  }
}

for (const [source, pages] of sourcePages) {
  if (pages.length > 1) violations.push(`Editorial source reused across pages: ${source} -> ${pages.join(", ")}`);
}

if (violations.length) {
  console.error("Editorial image validation failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(`Editorial image validation passed for ${sourcePages.size} unique editorial sources.`);
