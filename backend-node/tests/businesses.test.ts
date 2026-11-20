import { BusinessService } from '../src/businesses/service.js';
import { acceptInvitation } from '../src/auth/invitations.js';
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { passwordMatches, passwordHash, csrfFor, encrypt, randomToken, digest, totp } from '../src/auth/crypto.js';
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
  it('allows audited currency changes after financial activity without conversion', async () => {
    await db.business.update({ where: { id: b }, data: { currencyLockedAt: new Date() } });
    const before = (await get(`/${b}`, ownerB)).body.business;
    const changed = await write(`/${b}`, { revision: before.revision, baseCurrency: 'AED' }, ownerB);
    expect(changed.status).toBe(200); expect(changed.body.baseCurrency).toBe('AED');
    expect((await write(`/${b}`, { revision: before.revision + 1, dateFormat: 'ymd' }, ownerB)).status).toBe(200);
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
  it('lets owners remove every staff role, custom roles and delegated admins with immediate access revocation', async () => {
    const custom = await write(`/${a}/roles`, { name: 'Removal test admin', permissions: { 'team.manage': true, 'team.view': true } }, ownerA, 'post');
    expect(custom.status).toBe(201);
    for (const role of ['OPERATIONS_MANAGER', 'WAREHOUSE_STAFF', 'SHOP_MANAGER', 'CASHIER', 'VIEWER', 'CUSTOM'] as const) {
      let staff = await actor(role === 'CUSTOM' ? 'VIEWER' : role);
      let revision = 0;
      if (role === 'CUSTOM') {
        expect((await write(`/${a}/members/${staff.membershipId}`, { revision, customRoleId: custom.body.role }, ownerA)).status).toBe(200);
        revision++;
        staff = { ...await session(staff.id), membershipId: staff.membershipId };
      }
      const listed = await get(`/${a}/members?pageSize=100`, ownerA);
      expect(listed.body.items.find((m: { id: string }) => m.id === staff.membershipId).canEdit).toBe(true);
      const removed = await write(`/${a}/members/${staff.membershipId}`, { revision, active: false }, ownerA);
      expect(removed.status, removed.text).toBe(200);
      expect(removed.body.active).toBe(false);
      expect((await get(`/${a}`, staff)).status).toBe(401);
      expect((await get(`/${a}`, await session(staff.id))).status).toBe(403);
      expect(await db.authUser.count({ where: { id: staff.id } })).toBe(1);
      expect(await db.authAudit.count({ where: { businessId: a, targetId: staff.membershipId, action: 'membership.updated' } })).toBeGreaterThan(0);
    }
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
  it('persists owner cashier mode without changing role, grants or other memberships', async () => {
    const cashier = await actor('CASHIER');
    const before = (await get(`/${a}`, ownerA)).body;
    const enabled = await write(`/${a}/preferences`, {hiddenTabs:['sales'],ownerAsCashier:true}, ownerA);
    expect(enabled.status).toBe(200);
    expect(enabled.body.ownerAsCashier).toBe(true);
    const after = (await get(`/${a}`, ownerA)).body;
    expect(after.ownerAsCashier).toBe(true);
    expect(after.role).toBe('OWNER');
    expect(after.permissions).toEqual(before.permissions);
    expect(after.permissions['sales.create']).toBe(true);
    expect(after.permissions['cash.close']).toBe(true);
    expect((await get(`/${a}`, cashier)).body.ownerAsCashier).toBe(false);
    expect((await get(`/${b}`, ownerB)).body.ownerAsCashier).toBe(false);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:true}, cashier)).status).toBe(403);
    expect((await write(`/${b}/preferences`, {hiddenTabs:[],ownerAsCashier:true}, ownerA)).status).toBe(403);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:'true'}, ownerA)).status).toBe(422);
    expect((await write(`/${a}/preferences`, {hiddenTabs:['sales']}, ownerA)).body.ownerAsCashier).toBe(true);
    expect((await write(`/${a}/preferences`, {hiddenTabs:['sales'],ownerAsCashier:false}, ownerA)).body.ownerAsCashier).toBe(false);
    expect((await get(`/${a}`, ownerA)).body.permissions).toEqual(before.permissions);
  });
  it('protects cashier preferences with CSRF, membership and owner checks and audits changes once', async () => {
    for (const role of ['OPERATIONS_MANAGER','SHOP_MANAGER','WAREHOUSE_STAFF','VIEWER'] as const) {
      const staff = await actor(role);
      expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:true}, staff)).status).toBe(403);
    }
    const platform = await actor(undefined,a,'SUPER_ADMIN');
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:true}, platform)).status).toBe(403);
    expect((await request(app).patch(`/api/businesses/${a}/preferences`).set('Cookie',ownerA.cookie).set('Origin',settings.appOrigin).send({hiddenTabs:[],ownerAsCashier:true})).status).toBe(403);
    const before=await db.authAudit.count({where:{businessId:a,action:'membership.owner_cashier_updated'}});
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:true}, ownerA)).status).toBe(200);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:true}, ownerA)).status).toBe(200);
    expect(await db.authAudit.count({where:{businessId:a,action:'membership.owner_cashier_updated'}})).toBe(before+1);
    const fresh = await session(ownerA.id);
    expect((await get(`/${a}`,fresh)).body.ownerAsCashier).toBe(true);
    await db.membership.update({where:{id:ownerA.membershipId!},data:{disabledAt:new Date()}});
    try { expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:false}, fresh)).status).toBe(403); }
    finally { await db.membership.update({where:{id:ownerA.membershipId!},data:{disabledAt:null}}); }
    expect((await get(`/${a}`,ownerA)).body.ownerAsCashier).toBe(true);
    expect((await write(`/${a}/preferences`, {hiddenTabs:[],ownerAsCashier:false}, ownerA)).status).toBe(200);
  });
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


describe('custom business roles', () => {
  it('creates tenant-local roles, validates names/grants, and audits successful creation', async () => {
    const payload = { name: 'Inventory supervisor', permissions: { 'inventory.view': true, 'catalogue.view': true } };
    const created = await write(`/${a}/roles`, payload, ownerA, 'post');
    expect(created.status, created.text).toBe(201);
    expect(created.body.permissions['inventory.view']).toBe(true);
    expect(created.body.permissions['business.view']).toBe(true);
    expect(created.body.permissions['reports.view']).toBe(false);
    expect(created.body.permissions['billing.manage']).toBe(false);
    expect((await get(`/${a}/roles`, ownerA)).body.roles.some((r: { role: string }) => r.role === created.body.role)).toBe(true);
    expect((await get(`/${b}/roles`, ownerB)).body.roles.some((r: { role: string }) => r.role === created.body.role)).toBe(false);
    expect((await write(`/${a}/roles`, { ...payload, name: ' INVENTORY   supervisor ' }, ownerA, 'post')).status).toBe(409);
    expect((await write(`/${a}/roles`, { ...payload, name: ' ' }, ownerA, 'post')).status).toBe(422);
    for (const key of ['billing.manage', 'unknown.permission']) expect((await write(`/${a}/roles`, { ...payload, permissions: { [key]: true } }, ownerA, 'post')).status).toBe(422);
    const outsider = await actor(undefined, a, 'SUPER_ADMIN'), viewer = await actor('VIEWER');
    expect((await write(`/${a}/roles`, payload, outsider, 'post')).status).toBe(403);
    expect((await write(`/${a}/roles`, payload, viewer, 'post')).status).toBe(403);
    expect((await write(`/${b}/roles`, payload, ownerA, 'post')).status).toBe(403);
    expect((await request(app).post(`/api/businesses/${a}/roles`).set('Cookie', ownerA.cookie).set('Origin', settings.appOrigin).send(payload)).status).toBe(403);
    expect(await db.authAudit.count({ where: { businessId:a, action:'role.created', targetId:created.body.role } })).toBe(1);
  });
  it('assigns custom access, revokes old sessions and rejects cross-tenant role identifiers', async () => {
    const role = await write(`/${a}/roles`, { name:'Stock reader', permissions:{ 'inventory.view':true } }, ownerA, 'post');
    const staff = await actor('CASHIER'), other = await actor('CASHIER', b);
    expect((await write(`/${b}/members/${other.membershipId}`, { revision:0, customRoleId:role.body.role }, ownerB)).status).toBe(404);
    const assigned = await write(`/${a}/members/${staff.membershipId}`, { revision:0, customRoleId:role.body.role }, ownerA);
    expect(assigned.status, assigned.text).toBe(200);
    expect(assigned.body.customRoleId).toBe(role.body.role);
    expect(assigned.body.permissions['inventory.view']).toBe(true);
    expect(assigned.body.permissions['sales.create']).toBe(false);
    expect((await get(`/${a}`, staff)).status).toBe(401);
    expect((await get(`/${a}`, await session(staff.id))).body.permissions['sales.create']).toBe(false);
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision:0, customRoleId:role.body.role }, ownerA)).status).toBe(409);
    const reset = await write(`/${a}/members/${staff.membershipId}`, { revision:1, role:'CASHIER', customRoleId:null }, ownerA);
    expect(reset.body.customRoleId).toBeNull();
    expect(reset.body.permissions['sales.create']).toBe(true);
  });
  it('allows delegated admins to create roles only within their grants and protects administrator assignment', async () => {
    let manager = await actor('OPERATIONS_MANAGER');
    await write(`/${a}/members/${manager.membershipId}`, { revision:0, permissionOverrides:{ 'team.manage':true, 'catalogue.cost':false } }, ownerA);
    manager = { ...await session(manager.id), membershipId:manager.membershipId };
    expect((await get(`/${a}/roles`, manager)).body.canCreate).toBe(true);
    for (const key of ['team.manage','catalogue.cost']) expect((await write(`/${a}/roles`, { name:`Forbidden ${key}`, permissions:{ [key]:true } }, manager, 'post')).status).toBe(403);
    const role = await write(`/${a}/roles`, { name:'Delegated stock reader', permissions:{ 'inventory.view':true } }, manager, 'post');
    expect(role.status).toBe(201);
    const adminRole = await write(`/${a}/roles`, { name:'Team administrator', permissions:{ 'team.manage':true, 'team.view':true, 'roles.view':true } }, ownerA, 'post');
    const staff = await actor('CASHIER');
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision:0, customRoleId:adminRole.body.role }, manager)).status).toBe(403);
    expect((await write(`/${a}/members/${staff.membershipId}`, { revision:0, customRoleId:role.body.role }, manager)).status).toBe(200);
  });
  it('accepts invitations with the saved custom permissions and keeps the tenant relation', async () => {
    const role = await write(`/${a}/roles`, { name:'Invited stock reader', permissions:{ 'inventory.view':true } }, ownerA, 'post');
    const invited = await actor(), user = await db.authUser.findUniqueOrThrow({where:{id:invited.id}}), token=randomToken();
    await db.invitation.create({data:{businessId:a,email:user.email,role:'VIEWER',customRoleId:role.body.role,invitedBy:ownerA.id,tokenHash:digest(token),expiresAt:new Date(Date.now()+3600000)}});
    // Exercise the invitation endpoint without sending or queuing real mail.
    const mail = vi.spyOn(auth, 'queueMail').mockResolvedValue(undefined);
    try {
      expect((await write(`/${b}/invitations`, { email:user.email, customRoleId:role.body.role }, ownerB, 'post')).status).toBe(404);
      expect((await write(`/${a}/invitations`, { email:`second-${user.email}`, customRoleId:role.body.role }, ownerA, 'post')).status).toBe(202);
      expect((await db.invitation.findFirstOrThrow({where:{businessId:a,email:`second-${user.email}`}})).customRoleId).toBe(role.body.role);
    } finally { mail.mockRestore(); }
    const ctx = await auth.transaction(tx=>auth.makeSession(tx,user,true));
    await acceptInvitation(auth,{token},ctx);
    const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:a,userId:user.id}}});
    expect(member.customRoleId).toBe(role.body.role);
    expect(effectivePermissions(member.role,member.permissionOverrides)['reports.view']).toBe(false);
    expect(effectivePermissions(member.role,member.permissionOverrides)['inventory.view']).toBe(true);
  });
});

describe('adding people through team invitations', () => {
  it('allows delegated admins, checks grant limits again at acceptance, and enforces subscription capacity', async () => {
    let manager = await actor('OPERATIONS_MANAGER');
    await write(`/${a}/members/${manager.membershipId}`, {revision:0,permissionOverrides:{'team.manage':true,'catalogue.cost':false}}, ownerA);
    manager = {...await session(manager.id),membershipId:manager.membershipId};
    const invited = await actor(), user = await db.authUser.findUniqueOrThrow({where:{id:invited.id}});
    let token = '';
    const mail = vi.spyOn(auth,'queueMail').mockImplementation(async (_tx,_email,_subject,_action,value) => { token=value; });
    try {
      expect((await write(`/${a}/invitations`,{email:user.email,role:'OPERATIONS_MANAGER'},manager,'post')).status).toBe(403);
      const viewer=await actor('VIEWER');
      expect((await write(`/${a}/invitations`,{email:user.email,role:'CASHIER'},viewer,'post')).status).toBe(403);
      expect((await write(`/${b}/invitations`,{email:user.email,role:'CASHIER'},manager,'post')).status).toBe(403);
      const sent=await write(`/${a}/invitations`,{name:'Invited colleague',email:user.email,role:'CASHIER'},manager,'post');
      expect(sent.status,sent.text).toBe(202);
      expect((await db.invitation.findFirstOrThrow({where:{businessId:a,email:user.email,revokedAt:null}})).name).toBe('Invited colleague');
      const ctx=await auth.transaction(tx=>auth.makeSession(tx,user,true));
      await db.membership.update({where:{id:manager.membershipId},data:{permissionOverrides:{'team.manage':true,'sales.create':false}}});
      await expect(acceptInvitation(auth,{token},ctx)).rejects.toMatchObject({code:'INVALID_INVITATION'});
      expect(await db.membership.findUnique({where:{businessId_userId:{businessId:a,userId:user.id}}})).toBeNull();
      await db.membership.update({where:{id:manager.membershipId},data:{permissionOverrides:{'team.manage':true}}});
      await acceptInvitation(auth,{token},ctx);
      expect((await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:a,userId:user.id}}})).role).toBe('CASHIER');
      expect((await write(`/${a}/invitations`,{email:user.email,role:'CASHIER'},manager,'post')).body.error.code).toBe('MEMBER_EXISTS');
      await db.billingPlan.update({where:{id:planId},data:{maxMembers:1}});
      expect((await write(`/${a}/invitations`,{email:`limit-${randomUUID()}@example.test`,role:'CASHIER'},manager,'post')).body.error.code).toBe('MEMBER_LIMIT_REACHED');
      await db.businessSubscription.update({where:{businessId:a},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
      expect((await write(`/${a}/invitations`,{email:`expired-${randomUUID()}@example.test`,role:'CASHIER'},manager,'post')).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
    } finally {
      mail.mockRestore();
      await db.billingPlan.update({where:{id:planId},data:{maxMembers:100}});
      await db.businessSubscription.update({where:{businessId:a},data:{trialEndsAt:new Date(Date.now()+86400000)}});
    }
  });
});


it('makes deletion independently denyable for every supported module',()=>{
 for(const key of ['returns.delete','counts.delete','sales.delete','purchasing.delete','receiving.delete','transfers.delete','catalogue.delete','suppliers.delete'] as const){
  expect(effectivePermissions('OPERATIONS_MANAGER',{})[key]).toBe(true);
  expect(effectivePermissions('OPERATIONS_MANAGER',{[key]:false})[key]).toBe(false);
  expect(effectivePermissions('VIEWER',{[key]:true})[key]).toBe(true);
  expect(effectivePermissions('OWNER',{[key]:false})[key]).toBe(true);
 }
});


it('stores only a password hash, applies it on acceptance, and never resets existing accounts',async()=>{
 const password='Invitation test '+randomUUID(), email=`password-${randomUUID()}@example.test`;
 let token='';const mail=vi.spyOn(auth,'queueMail').mockImplementation(async(_tx,_email,_subject,_action,value)=>{token=value;});
 try {
  expect((await write(`/${a}/invitations`,{name:'New colleague',email,role:'CASHIER',password:'short'},ownerA,'post')).status).toBe(422);
  expect((await write(`/${a}/invitations`,{name:'New colleague',email,role:'CASHIER',password},ownerA,'post')).status).toBe(202);
  const invitation=await db.invitation.findFirstOrThrow({where:{email,businessId:a}});
  expect(invitation.initialPasswordHash).not.toBe(password);
  expect(await passwordMatches(invitation.initialPasswordHash!,password)).toBe(true);
  const list=JSON.stringify((await get(`/${a}/invitations`,ownerA)).body);
  expect(list).not.toContain('initialPasswordHash');expect(list).not.toContain(password);
  await acceptInvitation(auth,{token});
  const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);
  expect(user.name).toBe('New colleague');expect(await passwordMatches(user.passwordHash,password)).toBe(true);
  expect((await db.invitation.findUniqueOrThrow({where:{id:invitation.id}})).initialPasswordHash).toBeNull();
  const existing=await actor(), existingUser=await db.authUser.findUniqueOrThrow({where:{id:existing.id}});
  expect((await write(`/${a}/invitations`,{name:'Do not overwrite',email:existingUser.email,role:'CASHIER',password},ownerA,'post')).status).toBe(202);
  await expect(acceptInvitation(auth,{token})).rejects.toMatchObject({code:'INVITATION_LOGIN_REQUIRED'});
  await acceptInvitation(auth,{token},await auth.transaction(tx=>auth.makeSession(tx,existingUser,true)));
  const after=await db.authUser.findUniqueOrThrow({where:{id:existing.id}});
  expect(after.passwordHash).toBe(existingUser.passwordHash);expect(after.name).toBe(existingUser.name);
 }finally{mail.mockRestore();}
});


it('resolves delegated custom-role assignment from the original request after a transaction retry',async()=>{
 let manager=await actor('OPERATIONS_MANAGER');const staff=await actor('CASHIER');
 await write(`/${a}/members/${manager.membershipId}`,{revision:0,permissionOverrides:{'team.manage':true}},ownerA);
 manager={...await session(manager.id),membershipId:manager.membershipId};
 const role=await write(`/${a}/roles`,{name:'Retry-safe role',permissions:{'inventory.view':true}},manager,'post');expect(role.status).toBe(201);
 const user=await db.authUser.findUniqueOrThrow({where:{id:manager.id}}),ctx=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const original=auth.transaction.bind(auth),rollback=new Error('simulated transaction retry');let attempted=false;
 const spy=vi.spyOn(auth,'transaction').mockImplementation(async fn=>{
  if(!attempted){attempted=true;try{await original(async tx=>{await fn(tx);throw rollback;});}catch(error){if(error!==rollback)throw error;}}
  return original(fn);
 });
 try{
  const result=await new BusinessService(auth).updateMember(ctx,a,staff.membershipId!,{revision:0,customRoleId:role.body.role});
  expect(result.customRoleId).toBe(role.body.role);expect(result.revision).toBe(1);
 }finally{spy.mockRestore();}
});

it('assigns invited staff to selected tenant locations and exposes them in the team list',async()=>{
 const location=await db.location.create({data:{businessId:a,code:'QA-ASSIGN',name:'Assigned warehouse',kind:'WAREHOUSE'}});
 const foreign=await db.location.create({data:{businessId:b,code:'QA-FOREIGN',name:'Foreign warehouse',kind:'WAREHOUSE'}});
 const email=`locations-${randomUUID()}@example.test`;let token='';
 const mail=vi.spyOn(auth,'queueMail').mockImplementation(async(_tx,_email,_subject,_action,value)=>{token=value;});
 try{
  const body={name:'Assigned colleague',email,role:'CASHIER',password:'Assignment test password 123!',locationIds:[foreign.id]};
  expect((await write(`/${a}/invitations`,body,ownerA,'post')).status).toBe(404);
  expect((await write(`/${a}/invitations`,{...body,locationIds:[location.id]},ownerA,'post')).status).toBe(202);
  await acceptInvitation(auth,{token});
  const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);
  const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:a,userId:user.id}}});
  expect(await db.locationAssignment.count({where:{membershipId:member.id,locationId:location.id}})).toBe(1);
  const service=new BusinessService(auth);const ctx=await auth.transaction(tx=>auth.makeSession(tx,user,true));
  const ownerUser=await db.authUser.findUniqueOrThrow({where:{id:ownerA.id}});
  const list=await service.members(await auth.transaction(tx=>auth.makeSession(tx,ownerUser,true)),a,{page:1,pageSize:100});
  expect(list.items.find(m=>m.id===member.id)?.locations[0]?.id).toBe(location.id);
 }finally{mail.mockRestore();await db.locationAssignment.deleteMany({where:{locationId:location.id}});await db.location.deleteMany({where:{id:{in:[location.id,foreign.id]}}});}
});

it('creates hired staff immediately with assigned locations and no invitation email',async()=>{
 const location=await db.location.create({data:{businessId:a,code:'DIRECT-QA',name:'Direct shop',kind:'SHOP'}});
 const email=`direct-${randomUUID()}@example.test`,password='Direct employee password 123!';
 const mail=vi.spyOn(auth,'queueMail');
 try{
  const body={name:'Hired employee',email,password,role:'CASHIER',locationIds:[location.id]};
  expect((await write(`/${a}/members`,{...body,locationIds:[]},ownerA,'post')).status).toBe(422);
  const created=await write(`/${a}/members`,body,ownerA,'post');expect(created.status,created.text).toBe(201);
  const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);
  expect(await passwordMatches(user.passwordHash,password)).toBe(true);
  expect(await db.locationAssignment.count({where:{membershipId:created.body.id,locationId:location.id}})).toBe(1);
  expect(mail).not.toHaveBeenCalled();
  expect((await write(`/${a}/members`,body,ownerA,'post')).status).toBe(409);
  expect(await db.invitation.count({where:{email}})).toBe(0);
 }finally{mail.mockRestore();await db.locationAssignment.deleteMany({where:{locationId:location.id}});await db.location.delete({where:{id:location.id}});}
});

it('security round: direct member creation rejects foreign locations, staff escalation and platform bypass without writes',async()=>{
 const location=await db.location.create({data:{businessId:b,code:'SEC-FOREIGN',name:'Private shop',kind:'SHOP'}});
 const staff=await actor('CASHIER'),platform=await actor(undefined,a,'SUPER_ADMIN');
 const body={name:'Forbidden employee',email:`security-${randomUUID()}@example.test`,password:'Security test password 123!',role:'CASHIER',locationIds:[location.id]};
 try{
  expect((await write(`/${a}/members`,body,ownerA,'post')).status).toBe(404);
  expect((await write(`/${a}/members`,body,staff,'post')).status).toBe(403);
  expect((await write(`/${a}/members`,body,platform,'post')).status).toBe(403);
  expect((await write(`/${b}/members`,body,ownerA,'post')).status).toBe(403);
  expect((await write(`/${a}/members`,{...body,role:'OWNER'},ownerA,'post')).status).toBe(422);
  expect(await db.authUser.findUnique({where:{email:body.email}})).toBeNull();
 }finally{await db.location.delete({where:{id:location.id}});}
});

it('resets only the confirmed owner’s operational rows and preserves business settings', async () => {
  const location = await db.location.create({ data: { businessId: a, code: 'RESET', name: 'Reset test shop', kind: 'SHOP' } });
  const cash = await db.cashClose.create({ data: {
    businessId: a, locationId: location.id, day: '2026-11-20', opening: 0, inflow: 0, outflow: 0,
    expected: 0, counted: 0, variance: 0, reason: '', currency: 'USD', actorId: ownerA.id, actorName: 'Test owner',
  } });
  const createSupplier = (businessId: string) =>
    db.supplier.create({ data: { businessId, code: 'RESET-SUP', name: 'Reset test supplier' } });
  const [supplierA, supplierB] = await Promise.all([createSupplier(a), createSupplier(b)]);
  const reset = (businessId: string, user: Actor, password: string, csrf = user.csrf) =>
    request(app).delete(`/api/businesses/${businessId}/operational-data`)
      .set('Origin', settings.appOrigin).set('Cookie', user.cookie).set('X-CSRF-Token', csrf)
      .send({ confirmation: 'DELETE ALL DATA', password });
  const password = 'Integration test passphrase 142!';
  try {
    await expect(db.cashClose.delete({ where: { id: cash.id } })).rejects.toThrow();
    expect((await reset(a, ownerA, password, '')).status).toBe(403);
    expect((await reset(a, ownerB, password)).status).toBe(403);
    expect((await reset(a, ownerA, 'incorrect password')).body.error.code).toBe('RESET_PASSWORD_INCORRECT');
    expect(await db.cashClose.count({ where: { id: cash.id } })).toBe(1);

    expect((await reset(a, ownerA, password)).status).toBe(200);
    expect(await db.cashClose.count({ where: { id: cash.id } })).toBe(0);
    expect(await db.supplier.count({ where: { businessId: a } })).toBe(0);
    expect(await db.supplier.count({ where: { id: supplierB.id } })).toBe(1);
    expect(await db.location.count({ where: { id: location.id } })).toBe(1);
    expect(await db.membership.count({ where: { id: ownerA.membershipId } })).toBe(1);
    expect(await db.businessSubscription.count({ where: { businessId: a } })).toBe(1);
    expect(await db.authAudit.count({ where: { businessId: a, action: 'business.operational_data_reset' } })).toBe(1);
  } finally {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('profitlens.reset_business', ${a}, true)`;
      await tx.cashClose.deleteMany({ where: { id: cash.id } });
      await tx.location.delete({ where: { id: location.id } });
      await tx.supplier.deleteMany({ where: { id: { in: [supplierA.id, supplierB.id] } } });
    });
  }
});

it('downloads operational backups for the selected owner tenant only', async () => {
  const [first, second] = await Promise.all([
    db.supplier.create({ data: { businessId: a, code: 'BACKUP-SUP', name: 'Alpha export supplier' } }),
    db.supplier.create({ data: { businessId: b, code: 'BACKUP-SUP', name: 'Beta private supplier' } }),
  ]);
  try {
    const path = `/${a}/backup`;
    expect((await get(`${path}?format=json`, ownerB)).status).toBe(403);
    const staff = await actor('VIEWER', a);
    expect((await get(`${path}?format=json`, staff)).status).toBe(403);
    const json = await get(`${path}?format=json`, ownerA);
    expect(json.status).toBe(200);
    expect(json.headers['content-disposition']).toMatch(/\.json/);
    expect(json.body.business.id).toBe(a);
    expect(json.body.tables.Suppliers.map((row: { id: string }) => row.id)).toEqual([first.id]);
    const xlsx = await get(`${path}?format=xlsx`, ownerA);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(xlsx.headers['content-disposition']).toMatch(/\.xlsx/);
    expect(Number(xlsx.headers['content-length'])).toBeGreaterThan(100);
  } finally {
    await db.supplier.deleteMany({ where: { id: { in: [first.id, second.id] } } });
  }
});

it('keeps partner ledgers tenant scoped and records retry-safe transactions', async () => {
  const path = `/${a}/partners`;
  const fields = { name: 'Partner test', ownership: '25', capital: '100', currency: 'USD', notes: '', active: true };
  const partner = await write(path, fields, ownerA, 'post');
  expect(partner.status).toBe(201);
  const history = `${path}/${partner.body.id}/transactions`;
  try {
    expect((await get(history, ownerB)).status).toBe(403);
    expect((await get(`/${b}/partners/${partner.body.id}/transactions`, ownerB)).status).toBe(404);
    const contribution = {kind: 'CONTRIBUTION', amount: '25.25', day: '2026-11-20', notes: '', clientKey: randomUUID()};
    const first = await write(history, contribution, ownerA, 'post');
    const retry = await write(history, contribution, ownerA, 'post');
    expect(first.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect((await write(history, {...contribution, kind: 'WITHDRAWAL', amount: '5', clientKey: randomUUID()}, ownerA, 'post')).status).toBe(201);
    const result = await get(history, ownerA);
    expect(result.body).toMatchObject({ balance: '20.2500', total: 2 });
    expect((await write(`${path}/${partner.body.id}`, {...fields, currency: 'SYP', revision: result.body.partner.revision}, ownerA)).body.error.code).toBe('PARTNER_CURRENCY_LOCKED');
  } finally {
    await db.partner.deleteMany({ where: { businessId: a } });
  }
});

it('serves all seven interactive report views and scopes finance reports to the business and dates', async () => {
  const createShop = (businessId: string) => db.location.create({
    data: { businessId, code: 'REPORTS', name: 'Report shop', kind: 'SHOP' },
  });
  const [shop, otherShop] = await Promise.all([createShop(a), createShop(b)]);
  const day = '2026-11-20';
  try {
    for (const [location, id] of [[shop, ownerA.id], [otherShop, ownerB.id]] as const) {
      for (const kind of ['EXPENSE', 'CASH_IN', 'CASH_OUT']) {
        await db.moneyEntry.create({data: {
          businessId: location.businessId, locationId: location.id, actorId: id, actorName: 'Report owner',
          kind, clientKey: randomUUID(), requestHash: 'test', method: 'CASH', amount: 12, currency: 'USD',
          reason: 'Report test entry', reference: '', createdAt: new Date(`${day}T10:00:00Z`),
        }});
      }
      await db.cashClose.create({data: {
        businessId: location.businessId, locationId: location.id, day, opening: 30, inflow: 12, outflow: 12,
        expected: 30, counted: 28, variance: -2, reason: 'Report test closing', currency: 'USD',
        actorId: id, actorName: 'Report owner',
      }});
    }
    const report = (view: string, date = day, extra = '') =>
      get(`/${a}/workflows/reports?view=${view}&from=${date}&to=${date}${extra}`, ownerA);
    for (const view of ['sales','purchases','stock','returns']) expect((await report(view)).status).toBe(200);
    expect((await report('expenses')).body).toMatchObject({total:1,items:[{kind:'EXPENSE',amount:'12.00'}]});
    expect((await report('profit')).body).toMatchObject({estimatedProfit:'-12.0000'});
    expect((await report('profit', day, '&export=true')).body.csv).toContain('estimatedProfit');
    expect((await report('cash')).body).toMatchObject({total:1,items:[{day,counted:'28.00',variance:'-2.00'}]});
    expect((await report('cash', '2026-11-19')).body.total).toBe(0);
    expect((await report('cash', day, `&locationId=${otherShop.id}`)).status).toBe(404);
    const cash = await get(`/${a}/workflows/cash?locationId=${shop.id}&day=${day}`, ownerA);
    expect(cash.body).toMatchObject({inflow:'12.0000',outflow:'24.0000',
      breakdown:{sales:'0.0000',refunds:'0.0000',expenses:'12.0000',withdrawals:'12.0000',other:'12.0000'}});
    const history = await get(`/${a}/workflows/cash/history?locationId=${shop.id}`, ownerA);
    expect(history.body).toMatchObject({total:1,items:[{day,locationId:shop.id}]});
    expect((await get(`/${a}/workflows/cash/history?locationId=${otherShop.id}`, ownerA)).status).toBe(404);
    expect((await get(`/${a}/workflows/payments?locationId=${shop.id}&kind=CASH_OUT`, ownerA)).body)
      .toMatchObject({total:1,items:[{kind:'CASH_OUT',locationId:shop.id}]});
  } finally {
    for (const location of [shop, otherShop]) await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('profitlens.reset_business', ${location.businessId}, true)`;
      await tx.cashClose.deleteMany({where:{locationId:location.id}});
      await tx.moneyEntry.deleteMany({where:{locationId:location.id}});
      await tx.location.delete({where:{id:location.id}});
    });
  }
});

it('lists only saved accounts and keeps chart changes tenant scoped', async () => {
  const path = `/${a}/accounts`;
  const chart = await get(path, ownerA);
  expect(chart.status).toBe(200);
  expect(chart.body.items).toEqual([]);
  expect((await get(path, ownerB)).status).toBe(403);
  const fields = {name:'Test utilities',category:'expenses',nature:'debit',active:true};
  const remove = (code: string, revision: number) =>
    request(app).delete(`/api/businesses${path}/${code}`).set('Origin', settings.appOrigin)
      .set('Cookie', ownerA.cookie).set('X-CSRF-Token', ownerA.csrf).send({revision});
  try {
    expect((await write(`${path}/1000`,{...fields,revision:0},ownerA)).status).toBe(404);
    expect((await write(path,{...fields,code:'6800'},ownerA,'post')).status).toBe(201);
    expect((await write(path,{...fields,code:'6800'},ownerA,'post')).status).toBe(409);
    expect((await get(path,ownerA)).body.items).toMatchObject([{code:'6800',name:fields.name}]);
    expect((await write(`${path}/6800`,{...fields,active:false,revision:0},ownerA)).body.active).toBe(false);
    expect((await get(`/${b}/accounts`,ownerB)).body.items.some((row:{code:string})=>row.code==='6800')).toBe(false);
    expect((await write(path,{...fields,code:'1000'},ownerA,'post')).status).toBe(201);
    expect((await remove('1000',0)).status).toBe(200);
    expect((await remove('6800',1)).status).toBe(200);
  } finally {
    await db.chartAccount.deleteMany({where:{businessId:a,code:{in:['1000','6800']}}});
  }
});

it('allows only an owner to configure and unlock sensitive sections with a session-scoped PIN', async () => {
  const pin = '048271', password = 'Integration test passphrase 142!';
  const backup = `/${a}/backup?format=json`;
  const profit = `/${a}/workflows/reports?view=profit&from=2026-11-20&to=2026-11-20`;
  const setPin = (pinValue: string | null, user: Actor, currentPassword = password) =>
    request(app).put(`/api/businesses/${a}/owner-pin`).set('Origin',settings.appOrigin)
      .set('Cookie',user.cookie).set('X-CSRF-Token',user.csrf).send({pin:pinValue,password:currentPassword});
  const staff = await actor('VIEWER',a);
  try {
    expect((await setPin(pin,staff)).status).toBe(403);
    expect((await setPin(pin,ownerA,'incorrect')).body.error.code).toBe('OWNER_PIN_PASSWORD_INCORRECT');
    expect((await setPin(pin,ownerA)).body).toEqual({enabled:true,unlockedUntil:null,browserSignInEnabled:true});
    for (const path of [backup,profit,`/${a}/partners`,`/${a}/accounts`,`/${a}/workflows/payments`]) {
      expect((await get(path,ownerA)).body.error.code).toBe('OWNER_PIN_REQUIRED');
    }
    const summary = await get(`/${a}/workflows/reports?from=2026-11-20&to=2026-11-20`,ownerA);
    expect(summary.status).toBe(200);
    expect(summary.body.estimatedProfit).toBeUndefined();
    expect(await db.authUser.findUnique({where:{id:ownerA.id},select:{ownerPinHash:true}}))
      .toMatchObject({ownerPinHash:expect.stringMatching(/^\$argon2id\$/)});
    expect((await write(`/${a}/owner-pin/unlock`,{pin:'0000'},ownerA,'post')).body.error.code).toBe('OWNER_PIN_INCORRECT');
    expect((await write(`/${a}/owner-pin/unlock`,{pin},ownerA,'post')).status).toBe(200);
    expect((await get(backup,ownerA)).status).toBe(200);
    expect((await get(profit,ownerA)).status).toBe(200);
    const owner = await db.authUser.findUniqueOrThrow({where:{id:ownerA.id},select:{email:true}});
    const login = await request(app).post('/api/auth/login').set('Origin',settings.appOrigin)
      .send({email:owner.email,password});
    expect(login.body.stage).toBe('mfa_required');
    function sessionFrom(response: request.Response) {
      const cookies = response.headers['set-cookie'] as unknown as string[];
      return {id:ownerA.id,cookie:cookies[0]!.split(';')[0]!,csrf:response.body.csrfToken};
    }
    const pending = sessionFrom(login);
    expect((await write(`/${a}/owner-pin/unlock`,{pin},pending,'post')).body.error.code).toBe('MFA_REQUIRED');
    const verified = await request(app).post('/api/auth/mfa/verify').set('Origin',settings.appOrigin)
      .set('Cookie',pending.cookie).set('X-CSRF-Token',pending.csrf)
      .send({code:totp('JBSWY3DPEHPK3PXP',owner.email).generate()});
    expect(verified.body.stage).toBe('authenticated');
    const secondSession = sessionFrom(verified);
    expect((await get(backup,secondSession)).body.error.code).toBe('OWNER_PIN_REQUIRED');
    expect((await write(`/${a}/owner-pin/unlock`,{pin},secondSession,'post')).status).toBe(200);
    expect((await get(backup,secondSession)).status).toBe(200);
    await db.authSession.updateMany({where:{userId:ownerA.id},data:{ownerPinUnlockedUntil:new Date(0)}});
    expect((await get(profit,ownerA)).body.error.code).toBe('OWNER_PIN_REQUIRED');
    expect((await setPin(null,ownerA)).status).toBe(200);
    expect((await get(backup,ownerA)).status).toBe(200);
  } finally {
    await db.authUser.update({where:{id:ownerA.id},data:{ownerPinHash:null}});
  }
});

it('allows owner PIN sign-in only on an enabled browser and preserves MFA and device revocation', async () => {
  const owner = await actor('OWNER', a);
  const { email } = await db.authUser.findUniqueOrThrow({ where: { id: owner.id }, select: { email: true } });
  const password = 'Integration test passphrase 142!', pin = '068912';
  const authHeaders = { Origin: settings.appOrigin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf };
  const setPin = await request(app).put(`/api/businesses/${a}/owner-pin`).set(authHeaders).send({ pin, password });
  expect(setPin.status).toBe(200);
  const signIn = (cookie = '', input = { email, pin }) => request(app).post('/api/auth/login/pin')
    .set('Origin', settings.appOrigin).set('Cookie', cookie).send(input);
  expect((await signIn()).body.error.code).toBe('OWNER_PIN_LOGIN_FAILED');

  expect(setPin.body.browserSignInEnabled).toBe(true);
  const deviceHeader = (setPin.headers['set-cookie'] as unknown as string[])[0]!;
  expect(deviceHeader).toMatch(/HttpOnly/);
  const disable = await request(app).delete(`/api/businesses/${a}/owner-pin/device`).set(authHeaders).send({});
  expect(disable.status).toBe(200);
  expect(disable.headers['set-cookie']).toEqual([expect.stringMatching(/^pl_owner_device=;.*Expires=/)]);
  expect((await get(`/${a}`, owner)).body.ownerPin.enabled).toBe(true);
  const device = deviceHeader.split(';')[0]!;
  expect((await signIn(device + 'x')).body.error.code).toBe('OWNER_PIN_LOGIN_FAILED');
  expect((await signIn(device, { email, pin: '011111' })).body.error.code).toBe('OWNER_PIN_LOGIN_FAILED');
  const signedIn = await signIn(device);
  expect(signedIn.status).toBe(200);
  expect(signedIn.body.stage).toBe('mfa_required');
  const pending = (signedIn.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  expect((await get(`/${a}/partners`, {cookie:pending,id:owner.id,csrf:signedIn.body.csrfToken})).body.error.code).toBe('MFA_REQUIRED');

  expect((await request(app).post('/api/auth/sessions/revoke').set(authHeaders).send({})).status).toBe(200);
  expect((await signIn(device)).body.error.code).toBe('OWNER_PIN_LOGIN_FAILED');
});
