import {businessDay} from '../src/finance/cash.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService, type AuthContext } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { csrfFor, encrypt, passwordHash } from '../src/auth/crypto.js';
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
const reverse=(id:string,extra:object={},who=owner,b=business)=>write(`/payments/${id}/reverse`,{clientKey:randomUUID(),reason:'Duplicate entry corrected after review',confirm:true,...extra},who,'post',b);
const day=()=>businessDay(new Date(),'UTC');
it('reverses an expense once, preserves original, audit and report arithmetic',async()=>{
 const path=`/reports?from=${day()}&to=${day()}&view=summary`,before=(await get(path)).body;
 const p=await pay('EXPENSE','12.34');expect(p.status,p.text).toBe(201);const original=await db.moneyEntry.findUniqueOrThrow({where:{id:p.body.id}});
 const after=(await get(path)).body;expect(Number(after.expenses)-Number(before.expenses)).toBeCloseTo(12.34);
 const input={clientKey:randomUUID()};const results=await Promise.all([reverse(p.body.id,input),reverse(p.body.id,input)]);expect(results.map(r=>r.status)).toEqual([201,201]);expect(results[0]!.body.id).toBe(results[1]!.body.id);
 const correction=await db.moneyEntry.findUniqueOrThrow({where:{id:results[0]!.body.id}});expect(correction.amount.toFixed(2)).toBe('-12.34');expect(correction.reversalOfId).toBe(original.id);expect(correction.actorId).toBe(owner.user.id);
 expect(await db.moneyEntry.findUnique({where:{id:original.id}})).toEqual(original);expect(await db.authAudit.count({where:{businessId:business,action:'payment.reversed',targetId:original.id}})).toBe(1);
 expect((await get(path)).body.expenses).toBe(before.expenses);expect((await get(path)).body.estimatedProfit).toBe(before.estimatedProfit);
 expect((await reverse(original.id)).body.error.code).toBe('PAYMENT_ALREADY_REVERSED');expect((await reverse(correction.id)).body.error.code).toBe('REVERSAL_NOT_ALLOWED');expect((await reverse(original.id,{...input,reason:'A changed retry reason'})).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 const rows=(await get('/payments')).body.items;expect(rows.find((r:any)=>r.id===original.id).reversedBy.id).toBe(correction.id);expect(rows.find((r:any)=>r.id===correction.id).reversalOf.id).toBe(original.id);
 const csv=await get(`/reports?from=${day()}&to=${day()}&view=payments&export=true`);expect(csv.body.csv).toContain(original.id);expect(csv.body.csv).toContain('-12.34');
 await expect(db.moneyEntry.update({where:{id:correction.id},data:{reason:'Rewrite history'}})).rejects.toThrow();
});
it('rejects tampering, missing confirmation, cross-tenant, platform and unauthorized staff',async()=>{
 const p=await pay('EXPENSE','3');const id=p.body.id;
 expect((await reverse(id,{amount:'1'})).status).toBe(422);expect((await reverse(id,{reason:'x'})).status).toBe(422);expect((await reverse(id,{confirm:false})).status).toBe(422);
 expect((await request(app).post(`/api/businesses/${business}/workflows/payments/${id}/reverse`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send({clientKey:randomUUID(),reason:'Wrong payment',confirm:true})).status).toBe(403);
 expect((await reverse(id,{},foreign,other)).status).toBe(404);expect((await reverse(id,{},foreign)).status).toBe(403);expect((await reverse(id,{},admin)).status).toBe(403);expect((await reverse(id,{},cashier)).status).toBe(403);
 await db.membership.update({where:{businessId_userId:{businessId:business,userId:cashier.user.id}},data:{permissionOverrides:{'payments.view':true,'payments.manage':true,'payments.reverse':true}}});
 expect((await reverse(id,{},cashier)).status).toBe(201);
 const another=await pay('EXPENSE','2',{locationId:destination});expect((await reverse(another.body.id,{},cashier)).status).toBe(404);
 await db.membership.update({where:{businessId_userId:{businessId:business,userId:cashier.user.id}},data:{permissionOverrides:{}}});
});
it('different simultaneous requests create only one correction',async()=>{
 const p=await pay('EXPENSE','4');const results=await Promise.all([reverse(p.body.id),reverse(p.body.id)]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect(await db.moneyEntry.count({where:{reversalOfId:p.body.id}})).toBe(1);
});
it('restores supplier payment and refund balances and permits a corrected replacement',async()=>{
 const r=await receipt(),p=await pay('SUPPLIER_PAYMENT','60',{sourceId:r.id});expect((await reverse(p.body.id)).status).toBe(201);expect((await get(`/balances/${r.id}?kind=SUPPLIER`)).body.outstanding).toBe('100.0000');
 expect((await pay('SUPPLIER_PAYMENT','100',{sourceId:r.id})).status).toBe(201);
 const l=r.lines[0],ret=await adjustment('SUPPLIER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'5'}],{sourceId:r.id});expect((await approve(ret)).status).toBe(200);
 const refund=await pay('SUPPLIER_REFUND','50',{sourceId:r.id});expect(refund.status).toBe(201);expect((await reverse(refund.body.id)).status).toBe(201);expect((await get(`/balances/${r.id}?kind=SUPPLIER`)).body.refundDue).toBe('50.0000');expect((await pay('SUPPLIER_REFUND','50',{sourceId:r.id})).status).toBe(201);expect((await pay('SUPPLIER_REFUND','1',{sourceId:r.id})).status).toBe(409);
});
it('restores customer refund due without changing stock',async()=>{
 const sale=await sold(),l=sale.lines[0],ret=await adjustment('CUSTOMER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'1'}],{sourceId:sale.id});await approve(ret);const before=await stock(source,l.productId),p=await pay('CUSTOMER_REFUND','12',{sourceId:ret.id});expect(p.status).toBe(201);expect((await reverse(p.body.id)).status).toBe(201);expect((await get(`/balances/${ret.id}?kind=CUSTOMER`)).body.outstanding).toBe('12.0000');expect(await stock(source,l.productId)).toBe(before);expect((await pay('CUSTOMER_REFUND','12',{sourceId:ret.id})).status).toBe(201);expect((await pay('CUSTOMER_REFUND','1',{sourceId:ret.id})).status).toBe(409);
});
it('cash corrections flow in the opposite direction and cannot post after today closes',async()=>{
 const location=await db.location.create({data:{businessId:business,code:'REVERSE-CASH',name:'Reversal drawer',kind:'SHOP'}});
 const outgoing=await pay('EXPENSE','10',{method:'CASH',locationId:location.id});expect((await reverse(outgoing.body.id)).status).toBe(201);
 const incoming=await pay('CASH_IN','20',{method:'CASH',locationId:location.id});expect((await reverse(incoming.body.id)).status).toBe(201);
 const totals=(await get(`/cash?locationId=${location.id}&day=${day()}`)).body;expect(totals.inflow).toBe('30.0000');expect(totals.outflow).toBe('30.0000');
 const pending=await pay('EXPENSE','5',{method:'CASH',locationId:location.id});expect((await write('/cash',{locationId:location.id,day:day(),opening:'100',counted:'95',expected:'95',reason:'Reviewed drawer',confirm:true})).status).toBe(200);
 expect((await reverse(pending.body.id)).body.error.code).toBe('CASH_DAY_CLOSED');expect(await db.moneyEntry.count({where:{reversalOfId:pending.body.id}})).toBe(0);
 const card=await pay('EXPENSE','1',{method:'CARD',locationId:location.id});expect((await reverse(card.body.id)).status).toBe(201);
});
it('corrections for older entries post today without rewriting a previous closing',async()=>{
 const old=new Date(Date.now()-86400000),oldDay=businessDay(old,'UTC'),location=await db.location.create({data:{businessId:business,code:'OLD-CASH',name:'Older drawer',kind:'SHOP'}});
 const original=await db.moneyEntry.create({data:{businessId:business,locationId:location.id,kind:'EXPENSE',method:'CASH',amount:'7',currency:'USD',reference:'',reason:'Incorrect old expense',actorId:owner.user.id,actorName:owner.user.name,clientKey:randomUUID(),requestHash:'old fixture',createdAt:old}});
 const closing=await db.cashClose.create({data:{businessId:business,locationId:location.id,day:oldDay,opening:'100',inflow:'0',outflow:'7',expected:'93',counted:'93',variance:'0',reason:'Old closing',currency:'USD',actorId:owner.user.id,actorName:owner.user.name}});
 expect((await reverse(original.id)).status).toBe(201);expect(await db.cashClose.findUnique({where:{id:closing.id}})).toEqual(closing);expect((await get(`/cash?locationId=${location.id}&day=${oldDay}`)).body.outflow).toBe('7.0000');expect((await get(`/cash?locationId=${location.id}&day=${day()}`)).body.inflow).toBe('7.0000');
});
it('expired subscription blocks new corrections and database enforces linked equal-and-opposite entries',async()=>{
 const p=await pay('EXPENSE','9');await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(0),trialEndsAt:new Date(1)}});expect((await reverse(p.body.id)).status).toBe(402);await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()+86400000)}});
 const original=await db.moneyEntry.findUniqueOrThrow({where:{id:p.body.id}}),{id,...data}=original;
 await expect(db.moneyEntry.create({data:{...data,clientKey:randomUUID(),reversalOfId:id,amount:'-8'}})).rejects.toThrow();
 await expect(db.moneyEntry.create({data:{...data,businessId:other,locationId:foreignLocation,clientKey:randomUUID(),reversalOfId:id,amount:'-9'}})).rejects.toThrow();
 expect((await reverse(id)).status).toBe(201);
});
it('serializes cash reversal against closing without changing a closed snapshot',async()=>{
 const location=await db.location.create({data:{businessId:business,code:'RACE-CASH',name:'Race drawer',kind:'SHOP'}}),p=await pay('EXPENSE','10',{method:'CASH',locationId:location.id});
 const [correction,closing]=await Promise.all([reverse(p.body.id),write('/cash',{locationId:location.id,day:day(),opening:'100',counted:'90',expected:'90',reason:'Reviewed before correction',confirm:true})]);
 if(correction.status===201){expect(closing.status).toBe(409);expect(closing.body.error.code).toBe('CASH_TOTAL_CHANGED');expect((await get(`/cash?locationId=${location.id}&day=${day()}`)).body.closed).toBeNull();}
 else{expect(closing.status,closing.text).toBe(200);expect(correction.body.error.code).toBe('CASH_DAY_CLOSED');expect(await db.moneyEntry.count({where:{reversalOfId:p.body.id}})).toBe(0);}
});
