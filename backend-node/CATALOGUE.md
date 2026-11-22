# Catalogue — current local implementation

Updated 12 November 2026. Product CRUD/import, managed categories and units,
images, pack setup and retirement are implemented. Existing historical units and
pack factors are immutable. The earlier implementation notes below retain their
original verification history; this section supersedes their remaining-work lists.

- `/products/references`: view/create up to 500 tenant-specific CATEGORY/UNIT
  definitions. Codes/names are fixed; PATCH `/:id` with revision/active retires or
  reactivates definitions. Six built-in units always remain available. New custom
  units require an active definition, including Excel commit. Existing products
  keep their base units after retirement. Category text remains backwards-compatible;
  active definitions appear as suggestions, retired exact names cannot be newly used.
- `/products/:id/image`: authenticated GET and revision-checked PUT of
  `{revision,fileBase64}` (null removes). JPEG/PNG/WebP up to 1 MB and 12 megapixels;
  animated/vector formats are rejected. Sharp decodes, strips metadata and re-encodes
  to bounded WebP. Two decodes per process and 60 writes/user/hour; JSON allowance
  is restricted to the authenticated upload route. Images live in PostgreSQL, so
  database backups include them. Nothing is uploaded to public third-party storage.
- Pack setup is available in the product list. POST `/packs/:packId/retire` with
  `{confirm:true}` is idempotent; retirement prevents new sales/receiving selections.
  Saved historical snapshots and exact conversion remain available. Replace a pack
  by adding a new name/factor. At most 20 active packs. No pack price/barcode override.
- Custom unit codes display consistently in operational documents and receipts.
  Base-unit product prices apply to pack quantities through exact conversion.
- All controls preserve the existing bilingual styles, labels, placeholders and
  role boundaries. Catalogue APIs expose no stock mutation.

## Earlier implementation notes

### Product catalogue — Service 7, part 1

Product registration and stock receiving are separate. This service has no stock
quantity field and performs no stock movements. Migration 009 adds tenant-scoped
products and multiple barcodes, protected by tenant-qualified foreign keys.

Products contain name, SKU, category/subcategory/brand text, description, one base
unit, purchase/selling prices, minimum-stock threshold and active state. SKU and
base unit remain immutable. Basic units: piece, box, carton, kg, litre and metre.
Boxes/cartons are independent units here; conversion to pieces is not implemented.

Amounts and thresholds are decimal strings with at most 14 integral and 4 decimal
digits, persisted as numeric(18,4), never rounded from JavaScript floats. Values
are nonnegative. Prices use the business currency. Creating the first product
locks that currency and increments business revision in the same transaction.

SKU and barcode uniqueness is per business, including inactive products. Barcodes
retain leading zeros, permit ASCII scanner values, and are limited to 20 per
product. Replacing barcodes is atomic; any conflict rolls back the entire edit.
Product writes are revision checked and CSRF protected. No hard delete endpoint.

Permissions: catalogue.view, catalogue.manage, catalogue.cost. Owners have all;
operations managers default to all; other roles default to view only. Costs are
omitted from API list/detail/lookup responses without catalogue.cost. Creating a
priced product requires manage and cost; changing selling price or other metadata
requires manage, while changing purchase cost additionally requires cost. The
general audit records changed field names, never price values.

New products and reactivations require active entitlement. Existing records stay
readable after trial expiry. Suspended businesses cannot access catalogue APIs.
Platform administrators have no implicit business access.

Routes under /api/businesses/:businessId/products:

- GET /: paginated name/SKU/exact-barcode search, active/inactive/all filter.
- GET /barcode?value=: exact lookup; inactive items return PRODUCT_INACTIVE.
- GET /:productId: tenant-scoped detail, including inactive records.
- POST /: validated creation; no stock changes.
- PATCH /:productId: revision-checked details/barcodes/active state.

UI: Product catalogue in /business-v2; scanner keyboard input followed by Enter
and manual lookup; labeled bilingual forms and cost-aware tables. Existing legacy
product screens remain unchanged. Physical HID hardware needs pilot validation.

Excel preview/import is implemented as documented below. Remaining Service 7 work:
product images, managed categories/units and pack conversions. Receiving, transfers, POS and stock
history will reference product IDs and snapshot document values in later services.


## Excel import

Routes under `/api/businesses/:businessId/product-imports`:
- GET `/template`: JSON containing the XLSX filename and base64 template.
- POST `/preview`: `{filename, fileBase64, duplicateMode?}`. Modes are `review`
  (default), `skip`, or `keep`. Returns row/field issues, duplicate details and
  normalized product rows; returns a batch ID only for a nonempty valid batch.
- POST `/:importId/commit`: `{confirm:true}`. Uses the server-side encrypted preview;
  browser-supplied products cannot replace it. Replays return the original result.
- POST `/:importId/discard`: clears an uncommitted preview owned by this uploader.

Requires catalogue.create (inherited from catalogue.manage unless overridden) and catalogue.cost, live tenant/session/MFA checks and
CSRF on writes. Super Admin and other uploaders have no implicit batch access.
Recheck entitlement, currency, permissions and identifier uniqueness at commit.
Completed replays still require authorization but do not require renewing a trial.

Template columns: sku, name, unit, purchasePrice, sellingPrice, minimumStock,
category, subcategory, brand, description, barcodes, active. Supported English and
Arabic headings can be mixed and reordered. Common aliases include Purchase price /
سعر الشراء, Product name / اسم الصنف and Unit of measure / وحدة القياس. Unknown
headings and two headings mapping to the same field are rejected rather than guessed.
Name, unit and purchase cost are required; blank SKU receives a generated identifier.
Use one worksheet and plain values. SKU/barcode cells must be text; barcodes are
separated by line breaks within one cell. Empty active defaults true, empty
minimumStock defaults zero. Formulas/cached formula results are never imported.
The template contains no example product rows that could be imported accidentally.

Limits: 1 MB compressed, 8 MB expanded, 100 ZIP entries, 500 product rows, 24 columns,
20 previews per user/hour, 5 pending previews per user/business. Worker concurrency
is two per API process, timeout eight seconds and V8 old-generation limit 96 MB.
The parser rejects extra worksheets, merged cells, macros/external links/embedded
media and unsupported cell types. Libraries do not execute workbook formulas.

Validated preview data is AES-GCM encrypted with batch-specific associated data.
Commit/discard clears it. Expired previews are cleared opportunistically for the
uploader or globally with `npm run catalogue:purge-imports`; production scheduling
must be configured. Durable completion metadata remains for idempotency/audit.
The original file is not retained. Products, barcodes, per-product audit entries,
batch receipt and currency lock commit together, or all roll back.

The build copies xlsx-worker.cjs into dist/catalogue; deploy that worker alongside
the compiled API. ExcelJS uses a compatible patched uuid 11.1.1 override (v4 API).
Verification includes a compiled-worker/template smoke check, real XLSX fixtures,
500-row imports, compressed expansion rejection, auth/expiry/currency rechecks,
concurrent confirmation and browser flows. No real customer workbook was used.

### Duplicate review and verification — 22 November 2026

Duplicates are shown for existing tenant products and earlier accepted rows in the
same file. SKU/barcode conflicts block confirmation in review mode; matching names
(normalized case, Unicode and whitespace) are warnings, since distinct products can
share a name. No exported rows are silently skipped. Exclude removes duplicate rows
from the proposed import only; it never deletes an existing product. Keep preserves
names and prices, generates a new SKU only for a conflicting SKU, and removes only
conflicting barcodes. The resulting values are previewed before a separate confirm.
Existing products are never overwritten. Identifier uniqueness is rechecked at commit.

Arabic/Persian digits and Arabic decimal separators are supported in price/threshold
cells. Valid thousands groups are accepted; ambiguous decimal-comma values are rejected.
SKU/barcode cells remain text to preserve leading zeros. Opening quantity is not an
alias for minimum stock: catalogue import does not create stock or financial postings.
Use receiving/opening-stock workflows for quantities.

Verification used a newly created local `accountant_import_test` database, with all
52 migrations applied, and generated XLSX/CSV fixtures; no customer records were used.
The 56 tests in `product-import.test.ts`, `import-template.test.ts`, `csv.test.ts` and
`catalogue.test.ts` passed. Coverage includes bilingual/mixed/reordered titles,
export round trips, exact prices, required/invalid values, duplicate review/keep/skip,
same-file and existing-product conflicts, 500/501-row boundaries, formula/date/link/
merge rejection, compressed ZIP limits, idempotent concurrent commits, atomic rollback,
expiry/currency/subscription changes, CSRF, tenant isolation and permission revocation.

`import-browser.ts` passed owner and accountant-style staff flows using real API writes.
The accountant uses a VIEWER membership with explicit catalogue.create/catalogue.cost
permissions; this does not introduce a new built-in role. Cashier import is denied.
Browser checks cover template download, invalid input without writes, Arabic prices,
duplicate choices, final database values and unchanged stock, plus AR/EN at 320, 390,
768 and 1440px with page/dialog overflow assertions. Before/after screenshots are in
`tmp/import-review-before` and `tmp/import-review-after`. The preview uses the existing
light modal/table styles, with local duplicate controls and no new UI kit.
TypeScript checks, backend build, frontend production build/prerender and the compiled
XLSX-worker Arabic-template smoke check also passed. These are local checks; no
production deployment or customer-workbook verification was performed.

## Pack conversion backend (Service 7, part 3)

Migration 011 adds tenant-qualified product packs. A pack has a name and a fixed,
positive decimal quantity of the product's existing base unit (for example a
carton containing 12 pieces). Factors and names cannot be edited or deleted
through the API; historical documents must snapshot the selected factor when
receiving/POS are implemented. No stock, product prices, or barcodes are changed.

Under /api/businesses/:businessId/products/:productId:
- GET /packs: catalogue.view; includes baseUnit and pack factors as decimal strings.
- POST /packs: catalogue.manage and active entitlement; body {name,baseQuantity}.
  Product must be active; at most 20 packs per product; names unique per product.
- POST /packs/:packId/convert: catalogue.view plus CSRF; body {quantity} as a
  positive decimal string. Returns the exact base quantity, not a stock movement.
  Inactive products are rejected. Reads/conversion remain available after expiry.

Conversion uses integer arithmetic, rejects overflow beyond numeric(18,4), and
rejects sub-four-decimal precision rather than rounding. All endpoints recheck
business access; platform administrators have no implicit access. Pack creation
and its audit event are atomic. Pack prices/barcodes, retirement/replacement
controls, and the frontend pack editor are not implemented in this slice.

## Comprehensive import QA sign-off — 22 November 2026

Scope: the current B2B product catalogue XLSX/UTF-8 CSV import, for owners and
staff with an accountant-style permission profile. This is a local QA sign-off,
not a production deployment or a guarantee that no undiscovered defect exists.

The second audit reproduced and fixed four defects:

1. Numeric SKU `0` incorrectly triggered automatic SKU generation. Only an empty
   text SKU now receives a generated value; numeric identifiers are rejected.
2. Text `TRUE`, `FALSE`, `True` and `False` were rejected. Active values now handle
   case consistently, including yes/no and Arabic نعم/لا.
3. Discarding a browser draft left its encrypted server preview pending, consuming
   the five-preview allowance. Confirmed discard now clears the server preview
   before resetting local state. Cancelling the prompt preserves both.
4. A failed server request while replacing a file erased the previous browser
   draft. The old file and preview now remain available until the replacement is
   read and server cleanup succeeds. The file input resets on failure so the same
   replacement file can be selected again. Cancelling the chooser preserves work.

The shared local-draft reset keeps existing confirmation behavior for other forms.
Import-specific cleanup runs before reset; errors preserve the draft for retry.
Long barcodes stay on one line inside the existing horizontally scrolling preview.

| Check | Coverage / result |
| --- | --- |
| Backend regression | 105 tests passed across import, workbook, CSV, catalogue contracts, catalogue API, HTTP and security suites. |
| Frontend regression | All 27 tests in all seven frontend suites passed, including draft isolation, conflict handling, reset, remount and confirmation. |
| Import validation | Bilingual/mixed/reordered titles, semantic duplicate headings, required fields, zero/missing/negative/oversized amounts, four-decimal precision, Arabic/Persian digits, leading-zero identifiers, invalid fields and boolean values. |
| File handling | Malformed CSV/UTF-8/quoting, empty files, row/size limits, 500-row commit, 501-row rejection, ZIP expansion, extra sheets, merged cells, formulas, hyperlinks, date cells, worker concurrency and capacity recovery. |
| Duplicate handling | Name/SKU/barcode matches in-file and in-tenant, review/keep/exclude, partial barcode conflicts, preserved unique identifiers, excluded rows not reserving identifiers, export round trips and unchanged existing products. |
| Data protection | Tenant/uploader isolation, CSRF, platform-admin denial, cashier denial, accountant permissions and revocation, expiry/currency/subscription changes, request tampering, pending-preview limits and discard cleanup. |
| Transactions | Concurrent retries of one batch, conflicting separate batches, atomic rollback, reference retirement after preview, exact stored decimal values, one audit completion per batch, and unchanged stock balances/movements. |
| Browser recovery | Real API/database flows for both OWNER and ACCOUNTANT: invalid files, preview retry, close/reopen, cancelled/confirmed discard, failed replacement, file replacement, expired preview, lost response after committed import, retry without duplicates, 26-row pagination, busy-state guards and keyboard focus restoration. |
| Layout | Arabic/English at 320, 390, 768 and 1440px; page/dialog overflow assertions; reviewed screenshots using the existing visual system. |
| Build | Backend and frontend production builds, TypeScript source/test checks and compiled XLSX-worker Arabic/English template smoke checks. |

Environment: isolated PostgreSQL database `accountant_import_test`, generated
fixtures and fresh test accounts, Node 24.22.3 for API tests, headless Google Chrome.
Only test-created application records are cleaned up. No customer workbook or
production data was used. Safari/Firefox, real mobile hardware, production
infrastructure and high-concurrency multi-tenant load are outside this sign-off.
Legacy Python product/sales/purchase importers are outside this B2B catalogue scope.

Repeatable checks:

- In `backend-node`, with `TEST_DATABASE_URL` pointing to an isolated `_test`
  database: `npm run test:import` and `npm run typecheck`.
- In `frontend`: `CI=true npm test -- --watchAll=false --runInBand --watchman=false`.
- Build the frontend with `REACT_APP_B2B_PRIMARY=true` and
  `REACT_APP_AUTH_API_URL=http://localhost:4000`; then run
  `npm run test:browser:import:build` in `backend-node` with `TEST_DATABASE_URL`.
  The test starts its own local frontend on port 3000 and API on port 4000.
- `npm run test:browser:import:deep` targets an already running matching frontend.

Evidence directories: `tmp/import-signoff-before`, `tmp/import-signoff-after`
and `tmp/import-signoff-production`.

**Sign-off: PASS for the tested local B2B catalogue scope.** The complete owner and
accountant browser suites also passed against the optimized production frontend,
using the real API and isolated database. No known import defects remain from this
audit, and all final checks passed. Production deployment and live-environment
verification remain separate steps.
