import {activateProviderPayment} from '../src/billing/manual.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService, type AuthContext } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, csrfFor, passwordHash } from '../src/auth/crypto.js';
import { ApiError } from '../src/errors.js';
import type { PayPalProvider, WebhookHeaders } from '../src/billing/paypal/client.js';
import type { PayPalEvent, SubscriptionSnapshot } from '../src/billing/paypal/contracts.js';
import { CheckoutService } from '../src/billing/paypal/checkout.js';
import { receiveWebhook, processWebhookBatch } from '../src/billing/paypal/inbox.js';
import { processCancellationBatch } from '../src/billing/paypal/cancellation.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),auth=new AuthService(db,settings);
const ids:string[]=[],bids:string[]=[],pids:string[]=[],events:string[]=[];
const providerPlanId=`P-${'A'.repeat(24)}`,baseTime='2026-11-11T12:00:00Z';
class FakeProvider implements PayPalProvider {
 readonly scope=randomBytes(32).toString('hex');
 snapshots=new Map<string,SubscriptionSnapshot>(); createIds:string[]=[]; failCreate=false; failRead=false; badBinding=false;
 cancelIds:string[]=[]; failCancelAfterWrite=false; noCancelEffect=false;
 async cancelSubscription(id:string){
  this.cancelIds.push(id);
  if(!this.noCancelEffect)this.snapshots.set(id,{...this.snapshots.get(id)!,status:'CANCELLED',status_update_time:'2026-11-12T12:00:00Z'});
  if(this.failCancelAfterWrite){this.failCancelAfterWrite=false;throw new ApiError(502,'PAYMENT_PROVIDER_UNAVAILABLE','Test ambiguous cancellation');}
 }
 async getPlan(){return {id:providerPlanId,status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',sequence:1,total_cycles:0,frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{currency_code:'USD',value:'29.00'}}}]};}
 async createSubscription(planId:string,intentId:string){
  this.createIds.push(intentId);
  const existing=[...this.snapshots.values()].find(s=>s.custom_id===intentId);
  const result=existing??{id:`I-${randomBytes(8).toString('hex').toUpperCase()}`,plan_id:planId,custom_id:intentId,status:'APPROVAL_PENDING' as const,status_update_time:baseTime};
  this.snapshots.set(result.id,result);
  if(this.failCreate){this.failCreate=false;throw new ApiError(502,'PAYMENT_PROVIDER_UNAVAILABLE','Test timeout after create');}
  return result;
 }
 async getSubscription(id:string){if(this.failRead)throw new ApiError(502,'PAYMENT_PROVIDER_UNAVAILABLE','Test provider unavailable');const s=this.snapshots.get(id);if(!s)throw new ApiError(502,'PAYMENT_PROVIDER_UNAVAILABLE','Unknown test subscription');return this.badBinding?{...s,custom_id:randomUUID()}:s;}
 async verifyWebhook(headers:WebhookHeaders,_event:PayPalEvent){if(headers['paypal-transmission-sig']!=='TEST-VALID')throw new ApiError(401,'INVALID_WEBHOOK_SIGNATURE','Invalid signature');}
}
const provider=new FakeProvider(),checkout=new CheckoutService(auth,provider),app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth,provider);
let owner:AuthContext,staff:AuthContext,admin:AuthContext,business:string,planId:string,main:Awaited<ReturnType<CheckoutService['create']>>;
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
async function actor(role:'OWNER'|'VIEWER'|'SUPER_ADMIN'){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,email:`${id}@example.test`,name:'Provider test',passwordHash:await passwordHash('Provider test password 195!'),emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?role:'USER',...(role!=='VIEWER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 if(role!=='SUPER_ADMIN')await db.membership.create({data:{userId:id,businessId:business,role}});
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
async function newBusiness(){const b=await db.business.create({data:{name:'Provider retry business'}});bids.push(b.id);await db.membership.create({data:{businessId:b.id,userId:owner.user.id,role:'OWNER'}});await db.paidApproval.create({data:{businessId:b.id,planId,requestedBy:owner.user.id,status:'APPROVED'}});return b.id;}
function event(type='BILLING.SUBSCRIPTION.ACTIVATED',resource:Record<string,unknown>={id:main.snapshot.id}):PayPalEvent{return {id:`EVENT-${randomUUID()}`,event_type:type,create_time:baseTime,resource};}
async function receive(e:PayPalEvent){const result=await receiveWebhook(auth,provider,{'paypal-transmission-sig':'TEST-VALID'},e);const row=await db.billingWebhook.findUniqueOrThrow({where:{scope_eventId:{scope:provider.scope,eventId:e.id}}});events.push(row.id);return {row,result};}
function post(path:string,ctx:AuthContext,body:object={}){return request(app).post(`/api/billing${path}`).set('Cookie',cookie(ctx)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,ctx.token)).send(body);}
function get(path:string,ctx:AuthContext){return request(app).get(`/api/billing${path}`).set('Cookie',cookie(ctx));}
beforeAll(async()=>{
 business=(await db.business.create({data:{name:'Provider billing tenant'}})).id;bids.push(business);
 planId=(await db.billingPlan.create({data:{code:`paypal-test-${randomUUID()}`,name:'Test priced draft',nameAr:'اختبار',priceMinor:2900,currency:'USD',interval:'MONTH',maxMembers:10,maxWarehouses:2,maxShops:3}})).id;pids.push(planId);
 owner=await actor('OWNER');staff=await actor('VIEWER');admin=await actor('SUPER_ADMIN');
 await db.paidApproval.create({data:{businessId:business,planId,requestedBy:owner.user.id,status:'APPROVED'}});
});
afterAll(async()=>{
 await db.billingCancellation.deleteMany({where:{checkout:{businessId:{in:bids}}}});
 await db.billingReceipt.deleteMany({where:{scope:provider.scope}});await db.billingWebhook.deleteMany({where:{id:{in:events}}});
 await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{OR:[{userId:{in:ids}},{businessId:{in:bids}}]}});await db.billingCheckout.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.deleteMany({where:{id:{in:pids}}});await db.$disconnect();
});
it('does not expose paid checkout or allow staff/platform tenant bypass',async()=>{
 expect((await post(`/businesses/${business}/checkout`,owner,{planId,confirm:true})).status).toBe(409);
 await expect(checkout.create(staff,business,planId,providerPlanId)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(checkout.create(admin,business,planId,providerPlanId)).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(provider.createIds).toHaveLength(0);
});
it('persists one business checkout and binds only a server-verified provider subscription',async()=>{
 main=await checkout.create(owner,business,planId,providerPlanId);
 const second=await checkout.create(owner,business,planId,providerPlanId);
 expect(second.intentId).toBe(main.intentId);expect(provider.createIds).toEqual([main.intentId]);
 expect(await db.billingCheckout.count({where:{businessId:business}})).toBe(1);
 expect((await db.billingCheckout.findUniqueOrThrow({where:{id:main.intentId}})).providerSubscriptionId).toBe(main.snapshot.id);
 expect((await get(`/businesses/${business}`,owner)).body.checkoutAvailable).toBe(false);
});
it('reuses the same request ID after an ambiguous timeout instead of creating a second subscription',async()=>{
 const b=await newBusiness();provider.failCreate=true;
 await expect(checkout.create(owner,b,planId,providerPlanId)).rejects.toMatchObject({code:'PAYMENT_PROVIDER_UNAVAILABLE'});
 const original=await db.billingCheckout.findUniqueOrThrow({where:{businessId:b}});expect(original.providerSubscriptionId).toBeNull();expect(original.firstRequestedAt).not.toBeNull();
 const recovered=await checkout.create(owner,b,planId,providerPlanId);expect(recovered.intentId).toBe(original.id);
 expect(provider.createIds.filter(id=>id===original.id)).toHaveLength(2);expect([...provider.snapshots.values()].filter(s=>s.custom_id===original.id)).toHaveLength(1);
});
it('holds old unresolved checkout attempts for review after the provider idempotency window',async()=>{
 const b=await newBusiness();const intent=await db.billingCheckout.create({data:{businessId:b,planId,scope:provider.scope,providerPlanId,firstRequestedAt:new Date(Date.now()-71*3600000)}});
 const count=provider.createIds.length;await expect(checkout.create(owner,b,planId,providerPlanId)).rejects.toMatchObject({code:'CHECKOUT_REVIEW_REQUIRED'});expect(provider.createIds).toHaveLength(count);expect(intent.providerSubscriptionId).toBeNull();
});
it('validates signatures before storing and encrypts queued provider data',async()=>{
 const e=event();
 expect((await request(app).post('/api/billing/paypal/webhook').send(e)).status).toBe(401);
 expect(await db.billingWebhook.count({where:{eventId:e.id}})).toBe(0);
 const res=await request(app).post('/api/billing/paypal/webhook').set('paypal-transmission-sig','TEST-VALID').send(e);expect(res.status).toBe(202);
 const row=await db.billingWebhook.findUniqueOrThrow({where:{scope_eventId:{scope:provider.scope,eventId:e.id}}});events.push(row.id);expect(row.payload).not.toContain(e.id);expect(row.payload).not.toContain(main.snapshot.id);expect(row.status).toBe('PENDING');
 const replay=await receiveWebhook(auth,provider,{'paypal-transmission-sig':'TEST-VALID'},{resource:e.resource,create_time:e.create_time,event_type:e.event_type,id:e.id});expect(replay.duplicate).toBe(true);
 await expect(receiveWebhook(auth,provider,{'paypal-transmission-sig':'TEST-VALID'},{...e,resource:{id:'I-OTHER123'}})).rejects.toMatchObject({code:'WEBHOOK_EVENT_CONFLICT'});
 provider.snapshots.set(main.snapshot.id,{...main.snapshot,status:'ACTIVE',status_update_time:'2026-11-11T13:00:00Z'});
 expect((await processWebhookBatch(auth,provider)).processed).toBe(1);
 expect((await db.billingWebhook.findUniqueOrThrow({where:{id:row.id}})).payload).toBe('');
 expect(await db.billingReceipt.count({where:{checkoutId:main.intentId}})).toBe(0);
});
it('records settled sale receipts once, even across duplicate deliveries and event IDs',async()=>{
 const sale={id:'SALE-TEST001',billing_agreement_id:main.snapshot.id,state:'completed',create_time:baseTime,amount:{total:'29.00',currency:'USD'}};
 const e=event('PAYMENT.SALE.COMPLETED',sale);const {row}=await receive(e);await receive(e);
 const results=await Promise.all([processWebhookBatch(auth,provider),processWebhookBatch(auth,provider)]);
 expect(results.reduce((sum,r)=>sum+r.processed,0)).toBe(1);
 await receive(event('PAYMENT.SALE.COMPLETED',sale));expect((await processWebhookBatch(auth,provider)).processed).toBe(1);
 const receipts=await db.billingReceipt.findMany({where:{checkoutId:main.intentId}});expect(receipts).toHaveLength(1);expect(receipts[0]).toMatchObject({amountMinor:2900,currency:'USD',paidAt:new Date(baseTime)});
 expect((await db.billingWebhook.findUniqueOrThrow({where:{id:row.id}})).status).toBe('PROCESSED');
 // Receipt storage never itself grants subscription access.
 expect((await get(`/businesses/${business}`,owner)).body.active).toBe(false);
});
it('refuses foreign ownership binding and mismatched sale currencies without writing receipts',async()=>{
 provider.badBinding=true;const first=await receive(event());expect((await processWebhookBatch(auth,provider)).review).toBe(1);provider.badBinding=false;
 expect((await db.billingWebhook.findUniqueOrThrow({where:{id:first.row.id}})).lastError).toBe('PROVIDER_BINDING_MISMATCH');
 await receive(event('PAYMENT.SALE.COMPLETED',{id:'SALE-FOREIGN',billing_agreement_id:main.snapshot.id,state:'completed',create_time:baseTime,amount:{total:'29',currency:'EUR'}}));expect((await processWebhookBatch(auth,provider)).review).toBe(1);
 expect(await db.billingReceipt.count({where:{transactionId:'SALE-FOREIGN'}})).toBe(0);
});
it('does not overwrite newer provider state with a stale worker snapshot',async()=>{
 await db.billingCheckout.update({where:{id:main.intentId},data:{providerStatus:'CANCELLED',providerUpdatedAt:new Date('2026-11-11T15:00:00Z')}});
 await receive(event('BILLING.SUBSCRIPTION.ACTIVATED'));expect((await processWebhookBatch(auth,provider)).processed).toBe(1);
 expect((await db.billingCheckout.findUniqueOrThrow({where:{id:main.intentId}})).providerStatus).toBe('CANCELLED');
});
it('retries unknown bindings and provider outages, then retains exhausted events for review',async()=>{
 const unknown=await receive(event('BILLING.SUBSCRIPTION.CREATED',{id:'I-UNKNOWN123'}));expect((await processWebhookBatch(auth,provider)).retried).toBe(1);
 let row=await db.billingWebhook.findUniqueOrThrow({where:{id:unknown.row.id}});expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());expect(row.payload).toBeTruthy();
 await db.billingWebhook.update({where:{id:row.id},data:{attempts:9,nextAttemptAt:new Date(0)}});expect((await processWebhookBatch(auth,provider)).review).toBe(1);
 const outage=await receive(event());provider.failRead=true;expect((await processWebhookBatch(auth,provider)).retried).toBe(1);provider.failRead=false;
 await db.billingWebhook.update({where:{id:outage.row.id},data:{nextAttemptAt:new Date(0)}});expect((await processWebhookBatch(auth,provider)).processed).toBe(1);
});
it('recovers abandoned processing leases and ignores unsupported non-financial event types',async()=>{
 const stale=await receive(event('CATALOG.PRODUCT.UPDATED',{id:'PRODUCT-TEST'}));await db.billingWebhook.update({where:{id:stale.row.id},data:{status:'PROCESSING',leaseToken:randomUUID(),leaseUntil:new Date(0)}});
 expect((await processWebhookBatch(auth,provider)).ignored).toBe(1);expect((await db.billingWebhook.findUniqueOrThrow({where:{id:stale.row.id}})).payload).toBe('');
});
it('quarantines reversals and conflicting transaction replays rather than falsifying history',async()=>{
 await receive(event('PAYMENT.SALE.REFUNDED',{id:'REFUND-TEST'}));expect((await processWebhookBatch(auth,provider)).review).toBe(1);
 await receive(event('PAYMENT.SALE.COMPLETED',{id:'SALE-TEST001',billing_agreement_id:main.snapshot.id,state:'completed',create_time:baseTime,amount:{total:'99.00',currency:'USD'}}));expect((await processWebhookBatch(auth,provider)).review).toBe(1);
 expect((await db.billingReceipt.findFirstOrThrow({where:{checkoutId:main.intentId}})).amountMinor).toBe(2900);
});
it('scopes receipt history to owners and exposes no event payload or full transaction ID',async()=>{
 const response=await get(`/businesses/${business}/payments`,owner);expect(response.status).toBe(200);expect(response.body.items).toHaveLength(1);expect(response.body.items[0]).toMatchObject({amountMinor:2900,reference:'SAL…001'});expect(response.text).not.toContain('SALE-TEST001');expect(response.headers['cache-control']).toBe('no-store');
 expect((await get(`/businesses/${business}/payments`,staff)).status).toBe(403);expect((await get(`/businesses/${business}/payments`,admin)).status).toBe(403);expect((await get(`/businesses/${randomUUID()}/payments`,owner)).status).toBe(403);
});
it('lets only platform administrators inspect and retry review events with CSRF',async()=>{
 expect((await get('/provider-events',owner)).status).toBe(403);
 const list=await get('/provider-events',admin);expect(list.status).toBe(200);expect(list.body.items[0]).not.toHaveProperty('payload');expect(list.body.items[0]).not.toHaveProperty('payloadHash');
 const row=await db.billingWebhook.findFirstOrThrow({where:{scope:provider.scope,status:'REVIEW',lastError:'PROVIDER_BINDING_MISMATCH'}});
 expect((await request(app).post(`/api/billing/provider-events/${row.id}/retry`).set('Cookie',cookie(admin)).set('Origin',settings.appOrigin).send({})).status).toBe(403);
 expect((await post(`/provider-events/${row.id}/retry`,owner)).status).toBe(403);
 expect((await post(`/provider-events/${row.id}/retry`,admin)).status).toBe(200);expect((await processWebhookBatch(auth,provider)).processed).toBe(1);
 expect((await post(`/provider-events/${row.id}/retry`,admin)).status).toBe(409);
});
it('returns an explicit unavailable response when B2B credentials are absent',async()=>{
 const disabled=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
 expect((await request(disabled).post('/api/billing/paypal/webhook').send(event())).body.error.code).toBe('PAYPAL_NOT_CONFIGURED');
});
it('serializes concurrent checkout creation for one business without a second provider agreement',async()=>{
 const b=await newBusiness();const results=await Promise.allSettled([checkout.create(owner,b,planId,providerPlanId),checkout.create(owner,b,planId,providerPlanId)]);
 expect(results.some(r=>r.status==='fulfilled')).toBe(true);
 for(const result of results)if(result.status==='rejected')expect(result.reason.code).toBe('CHECKOUT_BUSY');
 const row=await db.billingCheckout.findUniqueOrThrow({where:{businessId:b}});expect(provider.createIds.filter(id=>id===row.id)).toHaveLength(1);
});
it('fences a worker that loses its lease before committing a payment',async()=>{
 const pending=await receive(event('PAYMENT.SALE.COMPLETED',{id:'SALE-LEASE001',billing_agreement_id:main.snapshot.id,state:'completed',create_time:baseTime,amount:{total:'29.00',currency:'USD'}}));
 const original=provider.getSubscription.bind(provider);let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{started=resolve;});
 provider.getSubscription=async id=>{started();await gate;return original(id);};
 const processing=processWebhookBatch(auth,provider,1);
 try{
  await began;
  await db.billingWebhook.update({where:{id:pending.row.id},data:{leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+120000)}});
  release();await processing;
  expect(await db.billingReceipt.count({where:{scope:provider.scope,transactionId:'SALE-LEASE001'}})).toBe(0);
  expect((await db.billingWebhook.findUniqueOrThrow({where:{id:pending.row.id}})).status).toBe('PROCESSING');
 }finally{release();provider.getSubscription=original;await processing;}
 await db.billingWebhook.update({where:{id:pending.row.id},data:{status:'PENDING',leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(0)}});
 expect((await processWebhookBatch(auth,provider)).processed).toBe(1);
 expect(await db.billingReceipt.count({where:{scope:provider.scope,transactionId:'SALE-LEASE001'}})).toBe(1);
});

async function cancellable(){
 const b=await newBusiness(),result=await checkout.create(owner,b,planId,providerPlanId);
 provider.snapshots.set(result.snapshot.id,{...result.snapshot,status:'ACTIVE',status_update_time:'2026-11-11T16:00:00Z'});
 return {b,...result};
}
it('keeps owner billing recovery available during suspension without opening operational access',async()=>{
 const c=await cancellable();await db.business.update({where:{id:c.b},data:{suspendedAt:new Date()}});
 const owned=await get('/businesses',owner);expect(owned.status).toBe(200);expect(owned.body.find((b:{id:string})=>b.id===c.b)).toMatchObject({suspended:true});
 expect((await get('/businesses',admin)).body).toEqual([]);expect((await get('/businesses',staff)).body).toEqual([]);
 expect((await get(`/businesses/${c.b}`,owner)).status).toBe(200);
 expect((await get(`/businesses/${c.b}/payments`,owner)).status).toBe(200);
 expect((await get(`/businesses/${c.b}/cancellation`,owner)).body.cancellationAvailable).toBe(true);
 expect((await post(`/businesses/${c.b}/trial`,owner,{planId})).status).toBe(403);
 await expect(checkout.create(owner,c.b,planId,providerPlanId)).rejects.toMatchObject({code:'FORBIDDEN'});
 expect((await post(`/businesses/${c.b}/cancellation`,admin,{confirm:true})).status).toBe(403);
 expect((await post(`/businesses/${c.b}/cancellation`,staff,{confirm:true})).status).toBe(403);
 expect((await request(app).post(`/api/billing/businesses/${c.b}/cancellation`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send({confirm:true})).status).toBe(403);
 expect((await post(`/businesses/${c.b}/cancellation`,owner,{confirm:false})).status).toBe(422);
 const replies=await Promise.all([post(`/businesses/${c.b}/cancellation`,owner,{confirm:true}),post(`/businesses/${c.b}/cancellation`,owner,{confirm:true})]);
 expect(replies.map(r=>r.status)).toEqual([202,202]);expect(replies[0]!.body.id).toBe(replies[1]!.body.id);
 expect(provider.cancelIds).not.toContain(c.snapshot.id);
 expect(await db.billingAudit.count({where:{businessId:c.b,action:'cancellation.requested'}})).toBe(1);
 const results=await Promise.all([processCancellationBatch(auth,provider),processCancellationBatch(auth,provider)]);
 expect(results.reduce((total,r)=>total+r.confirmed,0)).toBe(1);
 expect(provider.cancelIds.filter(id=>id===c.snapshot.id)).toHaveLength(1);
 const status=await get(`/businesses/${c.b}/cancellation`,owner);expect(status.body.cancellation.status).toBe('CONFIRMED');expect(status.text).not.toContain(c.snapshot.id);
 expect((await post(`/businesses/${c.b}/cancellation`,owner,{confirm:true})).body.id).toBe(replies[0]!.body.id);
});
it('reconciles an ambiguous cancellation timeout before making another provider mutation',async()=>{
 const c=await cancellable();const res=await post(`/businesses/${c.b}/cancellation`,owner,{confirm:true});
 provider.failCancelAfterWrite=true;expect((await processCancellationBatch(auth,provider)).retried).toBe(1);
 const row=await db.billingCancellation.findUniqueOrThrow({where:{id:res.body.id}});expect(row.status).toBe('PENDING');expect(row.confirmedAt).toBeNull();
 await db.billingCancellation.update({where:{id:row.id},data:{nextAttemptAt:new Date(0)}});
 expect((await processCancellationBatch(auth,provider)).confirmed).toBe(1);
 expect(provider.cancelIds.filter(id=>id===c.snapshot.id)).toHaveLength(1);
 expect(await db.billingAudit.count({where:{businessId:c.b,action:'cancellation.confirmed'}})).toBe(1);
});
it('requires provider-confirmed terminal state, limits retries and protects operator recovery',async()=>{
 const c=await cancellable();const res=await post(`/businesses/${c.b}/cancellation`,owner,{confirm:true});
 provider.noCancelEffect=true;
 try{
  expect((await processCancellationBatch(auth,provider)).retried).toBe(1);
  await db.billingCancellation.update({where:{id:res.body.id},data:{attempts:9,nextAttemptAt:new Date(0)}});
  expect((await processCancellationBatch(auth,provider)).review).toBe(1);
  expect((await db.billingCancellation.findUniqueOrThrow({where:{id:res.body.id}})).confirmedAt).toBeNull();
 }finally{provider.noCancelEffect=false;}
 expect((await get('/cancellations',owner)).status).toBe(403);
 const list=await get('/cancellations',admin);expect(list.status).toBe(200);expect(list.body.items[0]).not.toHaveProperty('checkout');
 expect((await post(`/cancellations/${res.body.id}/retry`,owner)).status).toBe(403);
 expect((await post(`/cancellations/${res.body.id}/retry`,admin)).status).toBe(200);
 expect((await processCancellationBatch(auth,provider)).confirmed).toBe(1);
 expect((await post(`/cancellations/${res.body.id}/retry`,admin)).status).toBe(409);
});
it('never cancels a foreign provider binding and rejects disabled owner recovery access',async()=>{
 const c=await cancellable();const res=await post(`/businesses/${c.b}/cancellation`,owner,{confirm:true});
 provider.badBinding=true;
 try{expect((await processCancellationBatch(auth,provider)).review).toBe(1);}finally{provider.badBinding=false;}
 expect(provider.cancelIds).not.toContain(c.snapshot.id);
 expect((await db.billingCancellation.findUniqueOrThrow({where:{id:res.body.id}})).lastError).toBe('PROVIDER_BINDING_MISMATCH');
 await db.membership.update({where:{businessId_userId:{businessId:c.b,userId:owner.user.id}},data:{disabledAt:new Date()}});
 expect((await get(`/businesses/${c.b}/cancellation`,owner)).status).toBe(403);
 expect((await get(`/businesses/${c.b}/payments`,owner)).status).toBe(403);
});
it('fences expired cancellation workers and safely recovers abandoned leases',async()=>{
 const c=await cancellable();const res=await post(`/businesses/${c.b}/cancellation`,owner,{confirm:true});
 const original=provider.getSubscription.bind(provider);let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{started=resolve;});
 provider.getSubscription=async id=>{started();await gate;return original(id);};
 const processing=processCancellationBatch(auth,provider,1);
 try{
  await began;
  await db.billingCancellation.update({where:{id:res.body.id},data:{leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+120000)}});
  release();await processing;
  expect(provider.cancelIds).not.toContain(c.snapshot.id);
  expect((await db.billingCancellation.findUniqueOrThrow({where:{id:res.body.id}})).status).toBe('PROCESSING');
 }finally{release();provider.getSubscription=original;await processing;}
 await db.billingCancellation.update({where:{id:res.body.id},data:{leaseUntil:new Date(0)}});
 expect((await processCancellationBatch(auth,provider)).confirmed).toBe(1);
});

it('grants only verified paid periods, never extends for the same payment, and holds refunds',async()=>{
 const {reconcileCheckout}=await import('../src/billing/paypal/reconciliation.js');
 const {billingState,requireMemberCapacity}=await import('../src/billing/entitlements.js');
 const bid=await newBusiness(),intent=await checkout.create(owner,bid,planId,providerPlanId);
 const now=new Date(),paid=new Date(now.getTime()-86400000).toISOString(),end=new Date(now.getTime()+29*86400000).toISOString();
 await db.businessSubscription.create({data:{businessId:bid,planId,trialStartedAt:new Date('2026-10-01T12:00:00Z'),trialEndsAt:new Date('2026-10-15T12:00:00Z')}});
 expect((await auth.transaction(tx=>billingState(tx,bid,now)))).toMatchObject({active:false,status:'EXPIRED'});

 await expect(auth.transaction(tx=>requireMemberCapacity(tx,bid))).rejects.toMatchObject({code:'SUBSCRIPTION_REQUIRED'});
 let status='COMPLETED';
 const reconciler:PayPalProvider={scope:provider.scope,getPlan:()=>provider.getPlan(),getSubscription:id=>provider.getSubscription(id),createSubscription:(...args)=>provider.createSubscription(args[0],args[1]),cancelSubscription:id=>provider.cancelSubscription(id),verifyWebhook:(...args)=>provider.verifyWebhook(...args),getTransactions:async()=>({transactions:[{id:'PAYMENT-NEW',status,time:paid,amount_with_breakdown:{gross_amount:{currency_code:'USD',value:'29.00'}}}],total_items:1,total_pages:1})};
 provider.snapshots.set(intent.snapshot.id,{...intent.snapshot,status:'ACTIVE',billing_info:{last_payment:{time:paid,amount:{value:'29.00',currency_code:'USD'}},next_billing_time:end,failed_payments_count:0,outstanding_balance:{value:'0.00',currency_code:'USD'}}});
 await reconcileCheckout(auth,reconciler,intent.intentId,now);
 expect((await auth.transaction(tx=>billingState(tx,bid,now)))).toMatchObject({active:false,status:'AWAITING_ACTIVATION'});
 const pending=await db.billingCheckout.findUniqueOrThrow({where:{id:intent.intentId}});
 await expect(activateProviderPayment(auth,owner,bid,{revision:pending.revision,transactionId:pending.paidTransaction!,confirmed:true})).rejects.toMatchObject({code:'PLATFORM_FORBIDDEN'});
 await activateProviderPayment(auth,admin,bid,{revision:pending.revision,transactionId:pending.paidTransaction!,confirmed:true});
 await activateProviderPayment(auth,admin,bid,{revision:pending.revision,transactionId:pending.paidTransaction!,confirmed:true});
 expect((await auth.transaction(tx=>billingState(tx,bid,now))).active).toBe(true);
 await expect(auth.transaction(tx=>requireMemberCapacity(tx,bid))).resolves.toBeUndefined();
 expect((await db.billingCheckout.findUniqueOrThrow({where:{id:intent.intentId}})).nextBillingAt?.toISOString()).toBe(new Date(end).toISOString());
 provider.snapshots.get(intent.snapshot.id)!.billing_info!.next_billing_time=new Date(new Date(end).getTime()+86400000).toISOString();
 await reconcileCheckout(auth,reconciler,intent.intentId,now);
 expect((await db.billingCheckout.findUniqueOrThrow({where:{id:intent.intentId}})).paidUntil?.toISOString()).toBe(end);
 provider.snapshots.get(intent.snapshot.id)!.status='CANCELLED';
 await reconcileCheckout(auth,reconciler,intent.intentId,now);
 expect((await auth.transaction(tx=>billingState(tx,bid,now))).status).toBe('CANCELLED_PAID');
 expect((await db.billingCheckout.findUniqueOrThrow({where:{id:intent.intentId}})).nextBillingAt).toBeNull();
 expect((await auth.transaction(tx=>billingState(tx,bid,new Date(new Date(end).getTime()+2*86400000)))).active).toBe(false);
 status='REFUNDED';await reconcileCheckout(auth,reconciler,intent.intentId,now);
 expect((await auth.transaction(tx=>billingState(tx,bid,now))).active).toBe(false);
 expect((await auth.transaction(tx=>billingState(tx,bid,now))).status).toBe('REVIEW');
});
it('keeps paid checkout disabled unless pricing, sandbox and bindings are explicitly configured',async()=>{
 const {checkoutConfiguration}=await import('../src/billing/paypal/launch.js');
 expect(checkoutConfiguration({}).enabled).toBe(false);
 expect(()=>checkoutConfiguration({B2B_CHECKOUT_ENABLED:'true'})).toThrow();
});

it('publishes and creates paid checkout only behind explicit launch gates and owner authorization',async()=>{
 const keys=['B2B_CHECKOUT_ENABLED','B2B_PRICING_APPROVED','B2B_SANDBOX_VERIFIED','B2B_PAYPAL_PLAN_BINDINGS'] as const;
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const plan=await db.billingPlan.findUniqueOrThrow({where:{id:planId}}),bid=await newBusiness();
 try{
  process.env.B2B_CHECKOUT_ENABLED='true';process.env.B2B_PRICING_APPROVED='true';process.env.B2B_SANDBOX_VERIFIED='true';process.env.B2B_PAYPAL_PLAN_BINDINGS=JSON.stringify({[plan.code]:providerPlanId});
  const published=await request(app).patch(`/api/billing/plans/${planId}`).set('Cookie',cookie(admin)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,admin.token)).send({revision:plan.revision,published:true});expect(published.status).toBe(200);
  expect((await post(`/businesses/${bid}/checkout`,staff,{planId,confirm:true})).status).toBe(403);
  expect((await post(`/businesses/${bid}/checkout`,admin,{planId,confirm:true})).status).toBe(403);
  expect((await post(`/businesses/${bid}/checkout`,owner,{planId,confirm:true})).status).toBe(200);
  expect((await get(`/businesses/${bid}`,owner)).body.active).toBe(false);
  expect(await db.billingCheckout.count({where:{businessId:bid}})).toBe(1);
 }finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}await db.billingPlan.update({where:{id:planId},data:{published:false}});}
});
