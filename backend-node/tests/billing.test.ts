import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { csrfFor, encrypt, decrypt, passwordHash } from '../src/auth/crypto.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const db = createDatabase(url), settings = readAuthSettings({ AUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:3000' });
const auth = new AuthService(db, settings), app = createApp({ CORS_ORIGINS: [settings.appOrigin] }, pino({ level: 'silent' }), async () => {}, auth);
const ids: string[] = [], businesses: string[] = [], plans: string[] = [], run = randomUUID().slice(0,8);
type Actor = { id: string; cookie: string; csrf: string };
let admin: Actor, owner: Actor, staff: Actor, business: string, plan: string, hash: string;
async function actor(role: 'OWNER' | 'VIEWER' | 'SUPER_ADMIN'): Promise<Actor> {
  const id = randomUUID(); ids.push(id);
  const user = await db.authUser.create({ data: { id, name: 'Billing Test', email: `${id}@example.test`, passwordHash: hash, emailVerifiedAt: new Date(), platformRole: role === 'SUPER_ADMIN' ? role : 'USER', ...(role !== 'VIEWER' ? { mfaSecret: encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`) } : {}) } });
  if (role !== 'SUPER_ADMIN') await db.membership.create({ data: { businessId: business, userId: id, role } });
  const session = await auth.transaction(tx => auth.makeSession(tx,user,true));
  return { id, cookie: `pl_session=${session.token}`, csrf: csrfFor(settings.key,session.token) };
}
function write(path: string, body: object, who = owner, method: 'post' | 'patch' = 'post') { return request(app)[method](`/api${path}`).set('Cookie',who.cookie).set('Origin',settings.appOrigin).set('X-CSRF-Token',who.csrf).send(body); }
const get = (path: string, who = owner) => request(app).get(`/api${path}`).set('Cookie',who.cookie);
const terms = () => ({ code: `test-${randomUUID()}`, name: 'Trial plan', nameAr: 'خطة تجربة', priceMinor: null as number | null, currency: 'USD', interval: 'MONTH', trialDays: 14, maxMembers: 3, maxWarehouses: 2, maxShops: 3 });
async function createPlan(input = terms()) { const result = await write('/billing/plans',input,admin); expect(result.status).toBe(201); plans.push(result.body.id); return result.body; }
beforeAll(async () => { hash = await passwordHash('Billing test passphrase 194!'); business = (await db.business.create({ data: { name: 'Billing tenant' } })).id; businesses.push(business); admin = await actor('SUPER_ADMIN'); owner = await actor('OWNER'); staff = await actor('VIEWER'); });
afterAll(async () => {
  for (const mail of await db.authMail.findMany()) { try { if (JSON.parse(decrypt(settings.key,mail.payload,`mail:${mail.id}`)).to.includes(run)) await db.authMail.delete({ where: { id: mail.id } }); } catch { /* Other suites own their messages. */ } }
  await db.billingAudit.deleteMany({ where: { actorId: { in: ids } } }); await db.authAudit.deleteMany({ where: { businessId: { in: businesses } } });
  await db.business.deleteMany({ where: { id: { in: businesses } } }); await db.authUser.deleteMany({ where: { id: { in: ids } } }); await db.billingPlan.deleteMany({ where: { id: { in: plans } } }); await db.$disconnect();
});
it('protects tenant billing from staff, unrelated owners and platform bypass', async () => {
  expect((await get(`/billing/businesses/${business}`,staff)).status).toBe(403);
  expect((await get(`/billing/businesses/${business}`,admin)).status).toBe(403);
  expect((await get(`/billing/businesses/${randomUUID()}`)).status).toBe(403);
  expect((await get('/billing/plans')).status).toBe(403);
  expect((await write('/billing/plans',terms())).status).toBe(403);
  const status = await get(`/billing/businesses/${business}`); expect(status.body).toMatchObject({ status: 'NOT_STARTED', active: false, checkoutAvailable: false });
});
it('creates unpublished immutable plan terms and validates money/limits', async () => {
  for (const bad of [{...terms(),maxMembers:0},{...terms(),priceMinor:1.5},{...terms(),published:true},{...terms(),trialDays:100}]) expect((await write('/billing/plans',bad,admin)).status).toBe(422);
  const created = await createPlan(); plan = created.id; expect(created.published).toBe(false);
  expect((await write(`/billing/plans/${plan}`,{revision:0,maxMembers:9},admin,'patch')).status).toBe(422);
  expect((await write('/billing/plans',{...terms(),code:created.code},admin)).status).toBe(409);
  expect((await get(`/billing/businesses/${business}`)).body.plans.some((p:{id:string}) => p.id === plan)).toBe(false);
});
it('allows publishing manual paid plans without granting free trial access', async () => {
  const paid = await createPlan({...terms(),priceMinor:2900});
  const result = await write(`/billing/plans/${paid.id}`,{revision:0,published:true},admin,'patch'); expect(result.status).toBe(200);
  expect((await write(`/billing/businesses/${business}/trial`,{planId:paid.id})).status).toBe(409);
});
it('requires CSRF and publishes trial terms with revision protection', async () => {
  expect((await request(app).patch(`/api/billing/plans/${plan}`).set('Cookie',admin.cookie).set('Origin',settings.appOrigin).send({revision:0,published:true})).status).toBe(403);
  expect((await write(`/billing/plans/${plan}`,{revision:0,published:true},admin,'patch')).status).toBe(200);
  expect((await write(`/billing/plans/${plan}`,{revision:0,published:false},admin,'patch')).status).toBe(409);
});
it('denies new seats before starting a trial and atomically starts it once', async () => {
  expect((await write(`/businesses/${business}/invitations`,{email:`${run}-before@example.test`,role:'VIEWER'})).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  const results = await Promise.all([1,2].map(() => write(`/billing/businesses/${business}/trial`,{planId:plan})));
  expect(results.map(r => r.status).sort()).toEqual([201,409]);
  expect(await db.billingAudit.count({where:{businessId:business,action:'trial.started'}})).toBe(1);
  const status = await get(`/billing/businesses/${business}`); expect(status.body.active).toBe(true); expect(status.body.subscription.plan.maxMembers).toBe(3);
});
it('reserves invitation seats and prevents concurrent oversubscription', async () => {
  const results = await Promise.all([1,2].map(i => write(`/businesses/${business}/invitations`,{email:`${run}-${i}@example.test`,role:'VIEWER'})));
  expect(results.map(r => r.status).sort()).toEqual([202,409]);
  expect((await get(`/billing/businesses/${business}`)).body.usage).toEqual({activeMembers:2,pendingInvitations:1,reservedMembers:3});
  const invite = await db.invitation.findFirstOrThrow({where:{businessId:business,revokedAt:null}});
  expect((await write(`/businesses/${business}/invitations`,{email:invite.email,role:'CASHIER'})).status).toBe(202);
  expect(await db.invitation.count({where:{businessId:business,revokedAt:null}})).toBe(1);
});
it('does not revoke an existing trial when an offer is unpublished', async () => {
  expect((await write(`/billing/plans/${plan}`,{revision:1,published:false},admin,'patch')).status).toBe(200);
  const status = await get(`/billing/businesses/${business}`); expect(status.body.active).toBe(true); expect(status.body.plans.some((p:{id:string}) => p.id === plan)).toBe(false);
});
it('counts reactivation as growth, and allows reducing access after expiry', async () => {
  const m = await db.membership.findFirstOrThrow({where:{userId:staff.id,businessId:business}});
  expect((await write(`/businesses/${business}/members/${m.id}`,{revision:0,active:false},owner,'patch')).status).toBe(200);
  expect((await write(`/businesses/${business}/invitations`,{email:`${run}-third@example.test`,role:'VIEWER'})).status).toBe(202);
  expect((await write(`/businesses/${business}/members/${m.id}`,{revision:1,active:true},owner,'patch')).body.error.code).toBe('MEMBER_LIMIT_REACHED');
  await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-172800000),trialEndsAt:new Date(Date.now()-86400000)}});
  expect((await get(`/billing/businesses/${business}`)).body).toMatchObject({status:'EXPIRED',active:false});
  expect((await write(`/businesses/${business}/members/${m.id}`,{revision:1,active:true},owner,'patch')).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  const pending = await db.invitation.findFirstOrThrow({where:{businessId:business,revokedAt:null}});
  expect((await write(`/businesses/${business}/invitations/${pending.id}/revoke`,{})).status).toBe(200);
  expect((await write(`/billing/businesses/${business}/trial`,{planId:'8ac8ae27-f871-47f2-8d70-e38b0aed295c'})).body.error.code).toBe('TRIAL_ALREADY_USED');
});
it('rechecks trial entitlement when an invitation is accepted', async () => {
  const invitation = await db.invitation.findFirstOrThrow({where:{businessId:business,revokedAt:null}});
  let token = '';
  for (const mail of await db.authMail.findMany()) { try { const payload = JSON.parse(decrypt(settings.key,mail.payload,`mail:${mail.id}`)); if (payload.to === invitation.email) token = payload.text.match(/token=([A-Za-z0-9_-]{43})/)[1]; } catch { /* Not this test's mail. */ } }
  expect(token).toBeTruthy();
  const response = await request(app).post('/api/auth/invitations/accept').set('Origin',settings.appOrigin).send({token,name:'Invited person',password:'Invited test password 198!'});
  expect(response.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  expect((await db.invitation.findUniqueOrThrow({where:{id:invitation.id}})).usedAt).toBeNull();
  expect(await db.authUser.findUnique({where:{email:invitation.email}})).toBeNull();
});
it('records plan changes and trial start in platform-only billing history', async () => {
  expect((await get('/billing/audit')).status).toBe(403);
  const result = await get('/billing/audit',admin); expect(result.status).toBe(200); expect(result.body.items.some((r:{action:string})=>r.action==='trial.started')).toBe(true);
  expect((await get('/billing/plans?page=0',admin)).status).toBe(422);
});
it('reports concurrent duplicate plan codes as a conflict without duplicating terms', async () => {
  const input = terms();
  const results = await Promise.all([1,2].map(() => write('/billing/plans', input, admin)));
  for (const result of results) if (result.status === 201) plans.push(result.body.id);
  expect(results.map(r => r.status).sort()).toEqual([201,409]);
  expect(await db.billingPlan.count({ where: { code: input.code } })).toBe(1);
});


it('allows business-owner billing without optional authenticator enrollment',async()=>{
 const user=await db.authUser.findUniqueOrThrow({where:{id:owner.id}});
 await db.authUser.update({where:{id:owner.id},data:{mfaSecret:null}});
 try {const response=await get(`/billing/businesses/${business}`,owner);expect(response.status,response.text).toBe(200);}
 finally{await db.authUser.update({where:{id:owner.id},data:{mfaSecret:user.mfaSecret}});}
});


it('keeps expired-trial login, dashboard and billing accessible without allowing new paid operations',async()=>{
 const login=await request(app).post('/api/auth/login').set('Origin',settings.appOrigin).send({email:(await db.authUser.findUniqueOrThrow({where:{id:owner.id}})).email,password:'Billing test passphrase 194!'});
 expect(login.status,login.text).toBe(200);
 expect((await get('/businesses')).body.some((b:{id:string})=>b.id===business)).toBe(true);
 const context=await get(`/businesses/${business}`);
 expect(context.status).toBe(200);expect(context.body.subscriptionAccess).toMatchObject({active:false,status:'EXPIRED',paid:false});
 const summary=await get(`/businesses/${business}/workflows/reports?view=summary&from=2026-11-01&to=2026-11-13`);
 expect(summary.status,summary.text).toBe(200);expect(summary.body.saleCount).toBe(0);
 expect((await get(`/billing/businesses/${business}`)).status).toBe(200);
 expect((await write(`/businesses/${business}/invitations`,{email:`${run}-expired@example.test`,role:'VIEWER'})).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await get(`/businesses/${business}`,admin)).status).toBe(403);
 const {billingState}=await import('../src/billing/entitlements.js');
 const sub=await db.businessSubscription.findUniqueOrThrow({where:{businessId:business}});
 expect((await auth.transaction(tx=>billingState(tx,business,new Date(sub.trialEndsAt.getTime()-1)))).active).toBe(true);
 expect((await auth.transaction(tx=>billingState(tx,business,sub.trialEndsAt))).active).toBe(false);
});
