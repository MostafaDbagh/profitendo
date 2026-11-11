import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { csrfFor, encrypt, passwordHash, digest, randomToken } from '../src/auth/crypto.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const db = createDatabase(url), settings = readAuthSettings({ AUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:3000' });
const auth = new AuthService(db, settings), app = createApp({ CORS_ORIGINS: [settings.appOrigin] }, pino({ level: 'silent' }), async () => {}, auth);
const ids: string[] = [], bids: string[] = [], tag = randomUUID();
type Actor = { id: string; cookie: string; csrf: string };
let admin: Actor, owner: Actor, business: string, hash: string;
async function actor(adminRole = false, mfa = true) {
  const id = randomUUID(); ids.push(id);
  const user = await db.authUser.create({ data: { id, name: `Platform ${tag}`, email: `${id}@example.test`, passwordHash: hash, emailVerifiedAt: new Date(), platformRole: adminRole ? 'SUPER_ADMIN' : 'USER', ...(adminRole ? { mfaSecret: encrypt(settings.key, 'JBSWY3DPEHPK3PXP', `mfa:${id}`) } : {}) } });
  const session = await auth.transaction(tx => auth.makeSession(tx, user, mfa));
  return { id, cookie: `pl_session=${session.token}`, csrf: csrfFor(settings.key, session.token) };
}
const get = (path: string, actor: Actor) => request(app).get(`/api/platform${path}`).set('Cookie', actor.cookie);
const patch = (path: string, body: object, actor = admin) => request(app).patch(`/api/platform${path}`).set('Cookie', actor.cookie).set('Origin', settings.appOrigin).set('X-CSRF-Token', actor.csrf).send(body);
beforeAll(async () => {
  hash = await passwordHash('Platform testing password 151!');
  admin = await actor(true); owner = await actor();
  business = (await db.business.create({ data: { name: `Platform business ${tag}` } })).id; bids.push(business);
  await db.membership.create({ data: { userId: owner.id, businessId: business, role: 'OWNER' } });
});
afterAll(async () => {
  await db.platformAudit.deleteMany({ where: { actorId: { in: ids } } });
  await db.authAudit.deleteMany({ where: { OR: [{ userId: { in: ids } }, { businessId: { in: bids } }] } });
  await db.business.deleteMany({ where: { id: { in: bids } } }); await db.authUser.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
});
it('requires a live platform administrator and completed MFA on every endpoint', async () => {
  const pending = await actor(true, false);
  for (const path of ['/overview','/businesses','/users','/audit']) {
    expect((await get(path, owner)).status).toBe(403);
    expect((await get(path, pending)).status).toBe(403);
    expect((await get(path, admin)).status).toBe(200);
    expect((await request(app).get(`/api/platform${path}`)).status).toBe(401);
  }
  expect((await patch(`/businesses/${business}/status`, { revision: 0, active: false, reason: 'Forbidden attempt' }, owner)).status).toBe(403);
  expect((await request(app).get(`/api/businesses/${business}`).set('Cookie', admin.cookie)).status).toBe(403);
});
it('rechecks demoted and disabled administrators', async () => {
  const demoted = await actor(true); await db.authUser.update({ where: { id: demoted.id }, data: { platformRole: 'USER' } });
  expect((await get('/overview', demoted)).status).toBe(403);
  const disabled = await actor(true); await db.authUser.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
  expect((await get('/overview', disabled)).status).toBe(401);
});
it('validates status/reason/revision, identifiers, pagination, origin and CSRF', async () => {
  const path = `/businesses/${business}/status`, valid = { revision: 0, active: false, reason: 'Support investigation' };
  for (const body of [{ ...valid, reason: ' ' }, { ...valid, revision: -1 }, { ...valid, platformRole: 'SUPER_ADMIN' }, { ...valid, active: 'false' }]) expect((await patch(path, body)).status).toBe(422);
  expect((await patch('/businesses/nope/status', valid)).status).toBe(400);
  expect((await request(app).patch(`/api/platform${path}`).set('Cookie', admin.cookie).set('Origin', settings.appOrigin).send(valid)).status).toBe(403);
  expect((await request(app).patch(`/api/platform${path}`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send(valid)).status).toBe(403);
  for (const q of ['page=0','pageSize=101','status=unknown','extra=true']) expect((await get(`/users?${q}`, admin)).status).toBe(422);
});
it('returns minimal searchable paginated account and business metadata', async () => {
  const users = await get(`/users?q=${owner.id}&pageSize=1`, admin);
  expect(users.body.total).toBe(1); expect(users.body.items).toHaveLength(1);
  expect(users.body.items[0]).not.toHaveProperty('passwordHash'); expect(users.body.items[0]).not.toHaveProperty('mfaSecret'); expect(users.body.items[0]).not.toHaveProperty('recoveryHashes');
  const businesses = await get(`/businesses?q=${tag}`, admin);
  expect(businesses.body.items[0]).toMatchObject({ id: business, memberCount: 1, active: true });
  expect(businesses.body.items[0]).not.toHaveProperty('memberships'); expect(businesses.body.items[0]).not.toHaveProperty('baseCurrency');
  expect(users.headers['cache-control']).toBe('no-store');
});
it('suspends business access, revokes invitations and records only platform audit', async () => {
  const token = randomToken();
  const invitation = await db.invitation.create({ data: { businessId: business, invitedBy: owner.id, email: 'platform-invite@example.test', role: 'VIEWER', tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
  const result = await patch(`/businesses/${business}/status`, { revision: 0, active: false, reason: 'Support requested suspension' }); expect(result.status).toBe(200);
  expect((await request(app).get(`/api/businesses/${business}`).set('Cookie', owner.cookie)).status).toBe(403);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).revokedAt).not.toBeNull();
  expect(await db.platformAudit.count({ where: { targetId: business } })).toBe(1);
  expect(await db.authAudit.count({ where: { businessId: business } })).toBe(0);
  expect((await get(`/businesses?q=${tag}&status=inactive`, admin)).body.total).toBe(1);
});
it('reactivates with revision checks without resurrecting revoked invitations', async () => {
  expect((await patch(`/businesses/${business}/status`, { revision: 0, active: true, reason: 'Reviewed by support' })).status).toBe(409);
  expect((await patch(`/businesses/${business}/status`, { revision: 1, active: true, reason: 'Reviewed by support' })).status).toBe(200);
  expect((await request(app).get(`/api/businesses/${business}`).set('Cookie', owner.cookie)).status).toBe(200);
  expect(await db.invitation.count({ where: { businessId: business, revokedAt: null } })).toBe(0);
  const auditCount = await db.platformAudit.count({ where: { targetId: business } });
  expect((await patch(`/businesses/${business}/status`, { revision: 2, active: true, reason: 'Repeated request' })).body.changed).toBe(false);
  expect(await db.platformAudit.count({ where: { targetId: business } })).toBe(auditCount);
});
it('disables a customer globally and prevents old sessions or reset links being restored', async () => {
  const customer = await actor();
  await db.authToken.create({ data: { userId: customer.id, kind: 'PASSWORD_RESET', tokenHash: digest(randomToken()), expiresAt: new Date(Date.now() + 60000) } });
  expect((await patch(`/users/${customer.id}/status`, { revision: 0, active: false, reason: 'Customer requested lock' })).status).toBe(200);
  expect(await db.authSession.count({ where: { userId: customer.id } })).toBe(0);
  expect(await db.authToken.count({ where: { userId: customer.id, usedAt: null } })).toBe(0);
  expect((await patch(`/users/${customer.id}/status`, { revision: 0, active: true, reason: 'Customer verified identity' })).status).toBe(409);
  expect((await patch(`/users/${customer.id}/status`, { revision: 1, active: true, reason: 'Customer verified identity' })).status).toBe(200);
  expect((await request(app).get('/api/auth/me').set('Cookie', customer.cookie)).status).toBe(401);
});
it('protects all administrators from disabling, including self', async () => {
  for (const target of [admin, await actor(true)]) expect((await patch(`/users/${target.id}/status`, { revision: 0, active: false, reason: 'Attempted admin lockout' })).status).toBe(403);
  expect((await patch(`/users/${randomUUID()}/status`, { revision: 0, active: false, reason: 'Missing customer' })).status).toBe(404);
});
it('allows only one concurrent status change and audits only the committed change', async () => {
  const b = await db.business.create({ data: { name: 'Concurrent platform test' } }); bids.push(b.id);
  const results = await Promise.all([1,2].map(() => patch(`/businesses/${b.id}/status`, { revision: 0, active: false, reason: 'Concurrent support request' })));
  expect(results.map(r => r.status).sort()).toEqual([200,409]);
  expect(await db.platformAudit.count({ where: { targetId: b.id } })).toBe(1);
});
it('exposes paginated platform history with actor and target names', async () => {
  const history = await get('/audit?pageSize=1', admin);
  expect(history.body.items).toHaveLength(1); expect(history.body.items[0]).toMatchObject({ actorId: admin.id, beforeActive: true, afterActive: false });
  expect(history.body.items[0].actorName).toBeTruthy(); expect(history.body.items[0].targetName).toBeTruthy();
});
