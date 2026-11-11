# Service 11 — warehouse and shop transfers

Migration 013 adds tenant-qualified transfers, transfer lines and immutable arrival/
discrepancy events. API readiness now expects transfers-v1. The optional business-v2
workspace has a Stock transfers section. Legacy screens and customer data are not
migrated or changed by this service.

## Workflow and quantity conservation

DRAFT -> IN_TRANSIT -> PARTIAL -> COMPLETED. A draft may be CANCELLED. Once
dispatched, it cannot be cancelled or edited. Drafts do not reserve or move stock.

- Dispatch subtracts every planned line from available source stock atomically,
  inserts TRANSFER_OUT movements, and records the dispatcher/time. Destination
  stock does not change. A source shortage, reserved quantity or later failure
  rolls the whole operation back.
- An arrival adds only confirmed quantities to destination stock with TRANSFER_IN
  movements. Partial arrivals leave the rest visibly in transit.
- A manager can confirm physical goods returned to the source (TRANSFER_RETURN),
  or confirmed missing/damaged goods as a transit loss. Both require a reason of
  at least five characters. A return must represent goods physically back at the
  source; it is not an instruction to dispatch them again.
- Loss records reduce outstanding transit, never physical source/destination
  balances (the goods already left the source at dispatch). The immutable transfer
  event and line are the transit-loss ledger; no fictitious physical location
  movement is inserted.

For each dispatched line:
  sent = received + returned + lost + still_in_transit

Counters are exact numeric(18,4), nonnegative, and database-checked so their sum
cannot exceed sent quantity. A transfer closes only when every outstanding line
is zero. Closed means all goods are accounted for; it does not imply every unit
arrived. The UI shows received, returned and lost separately and retains history.

Transfers use product base units. Product name, SKU, unit, barcode and location-name
snapshots remain on the document. Transfer responses never include purchase costs.
Pricing/valuation and pack-selection UI are not introduced by this service.

## Authorization

All routes require a live business membership, session/MFA, transfers.view and
locations.view. Platform Super Admin has no implicit tenant access.

- Preparing/editing/cancelling a route: transfers.create and access to BOTH source
  and destination. They must be different locations in the same business.
- Dispatch: transfers.dispatch at the source. The route was already authorized at
  creation; a source employee can dispatch without access to destination balances.
  The destination is still checked for tenant membership and active status.
- Arrival: transfers.receive at the destination. A receiving employee does not
  need source inventory access. Only the destination balance is changed.
- Return/loss resolution: transfers.resolve and access to BOTH endpoints.
- Document/history visibility: at least one participating location. This shares the
  transfer document, not unrelated inventory or other documents at the other end.
  Filtering by an unassigned location is rejected.

Owners/operations managers have all transfer capabilities by default. Warehouse
staff and shop managers have view/create/dispatch/receive, limited by assignments;
creating a route still needs both assignments. Viewers have view only. Cashiers
have no transfer permission by default. Non-owner overrides remain configurable.
Capabilities returned by detail API reflect current role/assignments; the server
reauthorizes writes rather than trusting those UI flags.

Both endpoints are protected from archive while any draft/in-transit/partial
transfer exists. Existing nonzero stock/reservation guards continue to apply.

Creation, draft edits and first dispatch require active subscription entitlement.
Finishing already dispatched goods (arrival/return/loss) remains available after
trial expiry and product deactivation, preventing stranded in-transit inventory.
Business suspension, revoked sessions, removed assignments and permission changes
still block all affected operations. New physical postings reject archived
locations. Durable replays still require current authorization.

## Concurrency, history and retry behavior

Transfer creation uses a tenant-unique client UUID and normalized request hash.
An identical retry returns the original document; changed data with the same key
returns IDEMPOTENCY_CONFLICT. Draft edits and state changes use revisions.

Dispatch locks the transfer inside the existing serializable transaction helper.
Retries return the dispatched document even if the original response was lost.
Each transfer line can have only one TRANSFER_OUT posting.

Each arrival/return/loss request has a new client UUID and request hash. Store it
until the response is known; retry the exact payload and key after a timeout.
An accepted replay returns its durable event ID plus current transfer state.
A new request must use the current revision. Concurrent requests cannot consume
the same remaining transit quantity. Source balances and physical arrivals retain
the inventory engine's locking, nonnegative and precision/overflow protections.

Physical stock, movement records, transfer counters, permanent event lines,
document status and audit entries commit together. PostgreSQL blocks UPDATE or
DELETE of transfer event headers/lines and existing stock movements. The app
exposes no deletion or post-dispatch line editing endpoint. Audit events avoid
financial values. Corrections after a mistaken confirmed arrival require a new
explicit transfer/adjustment workflow, never editing history.

## API

Base: /api/businesses/:businessId/transfers

- GET /?page=&status=&locationId=&search= (reference search, 25 rows/page)
- GET /:id (snapshots, per-line transit and current action capabilities)
- GET /:id/events?page= (paginated permanent arrival/discrepancy history)
- POST / {clientKey,sourceId,destinationId,notes,lines:[{productId,quantity}]}
- PATCH /:id {revision,notes,lines:[{productId,quantity}]} (draft only)
- POST /:id/status {revision,action:"dispatch"|"cancel",confirm:true}
- POST /:id/events {clientKey,revision,kind:"RECEIVE"|"RETURN"|"LOSS",
  reason,confirm:true,lines:[{lineId,quantity}]}

Use 1–100 distinct products/lines and positive decimal strings, at most four
fractional digits. An event may include a subset of lines. Its quantities cannot
exceed remaining transit. All writes require CSRF and origin checks; responses
are no-store. Invalid UUIDs, extra fields, cross-tenant IDs, same-location routes,
zero/negative quantities, excessive precision and duplicate lines are rejected.

## Verification and boundaries

13 new PostgreSQL integration tests cover tenant/role/location isolation, CSRF,
cost absence, draft idempotency/revisions, dispatch replay, concurrent depletion,
reserved stock, partial-arrival replay, concurrent over-receiving, returns/losses,
immutable history, rollback after source/destination posting, overflow, snapshots,
archive guards, revoked assignments and completion after trial expiry.

Real browser checks use owner, source-only and destination-only staff accounts.
They exercise draft barcode entry, dispatch, partial arrival, an over-receive
error, manager return/loss, full reconciliation, read-only states, and AR/EN
responsive layouts. Test fixtures only; no real customer stock is moved.

Services 12–17 (POS, returns, counts/damage, payments, reports, migration/pilot),
Service 7 remaining work and paid billing lifecycle remain separate. This module
does not provide freight routing, offline dispatch, batch/serial/expiry tracking
or financial inventory valuation. Production rollout is still pending.
