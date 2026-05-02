// TrailBuiltOverland.com — Search Engine Sitemap Ping Script
// Notifies Google and Bing of sitemap updates after weekly content additions.
// Run automatically by GitHub Actions after each weekly update.

const SITEMAP_URL = "https://trailbuiltoverland.com/sitemap.xml";
const SITE_URL    = "https://trailbuiltoverland.com";

const PING_URLS = [
  `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
  `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
];

async function pingSitemap(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok || response.status === 200) {
      console.log(`✅ Pinged: ${new URL(url).hostname} (${response.status})`);
    } else {
      console.log(`⚠️  ${new URL(url).hostname} responded with ${response.status}`);
    }
  } catch (err) {
    console.log(`❌ Failed to ping ${new URL(url).hostname}: ${err.message}`);
  }
}

async function pingIndexNow() {
  // IndexNow protocol — supported by Bing, Yandex, and others
  // Requires INDEXNOW_KEY env variable and a key file at the site root
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.log("ℹ️  INDEXNOW_KEY not set — skipping IndexNow ping");
    return;
  }

  const payload = {
    host: "trailbuiltoverland.com",
    key,
    keyLocation: `${SITE_URL}/${key}.txt`,
    urlList: [
      SITE_URL,
      `${SITE_URL}/reviews.html`,
      `${SITE_URL}/build-guides.html`,
      `${SITE_URL}/quiz.html`,
      `${SITE_URL}/categories/recovery-gear.html`,
      `${SITE_URL}/categories/sleeping-camp.html`,
      `${SITE_URL}/categories/lighting.html`,
      `${SITE_URL}/categories/water-power.html`,
      `${SITE_URL}/categories/navigation.html`,
      `${SITE_URL}/categories/tools-safety.html`,
      `${SITE_URL}/categories/suspension-lift.html`,
      `${SITE_URL}/categories/bumpers-armor.html`,
    ],
  };

  try {
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok || response.status === 200 || response.status === 202) {
      console.log(`✅ IndexNow ping successful (${response.status})`);
    } else {
      console.log(`⚠️  IndexNow responded with ${response.status}`);
    }
  } catch (err) {
    console.log(`❌ IndexNow ping failed: ${err.message}`);
  }
}

async function main() {
  console.log("\n🔍 Pinging search engines with updated sitemap...");
  console.log(`   Sitemap: ${SITEMAP_URL}\n`);
  await Promise.all(PING_URLS.map(pingSitemap));
  await pingIndexNow();
  console.log("\n✅ Search engine ping complete\n");
}

main();
