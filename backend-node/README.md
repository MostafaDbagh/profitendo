# ProfitLens Node API — local B2B warehouse/shop implementation

Runs alongside the legacy FastAPI/MongoDB app. New workflows are available through
the optional `/business-v2` workspace when `REACT_APP_AUTH_API_URL` is configured.
Services 1–4 and 6, 8–16 are implemented locally; billing (5) and catalogue (7)
follow-ups remain. Service 17 is locally rehearsed; hosting/customer data and
production rollout are pending by user instruction. No legacy data is overwritten.

For the latest returns/counts/payments/reports APIs see [COMPLETION_SERVICES.md](COMPLETION_SERVICES.md).
For opening-stock migration, legacy analysis, backup/restore rehearsal and cutover
gates see [ROLLOUT.md](ROLLOUT.md). Earlier module guides document their own scope.

## Setup

Use Node 22 LTS (22.12 or newer) and PostgreSQL 16.
Dependencies are locked in package-lock.json; Prisma 7.10.1 and its PostgreSQL adapter are pinned
as the initial migration toolchain. Review supported versions before production.

```sh
cd backend-node
npm ci
cp .env.example .env
# With Docker installed:
docker compose up -d postgres
npm run db:generate
npm run db:migrate
# Set AUTH_ENCRYPTION_KEY and APP_ORIGIN as documented in AUTHENTICATION.md.
npm run dev
```

Without Docker, point DATABASE_URL at a separately provisioned PostgreSQL
instance. Do not point migration/test commands at the old application's data.
The API defaults to 127.0.0.1:4000. Configure HOST explicitly for containers.

- GET /api/health/live: process liveness.
- GET /api/health/ready: real database and current schema readiness.
- Unknown routes return 404. Tenant workflows require live session and permissions.
- Error envelope: `{ error: { code }, detail, requestId }`; `detail` preserves
  compatibility with the frontend's existing error formatter.
- Request logs contain method, status, duration and server-generated request ID;
  bodies, URLs, cookies, authorization headers and database credentials are not logged.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Integration tests require a separate database name ending in `_test` and do not
silently skip if it is absent. For the local Compose database:

```sh
docker compose exec postgres createdb -U profitlens profitlens_test
DATABASE_URL='postgresql://profitlens:local-development-only@127.0.0.1:55432/profitlens_test?schema=public' npm run db:migrate
npm run test:integration
```

TEST_DATABASE_URL is read from .env. Tests use random keys and only clean up
their own rows. They verify migrations/readiness and real transaction rollback.

## Production boundary

Use a managed PostgreSQL database, secret management, HTTPS and a restricted
runtime database role. Use a separate migration role. Run `npm ci`, generate,
build, `prisma migrate deploy` in a deployment job, then `npm start`. Never run
`migrate reset` in deployment. Current Compose configuration is local-only;
production hosting/container deployment is not configured or verified yet.

Service 2 adds sessions, rate limits, CSRF checks, email verification, resets and
privileged MFA. SMTP delivery must be configured before enabling public signup. Service 3 must
resolve tenant scope from trusted memberships (never a caller-supplied business
ID alone). Plan limits must later be checked on the backend, not just in menus.

## Migration observations

The old frontend uses `/api`, cookies, `detail` errors and X-Pin-Token. The old
backend has business-scoped MongoDB records, JWT/session paths, permissions,
PayPal subscriptions/webhook handling, backups and reporting. Those contracts
need explicit mapping and regression checks per service. Do not copy raw
provider tokens into new logs. Provider, session and data cutover remain future
work. Existing global product quantities need an approved per-location opening
allocation; never invent warehouse history.
