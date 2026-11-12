# Service 2: authentication

## What is implemented

- Business-owner signup with one-use email verification.
- Argon2id password hashing (19 MiB, 2 iterations, 1 lane), 12-128 character new
  passwords; no public platform-role or owner-invitation assignment.
- Opaque random sessions stored only as SHA-256 hashes. Production cookies use
  __Host-pl_session, HttpOnly, Secure, SameSite=Lax and Path=/, without Domain.
- 12-hour maximum sessions, 30-minute idle timeout and 10-minute MFA challenges.
- MFA is optional for ordinary business-owner sign-in and mandatory for platform
  administrators. Billing access requires enrolled and verified MFA. TOTP
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
- Business membership and role permissions scope staff invitations. Disabling
  a membership revokes existing sessions;
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
the legacy API unless B2B primary mode is enabled. Fully authenticated users
now go directly to their business dashboard (platform overview for Super Admin). Frontend code remains in the existing JSX
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

## Local email/MFA mock and QR enrollment (2026-11-12)

Set `AUTH_MOCK_OTP=true` only with explicit `NODE_ENV=development` or `test`.
The app origin, API bind host and database host must be loopback. Production
and non-local configuration fail at startup. Default is false; mock routes
return 404 when disabled. `/api/auth/config` exposes only whether mock mode is on.

In this mode, email verification and password recovery use **123456** after
requesting a challenge. No verification/reset mail is queued. Challenges are
purpose-bound, expire after ten minutes and work once; resending invalidates
older challenges. Five confirmation attempts per challenge and account/IP
request limits apply. Reset verification grants a separate one-use reset token;
changing the password revokes sessions and preserves MFA enrollment.

MFA still requires a valid password, verified email and enrollment. Setup shows
a locally generated QR encoding the account's real `otpauth://` URI, plus a
manual key. No enrollment secret is sent to an external QR service. In mock mode,
enter **123456** rather than the changing number displayed in the authenticator.
With mock mode off, the scanned authenticator's real TOTP and replay checks apply.
Recovery codes remain distinct 24-character, single-use codes.

Email/MFA inputs accept exactly six ASCII digits, preserve leading zeros, use
a numeric keyboard and reject letters/spaces. The API also rejects numbers,
non-ASCII numerals, newlines and incorrect lengths. Signup/reset require matching
password confirmation and retain the 12–128 character password policy.

The local preview uses an ignored `.env.mock` with a generated encryption key
and separate `profitlens_auth_mock_test` database. Start from each directory:

```sh
# backend-node (after configuring .env.mock and applying migrations to its DB)
npm run dev:mock
# frontend
npm run start:mock
```

Open `http://localhost:3100/auth-v2`; API is on port 4100. Existing services on
3000/4000 are unaffected. `.env.mock` is local-only and must never be committed.

Regression checks, with `TEST_DATABASE_URL` pointing to a dedicated `_test` DB:

```sh
npx vitest run tests/auth.test.ts tests/auth-mock.test.ts --maxWorkers=1
# Frontend start:mock must be running; these start their own temporary API on 4100.
# Stop the preview API first and run these sequentially.
npm run test:browser:auth-mock
npm run test:browser:auth-real
```

Browser checks cover actual signup, verification, MFA setup/QR, recovery,
logout, forgot/reset and subsequent login. Mock screens are checked in Arabic
and English at 320, 390, 768, 1024 and 1440px. QR decoding is verified against
the enrollment URI in the integration test. Artifacts remain ignored under
`tmp/auth-mock-design` and `tmp/auth-real-design`; prior UI references are under
`tmp/auth-design`. Reference review used Jawla merchant and Syria recovery UI
only; no Jawla code or country-specific signup requirements were changed.

## Dashboard landing and Security tab — 2026-11-12

After email/MFA verification and recovery-code acknowledgement, login redirects
to `/business-v2` for customers or `/platform-v2` for Super Admin. Returning to
the login URL with a full session redirects as well; verification/reset/invitation
links still complete their intended actions. MFA requirements are unchanged.

The business workspace defaults to a dashboard with permission-scoped monthly
report metrics and quick actions. Account security is an ordinary dashboard
section at `?tab=security`, containing session revocation, password change with
confirmation, device lock and sign-out. It is not an authentication card or modal.
Team invitations remain in the existing team/invitations sections. Platform
administrators have the same inline Security section in their own dashboard.

## Onboarding/auth verification — 12 November 2026

Verified against an isolated PostgreSQL test database using Node 22, plus the
existing local staging demo login. No customer credentials were changed and no
external email or payment was sent.

- 64 API tests passed across auth, local OTP, business access, billing, app and
  security boundaries. Coverage includes single-use/expired tokens, revoked and
  expired sessions, CSRF/origin checks, rate limits, invitations, password reset
  and session invalidation.
- Browser local-code journey: new owner signup and password confirmation, email
  verification, login, optional account MFA enrollment, billing MFA requirement,
  trial activation, first warehouse and shop, recovery login, logout, password
  reset/change and old-password rejection. Arabic/English at 320/390/768/1024/1440.
- Browser real-token journey: encrypted email-outbox links (read locally), genuine
  TOTP enrollment, recovery login, CSRF rejection, lock/logout and password reset.
- Team/billing browser journey: invitation acceptance with supplied credentials,
  staff login, seat limits, restricted billing, trial and expired-subscription UI.
- Browser resilience: disconnected API, invalid server reply, successful retry,
  disabled in-flight submission, 30-second timeout recovery and password masking
  when switching between login/signup. Arabic and English desktop/mobile.
- Frontend production build and backend source/test/script typechecks passed.

The auth screen now waits for configuration before showing forms, offers an
explicit connection retry and translates network/timeout/invalid-response errors.
Passwords return to masked state when switching auth modes. Browser suites were
updated to match optional owner MFA and mandatory billing MFA; production rate
limits remain unchanged. Screenshot-only reloads use distinct test identities.

Repeat with a dedicated `TEST_DATABASE_URL` ending in `_test` and the frontend
on localhost:3100 configured for localhost:4100:
`test:browser:auth-mock`, `test:browser:auth-real`, and
`test:browser:auth-resilience`. Run real/mock suites sequentially (both bind 4100).
`test:browser:staging-login` uses `.env.staging` and validates its environment.
Evidence: `tmp/auth-mock-design`, `tmp/auth-real-design`, `tmp/auth-resilience`,
`tmp/team-billing-e2e`, and `tmp/login-check`.

External SMTP delivery, production HTTPS/proxy configuration and deliverability
remain deployment checks; local test codes do not verify those services.
