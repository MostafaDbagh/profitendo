import express from 'express';
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
it('reconciles a packed purchase, partial deliveries/transfers, taxed mixed payments, refunds, damage, count and cash close',async()=>{
 const day=new Date().toISOString().slice(0,10);
 const warehouse=await db.location.create({data:{businessId:business,code:'AUDIT-WH',name:'Audit warehouse',kind:'WAREHOUSE'}});
 const shop=await db.location.create({data:{businessId:business,code:'AUDIT-SH',name:'Audit shop',kind:'SHOP'}});
 const p=await db.product.create({data:{businessId:business,sku:'AUDIT-SIX',name:'Six-pack product',unit:'PIECE',purchasePrice:'2',sellingPrice:'5'}});
 const pack=await db.productPack.create({data:{businessId:business,productId:p.id,name:'Box of six',baseQuantity:'6'}});
 const supplier=await db.supplier.create({data:{businessId:business,code:'AUDIT-SUP',name:'Audit supplier'}});
 await db.business.update({where:{id:business},data:{salesTaxRate:'5'}});
 const ok=(r:request.Response,status=200)=>{expect(r.status,r.text).toBe(status);return r.body;};
 async function checkpoint(wh:number,sh:number){for(const [locationId,expected] of [[warehouse.id,wh],[shop.id,sh]] as const){expect(Number(await stock(locationId,p.id))).toBe(expected);const ledger=await db.stockMovement.aggregate({where:{businessId:business,locationId,productId:p.id},_sum:{quantity:true}});expect(Number(ledger._sum.quantity??0)).toBe(expected);}}
 async function purchase(kind:string,quantity:string,orderId?:string){return ok(await api('/operations/purchases',{clientKey:randomUUID(),kind,locationId:warehouse.id,supplierId:supplier.id,documentDate:day,...(orderId?{orderId}:{}),lines:[{productId:p.id,packId:pack.id,quantity,unitCost:'2'}]}),201);}
 async function transition(d:any,action:string){return ok(await api(`/operations/purchases/${d.id}/status`,{revision:d.revision,action,confirm:true}));}
 const order=await transition(await purchase('ORDER','10'),'submit');await checkpoint(0,0);
 const first=await transition(await transition(await purchase('RECEIPT','4',order.id),'submit'),'confirm');await checkpoint(24,0);
 expect((await db.purchaseDocument.findUniqueOrThrow({where:{id:order.id}})).status).toBe('PARTIAL');
 const second=await transition(await transition(await purchase('RECEIPT','6',order.id),'submit'),'confirm');await checkpoint(60,0);
 expect((await db.purchaseDocument.findUniqueOrThrow({where:{id:order.id}})).status).toBe('RECEIVED');
 for(const [receipt,amount] of [[first,'48'],[second,'72']] as const)ok(await pay('SUPPLIER_PAYMENT',amount,{locationId:warehouse.id,sourceId:receipt.id,method:'TRANSFER'}),201);
 const supplierReturn=await adjustment('SUPPLIER_RETURN',[{productId:p.id,sourceLineId:first.lines[0].id,quantity:'6'}],{locationId:warehouse.id,sourceId:first.id});ok(await approve(supplierReturn));await checkpoint(54,0);
 expect(Number(ok(await get(`/balances/${first.id}?kind=SUPPLIER`)).refundDue)).toBe(12);
 ok(await pay('SUPPLIER_REFUND','12',{locationId:warehouse.id,sourceId:first.id,method:'TRANSFER'}),201);
 const settled=ok(await get(`/balances/${first.id}?kind=SUPPLIER`));expect(Number(settled.outstanding)).toBe(0);expect(Number(settled.refundDue)).toBe(0);
 let transfer=ok(await api('/transfers',{clientKey:randomUUID(),sourceId:warehouse.id,destinationId:shop.id,lines:[{productId:p.id,quantity:'18'}]}),201);
 transfer=ok(await api(`/transfers/${transfer.id}/status`,{revision:0,action:'dispatch',confirm:true}));await checkpoint(36,0);
 for(const [kind,quantity,wh,sh] of [['RECEIVE','12',36,12],['RECEIVE','3',36,15],['RETURN','2',38,15],['LOSS','1',38,15]] as const){
  const event={clientKey:randomUUID(),revision:transfer.revision,kind,reason:'Audit shipment resolution',confirm:true,lines:[{lineId:transfer.lines[0].id,quantity}]};
  const result=ok(await api(`/transfers/${transfer.id}/events`,event));transfer=result.transfer;
  expect(ok(await api(`/transfers/${transfer.id}/events`,event)).eventId).toBe(result.eventId);await checkpoint(wh,sh);
 }
 expect(transfer.status).toBe('COMPLETED');expect(Number(transfer.lines[0].inTransit)).toBe(0);
 const lossReport=ok(await get(`/reports?from=${day}&to=${day}&locationId=${warehouse.id}`));expect(Number(lossReport.estimatedProfit)).toBe(-2);
 async function sell(method:string,quantity:string,packed=false){const d=ok(await api('/sales',{clientKey:randomUUID(),locationId:shop.id,lines:[{productId:p.id,quantity,...(packed?{packId:pack.id,discount:'3',discountReason:'Audit pack discount'}:{})}]}),201);return ok(await api(`/sales/${d.id}/checkout`,{clientKey:randomUUID(),revision:d.revision,expectedTotal:d.total,confirm:true,payment:{method,received:method==='CASH'?'30':d.total,reference:method==='CASH'?'':'Audit terminal'}}));}
 const cash=await sell('CASH','1',true);expect(Number(cash.total)).toBe(28.35);expect(Number(cash.payment.change)).toBe(1.65);await checkpoint(38,9);
 const card=await sell('CARD','2');expect(Number(card.total)).toBe(10.5);await checkpoint(38,7);
 const bank=await sell('TRANSFER','1');expect(Number(bank.total)).toBe(5.25);await checkpoint(38,6);
 for(const [sale,quantity,condition,method,expected] of [[cash,'2','RESTOCK','CASH',9.45],[card,'1','DAMAGED','CARD',5.25]] as const){
  const returned=ok(await approve(await adjustment('CUSTOMER_RETURN',[{productId:p.id,sourceLineId:sale.lines[0].id,quantity,condition}],{locationId:shop.id,sourceId:sale.id})));expect(Number(returned.total)).toBe(expected);
  const key=randomUUID(),input={locationId:shop.id,sourceId:returned.id,method,clientKey:key};
  const payment=ok(await pay('CUSTOMER_REFUND',String(expected),input),201);expect(ok(await pay('CUSTOMER_REFUND',String(expected),input),201).id).toBe(payment.id);
  expect(Number(ok(await get(`/balances/${returned.id}?kind=CUSTOMER`)).outstanding)).toBe(0);await checkpoint(38,8);
 }
 ok(await approve(await adjustment('DAMAGE',[{productId:p.id,quantity:'1'}],{locationId:shop.id})));await checkpoint(38,7);
 ok(await approve(await adjustment('COUNT',[{productId:p.id,quantity:'6'}],{locationId:shop.id})));await checkpoint(38,6);
 ok(await pay('EXPENSE','2',{locationId:shop.id,method:'CASH'}),201);
 const report=ok(await get(`/reports?from=${day}&to=${day}&locationId=${shop.id}`));
 expect(report).toMatchObject({sales:'44.1000',customerReturns:'14.7000',netSales:'29.4000',estimatedCost:'14.0000',damageCost:'2.0000',countAdjustmentValue:'-2.0000',expenses:'2.0000',estimatedProfit:'8.0000'});
 const drawer=ok(await get(`/cash?locationId=${shop.id}&day=${day}`));expect(drawer).toMatchObject({inflow:'28.3500',outflow:'11.4500'});
 const close={locationId:shop.id,day,opening:'50',counted:'66.90',expected:'66.90',reason:'Reconciled audit drawer',confirm:true};const closed=ok(await write('/cash',close));expect(Number(closed.variance)).toBe(0);expect(ok(await write('/cash',close)).id).toBe(closed.id);
 expect((await pay('EXPENSE','1',{locationId:shop.id,method:'CASH'})).body.error.code).toBe('CASH_DAY_CLOSED');await checkpoint(38,6);
 await db.business.update({where:{id:business},data:{salesTaxRate:'0'}});
});

it('survives a lost checkout response and retries without duplicate stock, payment or audit entries',async()=>{
 const p=await funded('5');const d=(await api('/sales',{clientKey:randomUUID(),locationId:source,lines:[{productId:p,quantity:'2'}]})).body;
 const input={clientKey:randomUUID(),revision:d.revision,expectedTotal:d.total,confirm:true,payment:{method:'CARD',received:d.total,reference:'Lost response terminal'}};
 let committedResponse=false;
 const disconnected=express();disconnected.use((_req,res,next)=>{res.json=function(body){committedResponse=res.statusCode===200;res.socket?.destroy();return res;};next();});disconnected.use(app);
 await expect(request(disconnected).post(`/api/businesses/${business}/sales/${d.id}/checkout`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send(input)).rejects.toThrow();
 expect(committedResponse).toBe(true);
 const retries=await Promise.all(Array.from({length:8},()=>api(`/sales/${d.id}/checkout`,input)));
 for(const r of retries){expect(r.status,r.text).toBe(200);expect(r.body.id).toBe(d.id);}
 expect(await stock(source,p)).toBe('3.0000');expect(await db.salePayment.count({where:{saleId:d.id}})).toBe(1);expect(await db.stockMovement.count({where:{sourceId:d.id,type:'SALE'}})).toBe(1);expect(await db.authAudit.count({where:{targetId:d.id,action:'sale.completed'}})).toBe(1);
 const altered=await api(`/sales/${d.id}/checkout`,{...input,payment:{...input.payment,reference:'Changed retry'}});expect(altered.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
});

it('multiple cashiers racing for three remaining units never oversell, including duplicate retry bursts',async()=>{
 for(let round=0;round<5;round++){
  const p=await funded('3');const drafts:Array<{who:AuthContext;d:{id:string;revision:number;total:string};key:string}>=[];
  for(let i=0;i<8;i++){const who=i%2?cashier:secondCashier,r=await api('/sales',{clientKey:randomUUID(),locationId:source,lines:[{productId:p,quantity:'1'}]},who);expect(r.status,r.text).toBe(201);drafts.push({who,d:r.body,key:randomUUID()});}
  const checkout=({who,d,key}:typeof drafts[number])=>api(`/sales/${d.id}/checkout`,{clientKey:key,revision:d.revision,expectedTotal:d.total,confirm:true,payment:{method:'CARD',received:d.total,reference:'Concurrent terminal'}},who);
  const results=await Promise.all(drafts.map(checkout));expect(results.filter(r=>r.status===200)).toHaveLength(3);expect(results.filter(r=>r.status===409)).toHaveLength(5);
  const replay=await Promise.all(drafts.map(checkout));expect(replay.map(r=>r.status)).toEqual(results.map(r=>r.status));
  expect(await stock(source,p)).toBe('0.0000');expect(await db.salePayment.count({where:{saleId:{in:drafts.map(x=>x.d.id)}}})).toBe(3);
  const movements=await db.stockMovement.aggregate({where:{productId:p,businessId:business},_sum:{quantity:true}});expect(Number(movements._sum.quantity)).toBe(0);
 }
},30000);

it('selling and dispatching the same last units race atomically across services',async()=>{
 for(let round=0;round<5;round++){
  const p=await funded('2');const d=(await api('/sales',{clientKey:randomUUID(),locationId:source,lines:[{productId:p,quantity:'2'}]})).body;
  const t=(await api('/transfers',{clientKey:randomUUID(),sourceId:source,destinationId:destination,lines:[{productId:p,quantity:'2'}]})).body;
  const results=await Promise.all([api(`/sales/${d.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:d.total,confirm:true,payment:{method:'CARD',received:d.total,reference:'Cross service race'}}),api(`/transfers/${t.id}/status`,{revision:0,action:'dispatch',confirm:true})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(await stock(source,p)).toBe('0.0000');expect(await stock(destination,p)).toBe('0.0000');
  expect(await db.stockMovement.count({where:{productId:p,type:{in:['SALE','TRANSFER_OUT']}}})).toBe(1);
  expect(await db.salePayment.count({where:{saleId:d.id}})).toBe(results[0]!.status===200?1:0);
 }
},30000);

it('allocates tiny discounted tax-inclusive returns without losing cents or refunding tax above the returned amount',async()=>{
 try{
  await db.business.update({where:{id:business},data:{salesTaxRate:'5'}});
  const sale=await sold('17','0.0171'),line=sale.lines[0];expect(Number(sale.total)).toBe(0.30);expect(Number(sale.tax)).toBe(0.01);
  let total=0,tax=0;
  for(let i=0;i<17;i++){
   const d=await adjustment('CUSTOMER_RETURN',[{productId:line.productId,sourceLineId:line.id,quantity:'1'}],{sourceId:sale.id});const done=await approve(d);expect(done.status,done.text).toBe(200);
   const amountCents=Math.round(Number(done.body.total)*100),taxCents=Math.round(Number(done.body.lines[0].tax)*100);expect(taxCents).toBeGreaterThanOrEqual(0);expect(taxCents).toBeLessThanOrEqual(amountCents);total+=amountCents;tax+=taxCents;
  }
  expect(total).toBe(30);expect(tax).toBe(1);expect(await stock(source,line.productId)).toBe('100.0000');
 }finally{await db.business.update({where:{id:business},data:{salesTaxRate:'0'}});}
});

it('replays a supplier payment after its response is lost without paying the invoice twice',async()=>{
 const r=await receipt(),input={clientKey:randomUUID(),kind:'SUPPLIER_PAYMENT',locationId:source,sourceId:r.id,amount:'100',method:'TRANSFER',reference:'Wire audit',reason:'Audit supplier settlement',confirm:true};
 let committed=false;const disconnected=express();disconnected.use((_req,res,next)=>{res.json=function(body){committed=res.statusCode===201;res.socket?.destroy();return res;};next();});disconnected.use(app);
 await expect(request(disconnected).post(`/api/businesses/${business}/workflows/payments`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send(input)).rejects.toThrow();expect(committed).toBe(true);
 const results=await Promise.all(Array.from({length:8},()=>write('/payments',input)));for(const result of results)expect(result.status,result.text).toBe(201);
 expect(new Set(results.map(result=>result.body.id)).size).toBe(1);expect(await db.moneyEntry.count({where:{sourceId:r.id,kind:'SUPPLIER_PAYMENT'}})).toBe(1);
 const balance=await get(`/balances/${r.id}?kind=SUPPLIER`);expect(balance.status).toBe(200);expect(Number(balance.body.outstanding)).toBe(0);expect(Number(balance.body.paid)).toBe(100);
});

it('snapshots transit-loss cost, scopes it to the source, hides costs from staff, and flags unknown historical values',async()=>{
 const day=new Date().toISOString().slice(0,10),path=`/reports?from=${day}&to=${day}`;
 const before=await get(path),destinationBefore=await get(`${path}&locationId=${destination}`);
 const p=await funded('2'),draft=(await api('/transfers',{clientKey:randomUUID(),sourceId:source,destinationId:destination,lines:[{productId:p,quantity:'2'}]})).body;
 const dispatched=await api(`/transfers/${draft.id}/status`,{revision:0,action:'dispatch',confirm:true});expect(dispatched.status).toBe(200);
 const event=await api(`/transfers/${draft.id}/events`,{clientKey:randomUUID(),revision:dispatched.body.revision,kind:'LOSS',reason:'Damaged while in transit',confirm:true,lines:[{lineId:draft.lines[0].id,quantity:'1'}]});expect(event.status,event.text).toBe(200);
 const after=await get(path);expect(Number(before.body.estimatedProfit)-Number(after.body.estimatedProfit)).toBeCloseTo(9.88,4);
 const destinationAfter=await get(`${path}&locationId=${destination}`);expect(destinationAfter.body.estimatedProfit).toBe(destinationBefore.body.estimatedProfit);
 await db.product.update({where:{id:p},data:{purchasePrice:'99'}});expect((await get(path)).body.estimatedProfit).toBe(after.body.estimatedProfit);
 const history=await request(app).get(`/api/businesses/${business}/transfers/${draft.id}/events`).set('Cookie',cookie(owner));expect(history.status,history.text).toBe(200);expect(history.text).not.toContain('unitCost');
 await db.membership.updateMany({where:{businessId:business,userId:cashier.user.id},data:{permissionOverrides:{'reports.view':true,'payments.view':true}}});
 const staff=await get(path,cashier);expect(staff.status,staff.text).toBe(200);expect(staff.body).not.toHaveProperty('transferLossCost');expect(staff.body).not.toHaveProperty('estimatedProfit');
 // Simulate a row created before the cost-snapshot migration. Never invent its value.
 await db.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines DISABLE TRIGGER transfer_event_lines_immutable');await tx.transferEventLine.updateMany({where:{eventId:event.body.eventId},data:{unitCost:null}});await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines ENABLE TRIGGER transfer_event_lines_immutable');});
 const historical=await get(path);expect(historical.body.estimatedProfit).toBeNull();expect(historical.body.unvaluedTransferLosses).toBe(1);expect(historical.body.sales).toBe(after.body.sales);
 expect((await get(`${path}&locationId=${destination}`)).body.estimatedProfit).toBe(destinationBefore.body.estimatedProfit);
});

it.each([['0.005','0.0200'],['0.3333','1.0000']])('fully restocking split returns exactly reverses rounded cost %s',async(unitCost,expectedCost)=>{
 const location=await db.location.create({data:{businessId:business,code:`COST-${randomUUID().slice(0,6).toUpperCase()}`,name:'Cost rounding audit',kind:'SHOP'}});
 const p=await funded('3');await db.product.update({where:{id:p},data:{purchasePrice:unitCost,sellingPrice:'1'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:location.id,productId:p,delta:'3',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'cost audit',actorId:owner.user.id,notes:''}));
 const draft=await api('/sales',{clientKey:randomUUID(),locationId:location.id,lines:[{productId:p,quantity:'3'}]});expect(draft.status,draft.text).toBe(201);
 const sale=await api(`/sales/${draft.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:draft.body.total,payment:{method:'CARD',received:draft.body.total,reference:'Cost audit'},confirm:true});expect(sale.status,sale.text).toBe(200);
 const day=new Date().toISOString().slice(0,10),path=`/reports?from=${day}&to=${day}&locationId=${location.id}`;
 expect((await get(path)).body.estimatedCost).toBe(expectedCost);
 const returnedAt:Date[]=[];
 for(let i=0;i<3;i++){const d=await adjustment('CUSTOMER_RETURN',[{productId:p,sourceLineId:sale.body.lines[0].id,quantity:'1',condition:'RESTOCK'}],{locationId:location.id,sourceId:sale.body.id});const result=await approve(d);expect(result.status,result.text).toBe(200);returnedAt.push(new Date(result.body.completedAt));}
 const summary=(await get(path)).body;expect(summary.estimatedCost).toBe('0.0000');expect(summary.grossProfit).toBe('0.0000');expect(summary.estimatedProfit).toBe('0.0000');
 const {summaryTotals}=await import('../src/reports/service.js');
 const first=await auth.transaction(tx=>summaryTotals(tx,business,{gte:new Date(0),lt:returnedAt[1]!},{locationId:location.id},2));
 const later=await auth.transaction(tx=>summaryTotals(tx,business,{gte:returnedAt[1]!,lt:new Date(Date.now()+1000)},{locationId:location.id},2));
 expect(Number(first.estimatedCost)+Number(later.estimatedCost)).toBe(0);
 expect(later.estimatedCost).toBe(unitCost==='0.005'?'-0.0100':'-0.6700');

});

it('keeps damaged return cost while allocating the restocked remainder across report ranges',async()=>{
 const location=await db.location.create({data:{businessId:business,code:`MIX-${randomUUID().slice(0,6).toUpperCase()}`,name:'Mixed return cost audit',kind:'SHOP'}});
 const p=await funded('3');await db.product.update({where:{id:p},data:{purchasePrice:'0.3333',sellingPrice:'1'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:location.id,productId:p,delta:'3',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'mixed audit',actorId:owner.user.id,notes:''}));
 const draft=await api('/sales',{clientKey:randomUUID(),locationId:location.id,lines:[{productId:p,quantity:'3'}]});expect(draft.status,draft.text).toBe(201);
 const sale=await api(`/sales/${draft.body.id}/checkout`,{clientKey:randomUUID(),revision:0,expectedTotal:draft.body.total,payment:{method:'CARD',received:draft.body.total,reference:'Mixed cost'},confirm:true});expect(sale.status,sale.text).toBe(200);
 let boundary:Date|undefined;
 for(const condition of ['DAMAGED','RESTOCK','RESTOCK']){const d=await adjustment('CUSTOMER_RETURN',[{productId:p,sourceLineId:sale.body.lines[0].id,quantity:'1',condition}],{locationId:location.id,sourceId:sale.body.id});const result=await approve(d);expect(result.status,result.text).toBe(200);if(condition==='RESTOCK'&&!boundary)boundary=new Date(result.body.completedAt);}
 const {summaryTotals}=await import('../src/reports/service.js');
 const all=await auth.transaction(tx=>summaryTotals(tx,business,{gte:new Date(0),lt:new Date(Date.now()+1000)},{locationId:location.id},2));
 const later=await auth.transaction(tx=>summaryTotals(tx,business,{gte:boundary!,lt:new Date(Date.now()+1000)},{locationId:location.id},2));
 expect(all.estimatedCost).toBe('0.3300');expect(all.grossProfit).toBe('-0.3300');expect(later.estimatedCost).toBe('-0.6700');
});
