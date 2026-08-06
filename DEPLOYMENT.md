# Cloudflare Pages deployment and Resend setup

The website is static except for `functions/api/contact.js`. Cloudflare Pages file-based routing deploys that file as the `/api/contact` Function.

## Required secret

- `RESEND_API_KEY`: create a restricted sending API key in Resend and store it as an encrypted Cloudflare Pages secret. The Function reads it only from `context.env.RESEND_API_KEY`.

Never put the key in `index.html`, public JavaScript, a Wrangler `vars` block, GitHub, or another committed file. Local development may use the Git-ignored `.env.local` file.

## Cloudflare Pages project settings

1. Keep the Pages project root set to this repository root. If Cloudflare is configured with a root subdirectory, `functions/api/contact.js` must be inside that configured project root.
2. Use the existing static-site build settings. If no build command is needed, leave it blank and make sure the build-output directory contains `index.html`, `privacy.html`, the CSS files, `favicon.svg`, and `fonts/`.
3. Do not move `functions/` into the static build-output directory. It belongs at the Pages project root.
4. No custom `_routes.json` or `_redirects` file is required for `/api/contact`. If one is added later, ensure it includes `/api/*` and does not rewrite `/api/contact` to `index.html`.
5. In **Workers & Pages → your Pages project → Settings → Variables and Secrets**, add `RESEND_API_KEY` as an encrypted Production secret. Add a Preview secret too if preview deployments should send mail.
6. Trigger a new deployment after adding or changing a secret.

## Resend preparation

1. Verify `send.germanygrowthdesk.com` in the same Resend account that owns the API key.
2. Keep the sender fixed as `Germany Growth Desk Website <website@send.germanygrowthdesk.com>`.
3. Confirm successful or rejected deliveries in Resend's email logs.

## Local development

- `npm run dev` starts the lightweight local server at `http://127.0.0.1:4178` and executes the same Cloudflare Function module.
- `npm run dev:cloudflare` runs the site and Pages Function through Wrangler at `http://localhost:8788`.
- `.env.local` and `.dev.vars*` are ignored by Git. Do not commit either file.

The form cannot deliver email if it is opened directly from disk or served by a static-only server that does not execute Pages Functions.

## Abuse protection

The Function applies a best-effort per-IP limit of five submissions per fifty minutes and returns HTTP `429` with `Retry-After` when exceeded. The limit is stored in each running Function isolate. For globally consistent limits across isolates or high traffic, also configure Cloudflare rate limiting or use a shared server-side data store.

## Production diagnostics

Cloudflare Function logs can be viewed from the deployment's Functions/logs view in the Cloudflare dashboard. They can also be streamed with:

```bash
npx wrangler pages deployment tail --project-name YOUR_PROJECT_NAME --environment production
```

The Function logs only safe diagnostic fields such as the upstream HTTP status and Cloudflare Ray ID. It does not log submitted form data or the API key.

In Resend, open **Logs → Emails** and compare the request time, recipient, sender domain, and delivery status. A Cloudflare `502 DELIVERY_FAILED` normally corresponds to a rejected or failed Resend API request.

References: <https://developers.cloudflare.com/pages/functions/routing/>, <https://developers.cloudflare.com/pages/functions/bindings/>, <https://developers.cloudflare.com/pages/functions/local-development/>, <https://resend.com/docs/api-reference/emails/send-email>.
