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
async function adjustment(kind:string,lines:any[],extra:object={},who=owner){if(kind==='COUNT')lines=await Promise.all(lines.map(async l=>({...l,...(await get(`/snapshot?locationId=${source}&productId=${l.productId}`,who)).body})));const r=await write('/adjustments',{clientKey:randomUUID(),kind,locationId:source,reason:'Counted and verified with manager',lines,...extra},who);expect(r.status,r.text).toBe(201);return r.body;}
const approve=(doc:any,who=owner)=>write(`/adjustments/${doc.id}/status`,{revision:doc.revision,action:'confirm',confirm:true},who);
async function receipt(){const p=await funded('100'),supplier=await db.supplier.create({data:{businessId:business,code:`S-${randomUUID().slice(0,8).toUpperCase()}`,name:'Test supplier'}});const d=await api('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:source,supplierId:supplier.id,documentDate:'2026-11-11',lines:[{productId:p,quantity:'10',unitCost:'10'}]});expect(d.status,d.text).toBe(201);const pending=await api(`/operations/purchases/${d.body.id}/status`,{revision:0,action:'submit',confirm:true});expect(pending.status,pending.text).toBe(200);const done=await api(`/operations/purchases/${d.body.id}/status`,{revision:pending.body.revision,action:'confirm',confirm:true});expect(done.status,done.text).toBe(200);return done.body;}
const pay=(kind:string,amount:string,extra:object={})=>write('/payments',{clientKey:randomUUID(),kind,locationId:source,amount,method:'CARD',reference:'Terminal record',reason:'Verified payment record',confirm:true,...extra});
it('scopes returns/counts/payments/reports and migration to tenant and assigned location',async()=>{
 for(const path of ['/adjustments?kind=COUNT','/payments','/reports?from=2026-01-01&to=2026-12-31','/migration'])expect((await get(path,admin)).status).toBe(403);
 expect((await get('/migration',cashier)).status).toBe(403);expect((await get('/payments',cashier)).status).toBe(403);
 const d=await sold(),a=await adjustment('CUSTOMER_RETURN',[{productId:d.lines[0].productId,sourceLineId:d.lines[0].id,quantity:'1'}],{sourceId:d.id},cashier);
 expect((await approve(a,cashier)).status).toBe(403);expect((await get(`/adjustments/${a.id}`,unassigned)).status).toBe(404);expect((await get(`/adjustments/${a.id}`,foreign,other)).status).toBe(404);
 expect((await get(`/adjustments/source/${d.id}?kind=CUSTOMER_RETURN`,cashier)).text).not.toContain('unitCost');
 expect((await request(app).post(`/api/businesses/${business}/workflows/payments`).set('Cookie',cookie(owner)).send({})).status).toBe(403);
});
it('returns sellable stock once, keeps damaged returns out of stock and caps cumulative returns',async()=>{
 const s=await sold('5'),line=s.lines[0],a=await adjustment('CUSTOMER_RETURN',[{productId:line.productId,sourceLineId:line.id,quantity:'2'}],{sourceId:s.id});const rows=await Promise.all([approve(a),approve(a)]);expect(rows.map(r=>r.status)).toEqual([200,200]);expect(await stock(source,line.productId)).toBe('97.0000');
 const b=await adjustment('CUSTOMER_RETURN',[{productId:line.productId,sourceLineId:line.id,quantity:'3',condition:'DAMAGED'}],{sourceId:s.id});expect((await approve(b)).status).toBe(200);expect(await stock(source,line.productId)).toBe('97.0000');
 const r=await write('/adjustments',{clientKey:randomUUID(),kind:'CUSTOMER_RETURN',locationId:source,sourceId:s.id,reason:'Too many returned',lines:[{productId:line.productId,sourceLineId:line.id,quantity:'1'}]});expect(r.body.error.code).toBe('RETURN_QUANTITY_EXCEEDED');
 expect(await db.stockMovement.count({where:{sourceId:a.id}})).toBe(1);expect(await db.stockMovement.count({where:{sourceId:b.id}})).toBe(0);
});
it('rejects simultaneous over-returns and allocates fractional money exactly',async()=>{
 const s=await sold('3','0.3333'),l=s.lines[0];const a=await adjustment('CUSTOMER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'2'}],{sourceId:s.id}),b=await adjustment('CUSTOMER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'2'}],{sourceId:s.id});const rows=await Promise.all([approve(a),approve(b)]);expect(rows.map(r=>r.status).sort()).toEqual([200,409]);
 const c=await adjustment('CUSTOMER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'1'}],{sourceId:s.id});expect((await approve(c)).status).toBe(200);const totals=await db.adjustment.aggregate({where:{sourceId:s.id,status:'COMPLETED'},_sum:{total:true}});expect(totals._sum.total!.toFixed(2)).toBe('1.00');
});
it('counts record discrepancies and require an unchanged stock snapshot',async()=>{
 const p=await funded('10'),a=await adjustment('COUNT',[{productId:p,quantity:'7'}]);expect(a.lines[0].delta).toBe('-3');expect(await stock(source,p)).toBe('10.0000');expect((await approve(a)).status).toBe(200);expect(await stock(source,p)).toBe('7.0000');
 const stale=await adjustment('COUNT',[{productId:p,quantity:'6'}]),damage=await adjustment('DAMAGE',[{productId:p,quantity:'1'}]);expect((await approve(damage)).status).toBe(200);expect((await approve(stale)).body.error.code).toBe('COUNT_STALE');
 const zero=await adjustment('COUNT',[{productId:p,quantity:'0'}]);expect((await approve(zero)).status).toBe(200);expect(await stock(source,p)).toBe('0.0000');
});
it('damage respects reservations and approval rollback preserves all lines',async()=>{
 const a=await funded('10'),b=await funded('1'),d=await adjustment('DAMAGE',[{productId:a,quantity:'2'},{productId:b,quantity:'2'}]);expect((await approve(d)).body.error.code).toBe('INSUFFICIENT_STOCK');expect(await stock(source,a)).toBe('10.0000');expect(await db.stockMovement.count({where:{sourceId:d.id}})).toBe(0);
 await db.stockBalance.updateMany({where:{productId:a},data:{reserved:'10'}});const r=await adjustment('DAMAGE',[{productId:a,quantity:'1'}]);expect((await approve(r)).body.error.code).toBe('INSUFFICIENT_STOCK');
});
it('supplier returns reduce stock, create credits, and support partial payments and refunds',async()=>{
 const r=await receipt(),l=r.lines[0];expect((await pay('SUPPLIER_PAYMENT','60',{sourceId:r.id})).status).toBe(201);
 expect((await pay('SUPPLIER_PAYMENT','41',{sourceId:r.id})).body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
 const ret=await adjustment('SUPPLIER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'5'}],{sourceId:r.id});expect((await approve(ret)).status).toBe(200);expect(await stock(source,l.productId)).toBe('105.0000');
 let balance=await get(`/balances/${r.id}?kind=SUPPLIER`);expect(balance.body).toMatchObject({gross:'100.0000',credit:'50.0000',paid:'60.0000',refundDue:'10.0000',outstanding:'0.0000'});
 expect((await pay('SUPPLIER_REFUND','11',{sourceId:r.id})).body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');expect((await pay('SUPPLIER_REFUND','10',{sourceId:r.id})).status).toBe(201);balance=await get(`/balances/${r.id}?kind=SUPPLIER`);expect(balance.body.refundDue).toBe('0.0000');
});
it('customer refunds are capped and payment recording never changes stock',async()=>{
 const s=await sold(),l=s.lines[0],r=await adjustment('CUSTOMER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'1'}],{sourceId:s.id});await approve(r);const before=await stock(source,l.productId),input={clientKey:randomUUID(),kind:'CUSTOMER_REFUND',locationId:source,sourceId:r.id,amount:'7',method:'CARD',reference:'Refund terminal',reason:'Customer refund paid',confirm:true};
 const result=await Promise.all([write('/payments',input),write('/payments',input)]);expect(result.map(r=>r.status)).toEqual([201,201]);expect(result[0]!.body.id).toBe(result[1]!.body.id);expect((await pay('CUSTOMER_REFUND','6',{sourceId:r.id})).body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');expect((await pay('CUSTOMER_REFUND','5',{sourceId:r.id})).status).toBe(201);expect(await stock(source,l.productId)).toBe(before);
});
it('expense and cash movements are immutable, require precise amounts and references',async()=>{
 expect((await pay('EXPENSE','1.001')).body.error.code).toBe('MONEY_PRECISION');expect((await pay('EXPENSE','2',{reference:''})).status).toBe(422);
 const r=await pay('EXPENSE','3');expect(r.status).toBe(201);
 const expenses=await get('/payments?kind=EXPENSE');expect(expenses.status).toBe(200);expect(expenses.body.items.length).toBeGreaterThan(0);expect(expenses.body.items.every((row:{kind:string})=>row.kind==='EXPENSE')).toBe(true);expect((await get('/payments?kind=INVALID')).status).toBe(422);
await expect(db.moneyEntry.update({where:{id:r.body.id},data:{amount:'1'}})).rejects.toThrow();
});
it('cash closing reconciles opening/in/out, explains variances and blocks later cash only',async()=>{
 const {businessDay}=await import('../src/finance/cash.js'),b=await db.business.findUniqueOrThrow({where:{id:business}}),day=businessDay(new Date(),b.timezone);
 expect((await pay('CASH_IN','50',{method:'CASH'})).status).toBe(201);expect((await pay('EXPENSE','5',{method:'CASH'})).status).toBe(201);
 const c=await get(`/cash?locationId=${source}&day=${day}`);expect(c.body).toMatchObject({inflow:'50.0000',outflow:'5.0000'});
 const input={locationId:source,day,opening:'10',counted:'54',expected:'55',reason:'One unit cash difference',confirm:true};expect((await write('/cash',{...input,expected:'54'})).body.error.code).toBe('CASH_TOTAL_CHANGED');expect((await write('/cash',{...input,reason:''})).body.error.code).toBe('VARIANCE_REASON_REQUIRED');
 const done=await write('/cash',input);expect(done.status,done.text).toBe(200);expect(done.body.variance).toBe('-1');expect((await write('/cash',input)).body.id).toBe(done.body.id);expect((await pay('EXPENSE','1',{method:'CASH'})).body.error.code).toBe('CASH_DAY_CLOSED');expect((await pay('EXPENSE','1')).status).toBe(201);
 const p=await funded(),s=await api('/sales',{clientKey:randomUUID(),locationId:source,lines:[{productId:p,quantity:'1'}]});const attempted=await api(`/sales/${s.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:s.body.total,payment:{method:'CASH',received:s.body.total},confirm:true});expect(attempted.body.error.code).toBe('CASH_DAY_CLOSED');
});
it('reports reconcile posted rows, hide costs, scope locations and neutralize CSV formulas',async()=>{
 const day=new Date().toISOString().slice(0,10),q=`from=${day}&to=${day}`;const r=await get(`/reports?${q}&view=summary`);expect(r.status,r.text).toBe(200);
 const sum=await db.sale.aggregate({where:{businessId:business,status:'COMPLETED'},_sum:{total:true}});expect(r.body.sales).toBe(sum._sum.total!.toFixed(4));
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:cashier.user.id}}});await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'reports.view':true}}});
 const safe=await get(`/reports?${q}`,cashier);expect(safe.body.estimatedProfit).toBeUndefined();expect((await get(`/reports?${q}&view=purchases`,cashier)).status).toBe(403);expect((await get(`/reports?${q}&locationId=${destination}`,cashier)).status).toBe(404);
 await db.product.update({where:{id:product},data:{name:'=HYPERLINK("evil")'}});const exported=await get(`/reports?${q}&view=stock&export=true`);expect(exported.status).toBe(200);expect(exported.body.csv).toContain("'=HYPERLINK");
});
it('opening-stock preview is non-mutating, owner-only, repeat-safe and reconciles the ledger',async()=>{
 const p=await db.product.create({data:{businessId:business,sku:`OPEN-${randomUUID().slice(0,8).toUpperCase()}`,name:'Migrated stock',unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}}),input={clientKey:randomUUID(),locationId:destination,reason:'Approved opening allocation',rows:[{sku:p.sku,quantity:'20'}]};
 const preview=await write('/migration/preview',input);expect(preview.status,preview.text).toBe(201);expect(await stock(destination,p.id)).toBe('0.0000');
 expect((await write('/migration/preview',input,cashier)).status).toBe(403);const first=await write(`/migration/${preview.body.id}/confirm`,{confirm:true});expect(first.status,first.text).toBe(200);const again=await write(`/migration/${preview.body.id}/confirm`,{confirm:true});expect(again.status,again.text).toBe(200);expect(again.body.id).toBe(first.body.id);expect(await stock(destination,p.id)).toBe('20.0000');
 expect((await write('/migration/preview',{...input,clientKey:randomUUID()})).body.error.code).toBe('OPENING_STOCK_EXISTS');expect((await get('/migration')).body.stockLedgerMismatches).toBe(0);
});
it('expired migration previews and changed count snapshots cannot overwrite stock',async()=>{
 const p=await db.product.create({data:{businessId:business,sku:`EXP-${randomUUID().slice(0,8).toUpperCase()}`,name:'Expired migration',unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}}),r=await write('/migration/preview',{clientKey:randomUUID(),locationId:destination,reason:'Opening balance check',rows:[{sku:p.sku,quantity:'3'}]});await db.migrationPreview.update({where:{id:r.body.id},data:{expiresAt:new Date(0)}});expect((await write(`/migration/${r.body.id}/confirm`,{confirm:true})).body.error.code).toBe('MIGRATION_EXPIRED');expect(await stock(destination,p.id)).toBe('0.0000');
});
it('completed adjustment documents and lines cannot be rewritten',async()=>{
 const p=await funded(),d=await adjustment('DAMAGE',[{productId:p,quantity:'1'}]);await approve(d);await expect(db.adjustment.update({where:{id:d.id},data:{reason:'Changed history'}})).rejects.toThrow();await expect(db.adjustmentLine.update({where:{id:d.lines[0].id},data:{quantity:'2'}})).rejects.toThrow();
});
it('runs the agreed warehouse/shop pilot: receive 100, transfer 30, sell 5, return 2 => 70 / 27',async()=>{
 const warehouse=await db.location.create({data:{businessId:business,code:'PILOT-WH',name:'Pilot warehouse',kind:'WAREHOUSE'}}),p=await db.product.create({data:{businessId:business,sku:'PILOT-BOTTLE',name:'Pilot bottle',unit:'PIECE',purchasePrice:'10',sellingPrice:'12'}}),supplier=await db.supplier.create({data:{businessId:business,code:'PILOT-SUP',name:'Pilot supplier'}});
 const r=await api('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:warehouse.id,supplierId:supplier.id,documentDate:'2026-11-11',lines:[{productId:p.id,quantity:'100'}]});expect(r.status,r.text).toBe(201);await api(`/operations/purchases/${r.body.id}/status`,{revision:0,action:'submit',confirm:true});expect((await api(`/operations/purchases/${r.body.id}/status`,{revision:1,action:'confirm',confirm:true})).status).toBe(200);
 const tr=await api('/transfers',{clientKey:randomUUID(),sourceId:warehouse.id,destinationId:destination,lines:[{productId:p.id,quantity:'30'}]});expect(tr.status).toBe(201);const dispatched=await api(`/transfers/${tr.body.id}/status`,{revision:0,action:'dispatch',confirm:true});expect(dispatched.status).toBe(200);expect((await api(`/transfers/${tr.body.id}/events`,{clientKey:randomUUID(),revision:1,kind:'RECEIVE',confirm:true,lines:[{lineId:tr.body.lines[0].id,quantity:'30'}]})).status).toBe(200);
 const sale=await api('/sales',{clientKey:randomUUID(),locationId:destination,lines:[{productId:p.id,quantity:'5'}]});const paid=await api(`/sales/${sale.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:sale.body.total,payment:{method:'CARD',received:sale.body.total,reference:'Pilot terminal'},confirm:true});expect(paid.status).toBe(200);
 const returned=await adjustment('CUSTOMER_RETURN',[{productId:p.id,sourceLineId:paid.body.lines[0].id,quantity:'2'}],{locationId:destination,sourceId:sale.body.id});expect((await approve(returned)).status).toBe(200);expect(await stock(warehouse.id,p.id)).toBe('70.0000');expect(await stock(destination,p.id)).toBe('27.0000');expect((await db.stockTransfer.findUniqueOrThrow({where:{id:tr.body.id}})).status).toBe('COMPLETED');expect((await get('/migration')).body.stockLedgerMismatches).toBe(0);
});
it('cash closing races safely against a cash expense',async()=>{
 const {businessDay}=await import('../src/finance/cash.js'),b=await db.business.findUniqueOrThrow({where:{id:business}}),day=businessDay(new Date(),b.timezone);
 const rows=await Promise.all([write('/cash',{locationId:destination,day,opening:'0',counted:'0',expected:'0',reason:'Pilot closing check',confirm:true}),pay('EXPENSE','1',{locationId:destination,method:'CASH'})]);expect([[200,409],[409,201]]).toContainEqual(rows.map(r=>r.status));
});
it('refund limits withstand two different concurrent payment requests',async()=>{
 const s=await sold(),l=s.lines[0],r=await adjustment('CUSTOMER_RETURN',[{productId:l.productId,sourceLineId:l.id,quantity:'1'}],{sourceId:s.id});await approve(r);const rows=await Promise.all([pay('CUSTOMER_REFUND','7',{sourceId:r.id}),pay('CUSTOMER_REFUND','7',{sourceId:r.id})]);expect(rows.map(r=>r.status).sort()).toEqual([201,409]);
});
it('analyzes legacy exports without importing accounts or silently allocating stock',async()=>{
 const {analyzeLegacy}=await import('../src/migration/legacy.js');const raw=JSON.stringify({meta:{app:'ProfitLens',format_version:1,business_id:'legacy'},data:{business:{base_currency:'USD'},products:[{business_id:'legacy',product_id:'p1',sku:'MILK-001',name:'Milk',stock_qty:100,product_cost:2,selling_price:3}],users:[{business_id:'legacy',password_hash:'DO_NOT_COPY'}]}});const r=analyzeLegacy(raw);expect(r.readyToPost).toBe(false);expect(r.products[0]).toMatchObject({legacyStock:'100',allocations:[],baseUnit:null});expect(JSON.stringify(r)).not.toContain('DO_NOT_COPY');expect(r.sourceSha256).toHaveLength(64);expect(()=>analyzeLegacy(raw.replace('"business_id":"legacy","product_id"','"business_id":"foreign","product_id"'))).toThrow();
});
it('refuses count snapshots that changed before draft save and source IDs on non-returns',async()=>{
 const p=await funded('5'),snapshot=(await get(`/snapshot?locationId=${source}&productId=${p}`)).body,d=await adjustment('DAMAGE',[{productId:p,quantity:'1'}]);await approve(d);
 expect((await write('/adjustments',{clientKey:randomUUID(),kind:'COUNT',locationId:source,reason:'Stale count preparation',lines:[{productId:p,quantity:'5',...snapshot}]})).body.error.code).toBe('COUNT_STALE');
 expect((await write('/adjustments',{clientKey:randomUUID(),kind:'DAMAGE',locationId:source,reason:'Invalid linked adjustment',lines:[{productId:p,quantity:'1',sourceLineId:randomUUID()}]})).status).toBe(422);
});
it('rolls back financial records if the final audit insert fails',async()=>{
 const suffix=randomUUID().replaceAll('-',''),fn=`reject_payment_${suffix}`,before=await db.moneyEntry.count({where:{businessId:business}});
 try{await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='payment.recorded' AND NEW.business_id='${business}'::uuid THEN RAISE EXCEPTION 'test final audit failure'; END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON auth_audit FOR EACH ROW EXECUTE FUNCTION ${fn}()`);expect((await pay('EXPENSE','7')).status).toBe(500);expect(await db.moneyEntry.count({where:{businessId:business}})).toBe(before);}finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON auth_audit`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);}
});
it('keeps cash-day boundaries correct for local time and daylight-saving dates',async()=>{
 const {businessDay}=await import('../src/finance/cash.js');expect(businessDay(new Date('2026-11-01T03:30:00Z'),'America/New_York')).toBe('2026-10-31');expect(businessDay(new Date('2026-11-01T06:30:00Z'),'America/New_York')).toBe('2026-11-01');expect(businessDay(new Date('2026-11-11T22:30:00Z'),'Asia/Dubai')).toBe('2026-11-12');
 const b=await db.business.findUniqueOrThrow({where:{id:business}});const r=await request(app).patch(`/api/businesses/${business}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:b.revision,timezone:b.timezone==='UTC'?'Asia/Dubai':'UTC'});expect(r.body.error.code).toBe('TIMEZONE_LOCKED');
});
it('detects count staleness even when movements net to zero within one transaction',async()=>{
 const p=await funded('10'),d=await adjustment('COUNT',[{productId:p,quantity:'9'}]);await auth.transaction(async tx=>{for(const delta of ['1','-1'])await postStock(tx,{businessId:business,locationId:source,productId:p,delta,type:'TEST_CHANGE',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'same-time count test',actorId:owner.user.id,notes:''});});expect(await stock(source,p)).toBe('10.0000');expect((await approve(d)).body.error.code).toBe('COUNT_STALE');
});
it('requires renewed review if an intervening return changes one-cent rounding',async()=>{
 const s=await sold('3','0.3333'),l=s.lines[0],line=[{productId:l.productId,sourceLineId:l.id,quantity:'1'}],a=await adjustment('CUSTOMER_RETURN',line,{sourceId:s.id}),b=await adjustment('CUSTOMER_RETURN',line,{sourceId:s.id});expect((await approve(a)).status).toBe(200);expect((await approve(b)).body.error.code).toBe('RETURN_VALUE_CHANGED');expect((await db.adjustment.findUniqueOrThrow({where:{id:b.id}})).status).toBe('DRAFT');
});
it('supplier return history and refund reports retain scoped financial totals',async()=>{
 const r=await db.purchaseDocument.findFirstOrThrow({where:{businessId:business,kind:'RECEIPT',supplierName:'Test supplier'}}),history=await get(`/adjustments?kind=SUPPLIER_RETURN&supplierId=${r.supplierId}`);expect(history.status).toBe(200);expect(history.body.items.every((x:any)=>x.sourceId===r.id)).toBe(true);
 const day=new Date().toISOString().slice(0,10),report=await get(`/reports?from=${day}&to=${day}&view=refunds`);expect(report.status,report.text).toBe(200);expect(report.body.items.length).toBeGreaterThan(0);expect(report.body.items.every((r:any)=>Number(r.outstanding)>=0)).toBe(true);
});
it('shows product sale frequency, scoped available stock, low stock and filtered exports',async()=>{
 const sale=await sold('3'),productId=sale.lines[0].productId;
 await db.product.update({where:{id:productId},data:{minimumStock:'98',name:'Insight test product'}});
 const insights=(query:string,who=owner,bid=business)=>request(app).get(`/api/businesses/${bid}/products/insights?${query}`).set('Cookie',cookie(who));
 const result=await insights('search=Insight%20test%20product');expect(result.status,result.text).toBe(200);const row=result.body.items.find((p:{id:string})=>p.id===productId);expect(row.saleCount).toBe(1);expect(row.unitsSold).toBe('3.0000');expect(row.available).toBe('97.0000');expect(row.lowStock).toBe(true);
 const top=await insights('filter=top&search=Insight%20test%20product');expect(top.body.items[0].id).toBe(productId);
 const low=await insights('filter=low&search=Insight%20test%20product');expect(low.body.total).toBe(1);
 const csv=await insights('export=true&search=Insight%20test%20product');expect(csv.body.csv).toContain('Insight test product');expect(csv.body.csv).toContain('saleCount');
 expect((await insights('',foreign)).status).toBe(403);expect((await insights('',admin)).status).toBe(403);
 const restricted=await insights('search=Insight%20test%20product',unassigned);expect(restricted.status).toBe(200);expect(restricted.body.items[0].saleCount??0).toBe(0);expect(restricted.body.items[0].available??'0.0000').toBe('0.0000');
});
