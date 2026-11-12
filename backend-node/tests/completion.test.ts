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
it('values posted count gains and losses at saved cost and excludes drafts',async()=>{
 const day=new Date().toISOString().slice(0,10),path=`/reports?from=${day}&to=${day}&view=summary`;
 const before=(await get(path)).body;
 const p=await funded('10'),loss=await adjustment('COUNT',[{productId:p,quantity:'8'}]);
 expect((await get(path)).body.countAdjustmentValue).toBe(before.countAdjustmentValue);
 expect((await approve(loss)).status).toBe(200);
 const afterLoss=(await get(path)).body;
 expect(Number(afterLoss.countAdjustmentValue)-Number(before.countAdjustmentValue)).toBeCloseTo(-19.75,4);
 expect(Number(afterLoss.estimatedProfit)-Number(before.estimatedProfit)).toBeCloseTo(-19.75,4);
 const gain=await adjustment('COUNT',[{productId:p,quantity:'9'}]);
 expect((await approve(gain)).status).toBe(200);
 await db.product.update({where:{id:p},data:{purchasePrice:'999'}});
 const afterGain=(await get(path)).body;
 expect(Number(afterGain.countAdjustmentValue)-Number(afterLoss.countAdjustmentValue)).toBeCloseTo(9.88,4);
 expect(Number(afterGain.estimatedProfit)-Number(afterLoss.estimatedProfit)).toBeCloseTo(9.88,4);
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
it('runs the agreed warehouse/shop pilot: receive 100, transfer 30, sell 5, return 2, damage 1, count 24; reconcile every step',async()=>{
 const warehouse=await db.location.create({data:{businessId:business,code:'PILOT-WH',name:'Pilot warehouse',kind:'WAREHOUSE'}}),p=await db.product.create({data:{businessId:business,sku:'PILOT-BOTTLE',name:'Pilot bottle',unit:'PIECE',purchasePrice:'10',sellingPrice:'12'}}),supplier=await db.supplier.create({data:{businessId:business,code:'PILOT-SUP',name:'Pilot supplier'}});
 async function checkpoint(warehouseQty:string,shopQty:string){
  for(const [locationId,expected] of [[warehouse.id,warehouseQty],[destination,shopQty]]){
   expect(await stock(locationId!,p.id)).toBe(expected);
   const sum=await db.stockMovement.aggregate({where:{businessId:business,locationId,productId:p.id},_sum:{quantity:true}});
   expect(sum._sum.quantity?.toFixed(4)??'0.0000').toBe(expected);
  }
 }
 await checkpoint('0.0000','0.0000');
 const r=await api('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:warehouse.id,supplierId:supplier.id,documentDate:'2026-11-11',lines:[{productId:p.id,quantity:'100'}]});expect(r.status,r.text).toBe(201);await api(`/operations/purchases/${r.body.id}/status`,{revision:0,action:'submit',confirm:true});expect((await api(`/operations/purchases/${r.body.id}/status`,{revision:1,action:'confirm',confirm:true})).status).toBe(200);
 await checkpoint('100.0000','0.0000');
 const tr=await api('/transfers',{clientKey:randomUUID(),sourceId:warehouse.id,destinationId:destination,lines:[{productId:p.id,quantity:'30'}]});expect(tr.status).toBe(201);const dispatched=await api(`/transfers/${tr.body.id}/status`,{revision:0,action:'dispatch',confirm:true});expect(dispatched.status).toBe(200);await checkpoint('70.0000','0.0000');expect((await api(`/transfers/${tr.body.id}/events`,{clientKey:randomUUID(),revision:1,kind:'RECEIVE',confirm:true,lines:[{lineId:tr.body.lines[0].id,quantity:'30'}]})).status).toBe(200);
 await checkpoint('70.0000','30.0000');
 const sale=await api('/sales',{clientKey:randomUUID(),locationId:destination,lines:[{productId:p.id,quantity:'5'}]});const paid=await api(`/sales/${sale.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:sale.body.total,payment:{method:'CARD',received:sale.body.total,reference:'Pilot terminal'},confirm:true});expect(paid.status).toBe(200);
 await checkpoint('70.0000','25.0000');
 const returned=await adjustment('CUSTOMER_RETURN',[{productId:p.id,sourceLineId:paid.body.lines[0].id,quantity:'2'}],{locationId:destination,sourceId:sale.body.id});expect((await approve(returned)).status).toBe(200);expect(await stock(warehouse.id,p.id)).toBe('70.0000');expect(await stock(destination,p.id)).toBe('27.0000');expect((await db.stockTransfer.findUniqueOrThrow({where:{id:tr.body.id}})).status).toBe('COMPLETED');expect((await get('/migration')).body.stockLedgerMismatches).toBe(0);
 await checkpoint('70.0000','27.0000');
 const damage=await adjustment('DAMAGE',[{productId:p.id,quantity:'1'}],{locationId:destination});expect((await approve(damage)).status).toBe(200);await checkpoint('70.0000','26.0000');
 const count=await adjustment('COUNT',[{productId:p.id,quantity:'24'}],{locationId:destination});expect((await approve(count)).status).toBe(200);await checkpoint('70.0000','24.0000');
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
 const result=await insights('search=Insight%20test%20product');expect(result.status,result.text).toBe(200);const row=result.body.items.find((p:{id:string})=>p.id===productId);expect(row.saleCount).toBe(1);expect(row.unitsSold).toBe('3.0000');expect(row.available).toBe('97.0000');expect(row.onHand).toBe('97.0000');expect(row.lowStock).toBe(true);
 const top=await insights('filter=top&search=Insight%20test%20product');expect(top.body.items[0].id).toBe(productId);
 const low=await insights('filter=low&search=Insight%20test%20product');expect(low.body.total).toBe(1);
 const csv=await insights('export=true&search=Insight%20test%20product');expect(csv.body.csv).toContain('Insight test product');expect(csv.body.csv).toContain('saleCount');
 expect((await insights('',foreign)).status).toBe(403);expect((await insights('',admin)).status).toBe(403);
 const restricted=await insights('search=Insight%20test%20product',unassigned);expect(restricted.status).toBe(200);expect(restricted.body.items[0].saleCount??0).toBe(0);expect(restricted.body.items[0].available??'0.0000').toBe('0.0000');
});
it('shares the heavy report budget across API instances and keeps other users isolated',async()=>{
 const limited=await actor('OWNER');
 for(let i=0;i<30;i++)await auth.limit('heavy-api-user',limited.user.id,30,60);
 const second=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
 const path=`/api/businesses/${business}/products/insights`;
 const blocked=await request(second).get(path).set('Cookie',cookie(limited));
 expect(blocked.status).toBe(429);expect(blocked.headers['retry-after']).toBe('60');
 const fresh=await actor('OWNER');expect((await request(second).get(path).set('Cookie',cookie(fresh))).status).toBe(200);
 expect((await request(second).get(path)).status).toBe(401);
});
it('paginates a large catalogue before loading stock and sales statistics',async()=>{
 const prefix=`PERF-${randomUUID().slice(0,8).toUpperCase()}`;
 await db.product.createMany({data:Array.from({length:2000},(_,i)=>({businessId:business,sku:`${prefix}-${i}`,name:`${prefix}-${String(i).padStart(4,'0')}`,unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}))});
 const times:number[]=[];
 for(const page of [1,2,40,80,81]){
  const start=performance.now();const res=await request(app).get(`/api/businesses/${business}/products/insights?search=${prefix}&page=${page}`).set('Cookie',cookie(owner));times.push(performance.now()-start);
  expect(res.status,res.text).toBe(200);expect(res.body.total).toBe(2000);expect(res.body.items).toHaveLength(page===81?0:25);
  if(page<=80)expect(res.body.items[0].name).toBe(`${prefix}-${String((page-1)*25).padStart(4,'0')}`);
 }
 console.log('Catalogue benchmark (2,000 products, local API, five sequential pages), ms:',times.map(t=>Math.round(t)));
});
it('returns separate report pages with a full matching count and full export',async()=>{
 const prefix=`PAGING-${randomUUID().slice(0,8).toUpperCase()}`;
 await db.product.createMany({data:Array.from({length:60},(_,i)=>({businessId:business,sku:`${prefix}-${i}`,name:`${prefix}-${i}`,unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}))});
 const products=await db.product.findMany({where:{businessId:business,sku:{startsWith:prefix}}});
 await db.stockBalance.createMany({data:products.map(p=>({businessId:business,locationId:source,productId:p.id,onHand:'1',reserved:'0'}))});
 const day=new Date().toISOString().slice(0,10),query=`/reports?view=stock&from=${day}&to=${day}`;
 const first=await get(`${query}&page=1`),second=await get(`${query}&page=2`);
 expect(first.status).toBe(200);expect(second.status).toBe(200);expect(first.body.items).toHaveLength(25);expect(second.body.items).toHaveLength(25);expect(first.body.total).toBeGreaterThanOrEqual(60);expect(second.body.total).toBe(first.body.total);
 const keys=new Set(first.body.items.map((r:any)=>`${r.location}:${r.sku}`));expect(second.body.items.some((r:any)=>keys.has(`${r.location}:${r.sku}`))).toBe(false);
 const exported=await get(`${query}&export=true`);expect(exported.status).toBe(200);expect(exported.body.total).toBe(first.body.total);
});

async function treasuryLocation(){return (await db.location.create({data:{businessId:business,code:`CASH-${randomUUID().slice(0,8).toUpperCase()}`,name:'Isolated mock cash drawer',kind:'SHOP'}})).id;}
async function treasuryDay(){const {businessDay}=await import('../src/finance/cash.js');return businessDay(new Date(),(await db.business.findUniqueOrThrow({where:{id:business}})).timezone);}
it('treasury: rejects malformed payments without recording money or audit events',async()=>{
 const locationId=await treasuryLocation(),before=await db.moneyEntry.count({where:{businessId:business}}),audit=await db.authAudit.count({where:{businessId:business,action:'payment.recorded'}});
 const invalid=[{amount:'0'},{amount:'-1'},{amount:'NaN'},{amount:'1e3'},{amount:'1.001'},{amount:1},{method:'CHEQUE'},{reason:'x'},{confirm:false},{reference:''},{kind:'CASH_IN',method:'CARD'},{kind:'CASH_OUT',method:'TRANSFER'},{kind:'CUSTOMER_REFUND'},{sourceId:randomUUID()}];
 for(const extra of invalid){const r=await pay('EXPENSE','1',{locationId,...extra});expect(r.status,JSON.stringify(extra)+r.text).toBe(422);}
 expect(await db.moneyEntry.count({where:{businessId:business}})).toBe(before);expect(await db.authAudit.count({where:{businessId:business,action:'payment.recorded'}})).toBe(audit);
});
it('treasury: repeated cash submission records one entry and changed retries conflict',async()=>{
 const locationId=await treasuryLocation(),clientKey=randomUUID();const rows=await Promise.all(Array.from({length:5},()=>pay('CASH_IN','10.25',{locationId,clientKey,method:'CASH'})));
 expect(rows.map(r=>r.status)).toEqual([201,201,201,201,201]);expect(new Set(rows.map(r=>r.body.id)).size).toBe(1);
 expect((await pay('CASH_IN','10.26',{locationId,clientKey,method:'CASH'})).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 expect(await db.moneyEntry.count({where:{businessId:business,locationId}})).toBe(1);expect(await db.authAudit.count({where:{targetId:rows[0]!.body.id,action:'payment.recorded'}})).toBe(1);
});
it('treasury: exact cents reconcile cash only and isolate another drawer',async()=>{
 const locationId=await treasuryLocation(),day=await treasuryDay();
 for(const [kind,amount,method] of [['CASH_IN','0.10','CASH'],['CASH_IN','0.20','CASH'],['CASH_OUT','0.05','CASH'],['EXPENSE','0.02','CASH'],['EXPENSE','90','CARD'],['EXPENSE','80','TRANSFER']])expect((await pay(kind!,amount!,{locationId,method})).status).toBe(201);
 expect((await get(`/cash?locationId=${locationId}&day=${day}`)).body).toMatchObject({inflow:'0.3000',outflow:'0.0700'});
 const otherDrawer=await treasuryLocation();expect((await get(`/cash?locationId=${otherDrawer}&day=${day}`)).body).toMatchObject({inflow:'0.0000',outflow:'0.0000'});
 const closed=await write('/cash',{locationId,day,opening:'10',counted:'10.23',expected:'10.23',confirm:true});expect(closed.status,closed.text).toBe(200);expect(closed.body.variance).toBe('0');
});
it('treasury: cash sales contribute sale value after giving change, not cash tendered',async()=>{
 const locationId=await treasuryLocation(),p=await funded();await auth.transaction(tx=>postStock(tx,{businessId:business,locationId,productId:p,delta:'5',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'Mock treasury stock',actorId:owner.user.id,notes:''}));
 const sale=await api('/sales',{clientKey:randomUUID(),locationId,lines:[{productId:p,quantity:'2'}]});expect(sale.status).toBe(201);
 const paid=await api(`/sales/${sale.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:'24.00',payment:{method:'CASH',received:'50'},confirm:true});expect(paid.status,paid.text).toBe(200);
 expect((await db.salePayment.findUniqueOrThrow({where:{businessId_saleId:{businessId:business,saleId:sale.body.id}}})).change.toFixed(2)).toBe('26.00');
 expect((await get(`/cash?locationId=${locationId}&day=${await treasuryDay()}`)).body).toMatchObject({inflow:'24.0000',outflow:'0.0000'});
 const line=paid.body.lines[0],returned=await adjustment('CUSTOMER_RETURN',[{productId:p,sourceLineId:line.id,quantity:'1'}],{locationId,sourceId:sale.body.id});expect((await approve(returned)).status).toBe(200);
 expect((await pay('CUSTOMER_REFUND','12',{locationId,sourceId:returned.id,method:'CASH'})).status).toBe(201);
 expect((await get(`/cash?locationId=${locationId}&day=${await treasuryDay()}`)).body).toMatchObject({inflow:'24.0000',outflow:'12.0000'});

});
it('treasury: closing rejects stale totals and future dates; concurrent closing is repeat-safe',async()=>{
 const locationId=await treasuryLocation(),day=await treasuryDay(),input={locationId,day,opening:'20',counted:'20',expected:'20',confirm:true};
 expect((await write('/cash',{...input,day:'2099-01-01'})).body.error.code).toBe('FUTURE_DAY');
 expect((await pay('CASH_IN','5',{locationId,method:'CASH'})).status).toBe(201);expect((await write('/cash',input)).body.error.code).toBe('CASH_TOTAL_CHANGED');
 const valid={...input,counted:'25',expected:'25'};const rows=await Promise.all([write('/cash',valid),write('/cash',valid)]);expect(rows.map(r=>r.status)).toEqual([200,200]);expect(rows[0]!.body.id).toBe(rows[1]!.body.id);
 expect((await write('/cash',{...valid,counted:'24',reason:'Changed count after closing'})).body.error.code).toBe('CASH_DAY_CLOSED');expect(await db.cashClose.count({where:{businessId:business,locationId}})).toBe(1);
 await expect(db.cashClose.update({where:{id:rows[0]!.body.id},data:{counted:'999'}})).rejects.toThrow();
});
it('treasury: surplus requires explanation and closed drawers reject all new cash movements',async()=>{
 const locationId=await treasuryLocation(),day=await treasuryDay();const input={locationId,day,opening:'10',counted:'12',expected:'10',confirm:true};
 expect((await write('/cash',input)).body.error.code).toBe('VARIANCE_REASON_REQUIRED');const closed=await write('/cash',{...input,reason:'Mock surplus confirmed by recount'});expect(closed.status).toBe(200);expect(closed.body.variance).toBe('2');
 for(const kind of ['CASH_IN','CASH_OUT','EXPENSE'])expect((await pay(kind,'1',{locationId,method:'CASH'})).body.error.code).toBe('CASH_DAY_CLOSED');
 for(const method of ['CARD','TRANSFER'])expect((await pay('EXPENSE','1',{locationId,method})).status).toBe(201);
 expect((await get(`/cash?locationId=${locationId}&day=${day}`)).body).toMatchObject({inflow:'0.0000',outflow:'0.0000'});
});
it('treasury: supplier payments racing for the same balance never overpay',async()=>{
 const r=await receipt();const rows=await Promise.all([pay('SUPPLIER_PAYMENT','60',{sourceId:r.id}),pay('SUPPLIER_PAYMENT','60',{sourceId:r.id})]);expect(rows.map(r=>r.status).sort()).toEqual([201,409]);
 expect((await get(`/balances/${r.id}?kind=SUPPLIER`)).body).toMatchObject({paid:'60.0000',outstanding:'40.0000'});
 expect((await pay('SUPPLIER_PAYMENT','40',{sourceId:r.id})).status).toBe(201);expect((await pay('SUPPLIER_PAYMENT','0.01',{sourceId:r.id})).body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
 expect((await pay('SUPPLIER_PAYMENT','1',{sourceId:r.id,locationId:destination})).body.error.code).toBe('SOURCE_LOCATION_MISMATCH');
});
it('treasury: unauthorized users cannot post money, close cash or read foreign drawers',async()=>{
 const locationId=await treasuryLocation(),input={clientKey:randomUUID(),locationId,kind:'EXPENSE',amount:'1',method:'CASH',reason:'Mock unauthorized expense',confirm:true};
 for(const who of [cashier,unassigned,admin,foreign]){expect([403,404]).toContain((await write('/payments',input,who)).status);expect([403,404]).toContain((await write('/cash',{locationId,day:await treasuryDay(),opening:'0',counted:'0',expected:'0',confirm:true},who)).status);}
 expect((await get(`/cash?locationId=${foreignLocation}&day=${await treasuryDay()}`)).status).toBe(404);expect(await db.moneyEntry.count({where:{businessId:business,locationId}})).toBe(0);
});
it('treasury: payment pagination has no overlap and expense filter excludes cash deposits',async()=>{
 const locationId=await treasuryLocation();for(let i=0;i<31;i++)expect((await pay('EXPENSE','1',{locationId,reference:`Mock expense ${i}`})).status).toBe(201);
 expect((await pay('CASH_IN','5',{locationId,method:'CASH'})).status).toBe(201);
 const first=await get(`/payments?locationId=${locationId}&page=1`),second=await get(`/payments?locationId=${locationId}&page=2`),empty=await get(`/payments?locationId=${locationId}&page=3`);
 expect(first.body.total).toBe(32);expect(first.body.items).toHaveLength(25);expect(second.body.items).toHaveLength(7);expect(empty.body.items).toHaveLength(0);expect(new Set([...first.body.items,...second.body.items].map(r=>r.id)).size).toBe(32);
 const expenses=await get(`/payments?locationId=${locationId}&kind=EXPENSE`);expect(expenses.body.total).toBe(31);expect(expenses.body.items.every((r:any)=>r.kind==='EXPENSE')).toBe(true);
});
it('refunds snapshotted tax across partial returns and excludes it from estimated profit',async()=>{
 const day=new Date().toISOString().slice(0,10),summary=()=>get(`/reports?from=${day}&to=${day}`);
 const before=(await summary()).body;
 try{
  await db.business.update({where:{id:business},data:{salesTaxRate:'5'}});
  const sale=await sold('3','10'),line=sale.lines[0];expect(Number(sale.total)).toBe(31.5);
  const after=(await summary()).body;expect(Number(after.estimatedProfit)-Number(before.estimatedProfit)).toBeCloseTo(30-29.63,4);
  await db.business.update({where:{id:business},data:{salesTaxRate:'20'}});
  let refunded=0,tax=0;
  for(let i=0;i<3;i++){
   const ret=await adjustment('CUSTOMER_RETURN',[{productId:line.productId,sourceLineId:line.id,quantity:'1'}],{sourceId:sale.id});
   const approved=await approve(ret);expect(approved.status,approved.text).toBe(200);refunded+=Number(approved.body.total);tax+=Number(approved.body.lines[0].tax);
  }
  expect(refunded).toBe(31.5);expect(tax).toBe(1.5);
  const final=(await summary()).body;expect(Number(final.netSales)).toBe(Number(before.netSales));
 }finally{await db.business.update({where:{id:business},data:{salesTaxRate:'0'}});}
});

it('isolates every report/export view and rejects foreign location filters for a dual-business owner',async()=>{
 const dual=await actor('OWNER');await db.membership.create({data:{businessId:other,userId:dual.user.id,role:'OWNER'}});
 const marker=`PRIVATE-${randomUUID().toUpperCase()}`;
 const p=await db.product.create({data:{businessId:other,sku:marker,name:marker,unit:'PIECE',purchasePrice:'7',sellingPrice:'11'}});
 await auth.transaction(tx=>postStock(tx,{businessId:other,locationId:foreignLocation,productId:p.id,delta:'7',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:marker,actorId:foreign.user.id,notes:''}));
 const range='from=2026-01-01&to=2026-12-31';
 const control=await get(`/reports?${range}&view=stock&export=true`,dual,other);expect(control.status,control.text).toBe(200);expect(control.body.csv).toContain(marker);
 for(const view of ['summary','stock','sales','purchases','returns','payments','balances','refunds']){
  const response=await get(`/reports?${range}&view=${view}&export=true`,dual);expect(response.status,response.text).toBe(200);expect(response.text).not.toContain(marker);
  const spoof=await get(`/reports?${range}&view=${view}&export=true&locationId=${foreignLocation}`,dual);expect(spoof.status,spoof.text).toBe(404);
 }
 const denied=await get(`/reports?${range}&view=stock&export=true`,owner,other);expect(denied.status).toBe(403);expect(denied.text).not.toContain(marker);
});

it('rechecks report and export permissions on the next request using the same session',async()=>{
 const viewer=await actor('OWNER');
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:viewer.user.id}}});
 const path='/reports?from=2026-01-01&to=2026-12-31&view=stock&export=true';
 expect((await get(path,viewer)).status).toBe(200);
 await db.membership.update({where:{id:member.id},data:{role:'CASHIER',permissionOverrides:{'reports.view':false}}});
 expect((await get(path,viewer)).status).toBe(403);
 await db.membership.update({where:{id:member.id},data:{role:'OWNER',permissionOverrides:{},disabledAt:new Date()}});
 expect((await get(path,viewer)).status).toBe(403);
});
