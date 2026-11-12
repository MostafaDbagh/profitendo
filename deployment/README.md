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
