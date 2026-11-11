import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService, type AuthContext } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { csrfFor, encrypt, passwordHash } from '../src/auth/crypto.js';
import { requireLocation } from '../src/locations/access.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const ids:string[]=[],bids:string[]=[];
let owner:AuthContext,staff:AuthContext,manager:AuthContext,admin:AuthContext,foreign:AuthContext,business:string,other:string,planId:string,hash:string,warehouse:string,shop:string;
async function actor(role:'OWNER'|'CASHIER'|'OPERATIONS_MANAGER'|'SUPER_ADMIN',tenant=business){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Location tester',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(role!=='SUPER_ADMIN')await db.membership.create({data:{businessId:tenant,userId:id,role}});
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
const get=(path='',who=owner,b=business)=>request(app).get(`/api/businesses/${b}/locations${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'|'put'='post',b=business)=>request(app)[method](`/api/businesses/${b}/locations${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
const input=(code:string,kind='WAREHOUSE')=>({code,name:`Location ${code}`,kind,address:'Test address'});
beforeAll(async()=>{
 hash=await passwordHash('Location test password 412!');business=(await db.business.create({data:{name:'Location tenant'}})).id;other=(await db.business.create({data:{name:'Other tenant'}})).id;bids.push(business,other);
 owner=await actor('OWNER');staff=await actor('CASHIER');manager=await actor('OPERATIONS_MANAGER');admin=await actor('SUPER_ADMIN');foreign=await actor('OWNER',other);
 planId=(await db.billingPlan.create({data:{code:`locations-${randomUUID()}`,name:'Location test',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:1,maxShops:1}})).id;
});
afterAll(async()=>{await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();});
it('validates tenant scope, owner management, CSRF and a subscription before creation',async()=>{
 expect((await get('',admin)).status).toBe(403);expect((await get('',foreign)).status).toBe(403);
 expect((await write('',input('W1'),staff)).status).toBe(403);expect((await write('',input('W1'),manager)).status).toBe(403);
 expect((await request(app).post(`/api/businesses/${business}/locations`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send(input('W1'))).status).toBe(403);
 expect((await write('',input('W1'))).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 for(const bad of [{...input('W1'),kind:'ANY'},input('../x'),{...input('W1'),businessId:other}])expect((await write('',bad)).status).toBe(422);
 await db.businessSubscription.create({data:{businessId:business,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
});
it('enforces separate location allowances under concurrent creation',async()=>{
 const results=await Promise.all([write('',input('w1')),write('',input('w2'))]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
 const result=results.find(r=>r.status===201)!;warehouse=result.body.id;expect(result.body.code).toMatch(/^W[12]$/);
 const created=await write('',input('S1','SHOP'));expect(created.status).toBe(201);shop=created.body.id;
 expect((await write('',input('S2','SHOP'))).body.error.code).toBe('LOCATION_LIMIT_REACHED');
 expect((await get('',manager)).body.total).toBe(2);expect((await get('',staff)).body.total).toBe(0);
 expect((await get('?kind=SHOP&search=s1')).body.items.map((l:{id:string})=>l.id)).toEqual([shop]);
 expect(await db.authAudit.count({where:{businessId:business,action:'location.created'}})).toBe(2);
});
it('assigns only members of the same business and checks location access on every transaction',async()=>{
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:staff.user.id}}});
 const stranger=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:other,userId:foreign.user.id}}});
 expect((await write(`/${shop}/assignments`,{revision:0,membershipId:stranger.id,assigned:true},owner,'put')).status).toBe(404);
 await expect(db.locationAssignment.create({data:{businessId:business,locationId:shop,membershipId:stranger.id}})).rejects.toMatchObject({code:'P2003'});
 const assigned=await write(`/${shop}/assignments`,{revision:0,membershipId:member.id,assigned:true},owner,'put');expect(assigned.status).toBe(200);
 expect((await get('',staff)).body.items.map((l:{id:string})=>l.id)).toEqual([shop]);
 await expect(auth.transaction(tx=>requireLocation(auth,tx,staff,business,shop))).resolves.toMatchObject({location:{id:shop}});
 await expect(auth.transaction(tx=>requireLocation(auth,tx,staff,business,warehouse))).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await get(`/${shop}/assignments`,staff)).status).toBe(403);
 expect((await write(`/${shop}/assignments`,{revision:0,membershipId:member.id,assigned:false},owner,'put')).status).toBe(409);
 expect((await write(`/${shop}/assignments`,{revision:1,membershipId:member.id,assigned:false},owner,'put')).status).toBe(200);
 await expect(auth.transaction(tx=>requireLocation(auth,tx,staff,business,shop))).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('protects edits with revisions and keeps location kind/code immutable',async()=>{
 expect((await write(`/${warehouse}`,{revision:0,name:'Main warehouse'},owner,'patch')).status).toBe(200);
 expect((await write(`/${warehouse}`,{revision:0,name:'Stale'},owner,'patch')).status).toBe(409);
 expect((await write(`/${warehouse}`,{revision:1,kind:'SHOP'},owner,'patch')).status).toBe(422);
 expect((await write(`/${warehouse}`,{revision:1,code:'NEW'},owner,'patch')).status).toBe(422);
 expect((await write(`/${warehouse}`,{revision:1,name:'Cross tenant'},foreign,'patch',other)).status).toBe(404);
});
it('archives without deleting records, clears assignments and rechecks limits on reactivation',async()=>{
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:staff.user.id}}});
 await write(`/${shop}/assignments`,{revision:2,membershipId:member.id,assigned:true},owner,'put');
 expect((await write(`/${shop}`,{revision:3,active:false},owner,'patch')).status).toBe(200);
 expect(await db.locationAssignment.count({where:{locationId:shop}})).toBe(0);
 await expect(auth.transaction(tx=>requireLocation(auth,tx,owner,business,shop))).rejects.toMatchObject({code:'LOCATION_ARCHIVED'});
 expect((await get('?state=archived')).body.items.map((l:{id:string})=>l.id)).toEqual([shop]);
 const replacement=await write('',input('S2','SHOP'));expect(replacement.status).toBe(201);
 expect((await write(`/${shop}`,{revision:4,active:true},owner,'patch')).body.error.code).toBe('LOCATION_LIMIT_REACHED');
 await write(`/${replacement.body.id}`,{revision:0,active:false},owner,'patch');
 expect((await write('',input('S1','SHOP'))).body.error.code).toBe('LOCATION_CODE_EXISTS');
 expect((await write(`/${shop}`,{revision:4,active:true},owner,'patch')).status).toBe(200);
 expect((await get('',staff)).body.total).toBe(0);
});
it('honors live permission overrides and rejects assignments to disabled members',async()=>{
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:staff.user.id}}});
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'locations.all':true}}});
 expect((await get('',staff)).body.total).toBe(2);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'locations.all':true,'locations.view':false}}});
 expect((await get('',staff)).status).toBe(403);
 await expect(auth.transaction(tx=>requireLocation(auth,tx,staff,business,warehouse))).rejects.toMatchObject({code:'FORBIDDEN'});
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{},disabledAt:new Date()}});
 const row=await db.location.findUniqueOrThrow({where:{id:warehouse}});
 expect((await write(`/${warehouse}/assignments`,{revision:row.revision,membershipId:member.id,assigned:true},owner,'put')).body.error.code).toBe('ASSIGNMENT_UNAVAILABLE');
 expect((await get('',staff)).status).toBe(403);
});
it('blocks growth on expiry but preserves reads and reductions, and denies suspended businesses',async()=>{
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
 expect((await write(`/${warehouse}`,{revision:1,active:false},owner,'patch')).status).toBe(200);
 expect((await write(`/${warehouse}`,{revision:2,active:true},owner,'patch')).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await get('?state=all')).status).toBe(200);
 await db.business.update({where:{id:business},data:{suspendedAt:new Date()}});
 expect((await get()).status).toBe(403);
});
