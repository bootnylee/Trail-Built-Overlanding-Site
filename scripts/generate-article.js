#!/usr/bin/env node
/**
 * Trail Built — AI Article Generator
 * Uses Groq (free tier) to write a new overlanding affiliate article,
 * then saves it as a ready-to-publish HTML file.
 *
 * Usage:
 *   node scripts/generate-article.js
 *   node scripts/generate-article.js --topic "best overlanding fridges"
 *
 * Required env var: GROQ_API_KEY
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────

const ASSOCIATE_TAG = process.env.AMAZON_ASSOCIATE_TAG || 'YOUR-ASSOCIATE-TAG';
const GROQ_API_KEY  = process.env.GROQ_API_KEY;
const GROQ_MODEL    = 'llama-3.3-70b-versatile';

const ARTICLES_DIR = path.join(__dirname, '..', 'articles');
const INDEX_FILE   = path.join(__dirname, '..', 'index.html');

// Topic pool — the generator cycles through these automatically.
// Add more topics here to expand site coverage.
const TOPIC_POOL = [
  'best overlanding air compressors',
  'best winches for Toyota 4Runner',
  'overlanding solar power setup guide',
  'best skid plates for off-road trucks',
  'overlanding water storage and filtration',
  'best off-road tires for overlanding',
  'vehicle communication gear for overlanding',
  'best overlanding camp kitchens',
  'how to build a truck bed sleeping platform',
  'best hi-lift jack alternatives',
  'overlanding first aid kit essentials',
  'best roof rack brands for overlanding',
  'Toyota Tacoma overland build guide',
  'best overlanding GPS and navigation devices',
  'diesel vs gasoline for overlanding',
  'best overlanding suspension upgrades',
  'overlanding packing list complete guide',
  'best portable power stations for overlanding',
  'how to choose overlanding recovery boards',
  'best overlanding trailers and teardrops',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function todayHuman() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function pickTopic() {
  // CLI override
  const idx = process.argv.indexOf('--topic');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];

  // Pick a topic not yet covered (check filenames)
  const existing = fs.readdirSync(ARTICLES_DIR).map(f => f.replace('.html', '').replace(/-/g, ' '));
  const remaining = TOPIC_POOL.filter(t => !existing.some(e => e.includes(t.split(' ')[1])));
  if (remaining.length === 0) return TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
  return remaining[Math.floor(Math.random() * remaining.length)];
}

// ── Groq API ─────────────────────────────────────────────────────────────────

function groqRequest(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          resolve(json.choices[0].message.content);
        } catch (e) {
          reject(new Error('Failed to parse Groq response: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Article generation ───────────────────────────────────────────────────────

async function generateArticleContent(topic) {
  console.log(`Generating article for: "${topic}"`);

  const systemPrompt = `You are an expert overlanding writer for TrailBuilt.com, an affiliate review site.
Write in a confident, practical, first-person-plural voice ("we tested", "we ran it for 3 months").
Every article must include:
- A compelling intro paragraph
- 4-6 specific product recommendations with realistic prices in USD
- Amazon search links formatted as: https://www.amazon.com/s?k=PRODUCT+NAME+HERE&tag=${ASSOCIATE_TAG}
- Pros/cons or "why we like it" for each product
- At least one FAQ section with 3 questions
- An affiliate disclosure reminder in the footer note
Write clean HTML fragments only (no <html>/<head>/<body> tags).
Use <h2>, <h3>, <p>, <ul>, <li>, <strong> tags only.
For each product recommendation, wrap in this exact structure:
<div class="product-box" data-product="PRODUCT NAME">
  <div class="product-box-header">
    <div class="product-box-icon">EMOJI</div>
    <div class="product-box-info">
      <h4>PRODUCT FULL NAME</h4>
      <div class="price">~$PRICE on Amazon</div>
    </div>
  </div>
  <div class="product-box-pros">
    <h5>Why We Like It</h5>
    <ul><li>...</li></ul>
  </div>
  <a href="AMAZON_LINK" class="btn-amazon" rel="nofollow sponsored noopener" target="_blank">Check Price on Amazon ↗</a>
</div>`;

  const userPrompt = `Write a comprehensive buyer's guide article titled "Best ${topic.charAt(0).toUpperCase() + topic.slice(1)} 2026".
Include 4-5 product picks across budget, mid-range, and premium tiers.
Make it around 1,200–1,500 words. Be specific with product names, prices, and real-world testing details.
End with a 3-question FAQ section using <h2 id="faq">FAQ</h2> and <h3> for each question.`;

  return groqRequest([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
}

async function generateMeta(topic) {
  const prompt = `For an overlanding affiliate article about "${topic}", write:
1. A title tag (max 65 chars, include "2026")
2. A meta description (max 155 chars, mention testing and specific product types)
Return as JSON: {"title": "...", "description": "..."}`;

  const raw = await groqRequest([
    { role: 'system', content: 'Return only valid JSON, no markdown.' },
    { role: 'user', content: prompt },
  ]);

  try {
    return JSON.parse(raw.trim());
  } catch {
    return {
      title: `Best ${topic} 2026 — Trail Built`,
      description: `Expert reviews and top picks for ${topic}. Tested in the field.`,
    };
  }
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHTML({ slug, title, description, topic, bodyHTML, date, dateHuman }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="https://trailbuilt.com/articles/${slug}.html" />
  <link rel="stylesheet" href="../css/style.css" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${escapeHtml(title)}",
    "description": "${escapeHtml(description)}",
    "datePublished": "${date}",
    "dateModified": "${date}",
    "author": { "@type": "Person", "name": "Trail Built Staff" },
    "publisher": { "@type": "Organization", "name": "Trail Built" }
  }
  <\/script>
</head>
<body>

<header>
  <div class="container header-inner">
    <a href="../index.html" class="logo">Trail<span>Built</span></a>
    <nav>
      <a href="../index.html">Home</a>
      <a href="../index.html#reviews" class="active">Reviews</a>
      <a href="../index.html#guides">Build Guides</a>
      <a href="../index.html#gear">Top Gear</a>
      <a href="../index.html#categories">Categories</a>
      <a href="../index.html#gear" class="header-cta btn">Best Picks</a>
    </nav>
    <button class="menu-toggle" aria-label="Toggle menu">&#9776;</button>
  </div>
</header>

<div class="article-header">
  <div class="container">
    <div class="article-hero">
      <div>
        <div class="article-meta-top">
          <span class="badge">Gear Guide</span>
          <span class="badge badge-green">2026</span>
          <span class="card-date">${dateHuman}</span>
        </div>
        <h1>${escapeHtml(title.replace(' — Trail Built', ''))}</h1>
        <p class="article-intro">${escapeHtml(description)}</p>
        <div class="article-byline">
          <div class="avatar">&#127952;</div>
          <div class="byline-info">
            <strong>Trail Built Staff</strong>
            <span>Published ${dateHuman}</span>
          </div>
        </div>
      </div>
      <div class="article-img-hero">&#127956;</div>
    </div>
  </div>
</div>

<div class="container">
  <div class="article-layout">
    <article class="article-body">
      ${bodyHTML}
    </article>
    <aside class="article-sidebar">
      <div class="sidebar-widget">
        <h4>More Guides</h4>
        <div class="sidebar-product">
          <div class="icon">&#9981;</div>
          <div><h5><a href="best-overlanding-recovery-gear.html">Best Recovery Gear 2026</a></h5><span>18 min read</span></div>
        </div>
        <div class="sidebar-product">
          <div class="icon">&#128269;</div>
          <div><h5><a href="best-off-road-light-bars.html">Best Light Bars 2026</a></h5><span>14 min read</span></div>
        </div>
        <div class="sidebar-product">
          <div class="icon">&#127988;</div>
          <div><h5><a href="rooftop-tent-buying-guide.html">Rooftop Tent Guide 2026</a></h5><span>22 min read</span></div>
        </div>
      </div>
    </aside>
  </div>
</div>

<footer>
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="logo">Trail<span>Built</span></div>
        <p>Honest overlanding gear reviews. We test everything ourselves.</p>
        <div class="affiliate-notice"><strong>Affiliate Disclosure:</strong> TrailBuilt earns commissions from qualifying Amazon purchases. This never affects our recommendations.</div>
      </div>
      <div class="footer-col"><h4>Reviews</h4><a href="best-overlanding-recovery-gear.html">Recovery Gear</a><a href="best-off-road-light-bars.html">Light Bars</a><a href="rooftop-tent-buying-guide.html">Rooftop Tents</a></div>
      <div class="footer-col"><h4>Guides</h4><a href="#">4Runner Build</a><a href="#">Bronco Build</a><a href="#">Tacoma Build</a></div>
      <div class="footer-col"><h4>Site</h4><a href="#">About</a><a href="#">Privacy Policy</a><a href="#">Affiliate Disclosure</a></div>
    </div>
    <div class="footer-bottom"><p>&copy; ${new Date().getFullYear()} Trail Built. All rights reserved.</p></div>
  </div>
</footer>

<script src="../js/main.js"><\/script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Index updater ─────────────────────────────────────────────────────────────

function addArticleToIndex(slug, title, description, date) {
  if (!fs.existsSync(INDEX_FILE)) return;
  let html = fs.readFileSync(INDEX_FILE, 'utf8');

  const card = `
      <div class="card">
        <div class="card-img">&#127956;</div>
        <div class="card-body">
          <div class="card-meta">
            <span class="badge">Gear Guide</span>
            <span class="card-date">${date}</span>
          </div>
          <h3><a href="articles/${slug}.html">${title.replace(' — Trail Built', '')}</a></h3>
          <p>${description}</p>
          <div class="card-footer">
            <a href="articles/${slug}.html" class="read-link">Read More &rarr;</a>
            <span class="read-time">12 min</span>
          </div>
        </div>
      </div>`;

  // Insert before closing </div> of the reviews grid
  html = html.replace('</div>\n\n    </div>\n  </div>\n</section>\n\n<!-- ===== TOP PRODUCT',
    card + '\n</div>\n\n    </div>\n  </div>\n</section>\n\n<!-- ===== TOP PRODUCT');

  fs.writeFileSync(INDEX_FILE, html);
  console.log('Index updated with new article card.');
}

// ── Sitemap updater ───────────────────────────────────────────────────────────

function updateSitemap(slug, date) {
  const sitemapPath = path.join(__dirname, '..', 'sitemap.xml');
  let sitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';

  const entry = `  <url>
    <loc>https://trailbuilt.com/articles/${slug}.html</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;

  if (sitemap.includes(`/${slug}.html`)) return; // already exists

  sitemap = sitemap.replace('</urlset>', entry + '\n</urlset>');
  fs.writeFileSync(sitemapPath, sitemap);
  console.log('Sitemap updated.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!GROQ_API_KEY) {
    console.error('ERROR: GROQ_API_KEY environment variable is not set.');
    console.error('Get a free key at: https://console.groq.com');
    process.exit(1);
  }

  const topic = pickTopic();
  const slug  = slugify(`best-${topic}`).replace(/^best-best-/, 'best-');
  const date  = todayISO();
  const dateHuman = todayHuman();

  console.log(`Topic: ${topic}`);
  console.log(`Slug:  ${slug}`);

  // Generate in parallel
  const [bodyHTML, meta] = await Promise.all([
    generateArticleContent(topic),
    generateMeta(topic),
  ]);

  const html = buildHTML({ slug, title: meta.title, description: meta.description, topic, bodyHTML, date, dateHuman });

  const outPath = path.join(ARTICLES_DIR, `${slug}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`Article written: ${outPath}`);

  addArticleToIndex(slug, meta.title, meta.description, dateHuman);
  updateSitemap(slug, date);

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
