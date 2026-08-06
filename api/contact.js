const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RECIPIENT = 'info@germanygrowthdesk.com';
const DEFAULT_SENDER = 'Germany Growth Desk Website <website@send.germanygrowthdesk.com>';
const RATE_LIMIT_WINDOW_MS = 50 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_MAX_BUCKETS = 10_000;
const rateLimitBuckets = new Map();
let lastRateLimitCleanup = 0;

const SUPPORT_OPTIONS = new Set([
  'Customer Visits & Meetings',
  'Trade Fair Representation',
  'Sales Development & Customer Acquisition',
  'Local Market Representation',
  'Other'
]);

const LIMITS = {
  name: 120,
  company: 160,
  email: 254,
  industry: 180,
  support: 80,
  message: 3000,
  office_fax: 200,
  language: 2
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function normalizeBody(rawBody) {
  if (typeof rawBody === 'string') return JSON.parse(rawBody);
  if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) return rawBody;
  return {};
}

function clean(body, key) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  return value.slice(0, LIMITS[key]);
}

function hasOversizedValue(body) {
  return Object.entries(LIMITS).some(([key, limit]) =>
    typeof body[key] === 'string' && body[key].length > limit
  );
}

function isValidEmail(value) {
  return value.length <= LIMITS.email &&
    !/[\r\n]/.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function firstHeaderValue(value) {
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' ? header.split(',')[0].trim() : '';
}

function clientAddress(req) {
  return firstHeaderValue(req.headers?.['x-vercel-forwarded-for']) ||
    firstHeaderValue(req.headers?.['x-forwarded-for']) ||
    req.socket?.remoteAddress ||
    'unknown';
}

function cleanupRateLimitBuckets(now) {
  if (now - lastRateLimitCleanup < RATE_LIMIT_WINDOW_MS && rateLimitBuckets.size < RATE_LIMIT_MAX_BUCKETS) return;

  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }

  while (rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
    rateLimitBuckets.delete(rateLimitBuckets.keys().next().value);
  }
  lastRateLimitCleanup = now;
}

function checkRateLimit(req) {
  const now = Date.now();
  cleanupRateLimitBuckets(now);
  const key = clientAddress(req);
  let bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitBuckets.set(key, bucket);
  }

  const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetSeconds };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - bucket.count,
    resetSeconds
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  let body;
  try {
    body = normalizeBody(req.body);
  } catch (_error) {
    return sendJson(res, 400, { ok: false, error: 'invalid_json' });
  }

  if (JSON.stringify(body).length > 12000 || hasOversizedValue(body)) {
    return sendJson(res, 413, { ok: false, error: 'invalid_submission' });
  }

  // Honeypot submissions receive a neutral success response and are discarded.
  if (clean(body, 'office_fax')) {
    return sendJson(res, 200, { ok: true });
  }

  const rateLimit = checkRateLimit(req);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.resetSeconds));
    return sendJson(res, 429, { ok: false, error: 'rate_limited' });
  }

  const submission = {
    name: clean(body, 'name'),
    company: clean(body, 'company'),
    email: clean(body, 'email'),
    industry: clean(body, 'industry'),
    support: clean(body, 'support'),
    message: clean(body, 'message'),
    language: clean(body, 'language') || 'en'
  };

  const required = ['name', 'company', 'email', 'industry', 'support', 'message'];
  const invalid = required.some(key => !submission[key]) ||
    !isValidEmail(submission.email) ||
    !SUPPORT_OPTIONS.has(submission.support) ||
    body.privacyConsent !== true ||
    !['en', 'de', 'tr'].includes(submission.language);

  if (invalid) {
    return sendJson(res, 400, { ok: false, error: 'invalid_submission' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { ok: false, error: 'service_unavailable' });
  }

  const text = [
    'New Germany Growth Desk website enquiry',
    '',
    `Name: ${submission.name}`,
    `Company: ${submission.company}`,
    `Business email: ${submission.email}`,
    `Product / industry: ${submission.industry}`,
    `Required support: ${submission.support}`,
    `Selected website language: ${submission.language.toUpperCase()}`,
    `Privacy consent: Confirmed`,
    '',
    'Message:',
    submission.message
  ].join('\n');

  try {
    const resendResponse = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_SENDER,
        to: [RECIPIENT],
        reply_to: submission.email,
        subject: `Website enquiry — ${submission.company}`,
        text
      })
    });

    if (!resendResponse.ok) {
      return sendJson(res, 502, { ok: false, error: 'delivery_failed' });
    }

    return sendJson(res, 200, { ok: true });
  } catch (_error) {
    return sendJson(res, 502, { ok: false, error: 'delivery_failed' });
  }
}
