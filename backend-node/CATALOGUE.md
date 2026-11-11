# Product catalogue — Service 7, part 1

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
- POST `/preview`: `{filename, fileBase64}`. Returns row/field issues and normalized
  product rows; returns a batch ID only if every row passes validation.
- POST `/:importId/commit`: `{confirm:true}`. Uses the server-side encrypted preview;
  browser-supplied products cannot replace it. Replays return the original result.
- POST `/:importId/discard`: clears an uncommitted preview owned by this uploader.

Requires catalogue.manage and catalogue.cost, live tenant/session/MFA checks and
CSRF on writes. Super Admin and other uploaders have no implicit batch access.
Recheck entitlement, currency, permissions and identifier uniqueness at commit.
Completed replays still require authorization but do not require renewing a trial.

Template columns: sku, name, unit, purchasePrice, sellingPrice, minimumStock,
category, subcategory, brand, description, barcodes, active. Column order is fixed.
Use one worksheet and plain values. SKU/barcode cells must be text; barcodes are
separated by line breaks within one cell. Empty active defaults true, empty
minimumStock defaults zero. Formulas/cached formula results are never imported.
The template contains no example product rows that could be imported accidentally.

Limits: 1 MB compressed, 8 MB expanded, 100 ZIP entries, 500 product rows, 12 columns,
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
