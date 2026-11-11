# Profitendo

Bilingual Arabic/English B2B warehouse and shop management, with business-scoped
roles, purchasing, stock transfers, POS, returns, counts, payments and reports.

## Repository structure

- `frontend/`: React application and shared Tailwind design components.
- `backend-node/`: Express/TypeScript API, Prisma schema, PostgreSQL migrations and tests.
- `backend/`: legacy FastAPI/MongoDB backend, retained during migration.
- `memory/`: implementation progress and design-system decisions.

Frontend and backend live together but can be deployed independently. This is a
locally verified implementation; paid billing/catalogue follow-ups and production
rollout remain pending. See [service progress](memory/SERVICE_PROGRESS.md).

## Local development

Use Node 22 and PostgreSQL 16 for the new API. Start with the
[backend setup guide](backend-node/README.md), copy `.env.example` to your private
`.env`, configure credentials, generate Prisma and apply migrations to your local
database. Never commit `.env` or database backups.

For the frontend, install using `frontend/yarn.lock`, configure
`REACT_APP_AUTH_API_URL=http://localhost:4000`, and run the package's start command.
The new workspace is `/business-v2`; legacy screens continue to use their existing
backend configuration. Follow `frontend/package.json` for available scripts.

## Verification and rollout

- [Authentication](backend-node/AUTHENTICATION.md)
- [Business roles and access](backend-node/BUSINESS_ACCESS.md)
- [Sales/POS](backend-node/SALES.md)
- [Returns, counts, payments and reports](backend-node/COMPLETION_SERVICES.md)
- [Migration rehearsal, backup/restore and rollout](backend-node/ROLLOUT.md)

The PostgreSQL integration/browser scripts require a separate database ending in
`_test`; do not run them against customer data. Legacy tests that log in to seeded
accounts read `LEGACY_TEST_ADMIN_PASSWORD` or `LEGACY_TEST_EMPLOYEE_PASSWORD` from
the environment; their fallback is intentionally a local-only placeholder.

Keep secrets, cookies, generated screenshots, logs, recordings, dependencies and
build output outside Git. Source, tests, migrations, example configuration and
lockfiles are versioned.
