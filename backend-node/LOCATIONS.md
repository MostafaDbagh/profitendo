# Warehouses, shops and staff assignments

Service 6 uses real PostgreSQL records and the existing optional business-v2
workspace. Creating a location does not create products, stock or transactions.

Owners create/edit/archive/reactivate locations and assign staff. Operations
managers can view all locations by default. Other staff can view assigned
locations only. Owners can change `locations.view` and `locations.all` in Team
permissions. Super Admin has no implicit tenant access.

`requireLocation` performs live business/session/MFA/permission/assignment and
archive checks inside the caller's transaction. Every future stock operation
must call it for every participating location. Do not authorize a transfer using
only its source location or a cached list from the browser.

Codes are normalized to uppercase and unique within the business, including
archived records. Codes and location types are immutable. Tenant-qualified
foreign keys prevent cross-business staff assignments even at database level.
All mutations are CSRF protected, audited atomically and revision checked.
Assignment changes take effect immediately without relying on token refresh.

Active warehouse/shop counts enforce the trial plan's separate limits. Creation
and reactivation acquire the same capacity lock used by other entitlement
checks. Expired trials permit reading, editing metadata, access reductions and
archiving, but prevent location growth. Archiving retains the location and clears
explicit assignments; reactivation never restores assignments automatically.

Routes under `/api/businesses/:businessId/locations`:

- GET `/`: paginated scoped search, kind and active/archived/all filters.
- POST `/`: create a warehouse or shop.
- PATCH `/:locationId`: revision-checked name/address or active state.
- GET `/:locationId/assignments`: owner-only paginated team/assignment state.
- PUT `/:locationId/assignments`: revision-checked assignment or removal.

UI: Warehouses & shops in `/business-v2`, with bilingual labeled fields,
placeholders, confirmation dialogs, error recovery, filtering and pagination.

Integration tests cover concurrent limits, tenant isolation, database foreign
keys, assignment revocation, revisions, archival, expiry and suspension. Browser
tests exercise the real API/DB and AR/EN layouts at 320/390/768/1440px. Tests use
isolated fixtures and clean them afterward.

Dependency for Service 8/10/11/12: before adding stock or open operational
documents, extend the archive guard to reject locations with remaining stock,
reservations, in-transit stock or unfinished documents. Such records do not exist
in the new backend yet. Location authorization here does not migrate or secure
legacy operational routes; legacy remains separate until the migration service.
