# Service 12: Sales / POS

Implemented locally on 2026-11-11. Migration `202611110014_sales` is applied to
isolated test PostgreSQL only. No production deployment or legacy data migration.

## Workflow

1. Choose an assigned, active **shop**. Warehouses cannot be a sale location.
2. Search products or scan an exact barcode. Each scan adds one base unit;
   choose an existing pack or enter a decimal quantity in the cart. A product
   may have separate base-unit and pack lines. Existing pack definitions come
   from the catalogue API; catalogue pack-management UI is still pending.
3. Review a server-priced draft. Prices always come from the product catalogue;
   no client price override is accepted. Line discounts require a permission
   and a reason. Drafts expire after 15 minutes and do not reserve stock.
4. Record money already received: cash, card through an external terminal, or
   bank transfer. This module does not charge a processor. Noncash payment must
   equal the sale total and include a reference. Cash may exceed the total;
   change is calculated by the server. Only one full payment is supported.
5. Sale completion, payment record, stock deductions and audit entry commit
   together. Completed receipts can be viewed and printed on an authenticated
   route. They cannot be edited or cancelled; returns belong to Service 13.

## Authorization and consistency

- Live session, tenant membership, suspension, MFA, location assignment and
  role checks run inside each serializable transaction. Platform Super Admin
  has no customer-data bypass. Product lookup does not expose purchase costs.
- `sales.view` reads assigned-shop history. `sales.create` creates/completes own
  drafts. `sales.discount` applies fixed line discounts. `sales.manage` allows
  working on other staff drafts, alongside `sales.create`.
- Owner/operations manager/shop manager have all four permissions by default;
  cashiers have view/create and still require a shop assignment. Warehouse
  staff and viewers have no default sales access.
- Checkout rechecks entitlement, active products/shop, quote expiration, current
  catalogue selling prices, expected total and discount permission. Changed
  prices require a new review. Editing is revision protected.
- Creation and checkout use durable client UUIDs and payload hashes. Identical
  checkout replays return the completed receipt even after trial expiry, but
  still require live authorization. Other payloads or reused payment keys fail.
- Stock uses the shared append-only ledger and locked balances, preserving
  reserved stock and preventing concurrent overselling. A mixed pack/base cart
  cannot bypass the available quantity by splitting a product across lines.
- Integer arithmetic calculates exact base quantities and line gross amounts.
  Each gross line rounds half-up to the currency's minor precision, then line
  discounts are subtracted. Totals are summed from rounded lines. Discounts and
  payment inputs must already match currency precision. Numeric limits and
  conversions requiring more than four stock decimals are rejected.
- Completed sale headers/lines and payment updates/deletions are blocked by
  database triggers. Receipts snapshot business/shop, product/unit/pack, prices,
  customer text, cashier, currency precision and timezone. Internal cost
  snapshots are never returned from POS routes.
- Active sale drafts block shop archiving. Expired drafts cannot check out until
  refreshed, and an archived shop cannot refresh or complete a draft.

## API

All paths below are under `/api/businesses/:businessId/sales`, require an
authenticated session, and send no-store headers. Writes require CSRF/origin checks.

- `GET /`: paginated history, optional status and location filters.
- `GET /products`: paginated active product lookup scoped to `locationId`, with
  search or exact barcode. Includes selling price, packs and available stock.
- `GET /:id`: authorized draft or receipt, including allowed actions.
- `POST /`: create a priced draft with `clientKey`, `locationId`, optional customer
  name/notes and lines (`productId`, optional `packId`, quantity, discount/reason).
- `PATCH /:id`: revise/reprice a draft with its current revision and line content.
- `POST /:id/cancel`: cancel a draft with revision and explicit confirmation.
- `POST /:id/checkout`: client key, revision, expected total, explicit confirmation
  and payment `{method, received, reference}`.

## UI and verification

Business-v2 adds Sales/POS, history/status filtering, queued repeated scanner
input, searchable pickers, pack selection, quantity/discount controls, saved draft
review/edit/cancel, payment entry and receipts. Print view is
`/sales-v2/:businessId/:id/receipt`. It uses the existing light slate/white/emerald
components, fonts and Arabic/English direction; inputs include useful examples.

- 16 dedicated PostgreSQL/HTTP tests cover scopes, costs, CSRF, idempotency,
  ownership, pricing/rounding, packs, discounts, payment validation, price expiry,
  stock rollback, simultaneous last-unit sales, reservations, immutable records,
  entitlement/permission revocation, three-decimal currencies, final-audit rollback,
  archiving and payment-key reuse.
- Full prior integration suite plus POS: 136 tests; HTTP/provider suite: 20 tests.
- Typechecks include source, tests and browser scripts; both production builds.
- Real-API Chrome coverage exercises mixed packs, repeated scans, cashier limits,
  cash change, failed stock deduction and recovery, manually recorded card payment,
  print media, dialog focus restoration, and Arabic/English at widths
  320/390/768/1024/1440. Artifacts: `tmp/sales-design` at repository root.

## Remaining boundaries

Online only; no offline synchronization, split/partial/credit payments, terminal
integration, cash drawer shifts, refunds, customer accounts or customer master
records. Service 15 will provide daily cash/reconciliation. No tax engine,
statutory fiscal/e-invoicing, serial/batch/expiry allocation or dedicated thermal
printer integration is included. Commercial rollout still depends on billing,
local compliance configuration, migration and pilot work tracked separately.
