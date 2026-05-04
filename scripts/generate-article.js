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

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────
const ASSOCIATE_TAG  = process.env.AMAZON_ASSOCIATE_TAG || 'trailbuiltove-20';
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL     = 'llama-3.3-70b-versatile';
const ARTICLES_DIR   = path.join(__dirname, '..', 'articles');
const INDEX_FILE     = path.join(__dirname, '..', 'index.html');
const SITE_URL       = 'https://trailbuiltoverland.com';

// ── Topic pool — cycles automatically; add more to extend coverage ──────────
const TOPIC_POOL = [
  // Gear Reviews — Year 1
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
  'best overlanding GPS and navigation devices',
  'diesel vs gasoline for overlanding',
  'best overlanding suspension upgrades',
  'overlanding packing list complete guide',
  'best portable power stations for overlanding',
  'how to choose overlanding recovery boards',
  'best overlanding trailers and teardrops',
  // Gear Reviews — Year 2
  'best overlanding sleeping bags and quilts',
  'best overlanding camp chairs and tables',
  'best overlanding headlamps and lanterns',
  'best overlanding water filters and purifiers',
  'best overlanding fire starters and camp stoves',
  'best overlanding satellite communicators',
  'best overlanding tool kits and recovery bags',
  'best overlanding traction boards comparison',
  'best overlanding snorkels and intake systems',
  'best overlanding dual battery systems',
  'best overlanding cargo management systems',
  'best overlanding shower and hygiene solutions',
  'best overlanding maps and navigation apps',
  'best overlanding dog gear and pet safety',
  'best overlanding tow straps and kinetic ropes',
  'best overlanding CB radios and communication',
  'best overlanding awnings and shade systems',
  'best overlanding ground tents vs rooftop tents',
  'best overlanding solar generators and power banks',
  'best overlanding dash cams and trail cameras',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
function todayISO()   { return new Date().toISOString().split('T')[0]; }
function todayHuman() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function pickTopic() {
  const idx = process.argv.indexOf('--topic');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
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
  const systemPrompt = `You are an expert overlanding writer for TrailBuiltOverland.com, an affiliate review site.
Write in a confident, practical, first-person-plural voice ("we tested", "we ran it for 3 months").
Every article must include:
- A compelling intro paragraph
- 4-6 specific product recommendations with realistic prices in USD
- Amazon affiliate links formatted as: https://www.amazon.com/dp/ASIN?tag=${ASSOCIATE_TAG}
  Use real, valid 10-character Amazon ASINs (e.g. B07SJHVQTJ). Each product MUST have a UNIQUE ASIN.
- Pros/cons or "why we like it" for each product
- At least one FAQ section with 3 questions
- An affiliate disclosure reminder in the footer note
Write clean HTML fragments only (no <html>/<head>/<body> tags).
Use <h2>, <h3>, <p>, <ul>, <li>, <strong> tags only.
For each product recommendation, wrap in this exact structure:
<div class="product-box" data-product="PRODUCT NAME" data-asin="ASIN">
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
  <a href="https://www.amazon.com/dp/ASIN?tag=${ASSOCIATE_TAG}" class="btn-amazon" rel="nofollow sponsored noopener" target="_blank">Check Price on Amazon ↗</a>
</div>`;

  const userPrompt = `Write a comprehensive buyer's guide article titled "Best ${topic.charAt(0).toUpperCase() + topic.slice(1)} 2026".
Include 4-5 product picks across budget, mid-range, and premium tiers.
Make it around 1,200-1,500 words. Be specific with product names, prices, and real-world testing details.
Each product MUST have a unique Amazon ASIN — do NOT reuse the same ASIN for multiple products.
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
3. An og:image Unsplash URL for a high-quality overlanding/off-road photo.
   Use format: https://images.unsplash.com/photo-PHOTOID?w=1200&q=80
   Pick a relevant Unsplash photo ID for overlanding/off-road content.
Return as JSON: {"title": "...", "description": "...", "ogImage": "..."}`;

  const raw = await groqRequest([
    { role: 'system', content: 'Return only valid JSON, no markdown.' },
    { role: 'user', content: prompt },
  ]);
  try {
    const parsed = JSON.parse(raw.trim());
    if (!parsed.ogImage) {
      parsed.ogImage = 'https://images.unsplash.com/photo-1533591380348-14193f1de18f?w=1200&q=80';
    }
    return parsed;
  } catch {
    return {
      title: `Best ${topic} 2026 — Trail Built`,
      description: `Expert reviews and top picks for ${topic}. Tested in the field.`,
      ogImage: 'https://images.unsplash.com/photo-1533591380348-14193f1de18f?w=1200&q=80',
    };
  }
}

// ── HTML template ─────────────────────────────────────────────────────────────
function buildHTML({ slug, title, description, ogImage, topic, bodyHTML, date, dateHuman }) {
  const articleUrl = `${SITE_URL}/articles/${slug}.html`;
  const cleanTitle = title.replace(' - Trail Built', '').replace(' — Trail Built', '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-GX99D9KWL0"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-GX99D9KWL0');
  </script>
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${articleUrl}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${articleUrl}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
  <link rel="icon" type="image/svg+xml" href="../images/favicon.svg" />
  <link rel="preconnect" href="https://images.unsplash.com" crossorigin />
  <link rel="preconnect" href="https://m.media-amazon.com" crossorigin />
  <link rel="stylesheet" href="../css/style.css" />
  <script src="https://analytics.ahrefs.com/analytics.js" data-key="j9FlobP0cqeKUsyYo3HRlw" async></script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${escapeHtml(title)}",
    "description": "${escapeHtml(description)}",
    "image": "${escapeHtml(ogImage)}",
    "datePublished": "${date}",
    "dateModified": "${date}",
    "url": "${articleUrl}",
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${articleUrl}" },
    "author": { "@type": "Person", "name": "Trail Built Staff" },
    "publisher": {
      "@type": "Organization",
      "name": "Trail Built",
      "url": "${SITE_URL}",
      "logo": { "@type": "ImageObject", "url": "${SITE_URL}/images/favicon.svg" }
    }
  }
  <\/script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}/" },
      { "@type": "ListItem", "position": 2, "name": "Reviews", "item": "${SITE_URL}/reviews.html" },
      { "@type": "ListItem", "position": 3, "name": "${escapeHtml(cleanTitle)}", "item": "${articleUrl}" }
    ]
  }
  <\/script>
</head>
<body>

<header>
  <div class="container header-inner">
    <a href="../index.html" class="logo">Trail<span>Built</span></a>
    <nav>
      <a href="../index.html">Home</a>
      <a href="../reviews.html" class="active">Reviews</a>
      <a href="../build-guides.html">Build Guides</a>
      <a href="../quiz.html">Rig Quiz</a>
      <a href="../index.html#gear">Top Gear</a>
      <a href="../categories/recovery-gear.html" class="header-cta btn">Best Picks</a>
    </nav>
    <button class="menu-toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>
  </div>
</header>

<div class="article-header">
  <div class="container">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="../index.html">Home</a> &rsaquo;
      <a href="../reviews.html">Reviews</a> &rsaquo;
      <span>${escapeHtml(cleanTitle)}</span>
    </nav>
    <div class="article-hero">
      <div>
        <div class="article-meta-top">
          <span class="badge">Gear Guide</span>
          <span class="badge badge-green">2026</span>
          <span class="card-date">${dateHuman}</span>
        </div>
        <h1>${escapeHtml(cleanTitle)}</h1>
        <p class="article-intro">${escapeHtml(description)}</p>
        <div class="article-byline">
          <div class="avatar">&#127952;</div>
          <div class="byline-info">
            <strong>Trail Built Staff</strong>
            <span>Published ${dateHuman}</span>
          </div>
        </div>
      </div>
      <div class="article-img-hero">
        <img src="${escapeHtml(ogImage)}" alt="${escapeHtml(cleanTitle)}" width="600" height="400" loading="lazy" decoding="async" />
      </div>
    </div>
  </div>
</div>

<div class="container">
  <div class="article-layout">
    <article class="article-body">
      <div class="share-bar" data-url="${articleUrl}" data-title="${escapeHtml(title)}">
        <span class="share-label">Share:</span>
        <a class="share-btn share-twitter" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(articleUrl)}&text=${encodeURIComponent(title)}" rel="noopener" target="_blank" aria-label="Share on Twitter">&#120143;</a>
        <a class="share-btn share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(articleUrl)}" rel="noopener" target="_blank" aria-label="Share on Facebook">&#128218;</a>
        <a class="share-btn share-pinterest" href="https://pinterest.com/pin/create/button/?url=${encodeURIComponent(articleUrl)}&description=${encodeURIComponent(title)}" rel="noopener" target="_blank" aria-label="Share on Pinterest">&#128204;</a>
        <button class="share-btn share-copy" onclick="navigator.clipboard.writeText('${articleUrl}').then(function(){this.textContent='Copied!';var btn=this;setTimeout(function(){btn.textContent='&#128279;'},2000)}.bind(this))" aria-label="Copy link">&#128279;</button>
      </div>

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
        <div class="sidebar-product">
          <div class="icon">&#9889;</div>
          <div><h5><a href="best-overlanding-solar-and-power.html">Solar &amp; Power 2026</a></h5><span>16 min read</span></div>
        </div>
      </div>
      <div class="sidebar-widget" style="margin-top:1.5rem">
        <h4>Find Your Rig Profile</h4>
        <p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem">Take our 5-question quiz to get personalized gear picks for your vehicle.</p>
        <a href="../quiz.html" class="btn btn-primary" style="width:100%;text-align:center;display:block">Take the Quiz &rarr;</a>
      </div>
    </aside>
  </div>
</div>

<button class="back-to-top" aria-label="Back to top" title="Back to top">&#8679;</button>

<footer>
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="logo">Trail<span>Built</span></div>
        <p>Honest overlanding gear reviews. We test everything ourselves.</p>
        <div class="affiliate-notice"><strong>Affiliate Disclosure:</strong> TrailBuilt earns commissions from qualifying Amazon purchases. This never affects our recommendations.</div>
        <div class="footer-social">
          <a href="https://www.instagram.com/trailbuiltoverland" rel="noopener" target="_blank" aria-label="Instagram">&#128247;</a>
          <a href="https://www.youtube.com/@trailbuiltoverland" rel="noopener" target="_blank" aria-label="YouTube">&#9654;</a>
          <a href="https://www.pinterest.com/trailbuiltoverland" rel="noopener" target="_blank" aria-label="Pinterest">&#128204;</a>
        </div>
      </div>
      <div class="footer-col">
        <h4>Reviews</h4>
        <a href="best-overlanding-recovery-gear.html">Recovery Gear</a>
        <a href="best-off-road-light-bars.html">Light Bars</a>
        <a href="rooftop-tent-buying-guide.html">Rooftop Tents</a>
        <a href="best-overlanding-fridges.html">Fridges &amp; Coolers</a>
        <a href="../reviews.html">All Reviews</a>
      </div>
      <div class="footer-col">
        <h4>Build Guides</h4>
        <a href="../articles/4runner-5th-gen-overland-build-guide.html">Toyota 4Runner</a>
        <a href="../articles/ford-bronco-overland-build-guide.html">Ford Bronco</a>
        <a href="../articles/toyota-tacoma-overland-build-guide.html">Toyota Tacoma</a>
        <a href="../articles/jeep-wrangler-overland-build-guide.html">Jeep Wrangler</a>
        <a href="../build-guides.html">All Build Guides</a>
      </div>
      <div class="footer-col">
        <h4>Site</h4>
        <a href="../about.html">About</a>
        <a href="../quiz.html">Rig Quiz</a>
        <a href="../about.html#privacy">Privacy Policy</a>
        <a href="../about.html#affiliate">Affiliate Disclosure</a>
        <a href="../sitemap.xml">Sitemap</a>
      </div>
    </div>
    <div class="footer-bottom"><p>&copy; ${new Date().getFullYear()} Trail Built. All rights reserved.</p></div>
  </div>
</footer>

<script src="../js/main.js"><\/script>
<script src="../js/amazon.js"><\/script>
<script src="../js/price-history.js"><\/script>
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
function addArticleToIndex(slug, title, description, date, ogImage) {
  if (!fs.existsSync(INDEX_FILE)) return;
  let html = fs.readFileSync(INDEX_FILE, 'utf8');
  const cleanTitle = title.replace(' - Trail Built', '').replace(' — Trail Built', '');
  const card = `
      <div class="card">
        <div class="card-img">
          <img src="${ogImage}" alt="${cleanTitle.replace(/"/g, '&quot;')}" loading="lazy" decoding="async" />
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="badge">Gear Guide</span>
            <span class="card-date">${date}</span>
          </div>
          <h3><a href="articles/${slug}.html">${cleanTitle}</a></h3>
          <p>${description}</p>
          <div class="card-footer">
            <a href="articles/${slug}.html" class="read-link">Read More &rarr;</a>
            <span class="read-time">12 min</span>
          </div>
        </div>
      </div>`;

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
    <loc>${SITE_URL}/articles/${slug}.html</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
  if (sitemap.includes(`/${slug}.html`)) return;
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

  const topic     = pickTopic();
  const slug      = slugify(`best-${topic}`).replace(/^best-best-/, 'best-');
  const date      = todayISO();
  const dateHuman = todayHuman();

  console.log(`Topic: ${topic}`);
  console.log(`Slug:  ${slug}`);

  const [bodyHTML, meta] = await Promise.all([
    generateArticleContent(topic),
    generateMeta(topic),
  ]);

  const html = buildHTML({
    slug,
    title: meta.title,
    description: meta.description,
    ogImage: meta.ogImage,
    topic,
    bodyHTML,
    date,
    dateHuman,
  });

  const outPath = path.join(ARTICLES_DIR, `${slug}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`Article written: ${outPath}`);

  addArticleToIndex(slug, meta.title, meta.description, dateHuman, meta.ogImage);
  updateSitemap(slug, date);
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
