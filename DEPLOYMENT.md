# Deployment and Resend setup

The website is static except for `api/contact.js`, a Node-compatible serverless function exposed at `/api/contact` on Vercel.

## Required environment variable

- `RESEND_API_KEY`: create a restricted sending API key in Resend and store it only in the deployment platform's server-side environment settings. Never put it in `index.html`, public JavaScript, or source control.

Optional:

- `RESEND_FROM_EMAIL`: overrides the default sender, `Germany Growth Desk Website <website@send.germanygrowthdesk.com>`. Use the exact domain or subdomain verified in Resend.

## Resend preparation

1. Add and verify `send.germanygrowthdesk.com` in Resend.
2. Add the SPF and DKIM records shown by Resend to the domain's DNS.
3. If a sending subdomain is verified instead of the root domain, set `RESEND_FROM_EMAIL` to an address on that exact subdomain.
4. Add `RESEND_API_KEY` to the production and preview environments in the hosting dashboard.

## Vercel deployment

1. Import this project directory into Vercel with the repository root as the project root.
2. Do not select a frontend framework; the HTML files are served as static assets and `api/contact.js` is detected as the `/api/contact` serverless function.
3. Add the environment variables before the production deployment.
4. Deploy, then submit one test enquiry from each website language and confirm delivery to `info@germanygrowthdesk.com`.

The form cannot deliver email when `index.html` is opened directly from disk or hosted on a static-only service that does not run `/api/contact`. On another platform, deploy `api/contact.js` as an equivalent same-origin Node serverless endpoint at `/api/contact`.

## Abuse protection

The contact function applies a best-effort per-IP limit of five submissions per fifty minutes and returns HTTP `429` with `Retry-After` when exceeded. The limit is stored in each running function instance. For globally consistent limits across multiple serverless instances or high traffic, also configure rate limiting in the hosting firewall or use a shared server-side data store.

Resend setup references: <https://resend.com/docs/api-reference/emails/send-email> and <https://resend.com/docs/dashboard/domains/introduction>.
