import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { decrypt, digest, totp, encrypt } from '../src/auth/crypto.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { deliverMailBatch } from '../src/auth/mail.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL ending in _test required');
const db = createDatabase(url);
const settings = readAuthSettings({ AUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:3000', NODE_ENV: 'test' });
const auth = new AuthService(db, settings);
const app = createApp({ CORS_ORIGINS: [settings.appOrigin] }, pino({ level: 'silent' }), async () => {}, auth);
// Unique test IP per request group, solely for exercising shared DB rate buckets.
app.set('trust proxy', 'loopback');
let ipCounter = 0;
const ipPrefix = randomBytes(2);
const ip = () => `10.${ipPrefix[0]}.${ipPrefix[1]}.${++ipCounter}`;
const run = randomUUID().slice(0, 8);
const pass = 'Correct horse battery 923!';
const userIds: string[] = [], businessIds: string[] = [], mailIds: string[] = [];
type Session = { cookie: string; csrf: string; email: string; userId: string; businessId: string; recovery: string[] };
function cookie(res: request.Response) { return (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!; }
function post(path: string, body: object, session?: { cookie: string; csrf: string }, address = ip()) {
  let r = request(app).post(`/api/auth${path}`).set('Origin', settings.appOrigin).set('X-Forwarded-For', address);
  if (session) r = r.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  return r.send(body);
}
async function findMail(email: string, action: string) {
  const rows = await db.authMail.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: 'desc' } });
  for (const row of rows) {
    let payload: { to: string; text: string };
    try { payload = JSON.parse(decrypt(settings.key, row.payload, `mail:${row.id}`)); } catch { continue; }
    if (payload.to === email && payload.text.includes(`action=${action}&`)) {
      mailIds.push(row.id);
      return payload.text.match(/token=([A-Za-z0-9_-]{43})/)![1]!;
    }
  }
  throw new Error('Expected transactional mail not found');
}
async function register(tag: string) {
  const email = `${run}-${tag}@example.test`;
  const r = await post('/register', { email, password: pass, name: 'Test Owner', businessName: 'Test Business' });
  expect(r.status).toBe(202);
  const user = await db.authUser.findUniqueOrThrow({ where: { email } }); userIds.push(user.id);
  const member = await db.membership.findFirstOrThrow({ where: { userId: user.id } }); businessIds.push(member.businessId);
  await db.businessSubscription.create({ data: { businessId: member.businessId, planId: '8ac8ae27-f871-47f2-8d70-e38b0aed295c', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000) } });
  return { email, userId: user.id, businessId: member.businessId };
}
async function owner(tag: string): Promise<Session> {
  const identity = await register(tag);
  expect((await post('/verification/confirm', { token: await findMail(identity.email, 'verify') })).status).toBe(200);
  const login = await post('/login', { email: identity.email, password: pass });
  expect(login.body.stage).toBe('authenticated');
  const pending = { cookie: cookie(login), csrf: login.body.csrfToken };
  const setup = await post('/mfa/setup', { password: pass }, pending);
  expect(setup.status).toBe(200);
  const confirm = await post('/mfa/confirm', { code: totp(setup.body.secret, identity.email).generate() }, pending);
  expect(confirm.status).toBe(200); expect(confirm.body.stage).toBe('authenticated');
  return { ...identity, cookie: cookie(confirm), csrf: confirm.body.csrfToken, recovery: confirm.body.recoveryCodes };
}
afterAll(async () => {
  await db.authAudit.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { businessId: { in: businessIds } }] } });
  await db.business.deleteMany({ where: { id: { in: businessIds } } });
  await db.authUser.deleteMany({ where: { id: { in: userIds } } });
  await db.authMail.deleteMany({ where: { id: { in: mailIds } } });
  await db.$disconnect();
});
describe('authentication with real PostgreSQL', () => {
  it('rejects missing origin, role escalation and weak passwords', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'x@example.test', password: pass })).status).toBe(403);
    expect((await post('/register', { email: 'x@example.test', password: pass, name: 'Xx', businessName: 'Xx', platformRole: 'SUPER_ADMIN' })).status).toBe(422);
    expect((await post('/register', { email: 'x@example.test', password: 'short', name: 'Xx', businessName: 'Xx' })).status).toBe(422);
  });
  it('requires email verification and consumes verification tokens once', async () => {
    const u = await register('verify');
    expect((await post('/login', { email: u.email, password: pass })).body.error.code).toBe('EMAIL_UNVERIFIED');
    const token = await findMail(u.email, 'verify');
    const results = await Promise.all([post('/verification/confirm', { token }), post('/verification/confirm', { token })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    const stored = await db.authUser.findUniqueOrThrow({ where: { id: u.userId } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/); expect(stored.passwordHash).not.toContain(pass);
    expect((await db.authToken.findFirstOrThrow({ where: { userId: u.userId } })).tokenHash).not.toBe(token);
  });
  it('supports optional owner MFA, rotates cookies, and guards authenticated writes with CSRF', async () => {
    const u = await register('mfa');
    await post('/verification/confirm', { token: await findMail(u.email, 'verify') });
    const login = await post('/login', { email: u.email, password: pass });
    const pending = { cookie: cookie(login), csrf: login.body.csrfToken };
    expect(login.body.memberships).toHaveLength(1);
    expect((await post('/invitations', { businessId: u.businessId, email: 'a@example.test', role: 'CASHIER' }, { ...pending, csrf: 'wrong' })).status).toBe(403);
    expect((await post('/mfa/setup', { password: pass }, { ...pending, csrf: 'wrong' })).status).toBe(403);
    const setup = await post('/mfa/setup', { password: pass }, pending);
    const code = totp(setup.body.secret, u.email).generate();
    const confirmed = await post('/mfa/confirm', { code }, pending);
    expect(confirmed.status).toBe(200); expect(cookie(confirmed)).not.toBe(pending.cookie);
    expect((await request(app).get('/api/auth/me').set('Cookie', pending.cookie)).status).toBe(401);
    const relogin = await post('/login', { email: u.email, password: pass });
    const next = { cookie: cookie(relogin), csrf: relogin.body.csrfToken };
    expect(relogin.body.stage).toBe('mfa_required');
    expect((await post('/mfa/verify', { code }, next)).status).toBe(401); // replay blocked
    const recovery = confirmed.body.recoveryCodes[0];
    const recovered = await post('/mfa/verify', { code: recovery }, next);
    expect(recovered.body.stage).toBe('authenticated');
    const login3 = await post('/login', { email: u.email, password: pass });
    expect((await post('/mfa/verify', { code: recovery }, { cookie: cookie(login3), csrf: login3.body.csrfToken })).status).toBe(401);
    const stored = await db.authUser.findUniqueOrThrow({ where: { id: u.userId } });
    expect(stored.mfaSecret).not.toContain(setup.body.secret); expect(stored.recoveryHashes).not.toContain(recovery);
  });
  it('resets a password once, revokes sessions and preserves MFA', async () => {
    const u = await owner('reset');
    const known = await post('/forgot-password', { email: u.email });
    const unknown = await post('/forgot-password', { email: `${run}-unknown@example.test` });
    expect(known.body).toEqual(unknown.body);
    const token = await findMail(u.email, 'reset');
    const reset = await post('/reset-password', { token, password: pass + 'new' });
    expect(reset.status).toBe(200);
    expect((await post('/reset-password', { token, password: pass })).status).toBe(400);
    expect((await request(app).get('/api/auth/me').set('Cookie', u.cookie)).status).toBe(401);
    expect((await post('/login', { email: u.email, password: pass })).status).toBe(401);
    expect((await post('/login', { email: u.email, password: pass + 'new' })).body.stage).toBe('mfa_required');
  });
  it('rejects expired reset tokens without changing credentials', async () => {
    const u = await owner('expired');
    await post('/forgot-password', { email: u.email });
    const token = await findMail(u.email, 'reset');
    await db.authToken.update({ where: { tokenHash: digest(token) }, data: { expiresAt: new Date(0) } });
    expect((await post('/reset-password', { token, password: pass + 'new' })).status).toBe(400);
  });
  it('limits repeated login attempts across application instances', async () => {
    const address = ip(), email = `${run}-missing@example.test`;
    for (let i = 0; i < 10; i++) expect((await post('/login', { email, password: pass }, undefined, address)).status).toBe(401);
    const second = new AuthService(db, settings);
    await expect(second.limit('login-email', email, 10)).rejects.toMatchObject({ status: 429 });
    expect((await post('/login', { email, password: pass }, undefined, address)).status).toBe(429);
  });
  it('scopes invitations and member disabling to the owner business', async () => {
    const a = await owner('tenant-a'), b = await owner('tenant-b');
    const email = `${run}-staff@example.test`;
    expect((await post('/invitations', { businessId: b.businessId, email, role: 'CASHIER' }, a)).status).toBe(403);
    expect((await post('/invitations', { businessId: a.businessId, email, role: 'CASHIER' }, a)).status).toBe(202);
    const token = await findMail(email, 'invite');
    expect((await post('/invitations/accept', { token, name: 'Staff Person', password: pass })).status).toBe(200);
    expect((await post('/invitations/accept', { token, name: 'Staff Person', password: pass })).status).toBe(400);
    const staff = await db.authUser.findUniqueOrThrow({ where: { email } }); userIds.push(staff.id);
    const login = await post('/login', { email, password: pass });
    expect(login.body.memberships).toHaveLength(1); expect(login.body.memberships[0].businessId).toBe(a.businessId);
    const session = { cookie: cookie(login), csrf: login.body.csrfToken };
    expect((await post('/invitations', { businessId: a.businessId, email: 'bad@example.test', role: 'VIEWER' }, session)).status).toBe(403);
    const membership = await db.membership.findFirstOrThrow({ where: { userId: staff.id } });
    expect((await post('/members/disable', { membershipId: membership.id }, b)).status).toBe(403);
    expect((await post('/members/disable', { membershipId: membership.id }, a)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', session.cookie)).status).toBe(401);
    const reLogin = await post('/login', { email, password: pass });
    expect(reLogin.body.memberships).toEqual([]);
  });
  it('never replaces an existing account password through an invitation', async () => {
    const a = await owner('invite-existing-a'), b = await owner('invite-existing-b');
    await post('/invitations', { businessId: a.businessId, email: b.email, role: 'VIEWER' }, a);
    const token = await findMail(b.email, 'invite');
    expect((await post('/invitations/accept', { token, name: 'Attacker', password: 'Replacement password 123' })).status).toBe(401);
    expect((await post('/invitations/accept', { token }, b)).status).toBe(200);
    expect((await post('/login', { email: b.email, password: pass })).status).toBe(200);
  });
  it('revokes sessions and rejects disabled accounts immediately', async () => {
    const u = await owner('revoke');
    const list = await request(app).get('/api/auth/sessions').set('Cookie', u.cookie);
    expect(list.body[0].current).toBe(true); expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    expect((await post('/lock', {}, u)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', u.cookie)).status).toBe(401);
    const login = await post('/login', { email: u.email, password: pass });
    await db.authUser.update({ where: { id: u.userId }, data: { disabledAt: new Date() } });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(login))).status).toBe(401);
    expect((await post('/login', { email: u.email, password: pass })).status).toBe(401);
  });
  it('changes passwords atomically and invalidates outstanding reset links', async () => {
    const u = await owner('password-change');
    await post('/forgot-password', { email: u.email });
    const reset = await findMail(u.email, 'reset');
    expect((await post('/password', { currentPassword: 'incorrect', password: pass + 'next' }, u)).status).toBe(401);
    expect((await post('/password', { currentPassword: pass, password: pass + 'next' }, u)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', u.cookie)).status).toBe(401);
    expect((await post('/reset-password', { token: reset, password: pass })).status).toBe(400);
    expect((await post('/login', { email: u.email, password: pass + 'next' })).body.stage).toBe('mfa_required');
  });
  it('blocks revoked invitations and protects owner membership', async () => {
    const u = await owner('revoked-invite'), email = `${run}-revoked@example.test`;
    expect((await post('/invitations', { businessId: u.businessId, email, role: 'OWNER' }, u)).status).toBe(422);
    await post('/invitations', { businessId: u.businessId, email, role: 'VIEWER' }, u);
    const token = await findMail(email, 'invite');
    const invitation = await db.invitation.findUniqueOrThrow({ where: { tokenHash: digest(token) } });
    expect((await post('/invitations/revoke', { invitationId: invitation.id }, u)).status).toBe(200);
    expect((await post('/invitations/accept', { token, name: 'Test', password: pass })).status).toBe(400);
    const member = await db.membership.findFirstOrThrow({ where: { userId: u.userId } });
    expect((await post('/members/disable', { membershipId: member.id }, u)).status).toBe(403);
  });
  it('rejects idle and absolute session expiry', async () => {
    const u = await owner('session-expiry');
    await db.authSession.updateMany({ where: { userId: u.userId }, data: { lastSeenAt: new Date(Date.now() - 31 * 60000) } });
    expect((await request(app).get('/api/auth/me').set('Cookie', u.cookie)).status).toBe(401);
    const login = await post('/login', { email: u.email, password: pass });
    await db.authSession.updateMany({ where: { userId: u.userId }, data: { expiresAt: new Date(0) } });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(login))).status).toBe(401);
  });
  it('uses Secure host-only cookies in production', async () => {
    const u = await owner('secure');
    const secureSettings = { ...settings, secure: true, cookieName: '__Host-pl_session' };
    const secureApp = createApp({ CORS_ORIGINS: [settings.appOrigin] }, pino({ level: 'silent' }), async () => {}, new AuthService(db, secureSettings));
    const r = await request(secureApp).post('/api/auth/login').set('Origin', settings.appOrigin).send({ email: u.email, password: pass });
    const header = String(r.headers['set-cookie']);
    expect(header).toContain('__Host-pl_session='); expect(header).toContain('Secure'); expect(header).toContain('HttpOnly'); expect(header).toContain('SameSite=Lax'); expect(header).not.toContain('Domain=');
  });
  it('leases mail, retries safely and clears delivered encrypted content', async () => {
    // Defer this suite's pending mail so this isolated test can target one row.
    await db.authMail.updateMany({ where: { id: { in: mailIds } }, data: { availableAt: new Date(Date.now() + 3600000) } });
    const id = randomUUID(); mailIds.push(id);
    await db.authMail.create({ data: { id, payload: encrypt(settings.key, JSON.stringify({ to: 'sink@example.test', subject: 'Test', text: 'private-token' }), `mail:${id}`) } });
    const failing = await deliverMailBatch(db, settings, async () => { throw new Error('SMTP unavailable'); }, 1);
    expect(failing.failed).toBe(1);
    expect((await db.authMail.findUniqueOrThrow({ where: { id } })).deliveredAt).toBeNull();
    await db.authMail.update({ where: { id }, data: { availableAt: new Date(0) } });
    const delivered: string[] = [];
    const results = await Promise.all([deliverMailBatch(db, settings, async mail => { delivered.push(mail.text); }, 1), deliverMailBatch(db, settings, async mail => { delivered.push(mail.text); }, 1)]);
    expect(results.reduce((n, r) => n + r.delivered, 0), JSON.stringify({results, delivered: delivered.map(t => t === 'private-token' ? 'target' : 'other')})).toBe(1);
    expect(delivered).toEqual(['private-token']);
    expect((await db.authMail.findUniqueOrThrow({ where: { id } })).payload).toBe('');
  });
});
