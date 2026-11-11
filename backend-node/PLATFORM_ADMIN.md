# Platform administration (Service 4)

Implemented locally on 11 November 2026. The platform operator can inspect
customer account metadata and control access. Customer business records remain
protected by business membership and business permissions.

## Access boundary

Every platform operation revalidates the live account/session, SUPER_ADMIN role,
enrolled MFA secret and completed session MFA inside a serializable transaction.
A customer owner is not a platform administrator. A platform administrator does
not receive implicit business membership. Status writes require the exact app
origin, JSON, session CSRF, current revision and a 5–500 character reason.

All platform administrators are protected from status changes through this API,
including the signed-in administrator. No HTTP endpoint grants administrator
roles, changes customer passwords, removes MFA, impersonates customers, deletes
accounts or changes business ownership. The existing `admin:bootstrap` local
operator command creates the initial administrator and requires MFA enrollment
at first sign-in. No real administrator was created during implementation.

## Endpoints

- `GET /api/platform/overview`: business counts and customer account counts.
- `GET /api/platform/businesses`: minimal business metadata and member counts.
- `GET /api/platform/users`: name/email/platform role/verification/status only.
- `GET /api/platform/audit`: platform changes with actor, target, reason and time.
- `PATCH /api/platform/businesses/:id/status`.
- `PATCH /api/platform/users/:id/status`.

Status body: `{ revision, active, reason }`. Lists accept `page` (1-based),
`pageSize` (1–100), `q` (up to 100 characters) and `status` (all/active/inactive).
Audit accepts pagination only. Stale revisions return 409; strict schemas reject
mass assignment. Status no-ops do not create duplicate audit records. Responses
are no-store and never include password hashes, MFA secrets or session tokens.

Business suspension blocks all business API access through live authorization,
removes the business from accessible-business lists, and permanently revokes
pending invitations. It does not sign members out of unrelated businesses.
Reactivation restores existing membership access; it does not restore invitations.

Customer account disabling affects all businesses, increments security version,
revokes every session, consumes unused verification/reset tokens and revokes
pending invitations sent by that person. Reactivation requires a fresh sign-in;
old sessions and revoked links remain invalid. Account status uses securityVersion
as its revision, so concurrent security changes cause a stale-write conflict.

Status changes and before/after audit entries commit atomically. PlatformAudit
has its own table and API; internal support reasons never appear in customer
business activity. It retains actor/target identifiers without cascade deletion.
This is application-level audit history, not externally signed or tamper-proof
storage. No endpoint edits or deletes audit records.

## Frontend and verification

With REACT_APP_AUTH_API_URL set, authenticated Super Admin accounts get a
“Platform administration” link on /auth-v2 to /platform-v2. The workspace offers
an overview, searchable/filterable business and user lists, status-change
confirmation dialogs with impact text and required reason, and activity history.
Customers see an access-denied state. Existing auth, business and legacy screens
remain intact. Shared slate/emerald controls, labels, placeholders, dialogs and
Arabic/English layout conventions are reused.

- Migration 202611110004_platform_admin applied to isolated PostgreSQL 16.
- 10 platform integration tests cover role/MFA/live demotion, CSRF/origin/schema,
  minimal lists, suspension and invitation revocation, customer disable/session
  revocation, protected administrators, stale/concurrent writes and audit scope.
- 40 total database integration tests and 7 HTTP/configuration tests passed.
- Backend typecheck/build and frontend production build passed.
- `npm run test:browser:platform` passed against real local API/database: admin
  entry, customer denial, suspend/reactivate, stale edits, disable/reactivate,
  session revocation, audit, AR/EN 320/390/768/1440px and dialog focus restoration.
- Screenshots: ../tmp/platform-design/. Visual baseline: prior business workspace.
- Fixtures use unique test accounts and clean up their own records. No real
  customer data, external email or production deployment was involved.

Platform tests need the migrated dedicated TEST_DATABASE_URL ending in _test.
Browser tests additionally need the local API's APP_ORIGIN and encryption key.
Service 5 will handle subscriptions, billing and entitlements; manual business
suspension is not subscription cancellation and does not change payments.
