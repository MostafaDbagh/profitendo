# Service 17 — local migration rehearsal and pilot

The user confirmed local preparation only: hosting and customer exports are not
ready. Nothing has been deployed and no real customer data has been migrated.

## Implemented tools

1. **Read-only legacy export analysis.** Export v1 JSON from the existing owner's
   `/api/backup/export` route. Analyze a local copy:

   ```sh
   npm run migration:analyze -- /path/to/legacy-export.json /path/to/new-review.json
   ```

   The analyzer validates the export format and tenant IDs, inventories collections,
   hashes the source, flags SKU/quantity/price issues, and produces a private review
   file. It refuses to overwrite an existing output. It does not import credentials,
   recreate historical transactions, choose base units, choose warehouses/shops or
   write to either database. Maximum input size: 100 MB. Keep the original export
   immutable and separately backed up. Legacy exports have collection row caps;
   reconcile counts with the source database before relying on an export as complete.

2. **Opening-stock rehearsal UI.** Set up products, currency, base units, locations
   and assignments first. Use Migration & pilot checks in business-v2. Upload/paste
   `sku,quantity` CSV (up to 100 rows, 50 KB) for one chosen location. Quantities are
   positive base units. Preview changes no stock and expires after 30 minutes.
   Confirmation posts an owner-authorized immutable OPENING document with audit.
   Stock-history checks reject already-used product/location pairs. Retries cannot
   post twice. Stock movement after preview prevents overwriting live stock.

   A product's legacy total must be explicitly allocated across all destination
   locations. Reconcile the sum of allocations to its source total before posting.
   Negative legacy stock, unresolved units, duplicate SKUs and precision issues
   require correction/review. No supplier/customer opening-debt importer exists;
   do not invent receiving or sale documents to manufacture historical liabilities.
   Retain old history read-only and decide a separately reviewed balance migration.

3. **Live reconciliation screen.** Compares each scoped stock balance against the
   immutable movement sum and reports open transfers, receiving and adjustment
   drafts. A zero mismatch count is necessary, but does not certify complete source
   data, financial opening balances or production readiness. Rollout gates stay
   explicitly pending until verified in the real environment.

4. **Local backup/restore rehearsal.** PostgreSQL 16 client tools must be on PATH:

   ```sh
   TEST_DATABASE_URL=postgresql://.../profitlens_test npm run test:restore
   ```

   Accepts a loopback `_test` database only. Run when other tests/writers are stopped.
   Makes a custom-format dump in a private temporary directory, creates a random
   temporary database, restores it, compares every public table's row count and the
   schema marker, and checks immutable-history triggers. Finally removes only its
   own temporary database and dump. It never replaces the source database. Requires
   CREATE DATABASE permission on the local test server. This is not a production
   backup policy; verify encrypted backups, keys, retention and restore permissions
   separately once hosting is chosen.

5. **Automated warehouse/shop pilot.** `tests/completion.test.ts` exercises the real
   API and PostgreSQL: receive 100 bottles at a warehouse, dispatch/receive 30 into
   a shop, sell 5, accept 2 sellable returns. Final balances are warehouse 70, shop
   27, no stock in transit, and ledger reconciliation is zero. Browser tests exercise
   new forms, approvals, payments, cash closing, report export and opening import.

## Verification commands

```sh
npm run db:generate
npm run db:migrate                 # isolated rehearsal environment first
npm run typecheck
npm test
TEST_DATABASE_URL=postgresql://.../profitlens_test npm run test:integration
TEST_DATABASE_URL=postgresql://.../profitlens_test npm run test:browser:completion
TEST_DATABASE_URL=postgresql://.../profitlens_test npm run test:restore
npm run build
```

Browser checks require the frontend on localhost:3000 with the optional new API
configured as localhost:4000; the script starts a temporary test API and uses
Chrome. Scripts reject a non-test database. Frontend build runs from `frontend`.
Migration files, API/schema readiness and frontend/API configuration must match.

## Production cutover sequence — pending, not executed

- Finish paid subscription/renewal/reconciliation work in Service 5 and any required
  catalogue follow-ups in Service 7. Test provider sandbox, SMTP/MFA and ownership
  recovery before accepting subscription customers.
- Choose hosting, HTTPS origin, database region and secret storage. Configure
  production CORS, session cookies, mail delivery, rate limits, logging and health
  monitoring. Preserve the authentication encryption key with protected backups.
- Agree local fiscal/tax/e-invoicing requirements and actual receipt/terminal
  hardware. Automated browser checks do not verify a physical scanner or printer.
- Take and restore a production-like backup in an isolated environment. Confirm
  scope, row counts, ledger sums, opening liabilities and per-location allocations.
- Run a warehouse/shop pilot with actual staff roles and devices. Review sales,
  returns, damage, partial payments, cash differences and report exports with the
  business owner. Resolve discrepancies before rollout.
- During cutover, freeze legacy operational writes, take the final export/backup,
  reconcile its delta against the rehearsal, confirm allocations, post reviewed
  opening records once, and compare totals. Do not enable two systems to write the
  same stock. Preserve read-only access to legacy history.
- Have the owner accept the reconciled result, then switch the application origin
  and monitor errors, session behavior, ledger discrepancies and cash reconciliation.
- If cutover must be rolled back, stop new writes first and preserve all newly
  posted records. Reconcile those transactions before restoring/switching systems;
  never discard new sales/payments or blindly run a historical import twice.

A production rollout date cannot be asserted until these gates are complete.

## Local rehearsal evidence — 2026-11-11

- Automated warehouse/shop pilot: 70 warehouse / 27 shop / no transit.
- Stock ledger reconciliation: no mismatches in the pilot.
- Full integration suite: 159 passing tests; HTTP/provider suite: 20.
- Final completion/POS checks: 39 passing after the last timestamp correction.
- Browser workflows: both languages at 320/390/768/1024/1440; final focused
  recheck at 320/390/1440 for supplier history, count detail and Arabic dialogs.
- Backup restored 42 tables with matching counts, schema and immutable triggers.
- Synthetic legacy export CLI: one product, zero analysis issues, source unchanged;
  base units/location allocation deliberately remain unapproved.
- Frontend/backend builds and source/test/browser typechecks passed.

These are local synthetic-data results. They do not certify production hosting,
actual customer exports, hardware, fiscal compliance or paid billing readiness.


## Release preparation — 12 November 2026

Deployment templates, Docker build definitions, worker scheduling, CI checks,
encrypted-backup script and the opt-in primary-app switch are in `../deployment/`.
Read `../deployment/README.md` before using them. No live environment is configured.

`npm run migration:review -- source.json review.json new-result.json` validates
an explicitly reviewed allocation file against the immutable source SHA-256,
collection counts, currency, unique SKUs/locations and exact summed base quantities.
It refuses missing products, changed sources and duplicate allocations. It writes
only a private new report and never imports data or approves production cutover.

The review object contains sourceSha256, sourceCounts, currency, products
(`sku`, `baseUnit`, `allocations:[{locationId,quantity}]`), openingBalancesReviewed
(true), reviewedBy, and evidence references for sourceCounts, openingBalances,
hardwarePilot and fiscalRequirements. Evidence references are owner attestations;
the checker cannot verify their contents, physical stock, location ownership or
complete source exports. API opening preview/confirmation still checks live access.
There is still no automatic historical-debt or credential importer.

`npm run release:check -- --offline` checks configuration without contacting a
service; omit --offline to also check the database schema. It does not claim SMTP,
payment, backup, hardware or owner acceptance is verified. Never commit real review
files or customer exports; use protected storage outside the source tree.
