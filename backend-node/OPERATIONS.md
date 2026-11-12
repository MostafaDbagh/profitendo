# Services 8–10: inventory, suppliers, purchasing and receiving

Implemented in the optional /business-v2 workspace. Existing operational pages
continue to use the legacy backend. These services introduced migration 012; deploy all subsequent migrations required by API readiness.
No customer data migration or production deployment is included.

## Data and authorization

Stock balances are keyed by business + location + product, never stored globally
on products. onHand and reserved are numeric(18,4); available = onHand - reserved.
Database checks enforce 0 <= reserved <= onHand. New products have no stock row
until their first movement. Reservations have no public write workflow yet;
sales/reservation workflows belong to later services.

Every posting uses the internal postStock function in the caller's serializable
transaction. It validates exact decimal quantities, locks the balance, checks
available stock and overflow, changes the balance and inserts a unique source-line
movement. No arbitrary stock-write HTTP endpoint is exposed. PostgreSQL rejects
UPDATE/DELETE of movement history. Source ID, line ID, reference, employee ID,
posting time, notes and signed quantity are retained. Internal negative posting is
tested with concurrent depletion; no sales/POS interface is being claimed here.

Location authorization is live inside every transaction, including replay. Owners
and permitted operations managers can access all locations; assigned staff see
only assigned locations. Super Admin has no customer-data bypass. Inventory reads
also work for accessible archived locations. Location archiving now rejects
nonzero stock/reservations or open purchase/receiving documents.

New permissions:
- inventory.view: owner, operations manager, warehouse staff, shop manager, viewer.
- suppliers.view: owner, operations manager, warehouse staff, shop manager.
- suppliers.manage: owner and operations manager.
- purchasing.view: owner, operations manager, warehouse staff, shop manager.
- purchasing.manage: owner and operations manager.
- receiving.create: owner, operations manager, warehouse staff, shop manager.
- receiving.confirm: owner and operations manager.

Owners can configure non-owner overrides. Catalogue cost permission controls
purchase costs and total values in all document responses and forms. Staff without
it cannot submit a cost. Direct receiving defaults to catalogue cost; linked
receiving defaults to the approved order's cost. Draft edits preserve existing
line costs when the caller cannot view/change them. General audit entries contain
status, identifiers and field names, not financial values.

## Supplier records

Tenant-unique immutable code; name, contact person, phone, email, address, notes,
active state and revision. Deactivation preserves history and blocks submitting
or confirming documents until reactivated. Historical supplier/location/product
names are snapshotted on documents. Supplier history links to scoped purchase
documents; returns will join this history when Service 13 is implemented.

## Purchase and receipt documents

Documents contain generated unique reference, supplier/location/currency
snapshots, actual document date, supplier reference, notes, preparer and confirmer.
Lines snapshot product ID/SKU/name/unit/barcodes, pack factor/name when used,
entered quantity, base quantity and cost per BASE unit. Amounts are calculated
with integer arithmetic at up to eight decimals; UI trims redundant trailing
zeros without rounding. Costs do not overwrite catalogue prices.

Creation requires a client UUID. Identical retries return the original document;
a different payload with the same key returns IDEMPOTENCY_CONFLICT. Draft edits
and transitions require a revision. Product/location/supplier/entitlement and
purchase-order remaining quantities are rechecked before posting.

Orders: DRAFT -> OPEN -> PARTIAL -> RECEIVED. DRAFT, OPEN and PARTIAL orders can
be cancelled to close remaining work, but outstanding draft/pending receipts
must be cancelled first. Cancellation never reverses previously received stock.

Receipts: DRAFT -> PENDING -> COMPLETED; PENDING may return to DRAFT.
DRAFT/PENDING may be cancelled. Neither saving nor submitting increases stock.
Completed receipts cannot be edited/cancelled. Corrections will use linked
reversals/returns in later services, not edits to stock history.

Confirmation atomically:
1. Reauthorizes the current user and location.
2. Checks supplier/product activity, entitlement and remaining ordered quantity.
3. Posts each line to the stock ledger/balance.
4. Updates partial/full order progress, if linked.
5. Marks the receipt complete with employee/time and appends an audit entry.

Retries/concurrent confirmations return the durable completed document without
reposting. Completed replay still requires live permission/location access but
works after trial expiry. Multiple concurrent deliveries cannot over-receive an
order. Any later failure rolls back stock, movements, order progress and status.
Posted time is server time; document date records the delivery date separately.

## HTTP routes

All paths below start /api/businesses/:businessId/operations.
Session/MFA, origin, CSRF on writes, no-store and strict schema checks apply.

- GET /suppliers?page=&search=&state=active|inactive|all
- POST /suppliers
- PATCH /suppliers/:id (revision required)
- GET /inventory?locationId=&view=balances|movements&page=&search=
- GET /purchases?kind=ORDER|RECEIPT&page=&supplierId=&locationId=&status=
- GET /purchases/:id
- POST /purchases
- PATCH /purchases/:id (draft lines/date/notes/reference, revision required)
- POST /purchases/:id/status {revision,action,confirm:true}
  action: submit, reopen, confirm, cancel.

Documents contain 1–100 unique products; quantities must be positive decimal
strings with at most four fractional digits. Zero/fractional-overprecision,
overflow, duplicate products and foreign-tenant references are rejected. A single
receipt can link to one order with matching supplier and location. Receipt lines
may omit ordered products for a partial delivery. Over-delivery is rejected.

## UI and verification

Bilingual supplier CRUD/history, location stock/movement views, paginated/searchable
pickers, purchase orders, direct/linked receipt drafts and review/confirmation.
Keyboard-style barcode scanners and manual entry are supported. Single-scan mode
focuses quantity; repeated-scan mode queues requests and increases an existing
line by one base unit, then restores scanner focus. Product name/SKU/barcode
search provides a fallback. UI quantities and costs use base units explicitly;
API callers may supply an existing packId. Quantities total separately by unit.
Record pickers paginate rather than silently restricting to the first 25 records.

Regression tests use an isolated _test PostgreSQL database. Test cleanup disables
the stock-history trigger only inside a table-locking cleanup transaction, deletes
only that test's tenant fixtures and restores the trigger; application code has
no such escape hatch. Fault-injection triggers are removed in finally blocks.

Tests cover concurrent confirmation, over-receiving, negative-stock prevention,
transaction rollback after ledger writes, tenant/location/role/cost boundaries,
client-key conflicts, revision conflicts, snapshot retention, lifecycle and archive
guards. Real browser tests cover supplier creation, both scan modes, draft/pending
no-stock behavior, receipt posting, partial orders, staff cost privacy, and AR/EN
responsive layouts. Physical HID hardware still needs pilot verification.

## Remaining scope

Transfers are now implemented in Service 11 (see TRANSFERS.md). Services 12–17 provide POS, returns/reversals, counts/damage, payments,
reports and migration/pilot. This batch does not implement payments, tax handling,
valuation reports, serial/batch/expiry tracking, offline posting or supplier return
documents. Service 7 images, managed categories/units and pack UI remain separately
pending. Billing lifecycle and commercial rollout gates remain unchanged.

### Configurable sales tax

Business Settings exposes `salesTaxRate` (0–100%, up to four decimal places).
Only members with `business.edit` can update it through the revision-checked,
audited business PATCH endpoint. Zero disables tax and is the migration default
for existing businesses and historical documents.

Prices are tax-exclusive. Sales calculate tax after each line's discount, round
half-up at the sale currency's precision, and snapshot the rate and line/document
tax amounts. New and repriced drafts use the current setting; an existing quote
keeps its rate until repriced, and completed receipts never change. Checkout and
payments use the tax-inclusive total. Customer returns allocate original tax
cumulatively across refunds; estimated profit excludes collected tax and adds
back returned tax. This setting is for business sales, not platform subscriptions.

Deploy the new Prisma migration before running the updated API. Integration
coverage is in `sales.test.ts`, `completion.test.ts`, and `tax.test.ts`.
