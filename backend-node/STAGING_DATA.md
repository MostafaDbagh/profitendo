# Staging / pre-production mock data

This seed is explicitly opt-in and never runs during migrations, builds or normal
startup. It targets an **empty dedicated database**. It creates only synthetic
`DEMO` records and `@demo.example.test` accounts, with no copied customer data.

Set these environment values through a private environment file or secret store:

```
APP_ENV=staging
MOCK_DATA_ENABLED=true
DATABASE_URL=postgresql://…/your_database_staging
SEED_CONFIRM=your_database_staging
SEED_PASSWORD=<private random password, 20–128 characters>
B2B_CHECKOUT_ENABLED=false
```

For pre-production use `APP_ENV=preprod` and a database name ending `_preprod`.
Payment credentials must be absent; live mode and paid checkout are refused.
`NODE_ENV=production` is allowed for a normal production build on **staging**;
it is APP_ENV, the database target and the stored dataset marker that distinguish
staging from the real production environment. Production-named targets and
missing/mismatched environment settings are rejected.

Apply migrations, then run `npm run seed:staging` with the above variables loaded.
The command prints account emails and counts, never passwords. Use your own
strong staging password; the repository contains no default password.

A successful run writes a dataset marker. Further runs are no-ops, preserving
passwords, approvals, replies and other test changes. Existing non-seeded customer
records cause a refusal. The seed transaction rolls back on failure. No truncate,
delete-all or reset command is provided. Use a new empty staging database if a
fresh dataset is needed.

## Dataset

- 14 accounts: Super Admin, 8 owners, operations manager, warehouse staff,
  shop manager, cashier and viewer.
- 8 businesses: active trial, pending approval, approved/unpaid, rejected,
  paid/active, expired, cancelled with remaining access, and suspended.
- 16 locations: a warehouse and shop per business; location-limited staff have
  assignments in the trial business.
- 4 DEMO plans: trial, USD monthly, EUR annual, and an editable unpublished draft.
  These illustrative prices are **not approved commercial pricing**.
- 12 synthetic receipts across currencies/history. Annual-plan history uses
  annual spacing. No provider calls or actual payments occur. The revenue screen
  uses a separate mock scope and explicitly labels these as staging mock payments.
- 9 support conversations, including a public enquiry, with mixed statuses and
  replies, plus approval/billing audit examples.

This dataset covers admin/billing/support/role testing. It does not invent stock
movements, supplier invoices, POS sales or inventory balances.

The API refuses to start against a marked mock database unless the staging guards
are satisfied, including if the mock flag was removed. Do not restore this
staging database into production. Remote staging uses real authenticator MFA;
the existing `123456` shortcut remains restricted to loopback local testing.

## Prepared local staging preview

- Frontend: `http://localhost:3200/auth-v2` (`frontend: npm run start:staging`)
- API: port 4200 (`backend-node: npm run dev:staging`)
- Database: `profitlens_staging`, separate from existing preview/test databases.
- Private configuration: ignored `backend-node/.env.staging` (mode 0600).
- Private login instructions: ignored `tmp/staging-access.md` (mode 0600).

Repeat the local seed without changing existing test work:

```
node --env-file=.env.staging --import tsx scripts/seed-staging.ts
```

Guard unit tests: `tests/staging-guard.test.ts`. Local smoke check:
`node --env-file=.env.staging --import tsx scripts/staging-smoke.ts`.
