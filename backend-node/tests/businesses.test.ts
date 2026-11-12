import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { passwordHash, csrfFor, encrypt, randomToken, digest } from '../src/auth/crypto.js';
import type { MembershipRole, PlatformRole } from '../src/generated/prisma/client.js';
import { effectivePermissions, permissionKeys } from '../src/businesses/permissions.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const db = createDatabase(url), settings = readAuthSettings({ AUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:3000' });
const auth = new AuthService(db, settings), app = createApp({ CORS_ORIGINS: [settings.appOrigin] }, pino({ level: 'silent' }), async () => {}, auth);
const ids: string[] = [], businesses: string[] = [];
let hash: string, planId: string;
type Actor = { id: string; membershipId?: string; cookie: string; csrf: string };
let a: string, b: string, ownerA: Actor, ownerB: Actor;
async function session(id: string): Promise<Actor> {
  const user = await db.authUser.findUniqueOrThrow({ where: { id } });
  const ctx = await auth.transaction(tx => auth.makeSession(tx, user, true));
  return { id, cookie: `pl_session=${ctx.token}`, csrf: csrfFor(settings.key, ctx.token) };
}
async function actor(role?: MembershipRole, businessId = a, platformRole: PlatformRole = 'USER'): Promise<Actor> {
  const id = randomUUID(); ids.push(id);
  await db.authUser.create({ data: { id, email: `${id}@example.test`, name: `Test ${role ?? platformRole}`, passwordHash: hash, platformRole, emailVerifiedAt: new Date(),
    ...(role === 'OWNER' || platformRole === 'SUPER_ADMIN' ? { mfaSecret: encrypt(settings.key, 'JBSWY3DPEHPK3PXP', `mfa:${id}`) } : {}) } });
  const member = role ? await db.membership.create({ data: { userId: id, businessId, role } }) : undefined;
  return { ...await session(id), membershipId: member?.id };
}
function get(path: string, user: Actor) { return request(app).get(`/api/businesses${path}`).set('Cookie', user.cookie); }
function write(path: string, body: object, user: Actor, method: 'patch' | 'post' = 'patch') {
  return request(app)[method](`/api/businesses${path}`).set('Cookie', user.cookie).set('Origin', settings.appOrigin).set('X-CSRF-Token', user.csrf).send(body);
}
beforeAll(async () => {
  hash = await passwordHash('Integration test passphrase 142!');
  a = (await db.business.create({ data: { name: 'Tenant Alpha' } })).id;
  b = (await db.business.create({ data: { name: 'Tenant Beta' } })).id; businesses.push(a, b);
  planId = (await db.billingPlan.create({ data: { code: `test-${randomUUID()}`, name: 'Test plan', nameAr: 'اختبار', maxMembers: 100, maxWarehouses: 1, maxShops: 1 } })).id;
  await db.businessSubscription.createMany({ data: [a,b].map(businessId => ({ businessId, planId, trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000) })) });
  ownerA = await actor('OWNER', a); ownerB = await actor('OWNER', b);
});
afterAll(async () => {
  await db.authAudit.deleteMany({ where: { OR: [{ businessId: { in: businesses } }, { userId: { in: ids } }] } });
  await db.business.deleteMany({ where: { id: { in: businesses } } });
  await db.authUser.deleteMany({ where: { id: { in: ids } } });
  if (planId) await db.billingPlan.delete({ where: { id: planId } });
  await db.$disconnect();
});
describe('tenant authorization', () => {
  it('exposes only current memberships and never treats platform admin as a customer owner', async () => {
    const admin = await actor(undefined, a, 'SUPER_ADMIN');
    expect((await get('', ownerA)).body.map((v: { id: string }) => v.id)).toEqual([a]);
    expect((await get('', admin)).body).toEqual([]);
    for (const suffix of ['', '/members', '/roles', '/invitations', '/audit']) {
      expect((await get(`/${b}${suffix}`, ownerA)).status).toBe(403);
      expect((await get(`/${a}${suffix}`, admin)).status).toBe(403);
    }
    expect((await request(app).get(`/api/businesses/${a}`)).status).toBe(401);
  });
  it('requires MFA completion even with an owner membership', async () => {
    const user = await db.authUser.findUniqueOrThrow({ where: { id: ownerA.id } });
    const pending = await auth.transaction(tx => auth.makeSession(tx, user, false));
    expect((await request(app).get(`/api/businesses/${a}`).set('Cookie', `pl_session=${pending.token}`)).status).toBe(403);
  });
  it('returns business and team information according to every role', async () => {
    for (const role of ['OPERATIONS_MANAGER','WAREHOUSE_STAFF','SHOP_MANAGER','CASHIER','VIEWER'] as const) {
      const user = await actor(role);
      const context = await get(`/${a}`, user);
      expect(context.status).toBe(200); expect(context.body.role).toBe(role);
      expect(context.body.permissions).toEqual(effectivePermissions(role, {}));
      expect((await get(`/${a}/members`, user)).status).toBe(role === 'OPERATIONS_MANAGER' ? 200 : 403);
      expect((await write(`/${a}`, { revision: 0, name: 'Unauthorized' }, user)).status).toBe(403);
    }
    const catalog = await get(`/${a}/roles`, ownerA);
    expect(catalog.body.roles).toHaveLength(6);
    expect(Object.keys(catalog.body.permissions)).toEqual(permissionKeys);
  });
  it('checks suspension and disabled membership live, without stale role claims', async () => {
    const user = await actor('VIEWER');
    await db.membership.update({ where: { id: user.membershipId }, data: { disabledAt: new Date() } });
    expect((await get(`/${a}`, user)).status).toBe(403);
    expect((await get('', user)).body).toEqual([]);
    await db.business.update({ where: { id: b }, data: { suspendedAt: new Date() } });
    expect((await get(`/${b}`, ownerB)).status).toBe(403);
    expect((await get('', ownerB)).body).toEqual([]);
    await db.business.update({ where: { id: b }, data: { suspendedAt: null } });
  });
  it('enforces origin, CSRF, strict writable fields and valid selectors', async () => {
    expect((await request(app).patch(`/api/businesses/${a}`).set('Cookie', ownerA.cookie).send({ revision: 0, name: 'No origin' })).status).toBe(403);
    expect((await request(app).patch(`/api/businesses/${a}`).set('Cookie', ownerA.cookie).set('Origin', settings.appOrigin).send({ revision: 0, name: 'No CSRF' })).status).toBe(403);
    expect((await write(`/${a}`, { revision: 0, suspendedAt: null }, ownerA)).status).toBe(422);
    expect((await write(`/${a}`, { revision: 0, timezone: 'not-a-zone' }, ownerA)).status).toBe(422);
    expect((await get('/invalid-id', ownerA)).status).toBe(400);
    expect((await get(`/${a}/members?pageSize=10000`, ownerA)).status).toBe(422);
  });
  it('prevents lost settings edits and audits only the successful change', async () => {
    const current = (await get(`/${a}`, ownerA)).body.business;
    const results = await Promise.all([
      write(`/${a}`, { revision: current.revision, name: 'Alpha first edit', timezone: 'Asia/Dubai' }, ownerA),
      write(`/${a}`, { revision: current.revision, name: 'Alpha second edit', timezone: 'Asia/Dubai' }, ownerA),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200,409]);
    const changed = (await get(`/${a}`, ownerA)).body.business;
    expect(changed.revision).toBe(current.revision + 1);
    const audit = await get(`/${a}/audit`, ownerA);
    const updates = audit.body.items.filter((r: { action: string }) => r.action === 'business.updated');
    expect(updates).toHaveLength(1); expect(updates[0].changes.name.before).toBe(current.name);
    expect((await get(`/${b}/audit`, ownerB)).body.total).toBe(0);
  });
  it('locks currency after financial activity without blocking unrelated settings', async () => {
    await db.business.update({ where: { id: b }, data: { currencyLockedAt: new Date() } });
    const before = (await get(`/${b}`, ownerB)).body.business;
    expect((await write(`/${b}`, { revision: before.revision, baseCurrency: 'AED' }, ownerB)).body.error.code).toBe('CURRENCY_LOCKED');
    expect((await write(`/${b}`, { revision: before.revision, dateFormat: 'ymd' }, ownerB)).status).toBe(200);
  });
  it('rejects cross-tenant target IDs and ownership escalation', async () => {
    const other = await actor('CASHIER', b);
    expect((await write(`/${a}/members/${other.membershipId}`, { revision: 0, active: false }, ownerA)).status).toBe(404);
    const staff = await actor('CASHIER');
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision: 0, role: 'OWNER' }, ownerA)).status).toBe(422);
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision: 0, permissionOverrides: { 'billing.manage': true } }, ownerA)).status).toBe(422);
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision: 0, permissionOverrides: { 'unknown.permission': true } }, ownerA)).status).toBe(422);
    expect((await write(`/${a}/members/${ownerA.membershipId}`, { revision: 0, active: false }, ownerA)).status).toBe(403);
    expect((await db.membership.findUniqueOrThrow({ where: { id: other.membershipId } })).disabledAt).toBeNull();
  });
  it('applies overrides, resets them on role changes, and revokes prior sessions', async () => {
    let staff = await actor('VIEWER');
    const id = staff.membershipId!;
    const first = await write(`/${a}/members/${id}`, { revision: 0, permissionOverrides: { 'team.view': true, 'roles.view': true } }, ownerA);
    expect(first.status).toBe(200); expect(first.body.permissions['team.view']).toBe(true);
    expect((await get(`/${a}`, staff)).status).toBe(401);
    staff = { ...await session(staff.id), membershipId: id };
    expect((await get(`/${a}/members`, staff)).status).toBe(200);
    expect((await get(`/${a}/members`, staff)).body.items[0]).not.toHaveProperty('permissionOverrides');
    const second = await write(`/${a}/members/${id}`, { revision: 1, role: 'CASHIER' }, ownerA);
    expect(second.body.permissionOverrides).toEqual({}); expect(second.body.permissions['team.view']).toBe(false);
    staff = { ...await session(staff.id), membershipId: id };
    expect((await get(`/${a}/members`, staff)).status).toBe(403);
    const stale = await write(`/${a}/members/${id}`, { revision: 1, active: false }, ownerA);
    expect(stale.status).toBe(409);
  });
  it('disables and restores memberships without reusing old sessions', async () => {
    const staff = await actor('SHOP_MANAGER');
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision: 0, active: false }, ownerA)).status).toBe(200);
    expect((await get(`/${a}`, staff)).status).toBe(401);
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision: 1, active: true }, ownerA)).status).toBe(200);
    expect((await get(`/${a}`, staff)).status).toBe(401);
    expect((await get(`/${a}`, await session(staff.id))).status).toBe(200);
  });
  it('paginates members and exposes no credential/session secrets', async () => {
    const page = await get(`/${a}/members?page=1&pageSize=2`, ownerA);
    expect(page.body.items).toHaveLength(2); expect(page.body.total).toBeGreaterThan(2);
    const serialized = JSON.stringify(page.body);
    for (const secret of ['passwordHash','mfaSecret','tokenHash','recoveryHashes']) expect(serialized).not.toContain(secret);
    const next = await get(`/${a}/members?page=2&pageSize=2`, ownerA);
    expect(next.body.items.map((r: { id: string }) => r.id)).not.toContain(page.body.items[0].id);
  });
  it('scopes invitation lists/revocation and never returns token hashes', async () => {
    const id = randomUUID();
    await db.invitation.create({ data: { id, businessId: b, email: 'invited@example.test', role: 'VIEWER', invitedBy: ownerB.id, tokenHash: digest(randomToken()), expiresAt: new Date(Date.now() + 3600000) } });
    expect((await write(`/${a}/invitations/${id}/revoke`, {}, ownerA, 'post')).status).toBe(404);
    const list = await get(`/${b}/invitations`, ownerB);
    expect(list.body.items[0].status).toBe('pending'); expect(list.body.items[0]).not.toHaveProperty('tokenHash');
    expect((await write(`/${b}/invitations/${id}/revoke`, {}, ownerB, 'post')).status).toBe(200);
    expect((await get(`/${b}/invitations`, ownerB)).body.items[0].status).toBe('revoked');
  });
});

describe('personal dashboard preferences', () => {
  it('persists per membership without changing permissions or another user’s preferences', async () => {
    const viewer = await actor('VIEWER', a);
    const before = (await get(`/${a}`, ownerA)).body;
    expect((await write(`/${a}/preferences`, {hiddenTabs:['sales','locations','sales']}, ownerA)).body.hiddenTabs).toEqual(['sales','locations']);
    expect((await write(`/${a}/preferences`, {hiddenTabs:['sales','locations'],tabOrder:['settings','dashboard','sales']}, ownerA)).body.tabOrder).toEqual(['settings','dashboard','sales']);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],tabOrder:['sales','sales']}, ownerA)).status).toBe(422);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],tabOrder:['unknown']}, ownerA)).status).toBe(422);
    const after = (await get(`/${a}`, ownerA)).body;
    expect(after.tabOrder).toEqual(['settings','dashboard','sales']);
    expect((await get(`/${a}`, viewer)).body.tabOrder).toEqual([]);
    expect(after.hiddenTabs).toEqual(['sales','locations']);
    expect(after.permissions).toEqual(before.permissions);
    expect((await get(`/${a}`, viewer)).body.hiddenTabs).toEqual([]);
    expect((await write(`/${a}/preferences`, {hiddenTabs:['reports']}, viewer)).status).toBe(200);
    expect((await write(`/${b}/preferences`, {hiddenTabs:['sales']}, ownerA)).status).toBe(403);
    expect((await get(`/${b}`, ownerB)).body.hiddenTabs).toEqual([]);
    for(const key of ['settings','security','dashboard','unknown'])expect((await write(`/${a}/preferences`, {hiddenTabs:[key]}, ownerA)).status).toBe(422);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],userId:ownerB.id}, ownerA)).status).toBe(422);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[]}, ownerA)).body.hiddenTabs).toEqual([]);
  });
});
describe('delegated permission administrators',()=>{
 it('allows an owner to delegate, limits grants, protects peers and self, and audits changes',async()=>{
  let manager=await actor('OPERATIONS_MANAGER'),staff=await actor('CASHIER');
  expect((await write(`/${a}/members/${staff.membershipId}`,{revision:0,permissionOverrides:{'catalogue.create':true}},manager)).status).toBe(403);
  expect((await write(`/${a}/members/${manager.membershipId}`,{revision:0,permissionOverrides:{'team.manage':true,'catalogue.cost':false}},ownerA)).status).toBe(200);
  manager={...await session(manager.id),membershipId:manager.membershipId};
  const members=await get(`/${a}/members`,manager);expect(members.status).toBe(200);expect(members.body.permissionKeys).toContain('catalogue.create');expect(members.body.permissionKeys).not.toContain('team.manage');
  expect((await write(`/${a}/members/${staff.membershipId}`,{revision:0,permissionOverrides:{'catalogue.cost':true}},manager)).status).toBe(403);
  expect((await write(`/${a}/members/${staff.membershipId}`,{revision:0,permissionOverrides:{'team.manage':true}},manager)).status).toBe(403);
  expect((await write(`/${a}/members/${manager.membershipId}`,{revision:1,active:false},manager)).status).toBe(403);
  expect((await write(`/${a}/members/${ownerA.membershipId}`,{revision:0,active:false},manager)).status).toBe(403);
  const result=await write(`/${a}/members/${staff.membershipId}`,{revision:0,permissionOverrides:{'catalogue.create':true,'catalogue.edit':false,'returns.approve':true}},manager);
  expect(result.status,result.text).toBe(200);expect(result.body.permissions['catalogue.create']).toBe(true);expect(result.body.permissions['catalogue.edit']).toBe(false);
  expect((await get(`/${a}`,staff)).status).toBe(401);
  expect(await db.authAudit.count({where:{userId:manager.id,targetId:staff.membershipId,action:'membership.updated'}})).toBe(1);
  const other=await actor('CASHIER',b);expect((await write(`/${a}/members/${other.membershipId}`,{revision:0,active:false},manager)).status).toBe(404);
 });
});
