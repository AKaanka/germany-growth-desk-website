const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RECIPIENT = 'info@germanygrowthdesk.com';
const SENDER = 'Germany Growth Desk Website <website@send.germanygrowthdesk.com>';
const MAX_REQUEST_BYTES = 16_000;
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
  website: 300,
  country: 100,
  industry: 180,
  objective: 1000,
  german_market_objective: 1000,
  germanMarketObjective: 1000,
  support: 80,
  message: 3000,
  office_fax: 200,
  language: 2
};

const SINGLE_LINE_FIELDS = [
  'name',
  'company',
  'email',
  'website',
  'country',
  'industry',
  'support',
  'language'
];

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

function errorResponse(status, code, message, extraHeaders = {}) {
  return jsonResponse(status, { success: false, code, message }, extraHeaders);
}

function clean(body, key) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  return value.slice(0, LIMITS[key]);
}

function cleanSingleLine(body, key) {
  return clean(body, key).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function hasOversizedValue(body) {
  return Object.entries(LIMITS).some(([key, limit]) =>
    typeof body[key] === 'string' && body[key].length > limit
  );
}

function hasUnsafeSingleLineValue(body) {
  return SINGLE_LINE_FIELDS.some(key =>
    typeof body[key] === 'string' && /[\u0000-\u001f\u007f]/.test(body[key])
  );
}

function isValidEmail(value) {
  return value.length <= LIMITS.email &&
    !/[\r\n]/.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidWebsite(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function clientAddress(request) {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
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

function checkRateLimit(request) {
  const now = Date.now();
  cleanupRateLimitBuckets(now);
  const key = clientAddress(request);
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

async function parseJsonBody(request) {
  const declaredLength = Number.parseInt(request.headers.get('Content-Length') || '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return { error: 'too_large' };
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { error: 'invalid_json' };
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return { error: 'too_large' };
  }

  try {
    const body = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_json' };
    return { body };
  } catch (_error) {
    return { error: 'invalid_json' };
  }
}

function optionalObjective(body) {
  return clean(body, 'objective') ||
    clean(body, 'german_market_objective') ||
    clean(body, 'germanMarketObjective');
}

function formatEmailText(submission) {
  const lines = [
    'New Germany Growth Desk website enquiry',
    '',
    `Name: ${submission.name}`,
    `Company: ${submission.company}`,
    `Business email: ${submission.email}`
  ];

  if (submission.website) lines.push(`Website: ${submission.website}`);
  if (submission.country) lines.push(`Country: ${submission.country}`);
  lines.push(`Product / industry: ${submission.industry}`);
  if (submission.objective) lines.push(`German market objective: ${submission.objective}`);
  lines.push(
    `Required support: ${submission.support}`,
    `Selected website language: ${submission.language.toUpperCase()}`,
    'Privacy consent: Confirmed',
    '',
    'Message:',
    submission.message
  );

  return lines.join('\n');
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Allow': 'POST, OPTIONS',
        'Cache-Control': 'no-store'
      }
    });
  }

  if (request.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST requests are accepted.', {
      'Allow': 'POST, OPTIONS'
    });
  }

  const parsed = await parseJsonBody(request);
  if (parsed.error === 'too_large') {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'The submission is too large.');
  }
  if (parsed.error) {
    return errorResponse(400, 'INVALID_JSON', 'The request body must be valid JSON.');
  }

  const body = parsed.body;
  if (hasOversizedValue(body)) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'The submission is too large.');
  }

  // Honeypot submissions receive a neutral success response and are discarded.
  if (clean(body, 'office_fax')) {
    return jsonResponse(200, { success: true });
  }

  const rateLimit = checkRateLimit(request);
  const rateLimitHeaders = {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(rateLimit.remaining)
  };
  if (!rateLimit.allowed) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many submissions. Please try again later.', {
      ...rateLimitHeaders,
      'Retry-After': String(rateLimit.resetSeconds)
    });
  }

  const submission = {
    name: cleanSingleLine(body, 'name'),
    company: cleanSingleLine(body, 'company'),
    email: clean(body, 'email'),
    website: cleanSingleLine(body, 'website'),
    country: cleanSingleLine(body, 'country'),
    industry: cleanSingleLine(body, 'industry'),
    objective: optionalObjective(body),
    support: cleanSingleLine(body, 'support'),
    message: clean(body, 'message'),
    language: cleanSingleLine(body, 'language') || 'en'
  };

  const required = ['name', 'company', 'email', 'industry', 'support', 'message'];
  const invalid = required.some(key => !submission[key]) ||
    hasUnsafeSingleLineValue(body) ||
    !isValidEmail(submission.email) ||
    !isValidWebsite(submission.website) ||
    !SUPPORT_OPTIONS.has(submission.support) ||
    body.privacyConsent !== true ||
    !['en', 'de', 'tr'].includes(submission.language);

  if (invalid) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Please review the submitted fields.', rateLimitHeaders);
  }

  if (!env?.RESEND_API_KEY) {
    console.error('Contact form configuration error: RESEND_API_KEY binding is missing.');
    return errorResponse(500, 'SERVICE_UNAVAILABLE', 'The enquiry service is temporarily unavailable.', rateLimitHeaders);
  }

  try {
    const resendResponse = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        from: SENDER,
        to: [RECIPIENT],
        reply_to: submission.email,
        subject: `Website enquiry — ${submission.company}`,
        text: formatEmailText(submission)
      })
    });

    if (!resendResponse.ok) {
      console.error('Resend rejected a contact-form delivery.', {
        status: resendResponse.status,
        cfRay: request.headers.get('CF-Ray') || 'unavailable'
      });
      return errorResponse(502, 'DELIVERY_FAILED', 'The enquiry could not be delivered.', rateLimitHeaders);
    }

    return jsonResponse(200, { success: true }, rateLimitHeaders);
  } catch (error) {
    console.error('Contact-form delivery request failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      cfRay: request.headers.get('CF-Ray') || 'unavailable'
    });
    return errorResponse(502, 'DELIVERY_FAILED', 'The enquiry could not be delivered.', rateLimitHeaders);
  }
}
