# Service 2: authentication

## What is implemented

- Business-owner signup with one-use email verification.
- Argon2id password hashing (19 MiB, 2 iterations, 1 lane), 12-128 character new
  passwords; no public platform-role or owner-invitation assignment.
- Opaque random sessions stored only as SHA-256 hashes. Production cookies use
  __Host-pl_session, HttpOnly, Secure, SameSite=Lax and Path=/, without Domain.
- 12-hour maximum sessions, 30-minute idle timeout and 10-minute MFA challenges.
- Owner/Super Admin MFA enrollment and verification before full access. TOTP
  secrets use AES-256-GCM with per-record associated data. Used TOTP steps cannot
  be replayed. Ten random, single-use recovery codes are shown once and hashed.
- Login/MFA rotates the cookie. Password reset/change invalidates all sessions;
  lock/logout revokes the current session. Users can list and revoke their own
  sessions. Disabling a user is checked on every authentication request.
- All auth mutations require the configured APP_ORIGIN and JSON. Authenticated
  writes also require a session-derived X-CSRF-Token. No state changes via GET.
- Database-backed rate limits work across API instances. Proxy headers are not
  trusted by the production app. Configure a reviewed proxy policy before
  hosting behind a load balancer; do not enable unconditional trust proxy.
- Owner-scoped, expiring invitations for non-owner staff roles. Existing accounts
  must sign in before accepting; an invitation cannot replace their password.
- Minimal business/membership records support invitations, not the complete
  Service 3 permission engine. Disabling a membership revokes existing sessions;
  new login must not grant disabled membership access.
- Transactional encrypted mail outbox with leased SMTP delivery, retries and
  payload removal after delivery. Tokens never appear in API responses/logs.
- Security audit records for registration, verification, sessions, MFA,
  credentials, invitations and membership disabling.

## Configuration and local preview

Use the documented Service 1 database setup and apply both migrations:

```sh
npm ci
# Set DATABASE_URL, CORS_ORIGINS and the values below in .env.
npm run db:generate
npm run db:migrate
npm run dev
```

Generate AUTH_ENCRYPTION_KEY with 32 cryptographically random bytes encoded as
64 hex characters. APP_ORIGIN must exactly match the frontend origin and appear
in CORS_ORIGINS. Production requires HTTPS. Back up the key in a secret manager:
changing it without a re-encryption migration invalidates stored MFA/mail data.
Use PostgreSQL connections configured for UTC (enforced by createDatabase).

Frontend opt-in preview:

```sh
# Run from frontend/ with the existing frontend dependencies.
REACT_APP_AUTH_API_URL=http://localhost:4000 npm start
```

Open `http://localhost:3000/auth-v2`. Keep localhost consistent in both URLs;
127.0.0.1 and localhost are different sites for cookie purposes. This route is
registered only when REACT_APP_AUTH_API_URL is set. It uses the existing
Cairo/Outfit fonts, emerald/slate colors, AuthBranding, MobileLogo and native
form styles. Existing /auth, Google login and all operational routes still use
the legacy API. The new page is an account-security preview, not a fake gateway
to unimplemented business modules. Frontend code remains in the existing JSX
conventions; full frontend TypeScript migration is still future work.

The page supports AR/EN signup, login, email verification, reset, TOTP setup,
verification/recovery, active sessions, lock/logout, password changes and owner
invitations. Verification/reset/invitation tokens are delivered in URL fragments,
removed from the address bar immediately and kept only in component memory.
Refreshing a token page requires reopening its original email link.

## SMTP and administrator setup

Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM. TLS is
required (implicit TLS on 465, STARTTLS otherwise). Run the worker periodically:

```sh
npm run mail:send-once
```

This command sends real email; it was not run against an external mail service
in verification. Schedule it only with the chosen provider configured. Failed
messages remain encrypted and retry up to eight attempts with backoff; monitor
exhausted rows before public rollout. Delivery is at-least-once: if SMTP accepts
mail but the database acknowledgement fails, a retry can deliver the same link.
Single-use tokens make duplicate link delivery safe. Sender reputation, provider
limits and external deliverability are not verified.

Use `npm run admin:bootstrap` once, supplying ADMIN_EMAIL, ADMIN_NAME and a strong
ADMIN_PASSWORD through secure environment input (16+ characters). It refuses to
run if a Super Admin already exists and requires MFA at first login. It is a
local operator command, not an HTTP registration option. No real platform admin
or credentials were created in this implementation.

## API summary (under /api/auth)

| Method | Path | Access |
|---|---|---|
| POST | /register, /login | Origin + JSON; rate limited |
| POST | /verification/request, /forgot-password | Generic response; rate limited |
| POST | /verification/confirm, /reset-password | One-use token; origin + JSON |
| GET | /me | Valid session; restricted stage until MFA complete |
| POST | /mfa/setup, /mfa/confirm, /mfa/verify | Session + CSRF; rate limited |
| POST | /logout, /lock | Session + CSRF |
| GET | /sessions | Full authentication; own sessions only |
| POST | /sessions/revoke, /password | Full authentication + CSRF |
| POST | /invitations, /invitations/revoke | Business owner + MFA + CSRF |
| POST | /invitations/accept | Valid invitation; existing account requires own session + CSRF |
| POST | /members/disable | Business owner; owners cannot be removed here |

`/me` returns `{ user, stage, memberships, csrfToken }`. The stage is
`mfa_setup_required`, `mfa_required` or `authenticated`; pending stages expose no
business memberships. Errors preserve `{ error: { code }, detail, requestId }`.
Secrets/password hashes are never included in public user responses.

## Verification

```sh
npm run typecheck
npm test
# Apply migrations to the dedicated database first.
TEST_DATABASE_URL=... npm run test:integration
npm run build
# Against a running frontend/API using the same test DB and encryption key:
TEST_DATABASE_URL=... npm run test:browser
```

Browser checks require local Chrome (or install Playwright Chromium and adjust
its launch channel). They use real new APIs/database. Only the legacy
AuthProvider's unrelated calls are isolated with a signed-out response. Emails
are read from the encrypted test outbox; no external mail is sent. Screenshots
mask the MFA secret and do not capture recovery codes. Test accounts are removed.

## Remaining boundaries

Service 3 must implement reusable live tenant authorization and the complete
role/permission matrix before exposing business operations. Location checks,
plan limits, billing, Google identity migration, existing user/password/data
cutover, full frontend routing cutover and production deployment are not done.
MFA recovery is via saved recovery codes; no weak support bypass is implemented.


Transaction retries (catalogue verification update): serializable conflicts from
Prisma P2034, raw-query P2010 adapter metadata and direct adapter commit failures
are retried up to seven total attempts with bounded exponential backoff/jitter.
Only PostgreSQL serialization/deadlock errors qualify. Exhaustion returns 503
TRANSACTION_BUSY. Immediate and deferred database trigger tests verify rollback
and exactly one committed write across retries.
