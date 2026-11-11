# Business administration (Service 3)

Implemented 11 November 2026. This module manages customer businesses and
business-level access. It does not grant platform administrators automatic
access to customer records. Location assignments and operational permissions
belong to subsequent modules.

## Authorization

All `/api/businesses` routes require an active authenticated session with
required MFA completed. Writes also require the exact configured origin, JSON
and a valid session CSRF token. Authorization and mutations run together in
serializable database transactions, re-reading the user, session, membership,
business suspension and permission overrides. Business IDs never authorize
access by themselves. Target record lookups include the selected business ID.

Owners have all business permissions. Only owners may change business settings,
manage team access or manage invitations. Operations managers default to viewing
business details, team, roles and activity. Other staff roles default to viewing
business details only. Owners may customize the implemented non-owner capabilities per
member. Changing a role resets overrides unless replacements are explicitly
supplied. Every endpoint also requires `business.view`.

Owner membership cannot be edited through team management. Changing a staff
member's role, overrides or active state invalidates their sessions across all
businesses. A disabled platform account cannot be reactivated by a business
owner. Ownership transfer and custom role creation are outside this module.

## API

- `GET /api/businesses`: accessible businesses only.
- `GET /api/businesses/:businessId`: business settings and effective access.
- `PATCH /api/businesses/:businessId`: owner settings update with `revision`.
- `GET /api/businesses/:businessId/members`: paginated team.
- `PATCH /api/businesses/:businessId/members/:memberId`: owner access update
  with `revision`, optional role, active flag and permission overrides.
- `GET /api/businesses/:businessId/roles`: defaults and capability metadata.
- `GET|POST /api/businesses/:businessId/invitations`: paginated history/create.
- `POST /api/businesses/:businessId/invitations/:invitationId/revoke`.
- `GET /api/businesses/:businessId/audit`: paginated, business-scoped activity.

Pagination uses `page` (1-based) and `pageSize` (1–100, default 25). Settings
include name, base currency, time zone and display formats. Stale revisions return
409. Base currency changes are rejected when `currencyLockedAt` is populated;
future financial services must set that lock with their first financial write.
Updates and their before/after audit records commit atomically. Invitation lists
never expose token hashes. Mail is queued, not sent from an HTTP request.

## Frontend

Set `REACT_APP_AUTH_API_URL` to enable `/auth-v2` and `/business-v2`. After sign-in,
use “Manage businesses and team” from account security. Existing legacy routes
remain separate. The business workspace includes settings, team access editing,
role defaults, invitations/revocation and activity history. Controls follow the
existing light slate/emerald design, translated labels, short placeholders and
RTL conventions. Navigation reflects server-returned capabilities; server checks
remain authoritative. Switching business unmounts old views and cancels reads.

The role editor explains that saving signs the member out, resets overrides on
role changes and requires an explicit save. Stale edits offer reload instead of
overwriting newer records. Revoking invitations uses a confirmation dialog.

## Local verification

- Backend typecheck/build and frontend production build.
- 7 HTTP/config tests and 30 real PostgreSQL tests, including 12 business tests.
- Real browser flows via `npm run test:browser:business`: settings, stale edits,
  role/override editing, disable/reactivate, invite/revoke, audit, business switch,
  read-only staff, signed-out redirect, AR/EN at 320/390/768/1440px and dialog focus.
- Existing authentication browser flow is retained as a regression check.
- Screenshot evidence: `../tmp/business-design/` (controlled legacy design
  baselines, real new-API test-account screens). No real external mail sent.

Integration testing exposed an adapter-level commit serialization error that
bypassed Prisma's normal P2034 wrapper. Transaction retries now recognize the
adapter's PostgreSQL 40001/40P01 write-conflict errors, with bounded retry/backoff.
A deferred-trigger regression raises an actual conflict at COMMIT and verifies
that retry leaves one committed write. Retryable transaction callbacks must
contain database work only; external side effects belong in an outbox.

Run browser checks with the same APP_ORIGIN/AUTH_ENCRYPTION_KEY as the local test
API, and TEST_DATABASE_URL pointing to the migrated isolated `_test` database.
Browser fixtures create unique records and delete their own records afterward.
Production deployment, legacy migration, SMTP delivery, subscriptions and
warehouse/shop scope remain separate release work.


Catalogue capability extension: catalogue.view/manage/cost are separate. Owners
and operations managers default to all three; other roles default to view only.
Purchase cost is omitted from responses without catalogue.cost. Location and
catalogue permissions are exposed in the existing team override controls.
