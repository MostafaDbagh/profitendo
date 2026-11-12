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

Owners have all business permissions. Only owners may change business settings
or manage invitation history/revocation. Owners and delegated administrators with
`team.manage` may manage eligible staff and create invitations within their access. Operations managers default to viewing
business details, team, roles and activity. Other staff roles default to viewing
business details only. Owners may customize the implemented non-owner capabilities per
member. Changing a role resets overrides unless replacements are explicitly
supplied. Every endpoint also requires `business.view`.

Owner membership cannot be edited through team management. Changing a staff
member's role, overrides or active state invalidates their sessions across all
businesses. A disabled platform account cannot be reactivated by a business
owner. Ownership transfer is outside this module. Custom role creation is described below.

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

## Custom roles (2026-11-12)

Business owners and delegated administrators with `team.manage` can create a
named role from the Roles & access screen (`POST /api/businesses/:businessId/roles`).
The server validates permission keys, rejects owner-only grants, restricts
non-owner administrators to their own permissions, and reserves delegation of
`team.manage` to owners. Workspace access is required. Names are normalized and
unique per business; creation is audited and capped at 100 custom roles per
business. Platform admin status provides no tenant access.

Custom roles appear alongside built-in defaults and can be selected in Team and
Invitations. Their IDs use composite tenant foreign keys. Assignment resolves the
role in the target tenant, copies its explicit grants into the existing membership
permission overrides, and revokes existing sessions using the established team
update flow. Individual overrides remain available. Selecting a built-in role
clears the custom-role association. Invitation acceptance applies the same saved
grants while retaining subscription/member-capacity checks.

This release adds creation and assignment only; saved role presets are immutable.
It does not add role editing/deletion or change existing built-in defaults.
Apply migration `20261112090000_custom_business_roles` and regenerate Prisma before
starting the updated API. Existing memberships and permissions are preserved.

Validation: business/auth integration tests and `scripts/roles-staging-browser.ts`
with temporary staging records. Browser checks cover creation, duplicate names,
persistence, team assignment, invitation selection, dialog focus return, and
Arabic/English layouts at 320/390/768/1024/1440px. Screenshots: `tmp/roles-design/`.


## Add people from Team (2026-11-12)

The Team header now opens an Add team member dialog with email and built-in/custom
role selection. It uses the existing invitation endpoint. Membership is created
only after the recipient accepts; the success message makes that timing explicit.
The browser exposes only roles within a delegated administrator's permission
ceiling. Server validation independently rejects wider grants and delegation of
administrator access by non-owners, including direct API calls.

Acceptance rechecks the inviter's active membership, business access, team-management
permission and current permission ceiling. Revoked authority invalidates pending
invitations. Existing subscription capacity, duplicate membership, origin/CSRF and
tenant isolation checks remain enforced. Invitation history/revocation remains
owner-only. No real invitations were sent during verification: service tests mock
mail queuing and browser tests mock invitation responses.

Validation: 33 business/auth tests, TypeScript checks, frontend development compile,
and `scripts/team-staging-browser.ts` for form errors/success, custom-role payloads,
focus return and AR/EN layouts at 320/390/768/1024/1440px. Before/after screenshots
are in `tmp/team-design/`.

## Granular removal permissions and invitation names (2026-11-12)

Role creation and member overrides now expose `returns.delete`, `counts.delete`,
`sales.delete`, `purchasing.delete`, `receiving.delete`, `transfers.delete`,
`catalogue.delete` and `suppliers.delete`. These are additional gates on existing
cancellation/deactivation actions, not hard deletion of accounting history.
Existing state, creator, location, tenant and management checks still apply.
Catalogue removal also gates retiring packs and category/unit definitions.
Completed payments and posted transactions remain immutable.

Existing built-in permissions retain their previous behavior when a delete override
is absent. Explicit false always denies the corresponding action for non-owners.
New custom roles save explicit selections. Owners retain their protected full access.
Action capabilities/controls reflect these gates as well as server enforcement.

Both Team and Invitations forms collect the name. Invitation names are saved and
shown in invitation history; new-account acceptance can use the saved name when no
recipient-provided name is supplied. Existing account names are never overwritten.
Migration `20261112100000_invitation_name` adds the optional storage field without
changing older invitations. Current forms require a 2–100 character name.

Validation: 107 tests across business permissions, catalogue, sales, purchasing,
transfers and completion; TypeScript checks; role and invitation AR/EN browser
screenshots at 320/390/768/1024/1440px in `tmp/roles-design/` and `tmp/team-design/`.

## Initial invitation password (2026-11-12)

Team and Invitations support an optional initial password (12–128 characters).
It is Argon2id-hashed before persistence and never included in invitation mail,
list responses or audit data. Acceptance can use the stored hash and name if the
recipient leaves those fields blank, or use a password the recipient chooses.
Existing accounts must sign in and their credentials are never overwritten.
Accepting, replacing or explicitly revoking an invitation clears its stored hash.
No account or membership is created until acceptance. Apply migration
`20261112110000_invitation_password` before running this version.

## Invitation, role, team and subscription regression run (2026-11-12)

Ran the business/auth/billing/PayPal/admin-service suites (79 passing tests), both
role/team staging browser scripts, and `scripts/team-billing-e2e.ts`. The latter
runs an isolated test-database API behind the existing frontend. Only mail delivery
is mocked: invitation creation, password hashing, acceptance, login, membership,
trial activation, seat limits, paid approval and expiry use the real API/database.
No email is delivered and no provider charge is made. Screenshots are under
`tmp/team-billing-e2e/` (AR/EN, desktop/mobile).

Found and fixed two issues:
- Custom-role member updates now re-resolve the original request on transaction
  retries; expanded permissions no longer become caller-supplied overrides.
- Billing distinguishes missing MFA setup from an unverified session. Subscription
  shows `BILLING_MFA_SETUP_REQUIRED` with an Account security link instead of
  redirecting a signed-in owner repeatedly to the dashboard. MFA remains required.

Added deterministic retry and missing-MFA regression coverage. TypeScript checks
passed. Real email deliverability and live PayPal payments are outside this local
verification; provider behavior is covered by the mocked PayPal integration suite.
