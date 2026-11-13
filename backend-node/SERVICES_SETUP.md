# Email and authenticator OTP setup

Authenticator-app OTP is already implemented. It uses six-digit TOTP codes from an authenticator app and requires no external OTP provider, API key or SMS service for MFA. Syrian phone verification is a separate required onboarding step using MsgPlus. Keep `AUTH_OTP_PROVIDER=authenticator` and use `AUTH_MOCK_OTP=false` for real authentication. Users enroll through Account security; MFA is optional for every role, including business owners and platform admins. Keep the server clock synchronized. Existing mock/demo accounts are not a substitute for real enrollment.

## Local staging: fill credentials, validate, restart

Local staging now exposes the new onboarding flow in explicit loopback mock mode. The displayed test code `123456` works for email/phone verification and mock MFA. No email or SMS is sent for mock verification requests. Existing owners with verified email but no verified phone will see the phone step next time they sign in; no owner phone was prefilled or marked verified during rollout. The real-services overlay below disables mock mode.

A private `backend-node/.env.services` overlay is prepared from `.env.services.example`. On a fresh checkout, copy the example to `.env.services` first. Fill:

```dotenv
SMTP_HOST=your-provider-smtp-host
SMTP_PORT=587
SMTP_USER=your-provider-user
SMTP_PASSWORD=your-provider-password
MAIL_FROM=your-verified-sender@example.com
MAIL_FROM_NAME=ProfitLens
MAIL_REPLY_TO=
AUTH_OTP_PROVIDER=authenticator
AUTH_MOCK_OTP=false
AUTH_EMAIL_VERIFICATION=otp
AUTH_OWNER_PHONE_REQUIRED=true
MSGPLUS_API_KEY=your-msgplus-key
MSGPLUS_SENDER_NAME=your-approved-sender
MSGPLUS_TEMPLATE_ID=1
MSGPLUS_VARIABLE_STYLE=code
MSGPLUS_APP_NAME=ProfitLens
```

Use your provider's SMTP credentials, not an HTTP API key unless the provider explicitly supports it as an SMTP password. `MAIL_FROM` is a plain verified email address; put the display name in `MAIL_FROM_NAME`. Optional `MAIL_REPLY_TO` must be an email address. Port 587 requires STARTTLS; port 465 uses implicit TLS. Certificate verification cannot be disabled. Quote secrets containing `#` or spaces. The private overlay is ignored by Git and excluded from Docker builds.

From `backend-node`, using Node 22:

```sh
npm run services:check:local
npm run services:check:local -- --connect
npm run build
npm run dev:services
```

In another terminal, from the same directory:

```sh
npm run jobs:services
```

Stop the old staging API before starting `dev:services` on the same port. Stop any standalone report-preparation watcher before replacing it with the full jobs worker. These commands load `.env.staging` first and `.env.services` second. Do not change the existing database or encryption key. Existing shell environment variables take precedence over env files; remove stale exported settings. Restart both processes after edits.

The first check is offline. `--connect` verifies SMTP connection, TLS and authentication without sending an email or consuming queued mail. It does not prove that the provider allows the sender or that mail reaches inboxes. The jobs worker is what sends queued mail: starting it with valid credentials can deliver pending invitations, password-reset messages, email verification codes, welcome emails and closing reports; it also sends queued phone codes through MsgPlus. Re-request expired verification codes/reset links after switching from mock mode. Review old queued messages before connecting a demo environment to a real sender.

Until credentials are supplied, local jobs still prepare in-app reports and purge expired imports, but skip email delivery without consuming its retry attempts. Partial/malformed SMTP settings fail startup. Production requires complete settings. The API, worker, reports settings endpoint and readiness checks share the same validator. The worker reports failed delivery batches as unsuccessful, so its health heartbeat does not claim success for a failing batch.

## Production

Put the same SMTP, MsgPlus and OTP settings in `deployment/.env`, alongside the existing database, HTTPS origin, encryption key and billing configuration. Both API and jobs containers load this file; never put these secrets in frontend `REACT_APP_*` variables. Do not deploy `.env.staging` or its mock users.

```sh
# From deployment; after filling .env
 docker compose config --quiet
 docker compose build
 docker compose run --rm api npm run db:migrate
 docker compose run --rm api npm run release:check
 docker compose run --rm api npm run services:check -- --connect
 docker compose up -d --force-recreate api worker web edge
```

Verify the sender/domain with the mail provider and configure its required DNS records. Then validate a real new-account verification, password reset, team invitation, authenticator enrollment/login/recovery and closing-report email/in-app pair using controlled accounts. No real email delivery is claimed until those checks pass. Hosting, payment-provider activation and operational rollout checks remain separate from email/OTP setup.


## Owner onboarding and Syrian SMS

Owners must verify email with a six-digit emailed code, then sign in and verify a Syrian mobile number before business access. Accepts `09XXXXXXXX`, `+9639XXXXXXXX`, `009639XXXXXXXX`, spaces, and Arabic/Persian digits. Verified numbers are unique per account. MFA is optional for owners (including billing); once enabled, sign-in challenges remain enforced until the owner disables it. Platform admin MFA is optional too. Invited staff prove email ownership through their invitation and are not required to verify a phone.

Codes expire after five minutes, permit five incorrect attempts, are one-use and superseded on resend. Code hashes are keyed; destinations and outgoing payloads are encrypted. Email requests have per-IP/account limits. Phone requests additionally have five-per-day number/account quotas and a one-per-minute account cooldown. Missing providers return an explicit unavailable error, never a usable production mock code. Production refuses disabled owner-phone verification or legacy email-link mode. Development fixtures can explicitly retain legacy flows when testing older APIs; `.env.services` enables the new flow.

A welcome email is queued once after an owner's email and phone are verified; invited staff receive their own onboarding message after accepting. Owner copy introduces the trial/subscription, warehouse/shop setup, products and staff. Language is selected at signup. No trial starts automatically and no payment is taken by verification.

MsgPlus must approve your sender and template for ProfitLens. Use `MSGPLUS_VARIABLE_STYLE=code` for the current documented `code` variable, or P1/P2/P3 if your approved template uses the corresponding Jawlaha-style slots. P2 adds the user's name; P3 adds name and app name. Do not assume Jawlaha's sender/template approvals apply to this app. No Jawlaha secrets were copied. Implementation follows the [official MsgPlus contract](https://sms.msgplus.tech/en/sms-api-syria), using `sender_name`, `template_id`, bearer auth and a timestamp. A successful response means accepted/queued, not delivered. SMS retries can repeat a message after an uncertain provider response, but the same expiring code cannot verify twice.

The connection-check command does not send SMS or verify an approved template against the live provider. Real Syrian-number delivery, email inbox delivery and provider approvals still need validation once credentials are available. No real email or SMS was sent during development tests.


## Verification evidence — 13 November 2026

38 unit/HTTP/configuration tests and 244 integration tests passed. The real browser flow used generated email/SMS codes captured locally (not production mock codes), enforced both verification gates, tested invalid numbers/codes, verified optional owner MFA and captured one welcome email. Arabic/English phone/code screens were checked at mobile, tablet and desktop widths; screenshots are in `tmp/contact-onboarding-ui/`. Backend typechecks/build and frontend build passed, with the existing frontend bundle-size advisory. The readiness checker currently fails only the unfilled SMTP/MsgPlus configuration checks. Provider delivery is not yet verified.
