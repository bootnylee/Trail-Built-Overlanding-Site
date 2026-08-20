#!/usr/bin/env node
const https = require('https');
const { loadHeroLibrary } = require('./generate-article');

function head(url) {
  return new Promise(resolve => {
    const request = https.request(url, { method: 'HEAD', timeout: 8000 }, response => {
      response.resume();
      resolve({ url, status: response.statusCode || 0 });
    });
    request.on('error', error => resolve({ url, status: 0, error: error.message }));
    request.on('timeout', () => { request.destroy(); resolve({ url, status: 0, error: 'timeout' }); });
    request.end();
  });
}

(async () => {
  const library = loadHeroLibrary();
  const urls = [...new Set(Object.values(library).flatMap(category => category.images))];
  const results = await Promise.all(urls.map(head));
  const failures = results.filter(result => result.status !== 200);
  for (const result of results) console.log(`${result.status || 'ERR'} ${result.url}${result.error ? ` (${result.error})` : ''}`);
  if (failures.length) {
    console.error(`${failures.length} curated hero URL(s) failed the liveness check.`);
    process.exit(1);
  }
  console.log(`hero liveness OK: ${results.length} unique curated URLs returned HTTP 200`);
})().catch(error => { console.error(error); process.exit(1); });
