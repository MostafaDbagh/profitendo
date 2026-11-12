import {randomBytes,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import request from 'supertest';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService,type AuthContext} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {csrfFor,encrypt,passwordHash} from '../src/auth/crypto.js';
import {billingState} from '../src/billing/entitlements.js';
import {CheckoutService} from '../src/billing/paypal/checkout.js';
import type {PayPalProvider} from '../src/billing/paypal/client.js';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3100'}),auth=new AuthService(db,settings),scope=randomUUID();
const provider={scope,getPlan:async()=>{throw new Error('Must not call provider before approval');}} as unknown as PayPalProvider;
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth,provider);
const ids:string[]=[],bids:string[]=[],pids:string[]=[],tickets:string[]=[];let admin:AuthContext,owner:AuthContext,other:AuthContext,bid:string,planId:string,hash:string;
const cookie=(c:AuthContext)=>`pl_session=${c.token}`;
function get(path:string,c=admin){return request(app).get('/api'+path).set('Cookie',cookie(c));}
function write(path:string,body:object,c=admin,method:'post'|'patch'|'put'='post'){return request(app)[method]('/api'+path).set('Cookie',cookie(c)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,c.token)).send(body);}
async function actor(role:'SUPER_ADMIN'|'USER'='USER'){const id=randomUUID();ids.push(id);const u=await db.authUser.create({data:{id,name:'Test Subscriber',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role,mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});return auth.transaction(tx=>auth.makeSession(tx,u,true));}
beforeAll(async()=>{hash=await passwordHash('Admin test passphrase 123!');admin=await actor('SUPER_ADMIN');owner=await actor();other=await actor();const b=await db.business.create({data:{name:'Subscriber test '+scope}});bid=b.id;bids.push(bid);await db.membership.create({data:{businessId:bid,userId:owner.user.id,role:'OWNER'}});const plan=await db.billingPlan.create({data:{code:'test-'+scope,name:'Monthly',nameAr:'شهري',priceMinor:1900,currency:'USD',interval:'MONTH',trialDays:0,maxMembers:5,maxWarehouses:2,maxShops:3,published:true}});planId=plan.id;pids.push(planId);});
afterAll(async()=>{await db.supportTicket.deleteMany({where:{id:{in:tickets}}});await db.billingReceipt.deleteMany({where:{checkout:{businessId:{in:bids}}}});await db.billingCheckout.deleteMany({where:{businessId:{in:bids}}});await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.billingPlan.deleteMany({where:{id:{in:pids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();});
it('allows trial immediately and denies unapproved paid checkout before any provider call',async()=>{
 const trial=await db.billingPlan.create({data:{code:'trial-'+scope,name:'Trial',nameAr:'تجربة',priceMinor:null,trialDays:7,maxMembers:5,maxWarehouses:1,maxShops:1,published:true}});pids.push(trial.id);
 expect((await write(`/billing/businesses/${bid}/trial`,{planId:trial.id},owner)).status).toBe(201);
 await expect(new CheckoutService(auth,provider).create(owner,bid,planId,'P-123456789012345678901234')).rejects.toMatchObject({code:'PAID_APPROVAL_REQUIRED'});
 expect((await auth.transaction(tx=>billingState(tx,bid))).active).toBe(true);
 expect((await write(`/billing/businesses/${bid}/approvals`,{planId},other)).status).toBe(403);
});
it('reviews a request with revisions, reason and audit; approval itself does not create paid access',async()=>{
 const path=`/billing/businesses/${bid}/approvals`;const first=await write(path,{planId},owner);expect(first.status).toBe(201);const id=first.body.id;
 expect((await write(path,{planId},owner)).body.id).toBe(id);
 expect((await get('/billing/approvals',owner)).status).toBe(403);
 expect((await write('/billing/approvals/'+id,{status:'APPROVED',reason:'Reviewed account',revision:0},owner,'patch')).status).toBe(403);
 const valid={status:'REJECTED',reason:'Please clarify business information',revision:0};
 expect((await request(app).patch('/api/billing/approvals/'+id).set('Cookie',cookie(admin)).set('Origin',settings.appOrigin).send(valid)).status).toBe(403);
 expect((await write('/billing/approvals/'+id,{...valid,reason:''},admin,'patch')).status).toBe(422);
 expect((await write('/billing/approvals/'+id,valid,admin,'patch')).status).toBe(200);
 expect((await auth.transaction(tx=>billingState(tx,bid))).status).toBe('TRIAL');
 expect((await get(path,owner)).body[0].reason).toBe(valid.reason);
 const retried=await write(path,{planId},owner);expect(retried.body.status).toBe('PENDING');
 expect((await write('/billing/approvals/'+id,{...valid,status:'APPROVED'},admin,'patch')).status).toBe(409);
 expect((await write('/billing/approvals/'+id,{...valid,status:'APPROVED',revision:retried.body.revision},admin,'patch')).status).toBe(200);
 expect((await auth.transaction(tx=>billingState(tx,bid))).status).toBe('TRIAL');expect(await db.billingCheckout.count({where:{businessId:bid}})).toBe(0);
 expect(await db.billingAudit.count({where:{businessId:bid,action:'approval.approved'}})).toBe(1);
});
it('reports verified receipts only for the current provider and month, separating currencies',async()=>{
 const c=await db.billingCheckout.create({data:{businessId:bid,planId,scope,providerPlanId:'P-123456789012345678901234'}});
 for(const [currency,amountMinor,receiptScope,paidAt] of [['USD',1900,scope,'2026-11-10'],['EUR',2500,scope,'2026-11-11'],['USD',9999,'other-scope','2026-11-10'],['USD',5000,scope,'2026-10-10']] as const)await db.billingReceipt.create({data:{checkoutId:c.id,scope:receiptScope,transactionId:randomUUID(),eventId:randomUUID(),currency,amountMinor,paidAt:new Date(paidAt)}});
 const result=await get('/platform/revenue?month=2026-11');expect(result.status).toBe(200);expect(result.body.total).toBe(2);expect(result.body.totals).toEqual(expect.arrayContaining([expect.objectContaining({currency:'USD',amountMinor:1900}),expect.objectContaining({currency:'EUR',amountMinor:2500})]));
 for(const path of ['/platform/revenue','/platform/subscribers'])expect((await get(path,owner)).status).toBe(403);
 expect((await get('/platform/revenue?month=bad')).status).toBe(422);
 await db.billingCheckout.update({where:{id:c.id},data:{paidFrom:new Date(Date.now()-10000),paidUntil:new Date(Date.now()+86400000),providerStatus:'ACTIVE'}});
 expect((await auth.transaction(tx=>billingState(tx,bid))).status).toBe('ACTIVE');
 await db.paidApproval.updateMany({where:{businessId:bid},data:{status:'REJECTED'}});
 expect((await auth.transaction(tx=>billingState(tx,bid))).status).toBe('TRIAL');
});
it('keeps signed-in conversations private and lets admins reply/resolve with stale-write protection',async()=>{
 const r=await write('/support/tickets',{subject:'Billing question',body:'Please help with my plan.',category:'BILLING',businessId:bid},owner);expect(r.status).toBe(201);const id=r.body.id;tickets.push(id);
 expect((await get('/support/tickets/'+id,other)).status).toBe(404);expect((await get('/support/admin/tickets',owner)).status).toBe(403);
 expect((await write('/support/tickets/'+id+'/messages',{body:'Intrusion'},other)).status).toBe(404);
 expect((await write('/support/admin/tickets/'+id+'/messages',{body:'We can help you choose.'})).status).toBe(200);
 const thread=await get('/support/tickets/'+id,owner);expect(thread.body.messages).toHaveLength(2);expect(thread.body.messages[1].fromAdmin).toBe(true);expect(thread.body).not.toHaveProperty('guestTokenHash');
 expect((await write('/support/admin/tickets/'+id,{revision:0,status:'RESOLVED'},admin,'patch')).status).toBe(409);
 expect((await write('/support/admin/tickets/'+id,{revision:thread.body.revision,status:'RESOLVED'},admin,'patch')).status).toBe(200);
 expect((await write('/support/tickets/'+id+'/messages',{body:'One more question'},owner)).status).toBe(200);
 expect((await get('/support/tickets/'+id,owner)).body.status).toBe('NEW');
 expect((await write('/support/tickets',{subject:'Fake business',category:'GENERAL',body:'Hello',businessId:randomUUID()},owner)).status).toBe(403);
});
it('protects public conversations with a private hashed token and validates input',async()=>{
 const input={name:'Visitor',email:`visitor-${scope}@example.test`,subject:'Subscription enquiry',category:'GENERAL',body:'Please explain the plans.'};
 const send=(data:object)=>request(app).post('/api/support/public').set('Origin',settings.appOrigin).send(data);
 expect((await send({...input,fromAdmin:true})).status).toBe(422);
 const r=await send(input);expect(r.status).toBe(201);tickets.push(r.body.id);expect(r.body.token).toHaveLength(43);
 const path='/api/support/public/'+r.body.id;expect((await request(app).get(path)).status).toBe(404);expect((await request(app).get(path).set('X-Support-Token','x'.repeat(43))).status).toBe(404);
 expect((await request(app).get(path).set('X-Support-Token',r.body.token)).status).toBe(200);
 const stored=await db.supportTicket.findUniqueOrThrow({where:{id:r.body.id}});expect(stored.guestTokenHash).not.toBe(r.body.token);
 expect((await get('/support/tickets',owner)).body.items.some((t:{id:string})=>t.id===r.body.id)).toBe(false);
 expect((await write('/support/admin/tickets/'+r.body.id+'/messages',{body:'Hello visitor'})).status).toBe(200);
 const reply=await request(app).get(path).set('X-Support-Token',r.body.token);expect(reply.body.messages[1].body).toBe('Hello visitor');
});

it('edits only unused drafts and records precise before/after terms',async()=>{
 const input={code:'draft-'+randomUUID(),name:'Draft annual',nameAr:'خطة سنوية',priceMinor:9900,currency:'USD',interval:'YEAR',trialDays:0,maxMembers:10,maxWarehouses:2,maxShops:5};
 const created=await write('/billing/plans',input);expect(created.status).toBe(201);pids.push(created.body.id);
 const path='/billing/plans/'+created.body.id+'/draft',next={...input,priceMinor:12900,maxMembers:20,revision:0};
 expect((await write(path,next,owner,'put')).status).toBe(403);
 expect((await write(path,next,admin,'put')).status).toBe(200);
 expect((await write(path,next,admin,'put')).status).toBe(409);
 const audit=await db.billingAudit.findFirstOrThrow({where:{planId:created.body.id,action:'plan.updated'}});
 expect(audit.changes).toMatchObject({before:{priceMinor:9900,maxMembers:10},after:{priceMinor:12900,maxMembers:20}});
 await db.paidApproval.create({data:{businessId:bid,planId:created.body.id,requestedBy:owner.user.id}});
 expect((await write(path,{...next,revision:1},admin,'put')).body.error.code).toBe('PLAN_IN_USE');
 const history=await get('/billing/audit');expect(history.body.items.some((r:{businessName?:string})=>r.businessName?.startsWith('Subscriber test'))).toBe(true);
});
it('reports payment and renewal separately, and hides renewal after cancellation',async()=>{
 const renewal=new Date(Date.now()+86400000);
 await db.billingCheckout.update({where:{businessId:bid},data:{providerStatus:'ACTIVE',nextBillingAt:renewal}});
 let list=await get('/platform/subscribers?q='+encodeURIComponent('Subscriber test '+scope));
 expect(list.status).toBe(200);expect(list.body.items[0]).toMatchObject({renewalAt:renewal.toISOString(),paymentStatus:'PAYMENT_RECEIVED',owners:[{email:owner.user.email}]});
 await db.billingCheckout.update({where:{businessId:bid},data:{providerStatus:'CANCELLED'}});
 list=await get('/platform/subscribers?q='+encodeURIComponent('Subscriber test '+scope));expect(list.body.items[0].renewalAt).toBeNull();
 await db.billingCheckout.update({where:{businessId:bid},data:{accessHold:true}});
 list=await get('/platform/subscribers?q='+encodeURIComponent('Subscriber test '+scope));expect(list.body.items[0].paymentStatus).toBe('PAYMENT_REVIEW');
});
