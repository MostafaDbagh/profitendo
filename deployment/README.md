# Local release preparation

No hosting, provider account, SMTP, real export or production deployment has been
configured. The following is an executable deployment template, not rollout evidence.

## Hosting and environment

Use a Linux Docker host with a managed PostgreSQL 16 database and an HTTPS domain.
Copy backend-node/.env.example to deployment/.env (ignored by Git). Set NODE_ENV to
production, HOST to 0.0.0.0, DATABASE_URL to the managed database, APP_DOMAIN to the
chosen host, and APP_ORIGIN/CORS_ORIGINS to its exact https origin. Configure a
unique encryption key and SMTP values. Back up the encryption key separately.
Keep B2B_CHECKOUT_ENABLED=false until pricing and actual sandbox tests are approved.
Use a separate staging database/origin; never point automated tests at production.

From deployment/ run `docker compose config --quiet`, then `docker compose build`.
Before first start, apply reviewed migrations with
`docker compose run --rm api npm run db:migrate`. Run the configuration/database
check using `docker compose run --rm api npx tsx scripts/release-check.ts`.
Bootstrap the first Super Admin through the existing admin:bootstrap CLI with
secure environment input, then enroll MFA. Start with `docker compose up -d`.
Only the edge proxy publishes ports; Caddy manages HTTPS. The frontend is built
with REACT_APP_B2B_PRIMARY=true and uses the same HTTPS origin for the new API.

The worker runs mail delivery, expired-import cleanup, and—when configured—PayPal
webhooks, cancellation and reconciliation. Its heartbeat becomes unhealthy if a
job fails. Configure an external alert for unhealthy containers and failed jobs;
Docker health checks alone do not notify an operator or restart unhealthy services.
Monitor /api/health/ready, structured API errors, payment REVIEW items, overdue mail
and reconciliation failures. Never include credentials in log collectors.

## Backups

Prefer managed encrypted PostgreSQL backups and point-in-time recovery. For a
separate archive, install PostgreSQL 16 client tools and age on the backup host.
Run `bash deployment/backup.sh` with DATABASE_URL, BACKUP_DIR and BACKUP_RECIPIENT
in protected environment input. The archive is encrypted before being written.
Schedule nightly and alert on failure; upload to protected off-host storage with
versioning and a retention policy. The script does not delete older backups.
Restore an archive into a NEW isolated database and verify table counts, ledger
reconciliation, schema version and MFA key recovery before accepting customers.
The age private identity must be kept separately. No production restore has run.

## Cutover and rollback

REACT_APP_B2B_PRIMARY=true switches the built frontend to the new auth/workspace,
including visits to old routes; default development behavior remains unchanged.
Use a separate restricted legacy origin for history. Set LEGACY_READ_ONLY=true in
the old backend at cutover to reject writes except login/logout/PIN verification.
This is an application-level guard: stop old background writers and use a read-only
legacy database account where possible. Reconcile/cancel old subscriptions first;
legacy webhook writes are also frozen. Do not leave two stock writers active.

Before switching traffic, run the real export review, opening balance review,
physical staff/scanner/printer pilot, fiscal review and owner acceptance described
in backend-node/ROLLOUT.md. For rollback stop new writes, preserve new transactions,
reconcile deltas, then switch traffic; never blindly restore over new sales.

## CI

.github/workflows/verify.yml builds both applications and runs the isolated backend
suite on PostgreSQL. It does not deploy, enable billing, or access customer data.
Container runtime checks still require Docker; Docker is unavailable on this
workstation, so image build and compose start must be verified on staging.

## Security boundaries

The edge supplies CSP, frame denial and HSTS for the frontend and API. Frontend
HTML no longer loads the external Emergent/PostHog tracking scripts. CSP assumes
the documented same-origin API deployment; do not loosen script-src to restore
tracking. Inline styles and Google Fonts remain allowed for existing UI styling.

Compose pins the edge to 172.30.86.2 and trusts only that address in the API.
Do not publish the API port or set trust proxy to true/hop counts. If this subnet
conflicts with your host, change the subnet, edge address and TRUST_PROXY_IP
together. Direct local development trusts no proxy. An additional CDN requires
an explicit, separately reviewed forwarding configuration.

The API allows 600 requests/minute/IP per process before body parsing, with a
bounded 10,000-address map. Expensive reports, insights, exports and imports also
use the shared database limiter at 30 requests/minute/authenticated user.
Responses include Retry-After. These are application safeguards, not volumetric
DDoS protection; validate limits under realistic shared-store/NAT traffic before
launch. Liveness is exempt; readiness remains limited.


## Email and OTP configuration

See [the service setup guide](../backend-node/SERVICES_SETUP.md) for SMTP fields, the no-send connection check, and local/production commands. Authenticator-app OTP is built in; set `AUTH_OTP_PROVIDER=authenticator` and `AUTH_MOCK_OTP=false`. The API and worker validate the same email settings; production fails startup if they are missing or invalid. The jobs service prepares closing reports before delivering mail. Restart/recreate both API and worker after environment changes.

## Public SEO build and crawler responses

`frontend`'s normal `npm run build` / `yarn build` now runs a build-time renderer
using the existing webpack/Babel/React dependencies. Docker's existing `yarn build`
step includes it automatically; no headless browser, API credentials or customer data
are required to build. The renderer uses the actual public page components and
translations, rather than maintaining a separate crawler-only version.

Eight public HTML pages are generated: Arabic `/`, `/features`, `/pricing`, `/about`
and English `/en`, `/en/features`, `/en/pricing`, `/en/about`. Initial HTML includes
page text, language/direction, canonical and reciprocal language links, Open Graph,
Twitter cards and JSON-LD. `sitemap.xml` is generated from the same route list;
no artificial last-modified dates are emitted. `llms.txt` and `product-overview.md`
are public text resources, not access controls or indexing guarantees.

The established canonical origin is `https://profitendo.com` in
`frontend/src/lib/siteMetadata.js`, `robots.txt` and LLM documentation. If the public
domain changes, update these together before release. Do not ship an alternate
production host while leaving canonical URLs pointing at a different domain.

The nginx configuration serves slashless public paths directly, redirects their
trailing-slash/index.html variants, serves a generic noindex `app.html` for account
and operational routes, and returns real 404 responses for unknown pages and assets.
Private APIs still enforce authentication/tenant boundaries; robots/noindex are not
security controls. Service-worker v5 caches public HTML by exact language/path,
never API/account responses or token-bearing query URLs; only a generic private
shell is retained for offline navigation.

Validation from `frontend/`:

```sh
npm run build
npm run test:seo:build
npm run test:seo:browser
```

The browser check requires this repository's `backend-node` Playwright dependency
and local Chrome; it uses an isolated temporary static server. It verifies all eight
raw HTML pages, content/FAQ without JavaScript, private/404 fixture directives and
client-side language navigation. Source checks cover JSON-LD, sitemap and negative
service-worker caching cases. These local checks do not execute nginx or Docker.
Before deployment, run the actual image's `nginx -t` and check HTTP 200/308/404,
`Content-Type`, `X-Robots-Tag`, canonical and social-preview URLs on the deployed host.
Submit the production sitemap in verified search-engine webmaster accounts only
once the public deployment is ready; no such submission has been performed here.
