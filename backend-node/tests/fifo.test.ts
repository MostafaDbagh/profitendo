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
const get=(path='',who=owner,b=business)=>request(app).get(`/api/businesses/${b}/sales${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'='post',b=business)=>request(app)[method](`/api/businesses/${b}/sales${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
const body=(extra:Record<string,unknown>={})=>({clientKey:randomUUID(),locationId:source,lines:[{productId:product,quantity:'2'}],...extra});
async function draft(extra:Record<string,unknown>={},who=owner){const r=await write('',body(extra),who);expect(r.status,r.text).toBe(201);return r.body;}
const checkoutBody=(doc:any,extra:Record<string,unknown>={})=>({clientKey:randomUUID(),revision:doc.revision,expectedTotal:doc.total,confirm:true,payment:{method:'CASH',received:doc.total},...extra});
const checkout=(doc:any,input=checkoutBody(doc),who=owner)=>write(`/${doc.id}/checkout`,input,who);
async function stock(locationId:string,productId=product){return (await db.stockBalance.findFirst({where:{businessId:business,locationId,productId}}))?.onHand.toFixed(4)??'0.0000';}
async function funded(quantity='100'){
 const p=await db.product.create({data:{businessId:business,sku:`SKU-${randomUUID().slice(0,8).toUpperCase()}`,name:'Transfer product',unit:'PIECE',purchasePrice:'9.8765',sellingPrice:'12'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:p.id,delta:quantity,unitCost:'2',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'test opening',actorId:owner.user.id,notes:''}));return p.id;
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
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');
  await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');
  for(const [table,trigger] of [['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.salePayment.deleteMany({where:{businessId:{in:bids}}});await tx.saleLine.deleteMany({where:{businessId:{in:bids}}});await tx.sale.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.$transaction(async tx=>{
  for(const [table,trigger] of [['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['transfer_events','transfer_events_immutable'],['transfer_event_lines','transfer_event_lines_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.adjustmentLine.deleteMany({where:{businessId:{in:bids}}});await tx.adjustment.deleteMany({where:{businessId:{in:bids}}});await tx.transferEventLine.deleteMany({where:{businessId:{in:bids}}});await tx.transferEvent.deleteMany({where:{businessId:{in:bids}}});await tx.transferLine.deleteMany({where:{businessId:{in:bids}}});await tx.stockTransfer.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['transfer_events','transfer_events_immutable'],['transfer_event_lines','transfer_event_lines_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.$transaction(async tx=>{
  await tx.purchaseLine.deleteMany({where:{businessId:{in:bids}}});await tx.purchaseDocument.deleteMany({where:{businessId:{in:bids}}});
 });
 await db.supplier.deleteMany({where:{businessId:{in:bids}}});
 await db.fifoLayer.deleteMany({where:{businessId:{in:bids}}});
 await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.productPack.deleteMany({where:{businessId:{in:bids}}});
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});
 await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
});
const apiGet=(path:string,who=owner)=>request(app).get(`/api/businesses/${business}${path}`).set('Cookie',cookie(who));
const apiPost=(path:string,data:object,who=owner)=>request(app).post(`/api/businesses/${business}${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(data);
let sold:any;
it('requires owner review, rejects stale/missing opening costs and activates atomically once',async()=>{
 for(const who of [cashier,foreign,admin])expect((await apiGet('/operations/fifo-review',who)).status).toBe(403);
 const transfer=await apiPost('/transfers',{clientKey:randomUUID(),sourceId:source,destinationId:destination,lines:[{productId:product,quantity:'1'}]});
 const dispatched=await apiPost(`/transfers/${transfer.body.id}/status`,{revision:0,action:'dispatch',confirm:true});expect(dispatched.status).toBe(200);
 const blocked=await apiGet('/operations/fifo-review');expect(blocked.body.inTransit).toBe(1);
 expect((await apiPost('/operations/fifo-activate',{snapshot:blocked.body.snapshot,confirmed:true,lines:blocked.body.lines.map((l:any)=>({balanceId:l.balanceId,unitCost:'5'}))})).body.error.code).toBe('FIFO_TRANSFERS_OPEN');
 expect((await apiPost(`/transfers/${transfer.body.id}/events`,{clientKey:randomUUID(),revision:dispatched.body.revision,kind:'RETURN',reason:'Resolve before activation',confirm:true,lines:[{lineId:dispatched.body.lines[0].id,quantity:'1'}]})).status).toBe(200);
 const before=await apiGet('/operations/fifo-review');expect(before.status).toBe(200);expect(before.body.activeSince).toBeNull();
 const input={snapshot:before.body.snapshot,confirmed:true,lines:before.body.lines.map((l:any)=>({balanceId:l.balanceId,unitCost:'5'}))};
 expect((await apiPost('/operations/fifo-activate',{...input,lines:[]})).status).toBe(422);
 expect((await apiPost('/operations/fifo-activate',{...input,confirmed:false})).status).toBe(422);
 expect((await apiPost('/operations/fifo-activate',{...input,lines:[...input.lines,...input.lines]})).status).toBe(422);
 expect((await apiPost('/operations/fifo-activate',{...input,lines:input.lines.map((l:any)=>({...l,unitCost:'-1'}))})).status).toBe(422);
 expect((await apiPost('/operations/fifo-activate',{...input,snapshot:'0'.repeat(64)})).status).toBe(409);
 expect((await apiPost('/operations/fifo-activate',input,cashier)).status).toBe(403);
 const pair=await Promise.all([apiPost('/operations/fifo-activate',input),apiPost('/operations/fifo-activate',input)]);expect(pair.map(r=>r.status)).toEqual([200,200]);
 expect(await db.fifoLayer.count({where:{businessId:business}})).toBe(1);expect(await db.authAudit.count({where:{businessId:business,action:'inventory.fifo_activated'}})).toBe(1);expect(await stock(source)).toBe('1000.0000');
});
it('uses oldest costs across receipts, snapshots COGS, and hides costs from cashier',async()=>{
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:product,delta:'10',unitCost:'7',type:'TEST_RECEIPT',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'later purchase',actorId:owner.user.id,notes:''}));
 const d=await draft({lines:[{productId:product,quantity:'1005'}]},cashier);const input=checkoutBody(d),r=await checkout(d,input,cashier);expect(r.status,r.text).toBe(200);sold=r.body;
 expect(r.text).not.toContain('costAmount');expect(r.text).not.toContain('unitCost');
 const line=await db.saleLine.findFirstOrThrow({where:{saleId:d.id}});expect(line.costAmount?.toFixed(4)).toBe('5035.0000');
 expect((await checkout(d,input,cashier)).status).toBe(200);expect(await stock(source)).toBe('5.0000');
 const today=new Date().toISOString().slice(0,10),summary=await apiGet(`/workflows/reports?view=summary&from=${today}&to=${today}`);expect(summary.body.estimatedCost).toBe('5035.0000');
 const stockReport=await apiGet(`/workflows/reports?view=stock&from=${today}&to=${today}`);expect(stockReport.body.items[0].estimatedValue).toBe('35.0000');
 const movements=await apiGet(`/operations/inventory?view=movements&locationId=${source}`);expect(movements.text).not.toContain('costLayers');
});
it('restores original FIFO costs on partial returns and ignores later catalogue price changes',async()=>{
 await db.product.update({where:{id:product},data:{purchasePrice:'99'}});
 const r=await apiPost('/workflows/adjustments',{clientKey:randomUUID(),kind:'CUSTOMER_RETURN',locationId:source,sourceId:sold.id,reason:'Customer returned goods',lines:[{productId:product,sourceLineId:sold.lines[0].id,quantity:'3',condition:'RESTOCK'}]});expect(r.status,r.text).toBe(201);
 const confirmed=await apiPost(`/workflows/adjustments/${r.body.id}/status`,{revision:0,action:'confirm',confirm:true});expect(confirmed.status,confirmed.text).toBe(200);expect(confirmed.body.lines[0].costAmount).toBe('15');
 const d=await draft({lines:[{productId:product,quantity:'4'}]});expect((await checkout(d)).status).toBe(200);
 expect((await db.saleLine.findFirstOrThrow({where:{saleId:d.id}})).costAmount?.toFixed(4)).toBe('22.0000');
});
it('carries FIFO costs through partial transfer receipt, return and loss',async()=>{
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:product,delta:'10',unitCost:'9',type:'TEST_RECEIPT',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'new purchase',actorId:owner.user.id,notes:''}));
 const made=await apiPost('/transfers',{clientKey:randomUUID(),sourceId:source,destinationId:destination,lines:[{productId:product,quantity:'8'}]});expect(made.status,made.text).toBe(201);
 let t=(await apiPost(`/transfers/${made.body.id}/status`,{revision:0,action:'dispatch',confirm:true})).body;expect(t.status).toBe('IN_TRANSIT');
 for(const [kind,quantity] of [['RECEIVE','3'],['RETURN','2'],['LOSS','3']]){const r=await apiPost(`/transfers/${t.id}/events`,{clientKey:randomUUID(),revision:t.revision,kind,reason:'FIFO test reconciliation',confirm:true,lines:[{lineId:t.lines[0].id,quantity}]});expect(r.status,r.text).toBe(200);t=r.body.transfer;}
 const losses=await db.transferEventLine.findMany({where:{businessId:business,event:{kind:'LOSS'}}});expect(losses[0]?.costAmount?.toFixed(4)).toBe('27.0000');
 const layers=await db.fifoLayer.findMany({where:{businessId:business,locationId:destination,remaining:{gt:0}}});expect(layers.map(l=>[l.remaining.toFixed(4),l.unitCost.toFixed(4)])).toEqual([['3.0000','7.0000']]);
});
it('serializes competing checkouts without consuming layers twice or inventing stock',async()=>{
 const available=await stock(source);const one=await draft({lines:[{productId:product,quantity:available}]}),two=await draft({lines:[{productId:product,quantity:available}]});const results=await Promise.all([checkout(one),checkout(two)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(await stock(source)).toBe('0.0000');expect(await db.fifoLayer.count({where:{businessId:business,locationId:source,remaining:{gt:0}}})).toBe(0);
});

it('uses confirmed purchase costs and FIFO damage costs independently of catalogue prices',async()=>{
 const p=await funded('10');
 const supplier=await apiPost('/operations/suppliers',{code:'FIFO-SUP',name:'FIFO supplier'});expect(supplier.status,supplier.text).toBe(201);
 let receipt=await apiPost('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:source,supplierId:supplier.body.id,documentDate:new Date().toISOString().slice(0,10),lines:[{productId:p,quantity:'10',unitCost:'4'}]});expect(receipt.status,receipt.text).toBe(201);
 for(const action of ['submit','confirm']){receipt=await apiPost(`/operations/purchases/${receipt.body.id}/status`,{revision:receipt.body.revision,action,confirm:true});expect(receipt.status,receipt.text).toBe(200);}
 const d=await draft({lines:[{productId:p,quantity:'15'}]});expect((await checkout(d)).status).toBe(200);expect((await db.saleLine.findFirstOrThrow({where:{saleId:d.id}})).costAmount?.toFixed(4)).toBe('40.0000');
 const adjustment=await apiPost('/workflows/adjustments',{clientKey:randomUUID(),kind:'DAMAGE',locationId:source,reason:'Damaged merchandise',lines:[{productId:p,quantity:'2'}]});expect(adjustment.status,adjustment.text).toBe(201);
 const confirmed=await apiPost(`/workflows/adjustments/${adjustment.body.id}/status`,{revision:0,action:'confirm',confirm:true});expect(confirmed.status,confirmed.text).toBe(200);expect(confirmed.body.lines[0].costAmount).toBe('8');
 const supplierReturn=await apiPost('/workflows/adjustments',{clientKey:randomUUID(),kind:'SUPPLIER_RETURN',locationId:source,sourceId:receipt.body.id,reason:'Return purchased items',lines:[{productId:p,sourceLineId:receipt.body.lines[0].id,quantity:'1'}]});expect(supplierReturn.status,supplierReturn.text).toBe(201);
 const returned=await apiPost(`/workflows/adjustments/${supplierReturn.body.id}/status`,{revision:0,action:'confirm',confirm:true});expect(returned.status,returned.text).toBe(200);expect(returned.body.lines[0].costAmount).toBe('4');
 const remaining=await db.fifoLayer.findMany({where:{businessId:business,productId:p,remaining:{gt:0}}});expect(remaining.map(l=>[l.remaining.toFixed(4),l.unitCost.toFixed(4)])).toEqual([['2.0000','4.0000']]);
});
it('conserves cents when a receipt is sold in fractional quantities and returned in parts',async()=>{
 const p=await db.product.create({data:{businessId:business,sku:'FIFO-FRACTION',name:'Fractional item',unit:'PIECE',purchasePrice:'0.01',sellingPrice:'1'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:p.id,delta:'1',unitCost:'0.01',type:'TEST_RECEIPT',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'One cent opening',actorId:owner.user.id,notes:''}));
 const amounts:string[]=[];
 for(const quantity of ['0.3333','0.3333','0.3334']){const d=await draft({lines:[{productId:p.id,quantity}]});expect((await checkout(d)).status).toBe(200);amounts.push((await db.saleLine.findFirstOrThrow({where:{saleId:d.id}})).costAmount!.toFixed(4));}
 expect(amounts).toEqual(['0.0000','0.0100','0.0000']);
 const layers=await db.fifoLayer.findMany({where:{businessId:business,productId:p.id}});expect(layers[0]?.remainingCost.toFixed(4)).toBe('0.0000');expect(layers[0]?.remaining.toFixed(4)).toBe('0.0000');
 const p2=await db.product.create({data:{businessId:business,sku:'FIFO-RET-CENTS',name:'Return rounding',unit:'PIECE',purchasePrice:'0.3333',sellingPrice:'1'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:p2.id,delta:'3',unitCost:'0.3333',type:'TEST_RECEIPT',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'Dollar layer',actorId:owner.user.id,notes:''}));
 const d=await draft({lines:[{productId:p2.id,quantity:'3'}]});const sale=await checkout(d);expect(sale.status).toBe(200);
 const costs=[];for(let i=0;i<3;i++){const r=await apiPost('/workflows/adjustments',{clientKey:randomUUID(),kind:'CUSTOMER_RETURN',locationId:source,sourceId:d.id,reason:'Return individual unit',lines:[{productId:p2.id,sourceLineId:sale.body.lines[0].id,quantity:'1',condition:'RESTOCK'}]});expect(r.status,r.text).toBe(201);const done=await apiPost(`/workflows/adjustments/${r.body.id}/status`,{revision:0,action:'confirm',confirm:true});expect(done.status,done.text).toBe(200);costs.push(done.body.lines[0].costAmount);}
 expect(costs).toEqual(['0.33','0.34','0.33']);
 const restored=await db.fifoLayer.aggregate({where:{businessId:business,productId:p2.id},_sum:{remainingCost:true}});expect(restored._sum.remainingCost?.toFixed(4)).toBe('1.0000');
});
it('allows activation retries and status review after an activated business grows past 1,000 stock rows',async()=>{
 const root=`/api/businesses/${other}/operations`;
 const review=()=>request(app).get(root+'/fifo-review').set('Cookie',cookie(foreign));
 const activate=(input:object)=>request(app).post(root+'/fifo-activate').set('Cookie',cookie(foreign)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,foreign.token)).send(input);
 const first=await review(),input={snapshot:first.body.snapshot,confirmed:true,lines:[]};expect((await activate(input)).status).toBe(200);
 const products=Array.from({length:1001},(_,i)=>({id:randomUUID(),businessId:other,sku:`GROW-${i}`,name:'Growth item '+i,unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}));
 await db.product.createMany({data:products});await db.stockBalance.createMany({data:products.map(p=>({businessId:other,locationId:foreignLocation,productId:p.id,onHand:'1'}))});
 await db.fifoLayer.createMany({data:products.map(p=>({businessId:other,locationId:foreignLocation,productId:p.id,quantity:'1',remaining:'1',unitCost:'1',totalCost:'1',remainingCost:'1',acquiredAt:new Date(),originId:p.id}))});
 expect((await activate(input)).status).toBe(200);expect((await review()).status).toBe(200);expect(await db.fifoLayer.count({where:{businessId:other}})).toBe(1001);
});

async function supplierVarianceFixture(openingCost:string,receiptCost:string,quantity='3'){
 const p=await db.product.create({data:{businessId:business,sku:`VAR-${randomUUID().slice(0,8).toUpperCase()}`,name:'Supplier return variance',unit:'PIECE',purchasePrice:'99',sellingPrice:'100'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:p.id,delta:quantity,unitCost:openingCost,type:'TEST_RECEIPT',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'Older cost layer',actorId:owner.user.id,notes:''}));
 const supplier=await apiPost('/operations/suppliers',{code:`VAR-${randomUUID().slice(0,8).toUpperCase()}`,name:'Variance supplier'});expect(supplier.status,supplier.text).toBe(201);
 let receipt=await apiPost('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:source,supplierId:supplier.body.id,documentDate:new Date().toISOString().slice(0,10),lines:[{productId:p.id,quantity,unitCost:receiptCost}]});expect(receipt.status,receipt.text).toBe(201);
 for(const action of ['submit','confirm']){receipt=await apiPost(`/operations/purchases/${receipt.body.id}/status`,{revision:receipt.body.revision,action,confirm:true});expect(receipt.status,receipt.text).toBe(200);}
 return {p,receipt:receipt.body};
}
async function supplierVarianceReturn(fixture:Awaited<ReturnType<typeof supplierVarianceFixture>>,quantity:string){
 const {p,receipt}=fixture;
 const made=await apiPost('/workflows/adjustments',{clientKey:randomUUID(),kind:'SUPPLIER_RETURN',locationId:source,sourceId:receipt.id,reason:'Return against confirmed supplier receipt',lines:[{productId:p.id,sourceLineId:receipt.lines[0].id,quantity}]});expect(made.status,made.text).toBe(201);
 const done=await apiPost(`/workflows/adjustments/${made.body.id}/status`,{revision:0,action:'confirm',confirm:true});expect(done.status,done.text).toBe(200);return done.body;
}
const summaryToday=(suffix='',who=owner)=>{const day=new Date().toISOString().slice(0,10);return apiGet(`/workflows/reports?view=summary&from=${day}&to=${day}${suffix}`,who);};
it('reconciles positive and negative supplier return FIFO variances into net profit without changing gross profit',async()=>{
 for(const [openingCost,receiptCost,expected] of [['2','10',8],['10','2',-8]] as const){
  const fixture=await supplierVarianceFixture(openingCost,receiptCost),before=await summaryToday();expect(before.status).toBe(200);
  const done=await supplierVarianceReturn(fixture,'1');expect(done.lines[0].costAmount).toBe(openingCost);expect(done.total).toBe(receiptCost);
  const after=await summaryToday();expect(after.status).toBe(200);
  expect(Number(after.body.supplierReturnAdjustment)-Number(before.body.supplierReturnAdjustment)).toBeCloseTo(expected,4);
  expect(Number(after.body.estimatedProfit)-Number(before.body.estimatedProfit)).toBeCloseTo(expected,4);expect(after.body.grossProfit).toBe(before.body.grossProfit);expect(after.body.estimatedCost).toBe(before.body.estimatedCost);
  const inventory=await db.fifoLayer.aggregate({where:{businessId:business,productId:fixture.p.id},_sum:{remainingCost:true}});expect(Number(inventory._sum.remainingCost)).toBe(Number(openingCost)*2+Number(receiptCost)*3);
  expect((await apiPost(`/workflows/adjustments/${done.id}/status`,{revision:0,action:'confirm',confirm:true})).status).toBe(200);expect((await summaryToday()).body.supplierReturnAdjustment).toBe(after.body.supplierReturnAdjustment);
 }
});
it('conserves supplier-return cents across partial returns and scopes the variance by date, location and cost permission',async()=>{
 const fixture=await supplierVarianceFixture('0.3333','1'),before=await summaryToday(),destinationBefore=await summaryToday(`&locationId=${destination}`),costs=[];
 for(let i=0;i<3;i++)costs.push((await supplierVarianceReturn(fixture,'1')).lines[0].costAmount);
 expect(costs).toEqual(['0.33','0.34','0.33']);
 const after=await summaryToday(),sourceReport=await summaryToday(`&locationId=${source}`),destinationAfter=await summaryToday(`&locationId=${destination}`);
 expect(Number(after.body.supplierReturnAdjustment)-Number(before.body.supplierReturnAdjustment)).toBeCloseTo(2,4);expect(Number(after.body.estimatedProfit)-Number(before.body.estimatedProfit)).toBeCloseTo(2,4);
 expect(sourceReport.body.supplierReturnAdjustment).toBe(after.body.supplierReturnAdjustment);expect(destinationAfter.body.supplierReturnAdjustment).toBe(destinationBefore.body.supplierReturnAdjustment);
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10),future=await apiGet(`/workflows/reports?view=summary&from=${tomorrow}&to=${tomorrow}`);expect(future.status).toBe(200);expect(future.body.supplierReturnAdjustment).toBe('0.0000');
 expect((await summaryToday('',foreign)).status).toBe(403);expect((await summaryToday('',admin)).status).toBe(403);
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:cashier.user.id}}});
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'reports.view':true,'payments.view':true}}});
 try{const hidden=await summaryToday('',cashier);expect(hidden.status,hidden.text).toBe(200);expect(hidden.body).not.toHaveProperty('supplierReturnAdjustment');expect(hidden.body).not.toHaveProperty('estimatedProfit');}finally{await db.membership.update({where:{id:member.id},data:{permissionOverrides:{}}});}
});
it('preserves historical non-FIFO supplier returns without inventing a valuation adjustment',async()=>{
 const b=(await db.business.create({data:{name:'Legacy supplier return audit'}})).id;bids.push(b);await db.businessSubscription.create({data:{businessId:b,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const loc=(await db.location.create({data:{businessId:b,code:'LEGACY',name:'Legacy shop',kind:'SHOP'}})).id,who=await actor('OWNER',b),p=await db.product.create({data:{businessId:b,sku:'LEGACY',name:'Legacy item',unit:'PIECE',purchasePrice:'2',sellingPrice:'12'}});
 const req=(path:string,input?:object)=>input===undefined?request(app).get(`/api/businesses/${b}${path}`).set('Cookie',cookie(who)):request(app).post(`/api/businesses/${b}${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(input);
 const supplier=await req('/operations/suppliers',{code:'LEGACY',name:'Legacy supplier'});expect(supplier.status).toBe(201);
 let receipt=await req('/operations/purchases',{clientKey:randomUUID(),kind:'RECEIPT',locationId:loc,supplierId:supplier.body.id,documentDate:new Date().toISOString().slice(0,10),lines:[{productId:p.id,quantity:'3',unitCost:'10'}]});expect(receipt.status).toBe(201);
 for(const action of ['submit','confirm']){receipt=await req(`/operations/purchases/${receipt.body.id}/status`,{revision:receipt.body.revision,action,confirm:true});expect(receipt.status).toBe(200);}
 const made=await req('/workflows/adjustments',{clientKey:randomUUID(),kind:'SUPPLIER_RETURN',locationId:loc,sourceId:receipt.body.id,reason:'Historical supplier return',lines:[{productId:p.id,sourceLineId:receipt.body.lines[0].id,quantity:'1'}]});expect(made.status).toBe(201);
 const done=await req(`/workflows/adjustments/${made.body.id}/status`,{revision:0,action:'confirm',confirm:true});expect(done.status).toBe(200);expect(done.body.lines[0].costAmount).toBeNull();
 const day=new Date().toISOString().slice(0,10),report=await req(`/workflows/reports?view=summary&from=${day}&to=${day}`);expect(report.status).toBe(200);expect(report.body.supplierReturnAdjustment).toBe('0.0000');expect(report.body.estimatedProfit).toBe('0.0000');
});
