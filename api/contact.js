const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RECIPIENT = 'info@germanygrowthdesk.com';
const DEFAULT_SENDER = 'Germany Growth Desk Website <website@send.germanygrowthdesk.com>';

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

function isValidWebsite(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (_error) {
    return false;
  }
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

  const submission = {
    name: clean(body, 'name'),
    company: clean(body, 'company'),
    email: clean(body, 'email'),
    website: clean(body, 'website'),
    country: clean(body, 'country'),
    industry: clean(body, 'industry'),
    support: clean(body, 'support'),
    message: clean(body, 'message'),
    language: clean(body, 'language') || 'en'
  };

  const required = ['name', 'company', 'email', 'country', 'industry', 'support', 'message'];
  const invalid = required.some(key => !submission[key]) ||
    !isValidEmail(submission.email) ||
    !isValidWebsite(submission.website) ||
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
    `Website: ${submission.website || 'Not provided'}`,
    `Country: ${submission.country}`,
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
