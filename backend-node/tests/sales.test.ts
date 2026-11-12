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
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');
  await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');
  for(const [table,trigger] of [['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.salePayment.deleteMany({where:{businessId:{in:bids}}});await tx.saleLine.deleteMany({where:{businessId:{in:bids}}});await tx.sale.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.productPack.deleteMany({where:{businessId:{in:bids}}});
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});
 await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
});
it('enforces tenant, assignment, CSRF, shop-only access and hides purchase costs',async()=>{
 const d=await draft();for(const who of [admin,foreign])expect((await get('',who)).status).toBe(403);
 expect((await get(`/${d.id}`,unassigned)).status).toBe(404);expect((await get(`/${d.id}`,foreign,other)).status).toBe(404);
 expect((await write('',body(),unassigned)).status).toBe(404);
 expect((await request(app).post(`/api/businesses/${business}/sales`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send(body())).status).toBe(403);
 const warehouse=await db.location.create({data:{businessId:business,code:'WAREHOUSE',name:'Warehouse',kind:'WAREHOUSE'}});
 expect((await write('',body({locationId:warehouse.id}))).body.error.code).toBe('SHOP_REQUIRED');
 for(const response of [await get(`/${d.id}`,cashier),await get(`/products?locationId=${source}`,cashier)]){expect(response.status).toBe(200);expect(response.text).not.toContain('unitCost');expect(response.text).not.toContain('purchasePrice');expect(response.text).not.toContain('9.8765');}
});
it('quotes idempotently without stock and restricts edits to creator or manager',async()=>{
 const input=body(),before=await stock(source),rows=await Promise.all([write('',input,cashier),write('',input,cashier)]);expect(rows.map(r=>r.status)).toEqual([201,201]);expect(rows[0]!.body.id).toBe(rows[1]!.body.id);
 expect((await write('',{...input,notes:'changed'},cashier)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 const d=rows[0]!.body;expect(await stock(source)).toBe(before);expect((await checkout(d,checkoutBody(d),secondCashier)).status).toBe(403);
 const update={revision:d.revision,lines:[{productId:product,quantity:'3'}]};expect((await write(`/${d.id}`,update,cashier,'patch')).status).toBe(200);expect((await write(`/${d.id}`,update,cashier,'patch')).body.error.code).toBe('REVISION_CONFLICT');
 expect((await write(`/${d.id}/cancel`,{revision:1,confirm:true},owner)).body.status).toBe('CANCELLED');expect(await stock(source)).toBe(before);
});
it('commits mixed pack/base quantities, cash change and exactly one payment on replay',async()=>{
 const p=await funded('30'),pack=await db.productPack.create({data:{businessId:business,productId:p,name:'Six pack',baseQuantity:'6'}});
 const d=await draft({lines:[{productId:p,packId:pack.id,quantity:'2'},{productId:p,quantity:'1.5'}]});expect(d.total).toBe('162');
 const input=checkoutBody(d,{payment:{method:'CASH',received:'200'}}),rows=await Promise.all([checkout(d,input),checkout(d,input)]);expect(rows.map(r=>r.status)).toEqual([200,200]);expect(rows[0]!.body.payment.change).toBe('38');expect(await stock(source,p)).toBe('16.5000');expect(await db.salePayment.count({where:{saleId:d.id}})).toBe(1);expect(await db.stockMovement.count({where:{sourceId:d.id,type:'SALE'}})).toBe(2);
 expect((await checkout(d)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
});
it('rejects malformed input, excessive discounts and unauthorized discounts',async()=>{
 for(const lines of [[],[{productId:product,quantity:'1e2'}],[{productId:product,quantity:'0'}],[{productId:product,quantity:'1',unitPrice:'1'}]])expect((await write('',body({lines}))).status).toBe(422);
 expect((await write('',body({lines:[{productId:product,quantity:'1',discount:'1',discountReason:'Customer promotion'}]}),cashier)).status).toBe(403);
 expect((await write('',body({lines:[{productId:product,quantity:'1',discount:'13',discountReason:'Customer promotion'}]}))).body.error.code).toBe('DISCOUNT_EXCEEDED');
 expect((await write('',body({lines:[{productId:product,quantity:'1',discount:'1'}]}))).body.error.code).toBe('DISCOUNT_REASON_REQUIRED');
});
it('rounds server line totals exactly and accepts currency precision only',async()=>{
 const p=await funded('10');await db.product.update({where:{id:p},data:{sellingPrice:'1.005'}});
 const d=await draft({lines:[{productId:p,quantity:'1',discount:'0.01',discountReason:'Round promotion'}]});expect(d.subtotal).toBe('1.01');expect(d.total).toBe('1');
 expect((await checkout(d,checkoutBody(d,{payment:{method:'CASH',received:'1.001'}}))).body.error.code).toBe('MONEY_PRECISION');
 expect((await checkout(d,checkoutBody(d,{expectedTotal:'0.99'}))).body.error.code).toBe('TOTAL_CHANGED');
 expect((await checkout(d)).status).toBe(200);
});
it('requires sufficient payment and a reference for manually recorded card/transfer payments',async()=>{
 const d=await draft();for(const payment of [{method:'CASH',received:'1'},{method:'CARD',received:d.total},{method:'TRANSFER',received:'100',reference:'Bank 123'}])expect((await checkout(d,checkoutBody(d,{payment}))).body.error.code).toBe('PAYMENT_INVALID');
 const r=await checkout(d,checkoutBody(d,{payment:{method:'CARD',received:d.total,reference:'Terminal receipt 123'}}));expect(r.status,r.text).toBe(200);expect(r.body.payment.reference).toBe('Terminal receipt 123');
});
it('reprices expired and changed-price drafts before checkout',async()=>{
 const p=await funded(),d=await draft({lines:[{productId:p,quantity:'1'}]});await db.product.update({where:{id:p},data:{sellingPrice:'15'}});expect((await checkout(d)).body.error.code).toBe('PRICE_CHANGED');
 await db.sale.update({where:{id:d.id},data:{expiresAt:new Date(0)}});expect((await checkout(d)).body.error.code).toBe('QUOTE_EXPIRED');
 const r=await write(`/${d.id}`,{revision:0,lines:[{productId:p,quantity:'1'}]},owner,'patch');expect(r.status).toBe(200);expect(r.body.total).toBe('15');expect((await checkout(r.body)).status).toBe(200);
});
it('rolls back all stock and payment writes when any cart line lacks stock',async()=>{
 const a=await funded('10'),b=await funded('1'),d=await draft({lines:[{productId:a,quantity:'2'},{productId:b,quantity:'2'}]});expect((await checkout(d)).body.error.code).toBe('INSUFFICIENT_STOCK');expect(await stock(source,a)).toBe('10.0000');expect(await stock(source,b)).toBe('1.0000');expect(await db.stockMovement.count({where:{sourceId:d.id}})).toBe(0);expect(await db.salePayment.count({where:{saleId:d.id}})).toBe(0);expect((await get(`/${d.id}`)).body.status).toBe('DRAFT');
});
it('prevents concurrent overselling and respects reserved stock',async()=>{
 const p=await funded('1'),a=await draft({lines:[{productId:p,quantity:'1'}]}),b=await draft({lines:[{productId:p,quantity:'1'}]});const rows=await Promise.all([checkout(a),checkout(b)]);expect(rows.map(r=>r.status).sort()).toEqual([200,409]);expect(await stock(source,p)).toBe('0.0000');
 const q=await funded('2');await db.stockBalance.updateMany({where:{productId:q},data:{reserved:'2'}});const d=await draft({lines:[{productId:q,quantity:'1'}]});expect((await checkout(d)).body.error.code).toBe('INSUFFICIENT_STOCK');
});
it('completed receipt snapshots and payments are immutable',async()=>{
 const p=await funded(),d=await draft({lines:[{productId:p,quantity:'1'}]});const done=await checkout(d);expect(done.status).toBe(200);
 await db.product.update({where:{id:p},data:{name:'Renamed product',sellingPrice:'99'}});expect((await get(`/${d.id}`)).body.lines[0].name).toBe('Transfer product');
 await expect(db.sale.update({where:{id:d.id},data:{notes:'tamper'}})).rejects.toThrow();await expect(db.saleLine.update({where:{id:done.body.lines[0].id},data:{name:'tamper'}})).rejects.toThrow();await expect(db.salePayment.update({where:{id:done.body.payment.id},data:{reference:'tamper'}})).rejects.toThrow();
 expect((await write(`/${d.id}/cancel`,{revision:1,confirm:true})).body.error.code).toBe('SALE_STATE');
});
it('rechecks discount permission and active subscription at checkout',async()=>{
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:cashier.user.id}}});await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'sales.discount':true}}});
 const d=await draft({lines:[{productId:product,quantity:'1',discount:'1',discountReason:'Approved offer'}]},cashier);await db.membership.update({where:{id:member.id},data:{permissionOverrides:{}}});expect((await checkout(d,checkoutBody(d),cashier)).status).toBe(403);
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(0),trialEndsAt:new Date(1)}});expect((await checkout(d)).body.error.code).toBe('SUBSCRIPTION_REQUIRED');await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()+86400000)}});
});
it('supports three-decimal currencies and rejects fractional pack stock',async()=>{
 const {lineGross,exactMoney,currencyDigits}=await import('../src/sales/money.js');
 expect(currencyDigits('KWD')).toBe(3);expect(currencyDigits('JOD')).toBe(3);expect(currencyDigits('USD')).toBe(2);
 expect(lineGross('1','1.2345',3)).toBe('1.2350');expect(lineGross('2.5','1.005',2)).toBe('2.5100');expect(exactMoney('1.234',3)).toBe(12340n);expect(()=>exactMoney('1.2345',3)).toThrow();expect(()=>lineGross('99999999999999','99999999999999',2)).toThrow();
 const pack=await db.productPack.create({data:{businessId:business,productId:product,name:'Tiny fraction',baseQuantity:'0.0001'}});expect((await write('',body({lines:[{productId:product,packId:pack.id,quantity:'0.1'}]}))).body.error.code).toBe('QUANTITY_PRECISION');
});
it('replays completed sales after expiry but still requires live location authorization',async()=>{
 const d=await draft({},cashier),input=checkoutBody(d);expect((await checkout(d,input,cashier)).status).toBe(200);
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(0),trialEndsAt:new Date(1)}});
 try{expect((await checkout(d,input,cashier)).status).toBe(200);const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:cashier.user.id}}});await db.locationAssignment.deleteMany({where:{membershipId:member.id}});try{expect((await checkout(d,input,cashier)).status).toBe(404);}finally{await db.locationAssignment.create({data:{businessId:business,membershipId:member.id,locationId:source}});}}
 finally{await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()+86400000)}});}
});
it('rolls back payment, sale status and stock when the final audit write fails',async()=>{
 const p=await funded('5'),d=await draft({lines:[{productId:p,quantity:'1'}]}),suffix=randomUUID().replaceAll('-',''),fn=`reject_sale_${suffix}`;
 try{
  await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sale.completed' AND NEW.target_id='${d.id}' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON auth_audit FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  expect((await checkout(d)).status).toBe(500);expect(await stock(source,p)).toBe('5.0000');expect(await db.salePayment.count({where:{saleId:d.id}})).toBe(0);expect((await get(`/${d.id}`)).body.status).toBe('DRAFT');expect(await db.stockMovement.count({where:{sourceId:d.id}})).toBe(0);
 }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON auth_audit`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);}
});
it('blocks archiving a shop while its price quote is active',async()=>{
 const shop=await db.location.create({data:{businessId:business,code:'EMPTY-POS',name:'Empty shop',kind:'SHOP'}}),d=await draft({locationId:shop.id});
 const archive=()=>request(app).patch(`/api/businesses/${business}/locations/${shop.id}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:0,active:false});
 expect((await archive()).body.error.code).toBe('LOCATION_OPEN_SALES');await db.sale.update({where:{id:d.id},data:{expiresAt:new Date(0)}});expect((await archive()).status).toBe(200);expect((await checkout(d)).body.error.code).toBe('LOCATION_ARCHIVED');
});
it('rejects a payment request key used for another sale without deducting stock',async()=>{
 const a=await draft(),b=await draft(),input=checkoutBody(a);expect((await checkout(a,input)).status).toBe(200);const before=await stock(source);expect((await checkout(b,{...checkoutBody(b),clientKey:input.clientKey})).body.error.code).toBe('IDEMPOTENCY_CONFLICT');expect(await stock(source)).toBe(before);
});

it('requires a separate delete permission to cancel drafts while preserving edit access',async()=>{
 const d=await draft({},cashier);
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:cashier.user.id}}});
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'sales.delete':false}}});
 try {
  const read=await get(`/${d.id}`,cashier);
  expect(read.body.capabilities.edit).toBe(true);expect(read.body.capabilities.cancel).toBe(false);
  expect((await write(`/${d.id}/cancel`,{revision:0,confirm:true},cashier)).status).toBe(403);
  expect((await db.sale.findUniqueOrThrow({where:{id:d.id}})).status).toBe('DRAFT');
  await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'sales.delete':true}}});
  expect((await write(`/${d.id}/cancel`,{revision:0,confirm:true},cashier)).status).toBe(200);
 } finally {await db.membership.update({where:{id:member.id},data:{permissionOverrides:member.permissionOverrides!}});}
});

it('configures tax per business, validates access and snapshots discounted tax on quotes and receipts',async()=>{
 const configure=async(value:unknown,who=owner,bid=business,revision?:number)=>request(app).patch(`/api/businesses/${bid}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send({revision:revision??(await db.business.findUniqueOrThrow({where:{id:bid}})).revision,salesTaxRate:value});
 try{
  for(const who of [cashier,foreign,admin])expect((await configure('5',who)).status).toBe(403);
  for(const rate of ['-1','100.0001','1e2','5.12345','',5,null])expect((await configure(rate)).status).toBe(422);
  expect((await configure('5')).status).toBe(200);
  expect((await db.business.findUniqueOrThrow({where:{id:other}})).salesTaxRate.toString()).toBe('0');
  const p=await funded(),d=await draft({lines:[{productId:p,quantity:'2',discount:'4',discountReason:'Test discount'}]});
  expect(Number(d.subtotal)).toBe(24);expect(Number(d.tax)).toBe(1);expect(Number(d.total)).toBe(21);expect(Number(d.lines[0].tax)).toBe(1);
  const rev=(await db.business.findUniqueOrThrow({where:{id:business}})).revision;
  expect((await configure('10')).status).toBe(200);expect((await configure('15',owner,business,rev)).status).toBe(409);
  const completed=await checkout(d);expect(completed.status,completed.text).toBe(200);expect(Number(completed.body.taxRate)).toBe(5);expect(Number(completed.body.payment.amount)).toBe(21);
  const next=await draft({lines:[{productId:p,quantity:'1'}]});expect(Number(next.tax)).toBe(1.2);
  expect((await configure('0')).status).toBe(200);
  const refreshed=await write(`/${next.id}`,{revision:next.revision,lines:[{productId:p,quantity:'1'}]},owner,'patch');expect(refreshed.status).toBe(200);expect(Number(refreshed.body.tax)).toBe(0);expect(Number(refreshed.body.total)).toBe(12);
  expect(Number((await get(`/${d.id}`)).body.tax)).toBe(1);
 }finally{await configure('0');}
});
