#!/usr/bin/env node
/**
 * Amazon Creators API verifier for pre-publish ASIN checks.
 *
 * A listing is LIVE only when GetItems returns an item. Authentication failures,
 * throttling, empty results, transport failures, and malformed responses are all
 * INCONCLUSIVE so callers preserve a fail-closed publication gate without treating
 * bot-block or transient API evidence as proof that a product is dead.
 */

const https = require('https');

const MARKETPLACE = 'www.amazon.com';
const LWA_SCOPE = 'creatorsapi::default';
const COGNITO_SCOPE = 'creatorsapi/default';
const REQUEST_INTERVAL_MS = 1000;
const LOOKUP_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCreatorsCredentials(env = process.env) {
  return {
    clientId: env.CREATORS_API_CLIENT_ID || env.CREATORS_CREDENTIAL_ID || '',
    clientSecret: env.CREATORS_API_CLIENT_SECRET || env.CREATORS_CREDENTIAL_SECRET || '',
    partnerTag: env.CREATORS_API_PARTNER_TAG || env.AMAZON_ASSOCIATE_TAG || 'trailbuiltove-20',
  };
}

function requestHttps({ hostname, path, method = 'POST', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method,
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 12000,
      },
      res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: raw }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function apiReason(response) {
  const body = parseJson(response.body);
  const firstError = Array.isArray(body.errors) ? body.errors[0] : null;
  return firstError?.code || firstError?.message || body.code || body.error || `HTTP ${response.status}`;
}

function createAsinVerifier({
  credentials = getCreatorsCredentials(),
  request = requestHttps,
  sleepFn = sleep,
  now = () => Date.now(),
  logger = console,
  requestIntervalMs = REQUEST_INTERVAL_MS,
  lookupAttempts = LOOKUP_ATTEMPTS,
  retryBackoffMs = RETRY_BACKOFF_MS,
} = {}) {
  let tokenCache = { token: '', expiresAt: 0 };
  let lastApiRequestAt = 0;

  async function post(hostname, path, headers, body) {
    return request({ hostname, path, method: 'POST', headers, body });
  }

  async function getAccessToken() {
    if (tokenCache.token && now() < tokenCache.expiresAt - 60000) {
      return tokenCache.token;
    }

    const cacheToken = (response, generation) => {
      const payload = parseJson(response.body);
      if (response.status < 200 || response.status >= 300 || !payload.access_token) {
        const error = new Error(`${generation} token exchange failed: ${apiReason(response)}`);
        error.code = payload.error || '';
        throw error;
      }
      tokenCache = {
        token: payload.access_token,
        expiresAt: now() + Math.max(60, payload.expires_in || 3600) * 1000,
      };
      return tokenCache.token;
    };

    try {
      const response = await post(
        'api.amazon.com',
        '/auth/o2/token',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          grant_type: 'client_credentials',
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scope: LWA_SCOPE,
        })
      );
      return cacheToken(response, 'LwA v3');
    } catch (v3Error) {
      const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
      try {
        const response = await post(
          'creatorsapi.auth.us-east-1.amazoncognito.com',
          '/oauth2/token',
          {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
          `grant_type=client_credentials&scope=${encodeURIComponent(COGNITO_SCOPE)}`
        );
        return cacheToken(response, 'Cognito v2');
      } catch (v2Error) {
        throw new Error(`Creators API authentication was inconclusive after LwA v3 and Cognito v2: ${v3Error.message}; ${v2Error.message}`);
      }
    }
  }

  async function pace() {
    const waitMs = requestIntervalMs - (now() - lastApiRequestAt);
    if (waitMs > 0) await sleepFn(waitMs);
    lastApiRequestAt = now();
  }

  async function lookupOnce(asin) {
    await pace();
    const token = await getAccessToken();
    const response = await post(
      'creatorsapi.amazon',
      '/catalog/v1/getItems',
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-marketplace': MARKETPLACE,
      },
      JSON.stringify({
        itemIds: [asin],
        itemIdType: 'ASIN',
        marketplace: MARKETPLACE,
        partnerTag: credentials.partnerTag,
        partnerType: 'Associates',
        resources: ['itemInfo.title'],
      })
    );
    const payload = parseJson(response.body);
    const items = payload?.itemResults?.items || payload?.itemsResult?.items || [];
    if (response.status >= 200 && response.status < 300 && items.length > 0) {
      return {
        status: 'LIVE',
        source: 'creators_api',
        title: items[0]?.itemInfo?.title?.displayValue || '',
        reason: '',
      };
    }
    return {
      status: 'INCONCLUSIVE',
      source: 'creators_api',
      title: '',
      reason: response.status === 429 ? 'Creators API throttled the lookup' : (items.length === 0 ? 'No items returned' : apiReason(response)),
    };
  }

  async function verifyAsin(asin) {
    if (!/^[A-Z0-9]{10}$/.test(asin || '')) {
      return { status: 'INCONCLUSIVE', source: 'input', title: '', reason: 'Invalid ASIN format' };
    }
    if (!credentials.clientId || !credentials.clientSecret || !credentials.partnerTag) {
      return { status: 'INCONCLUSIVE', source: 'creators_api', title: '', reason: 'Creators API credentials are unavailable' };
    }

    let lastResult = { status: 'INCONCLUSIVE', source: 'creators_api', title: '', reason: 'Creators API lookup unavailable' };
    for (let attempt = 1; attempt <= lookupAttempts; attempt++) {
      try {
        lastResult = await lookupOnce(asin);
        if (lastResult.status === 'LIVE') return { ...lastResult, attempts: attempt };
      } catch (error) {
        lastResult = {
          status: 'INCONCLUSIVE',
          source: 'creators_api',
          title: '',
          reason: `Creators API request failed: ${error.message}`,
        };
      }
      if (attempt < lookupAttempts) {
        logger.warn(`[asin-precheck] ${asin}: ${lastResult.reason}; retrying ${attempt + 1}/${lookupAttempts}.`);
        await sleepFn(retryBackoffMs * attempt);
      }
    }
    return { ...lastResult, attempts: lookupAttempts };
  }

  return { verifyAsin };
}

module.exports = {
  createAsinVerifier,
  getCreatorsCredentials,
  requestHttps,
};
