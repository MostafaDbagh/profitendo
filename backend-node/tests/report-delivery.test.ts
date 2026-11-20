import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService, type AuthContext } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { csrfFor, encrypt, passwordHash } from '../src/auth/crypto.js';
import {prepareReportBatch} from '../src/reports/delivery-worker.js';
import {deliverMailBatch} from '../src/auth/mail.js';
import {businessDay} from '../src/finance/cash.js';
import { postStock } from '../src/operations/inventory.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const ids:string[]=[],bids:string[]=[];
let owner:AuthContext,cashier:AuthContext,secondCashier:AuthContext,unassigned:AuthContext,foreign:AuthContext,admin:AuthContext,business:string,other:string,source:string,destination:string,foreignLocation:string,planId:string,product:string,hash:string;
async function actor(role:'OWNER'|'CASHIER'|'SUPER_ADMIN',tenant=business,location?:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Transfer tester',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(role!=='SUPER_ADMIN'){const member=await db.membership.create({data:{businessId:tenant,userId:id,role}});if(location)await db.locationAssignment.create({data:{businessId:tenant,membershipId:member.id,locationId:location}});}
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
const get=(path='',who=owner,b=business)=>request(app).get(`/api/businesses/${b}/workflows${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'='post',b=business)=>request(app)[method](`/api/businesses/${b}/workflows${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
async function stock(locationId:string,productId=product){return (await db.stockBalance.findFirst({where:{businessId:business,locationId,productId}}))?.onHand.toFixed(4)??'0.0000';}
async function funded(quantity='100'){
 const p=await db.product.create({data:{businessId:business,sku:`SKU-${randomUUID().slice(0,8).toUpperCase()}`,name:'Transfer product',unit:'PIECE',purchasePrice:'9.8765',sellingPrice:'12'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:p.id,delta:quantity,type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'test opening',actorId:owner.user.id,notes:''}));return p.id;
}
beforeAll(async()=>{
 hash=await passwordHash('Transfer integration password 914!');
 business=(await db.business.create({data:{name:'Transfer business'}})).id;other=(await db.business.create({data:{name:'Foreign transfer business'}})).id;bids.push(business,other);
 source=(await db.location.create({data:{businessId:business,code:'SOURCE',name:'Main warehouse',kind:'SHOP'}})).id;
 destination=(await db.location.create({data:{businessId:business,code:'DEST',name:'Branch shop',kind:'SHOP'}})).id;
 foreignLocation=(await db.location.create({data:{businessId:other,code:'FOREIGN',name:'Foreign location',kind:'SHOP'}})).id;
 owner=await actor('OWNER');cashier=await actor('CASHIER',business,source);secondCashier=await actor('CASHIER',business,source);unassigned=await actor('CASHIER');foreign=await actor('OWNER',other);admin=await actor('SUPER_ADMIN');
 planId=(await db.billingPlan.create({data:{code:`transfer-${randomUUID()}`,name:'Transfer test',nameAr:'اختبار',trialDays:14,maxMembers:20,maxWarehouses:10,maxShops:10}})).id;
 await db.businessSubscription.createMany({data:bids.map(businessId=>({businessId,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}))});
 product=await funded('1000');
});
afterAll(async()=>{
 await db.$transaction(async tx=>{
  for(const [table,trigger] of [['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['money_entries','money_entries_immutable'],['cash_closes','cash_closes_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  for(const [table,trigger] of [['transfer_events','transfer_events_immutable'],['transfer_event_lines','transfer_event_lines_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.transferEventLine.deleteMany({where:{businessId:{in:bids}}});await tx.transferEvent.deleteMany({where:{businessId:{in:bids}}});await tx.transferLine.deleteMany({where:{businessId:{in:bids}}});await tx.stockTransfer.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['transfer_events','transfer_events_immutable'],['transfer_event_lines','transfer_event_lines_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  await tx.migrationPreview.deleteMany({where:{businessId:{in:bids}}});await tx.moneyEntry.deleteMany({where:{businessId:{in:bids}}});await tx.cashClose.deleteMany({where:{businessId:{in:bids}}});await tx.adjustmentLine.deleteMany({where:{businessId:{in:bids}}});await tx.adjustment.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['money_entries','money_entries_immutable'],['cash_closes','cash_closes_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');
  await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');
  for(const [table,trigger] of [['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.salePayment.deleteMany({where:{businessId:{in:bids}}});await tx.saleLine.deleteMany({where:{businessId:{in:bids}}});await tx.sale.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.purchaseLine.deleteMany({where:{businessId:{in:bids}}});await db.purchaseDocument.deleteMany({where:{businessId:{in:bids}}});await db.supplier.deleteMany({where:{businessId:{in:bids}}});
 await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.productPack.deleteMany({where:{businessId:{in:bids}}});
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});
 await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
});
const api=(path:string,body:object,who=owner)=>request(app).post(`/api/businesses/${business}${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
async function sold(quantity='5',price='12'){
 const p=await funded('100');await db.product.update({where:{id:p},data:{sellingPrice:price}});const draft=await api('/sales',{clientKey:randomUUID(),locationId:source,lines:[{productId:p,quantity}]});expect(draft.status,draft.text).toBe(201);
 const done=await api(`/sales/${draft.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:draft.body.total,payment:{method:'CARD',received:draft.body.total,reference:'Terminal test'},confirm:true});expect(done.status,done.text).toBe(200);return done.body;
}
async function adjustment(kind:string,lines:any[],extra:object={},who=owner){if(kind==='COUNT')lines=await Promise.all(lines.map(async l=>({...l,...(await get(`/snapshot?locationId=${(extra as {locationId?:string}).locationId??source}&productId=${l.productId}`,who)).body})));const r=await write('/adjustments',{clientKey:randomUUID(),kind,locationId:source,reason:'Counted and verified with manager',lines,...extra},who);expect(r.status,r.text).toBe(201);return r.body;}
const approve=(doc:any,who=owner)=>write(`/adjustments/${doc.id}/status`,{revision:doc.revision,action:'confirm',confirm:true},who);
async function receipt(){const p=await funded('100'),supplier=await db.supplier.create({data:{businessId:business,code:`S-${randomUUID().slice(0,8).toUpperCase()}`,name:'Test supplier'}});const d=await api('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:source,supplierId:supplier.id,documentDate:'2026-11-11',lines:[{productId:p,quantity:'10',unitCost:'10'}]});expect(d.status,d.text).toBe(201);const pending=await api(`/operations/purchases/${d.body.id}/status`,{revision:0,action:'submit',confirm:true});expect(pending.status,pending.text).toBe(200);const done=await api(`/operations/purchases/${d.body.id}/status`,{revision:pending.body.revision,action:'confirm',confirm:true});expect(done.status,done.text).toBe(200);return done.body;}
const pay=(kind:string,amount:string,extra:object={})=>write('/payments',{clientKey:randomUUID(),kind,locationId:source,amount,method:'CARD',reference:'Terminal record',reason:'Verified payment record',confirm:true,...extra});
const types=['SALES','GROSS_PROFIT','NET_PROFIT','EXPENSES','RETURNS','CASH'];
const settingsPath='/report-delivery/settings';
const put=(body:object,who=owner,b=business)=>request(app).put(`/api/businesses/${b}/workflows${settingsPath}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
const today=businessDay(new Date(),'UTC');
let revision=0,automaticId='',manualId='';
async function preferences(enabled:boolean,reportTypes=types){const result=await put({revision,enabled,reportTypes,language:'en'});expect(result.status,result.text).toBe(200);revision=result.body.revision;}
async function send(who=owner,extra:object={}){return write('/report-delivery/send',{clientKey:randomUUID(),from:today,to:today,locationId:source,...extra},who);}
async function prioritize(id:string){await db.authMail.updateMany({where:{reportId:id},data:{createdAt:new Date(0),availableAt:new Date(0)}});}

it('defaults off and protects settings, destinations and personal history',async()=>{
 const result=await get(settingsPath);expect(result.status).toBe(200);expect(result.body).toMatchObject({enabled:false,revision:0,allowedTypes:types,email:owner.user.email});
 for(const who of [cashier,admin,foreign])expect((await get(settingsPath,who)).status).toBe(403);
 expect((await put({revision:0,enabled:true,reportTypes:types,language:'en',email:'other@example.test'})).status).toBe(422);
 expect((await request(app).put(`/api/businesses/${business}/workflows${settingsPath}`).set('Cookie',cookie(owner)).send({})).status).toBe(403);
 expect((await send()).body.error.code).toBe('REPORT_SETTINGS_REQUIRED');
 await preferences(true);
 expect((await put({revision:0,enabled:false,reportTypes:types,language:'en'})).body.error.code).toBe('REVISION_CONFLICT');
});
it('queues one report for repeated closing and does not wait for report generation or SMTP',async()=>{
 const input={locationId:source,day:'2026-01-01',opening:'0',counted:'0',expected:'0',reason:'',confirm:true};
 const responses=await Promise.all([write('/cash',input),write('/cash',input)]);for(const response of responses)expect(response.status,response.text).toBe(200);
 const rows=await db.reportDelivery.findMany({where:{businessId:business}});expect(rows).toHaveLength(1);automaticId=rows[0]!.id;expect(rows[0]).toMatchObject({automatic:true,snapshot:'',locationId:source,fromDay:'2026-01-01'});expect(await db.authMail.count({where:{reportId:automaticId}})).toBe(0);
 await preferences(false);expect((await db.reportDelivery.findUniqueOrThrow({where:{id:automaticId}})).cancelledAt).not.toBeNull();
});
it('manual reporting works with automatic reports off and reconciles sales, tax-free gross/net profit and cash',async()=>{
 const p=await funded('10');await db.product.update({where:{id:p},data:{purchasePrice:'4',sellingPrice:'10'}});
 const draft=await api('/sales',{clientKey:randomUUID(),locationId:source,lines:[{productId:p,quantity:'2'}]});expect(draft.status,draft.text).toBe(201);
 const sale=await api(`/sales/${draft.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:'20.0000',confirm:true,payment:{method:'CASH',received:'20',reference:''}});expect(sale.status,sale.text).toBe(200);
 const ret=await adjustment('CUSTOMER_RETURN',[{productId:p,sourceLineId:sale.body.lines[0].id,quantity:'1',condition:'RESTOCK'}],{sourceId:sale.body.id});expect((await approve(ret)).status).toBe(200);
 expect((await pay('CUSTOMER_REFUND','10',{sourceId:ret.id,method:'CASH'})).status).toBe(201);expect((await pay('EXPENSE','2',{method:'CASH'})).status).toBe(201);
 expect((await write('/cash',{locationId:source,day:today,opening:'100',expected:'108',counted:'108',confirm:true})).status).toBe(200);
 const input={clientKey:randomUUID(),from:today,to:today,locationId:source};const responses=await Promise.all([write('/report-delivery/send',input),write('/report-delivery/send',input)]);expect(responses.map(r=>r.status)).toEqual([202,202]);expect(responses[0]!.body.id).toBe(responses[1]!.body.id);manualId=responses[0]!.body.id;expect((await write('/report-delivery/send',{...input,locationId:destination})).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 expect((await prepareReportBatch(db,settings)).prepared).toBe(1);
 const view=await get(`/report-delivery/${manualId}`);expect(view.status,view.text).toBe(200);
 const metrics=Object.fromEntries(view.body.sections.flatMap((s:any)=>s.metrics.map((m:any)=>[m.key,m.value])));expect(metrics).toMatchObject({sales:'$20.00',customerReturns:'$10.00',grossProfit:'$6.00',estimatedProfit:'$4.00',supplierReturnAdjustment:'$0.00',expected:'$108.00',counted:'$108.00',variance:'$0.00'});
 expect((await db.reportDelivery.findUniqueOrThrow({where:{id:manualId}})).snapshot).not.toContain('$108.00');
 expect((await get(`/report-delivery/${manualId}`,foreign,other)).status).toBe(404);
 const anotherOwner=await actor('OWNER');expect((await get(`/report-delivery/${manualId}`,anotherOwner)).status).toBe(404);
 expect((await get('/report-delivery',anotherOwner)).body.items).toEqual([]);
});
it('uses the same selected metrics in app and email, retries SMTP failure without recreating the report',async()=>{
 await prioritize(manualId);const first=await deliverMailBatch(db,settings,async()=>{throw new Error('Simulated SMTP outage');},1);expect(first.failed).toBe(1);
 expect((await get('/report-delivery')).body.items.find((r:any)=>r.id===manualId)).toMatchObject({ready:true,status:'EMAIL_QUEUED'});
 const payloads:any[]=[];await prioritize(manualId);expect((await deliverMailBatch(db,settings,async payload=>{payloads.push(payload);},1)).delivered).toBe(1);
 expect(payloads[0].to).toBe(owner.user.email);for(const value of ['$6.00','$4.00','$108.00'])expect(payloads[0].text).toContain(value);
 expect((await get('/report-delivery')).body.items.find((r:any)=>r.id===manualId).status).toBe('SENT');expect(await db.authMail.count({where:{reportId:manualId}})).toBe(1);
});
it('rechecks location, role, subscription and recipient eligibility on manual requests and dispatch',async()=>{
 expect((await send(owner,{locationId:foreignLocation})).status).toBe(403);
 const user=await actor('OWNER');const changed=await put({revision:0,enabled:false,reportTypes:['SALES'],language:'en'},user);expect(changed.status).toBe(200);
 const queued=await send(user);expect(queued.status).toBe(202);await prepareReportBatch(db,settings);await prioritize(queued.body.id);
 await db.membership.updateMany({where:{businessId:business,userId:user.user.id},data:{disabledAt:new Date()}});
 let sent=false;await deliverMailBatch(db,settings,async()=>{sent=true;},1);expect(sent).toBe(false);expect((await db.reportDelivery.findUniqueOrThrow({where:{id:queued.body.id}})).cancelledAt).not.toBeNull();
 const subscription=await db.businessSubscription.findUniqueOrThrow({where:{businessId:business}});await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(0),trialEndsAt:new Date(1)}});
 expect((await send()).body.error.code).toBe('SUBSCRIPTION_REQUIRED');await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:subscription.trialStartedAt,trialEndsAt:subscription.trialEndsAt}});
});
it('honors selected reports and locale, and excludes activity posted after the request cutoff',async()=>{
 const response=await put({revision,enabled:false,reportTypes:['SALES','NET_PROFIT'],language:'ar'});expect(response.status).toBe(200);revision=response.body.revision;
 const queued=await send();expect(queued.status,queued.text).toBe(202);
 await new Promise(resolve=>setTimeout(resolve,5));await pay('EXPENSE','1',{method:'CARD'});
 await prepareReportBatch(db,settings);const report=await get(`/report-delivery/${queued.body.id}`);expect(report.body.language).toBe('ar');expect(report.body.sections.map((s:any)=>s.type)).toEqual(['SALES','NET_PROFIT']);expect(report.body.sections[1].metrics.find((m:any)=>m.key==='estimatedProfit').value).toBe(new Intl.NumberFormat('ar',{style:'currency',currency:'USD'}).format(4));expect(report.body.sections[1].metrics.find((m:any)=>m.key==='supplierReturnAdjustment')).toMatchObject({label:'فرق تقييم مرتجعات الموردين',value:new Intl.NumberFormat('ar',{style:'currency',currency:'USD'}).format(0)});expect(JSON.stringify(report.body)).not.toContain('grossProfit');
});

it('prepares automatic location-specific reports and cancels queued email when switched off',async()=>{
 await preferences(true,['SALES']);
 const close=await write('/cash',{locationId:destination,day:'2026-01-02',opening:'0',expected:'0',counted:'0',confirm:true});expect(close.status,close.text).toBe(200);
 const row=await db.reportDelivery.findFirstOrThrow({where:{businessId:business,closeId:close.body.id,userId:owner.user.id}});
 expect((await prepareReportBatch(db,settings)).prepared).toBe(1);const report=await get(`/report-delivery/${row.id}`);expect(report.status).toBe(200);expect(report.body.location).toBe('Branch shop');expect(report.body.sections.map((s:any)=>s.type)).toEqual(['SALES']);
 await preferences(false,['SALES']);await prioritize(row.id);let sent=false;await deliverMailBatch(db,settings,async()=>{sent=true;},1);expect(sent).toBe(false);expect((await get('/report-delivery')).body.items.find((r:any)=>r.id===row.id)).toMatchObject({ready:true,status:'CANCELLED'});
});

it('rejects profit delivery when a delegated administrator lacks cost access',async()=>{
 const delegated=await actor('OWNER');await db.membership.updateMany({where:{businessId:business,userId:delegated.user.id},data:{role:'OPERATIONS_MANAGER',permissionOverrides:{'catalogue.cost':false}}});
 const options=await get(settingsPath,delegated);expect(options.status).toBe(200);expect(options.body.allowedTypes).not.toContain('NET_PROFIT');
 expect((await put({revision:0,enabled:true,reportTypes:['NET_PROFIT'],language:'en'},delegated)).status).toBe(403);
 expect((await put({revision:0,enabled:true,reportTypes:['SALES'],language:'en'},delegated)).status).toBe(200);
});

it('handles simultaneous preference creation as a revision conflict rather than an internal error',async()=>{
 const user=await actor('OWNER');const input={revision:0,enabled:true,reportTypes:['SALES'],language:'en'};
 const results=await Promise.all([put(input,user),put(input,user)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 expect(await db.reportPreference.count({where:{businessId:business,userId:user.user.id}})).toBe(1);
});
it('allows only one worker to prepare a report and enqueue its email',async()=>{
 const queued=await send();expect(queued.status).toBe(202);
 const results=await Promise.all([prepareReportBatch(db,settings),prepareReportBatch(db,settings)]);expect(results.reduce((sum,result)=>sum+result.prepared,0)).toBe(1);
 expect(await db.authMail.count({where:{reportId:queued.body.id}})).toBe(1);expect((await get(`/report-delivery/${queued.body.id}`)).status).toBe(200);
});

it('revokes profit-report access before preparation and after snapshot creation when cost permission is removed',async()=>{
 const user=await actor('OWNER'),member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:user.user.id}}});
 expect((await put({revision:0,enabled:false,reportTypes:['NET_PROFIT'],language:'en'},user)).status).toBe(200);
 const first=await send(user);expect(first.status,first.text).toBe(202);
 await db.membership.update({where:{id:member.id},data:{role:'OPERATIONS_MANAGER',permissionOverrides:{'catalogue.cost':false}}});
 await prepareReportBatch(db,settings);expect((await db.reportDelivery.findUniqueOrThrow({where:{id:first.body.id}})).cancelledAt).not.toBeNull();expect(await db.authMail.count({where:{reportId:first.body.id}})).toBe(0);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{}}});
 const second=await send(user);expect(second.status,second.text).toBe(202);await prepareReportBatch(db,settings);expect((await get(`/report-delivery/${second.body.id}`,user)).status).toBe(200);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'catalogue.cost':false}}});
 expect((await get(`/report-delivery/${second.body.id}`,user)).status).toBe(404);const list=await get('/report-delivery',user);expect(list.status).toBe(200);expect(list.body.items).toEqual([]);
 await prioritize(second.body.id);let sent=false;await deliverMailBatch(db,settings,async()=>{sent=true;},1);expect(sent).toBe(false);expect((await db.reportDelivery.findUniqueOrThrow({where:{id:second.body.id}})).cancelledAt).not.toBeNull();
});

it('sends separate copies to active partner recipients and skips removed recipients at dispatch',async()=>{
 const actorOwner=await actor('OWNER');
 const createPartner=(businessId:string)=>db.partner.create({
  data:{businessId,name:'Report partner',ownership:10,capital:0,currency:'USD',notes:''},
 });
 const [partner,foreignPartner]=await Promise.all([createPartner(business),createPartner(other)]);
 const input={revision:0,enabled:false,reportTypes:['SALES'],language:'en'};
 const recipients=[{partnerId:partner.id,email:'partner@example.test'}];
 expect((await put({...input,partnerRecipients:[{...recipients[0],partnerId:foreignPartner.id}]},actorOwner)).status).toBe(422);
 expect((await put({...input,partnerRecipients:recipients},actorOwner)).status).toBe(200);
 expect((await get(settingsPath,actorOwner)).body).toMatchObject({partners:[{id:partner.id,name:partner.name}],partnerRecipients:recipients});
 const queued=await send(actorOwner);
 expect(queued.status).toBe(202);
 await prepareReportBatch(db,settings);
 await prioritize(queued.body.id);
 const addresses:string[]=[];
 await deliverMailBatch(db,settings,async mail=>{addresses.push(mail.to);},2);
 expect(addresses.sort()).toEqual([actorOwner.user.email,recipients[0]!.email].sort());

 const second=await send(actorOwner);
 expect(second.status).toBe(202);
 await prepareReportBatch(db,settings);
 await db.authMail.updateMany({where:{reportId:second.body.id},data:{createdAt:new Date(0),availableAt:new Date(0)}});
 expect((await put({...input,revision:1,partnerRecipients:[]},actorOwner)).status).toBe(200);
 const remaining:string[]=[];
 await deliverMailBatch(db,settings,async mail=>{remaining.push(mail.to);},2);
 expect(remaining).toEqual([actorOwner.user.email]);
 expect((await db.reportDelivery.findUniqueOrThrow({where:{id:second.body.id}})).cancelledAt).toBeNull();

 expect((await put({...input,revision:2,enabled:true,partnerRecipients:recipients},actorOwner)).status).toBe(200);
 const close=await write('/cash',{locationId:destination,day:'2025-12-31',opening:'0',counted:'0',expected:'0',confirm:true},actorOwner);
 expect(close.status,close.text).toBe(200);
 const automatic=await db.reportDelivery.findFirstOrThrow({where:{businessId:business,userId:actorOwner.user.id,automatic:true}});
 await prepareReportBatch(db,settings);
 await prioritize(automatic.id);
 const automaticAddresses:string[]=[];
 await deliverMailBatch(db,settings,async mail=>{automaticAddresses.push(mail.to);},2);
 expect(automaticAddresses.sort()).toEqual([actorOwner.user.email,recipients[0]!.email].sort());
});

it('allows owners to send closing reports to two extra addresses without a partner record',async()=>{
 const reportOwner=await actor('OWNER');
 const extraEmails=['first-copy@example.test','second-copy@example.test'];
 const input={revision:0,enabled:false,reportTypes:['SALES'],language:'en'};
 const delegated=await actor('OWNER');
 await db.membership.updateMany({where:{businessId:business,userId:delegated.user.id},data:{role:'OPERATIONS_MANAGER'}});
 expect((await put({...input,extraEmails},delegated)).status).toBe(403);
 expect((await put({...input,extraEmails:[...extraEmails,'third@example.test']},reportOwner)).status).toBe(422);
 expect((await put({...input,extraEmails},reportOwner)).status).toBe(200);
 expect((await get(settingsPath,reportOwner)).body).toMatchObject({canAddRecipients:true,extraEmails});
 const queued=await send(reportOwner);
 expect(queued.status).toBe(202);
 await prepareReportBatch(db,settings);
 await prioritize(queued.body.id);
 const addresses:string[]=[];
 await deliverMailBatch(db,settings,async mail=>{addresses.push(mail.to);},3);
 expect(addresses.sort()).toEqual([reportOwner.user.email,...extraEmails].sort());
});

it('normalizes extra addresses, queues automatic copies for one location, and rechecks recipients on retry',async()=>{
 const reportOwner=await actor('OWNER');
 const input={revision:0,enabled:true,reportTypes:['SALES','CASH'],language:'en'};
 const normalized='normalized-copy@example.test';
 expect((await put({...input,extraEmails:['invalid-address']},reportOwner)).status).toBe(422);
 expect((await put({...input,extraEmails:[' Normalized-Copy@Example.Test ',normalized]},reportOwner)).status).toBe(200);
 expect((await get(settingsPath,reportOwner)).body.extraEmails).toEqual([normalized]);

 const day='2025-12-30';
 const close=await write('/cash',{locationId:destination,day,opening:'0',counted:'0',expected:'0',confirm:true},reportOwner);
 expect(close.status,close.text).toBe(200);
 const row=await db.reportDelivery.findFirstOrThrow({where:{businessId:business,userId:reportOwner.user.id,automatic:true}});
 expect(row).toMatchObject({locationId:destination,fromDay:day,toDay:day,extraEmails:[normalized]});
 await prepareReportBatch(db,settings);
 const mail=await db.authMail.findFirstOrThrow({where:{reportId:row.id,reportAdditional:true}});
 await db.authMail.update({where:{id:mail.id},data:{createdAt:new Date(0),availableAt:new Date(0)}});
 const failed=await deliverMailBatch(db,settings,async payload=>{
  expect(payload.to).toBe(normalized);
  throw new Error('Simulated temporary mail failure');
 },1);
 expect(failed.failed).toBe(1);

 expect((await put({...input,revision:1,extraEmails:[]},reportOwner)).status).toBe(200);
 await prioritize(row.id);
 const sent:string[]=[];
 await deliverMailBatch(db,settings,async payload=>{sent.push(payload.to);},2);
 expect(sent).toEqual([reportOwner.user.email]);
 expect((await db.reportDelivery.findUniqueOrThrow({where:{id:row.id}})).cancelledAt).toBeNull();
});

it('deduplicates owner, partner and extra addresses and excludes replacements from an already queued report',async()=>{
 const reportOwner=await actor('OWNER');
 const shared='shared-recipient@example.test';
 const partner=await db.partner.create({data:{businessId:business,name:'Shared recipient',ownership:10,capital:0,currency:'USD',notes:''}});
 const input={revision:0,enabled:false,reportTypes:['SALES'],language:'ar',
  extraEmails:[reportOwner.user.email,shared],partnerRecipients:[{partnerId:partner.id,email:shared}]};
 expect((await put(input,reportOwner)).status).toBe(200);
 const first=await send(reportOwner);
 expect(first.status).toBe(202);
 await prepareReportBatch(db,settings);
 await prioritize(first.body.id);
 const copies:{to:string;text:string}[]=[];
 await deliverMailBatch(db,settings,async mail=>{copies.push(mail);},2);
 expect(copies.map(mail=>mail.to).sort()).toEqual([reportOwner.user.email,shared].sort());
 expect(copies[0]?.text).toBe(copies[1]?.text);
 expect(copies[0]?.text).toContain('Main warehouse');

 const second=await send(reportOwner);
 expect(second.status).toBe(202);
 expect((await put({...input,revision:1,extraEmails:['replacement@example.test'],partnerRecipients:[]},reportOwner)).status).toBe(200);
 await prepareReportBatch(db,settings);
 const queued=await db.authMail.findMany({where:{reportId:second.body.id},select:{reportAdditional:true,reportPartnerId:true}});
 expect(queued).toEqual([{reportAdditional:false,reportPartnerId:null}]);
});

it('retries only the failed extra copy after the owner copy has sent',async()=>{
 const reportOwner=await actor('OWNER');
 const extra='retry-copy@example.test';
 expect((await put({revision:0,enabled:false,reportTypes:['SALES'],language:'en',extraEmails:[extra]},reportOwner)).status).toBe(200);
 const result=await send(reportOwner);
 expect(result.status).toBe(202);
 const reportId=result.body.id;
 await prepareReportBatch(db,settings);
 await prioritize(reportId);
 const sent:string[]=[];
 const first=await deliverMailBatch(db,settings,async mail=>{
  if(mail.to===extra)throw new Error('Simulated SMTP rejection');
  sent.push(mail.to);
 },2);
 expect(first).toMatchObject({delivered:1,failed:1});
 expect(sent).toEqual([reportOwner.user.email]);
 const pending=await db.authMail.findFirstOrThrow({where:{reportId,reportAdditional:true}});
 expect(pending).toMatchObject({deliveredAt:null,attempts:1});
 await prioritize(reportId);
 const retry=await deliverMailBatch(db,settings,async mail=>{sent.push(mail.to);},1);
 expect(retry).toMatchObject({delivered:1,failed:0});
 expect(sent).toEqual([reportOwner.user.email,extra]);
});

it('skips a deactivated partner after preparation while still sending the owner and extra copies',async()=>{
 const reportOwner=await actor('OWNER');
 const extra='active-extra@example.test';
 const partner=await db.partner.create({data:{businessId:business,name:'Partner before deactivation',ownership:10,capital:0,currency:'USD',notes:''}});
 const input={revision:0,enabled:false,reportTypes:['SALES'],language:'en',extraEmails:[extra],
  partnerRecipients:[{partnerId:partner.id,email:'inactive-partner@example.test'}]};
 expect((await put(input,reportOwner)).status).toBe(200);
 const result=await send(reportOwner);
 expect(result.status).toBe(202);
 const reportId=result.body.id;
 await prepareReportBatch(db,settings);
 expect(await db.authMail.count({where:{reportId}})).toBe(3);
 await db.partner.update({where:{id:partner.id},data:{active:false}});
 await prioritize(reportId);
 const sent:string[]=[];
 await deliverMailBatch(db,settings,async mail=>{sent.push(mail.to);},3);
 expect(sent.sort()).toEqual([reportOwner.user.email,extra].sort());
 expect((await get(settingsPath,reportOwner)).body.partnerRecipients).toEqual([]);
});

it('stops external copies after an ownership change even if the sender retains access to sales reports',async()=>{
 const reportOwner=await actor('OWNER');
 const extra='former-owner-copy@example.test';
 expect((await put({revision:0,enabled:false,reportTypes:['SALES'],language:'en',extraEmails:[extra]},reportOwner)).status).toBe(200);
 const result=await send(reportOwner);
 expect(result.status).toBe(202);
 const reportId=result.body.id;
 await prepareReportBatch(db,settings);
 await db.membership.updateMany({where:{businessId:business,userId:reportOwner.user.id},data:{role:'OPERATIONS_MANAGER'}});
 expect((await get(settingsPath,reportOwner)).body).toMatchObject({canAddRecipients:false,extraEmails:[]});
 await prioritize(reportId);
 const sent:string[]=[];
 await deliverMailBatch(db,settings,async mail=>{sent.push(mail.to);},2);
 expect(sent).toEqual([reportOwner.user.email]);
});

it('continues delivering to the second extra address when the first copy fails',async()=>{
 const reportOwner=await actor('OWNER');
 const extraEmails=['simulated-rejection@example.test','working-copy@example.test'];
 expect((await put({revision:0,enabled:false,reportTypes:['SALES'],language:'en',extraEmails},reportOwner)).status).toBe(200);
 const result=await send(reportOwner);
 expect(result.status).toBe(202);
 const reportId=result.body.id;
 await prepareReportBatch(db,settings);
 await prioritize(reportId);
 const sent:string[]=[];
 const outcome=await deliverMailBatch(db,settings,async mail=>{
  if(mail.to===extraEmails[0])throw new Error('Simulated address-specific failure');
  sent.push(mail.to);
 },3);
 expect(outcome).toMatchObject({delivered:2,failed:1});
 expect(sent.sort()).toEqual([reportOwner.user.email,extraEmails[1]].sort());
});
