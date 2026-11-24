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
let owner:AuthContext,staff:AuthContext,admin:AuthContext,foreign:AuthContext,business:string,other:string,planId:string,hash:string,location:string,hiddenLocation:string,supplier:string,product:string,secondProduct:string,pack:string;
async function actor(role:'OWNER'|'WAREHOUSE_STAFF'|'SUPER_ADMIN',tenant=business){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Operations tester',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(role!=='SUPER_ADMIN')await db.membership.create({data:{businessId:tenant,userId:id,role}});
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
const get=(path:string,who=owner,b=business)=>request(app).get(`/api/businesses/${b}/operations${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'='post',b=business)=>request(app)[method](`/api/businesses/${b}/operations${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
const input=(extra:Record<string,unknown>={})=>({clientKey:randomUUID(),kind:'RECEIPT',locationId:location,supplierId:supplier,documentDate:'2026-11-11',lines:[{productId:product,quantity:'5',unitCost:'1.2345'}],...extra});
async function draft(extra:Record<string,unknown>={}){const r=await write('/purchases',input(extra));expect(r.status,r.text).toBe(201);return r.body;}
async function submit(doc:any){const r=await write(`/purchases/${doc.id}/status`,{revision:doc.revision,action:'submit',confirm:true});expect(r.status,r.text).toBe(200);return r.body;}
const confirm=(doc:any,who=owner)=>write(`/purchases/${doc.id}/status`,{revision:doc.revision,action:'confirm',confirm:true},who);
beforeAll(async()=>{
 hash=await passwordHash('Operations password 412!');business=(await db.business.create({data:{name:'Operations tenant'}})).id;other=(await db.business.create({data:{name:'Other operations'}})).id;bids.push(business,other);
 owner=await actor('OWNER');staff=await actor('WAREHOUSE_STAFF');admin=await actor('SUPER_ADMIN');foreign=await actor('OWNER',other);
 planId=(await db.billingPlan.create({data:{code:`operations-${randomUUID()}`,name:'Operations test',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:10,maxShops:10}})).id;
 await db.businessSubscription.createMany({data:bids.map(businessId=>({businessId,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}))});
 location=(await db.location.create({data:{businessId:business,code:'MAIN',name:'Main warehouse',kind:'WAREHOUSE'}})).id;
 hiddenLocation=(await db.location.create({data:{businessId:business,code:'HIDDEN',name:'Other warehouse',kind:'WAREHOUSE'}})).id;
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:staff.user.id}}});
 await db.locationAssignment.create({data:{businessId:business,locationId:location,membershipId:member.id}});
 supplier=(await db.supplier.create({data:{businessId:business,code:'SUP',name:'Food Supplier'}})).id;
 for(const sku of ['MILK','WATER']){
  const row=await db.product.create({data:{businessId:business,sku,name:sku,unit:'PIECE',purchasePrice:'1.2345',sellingPrice:'2'}});
  if(sku==='MILK')product=row.id;else secondProduct=row.id;
 }
 pack=(await db.productPack.create({data:{businessId:business,productId:product,name:'Carton',baseQuantity:'12'}})).id;
});
afterAll(async()=>{
 // Isolated test fixtures only. Table lock keeps the append-only trigger disabled
 // solely within this cleanup transaction; rollback restores it on any failure.
 await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');
  await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');
 });
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.purchaseLine.deleteMany({where:{businessId:{in:bids}}});
 await db.purchaseDocument.deleteMany({where:{businessId:{in:bids},kind:'RECEIPT'}});await db.purchaseDocument.deleteMany({where:{businessId:{in:bids}}});
 await db.supplier.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});
 await db.productPack.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});
 await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
});
it('round-trips all five purchase terms on receipts and orders without posting a supplier payment',async()=>{
 for(const kind of ['ORDER','RECEIPT'] as const){
  const content=kind==='ORDER'?{plannedItems:[{name:'Milk',quantity:'1'}],documentDate:'2026-11-24'}:
   {lines:[{productId:product,quantity:'1'}],documentDate:'2026-11-24'};
  for(const method of ['CASH','TRANSFER','REMITTANCE','CREDIT','OTHER']){
   const description=method==='OTHER'?'محفظة إلكترونية':'';
   const data={...content,kind,clientKey:randomUUID(),...(kind==='RECEIPT'?{locationId:location}:{}),paymentTerms:{method,description}};
   if(method==='OTHER')expect((await write('/purchases',{...data,paymentTerms:{method,description:'  '}})).status).toBe(422);
   const created=await write('/purchases',data);
   expect(created.status,created.text).toBe(201);
   const path='/purchases/'+created.body.id;
   expect((await get(path)).body).toMatchObject({paymentMethod:method,paymentDescription:description});
   if(method==='OTHER'){
    const updated=await write(path,{...content,revision:0,paymentTerms:{method:'CREDIT'}},owner,'patch');
    expect(updated.status,updated.text).toBe(200);
    expect((await get(path)).body).toMatchObject({paymentMethod:'CREDIT',paymentDescription:''});
   }
  }
 }
 expect(await db.moneyEntry.count({where:{businessId:business}})).toBe(0);
});
it('creates suppliers without a user-entered code and preserves generated codes on edits',async()=>{
 const first=await write('/suppliers',{name:'Automatic supplier one'}),second=await write('/suppliers',{name:'Automatic supplier two'});
 expect(first.status).toBe(201);expect(second.status).toBe(201);
 expect(first.body.code).toMatch(/^SUP-[A-F0-9]{20}$/);expect(second.body.code).not.toBe(first.body.code);
 const edited=await write(`/suppliers/${first.body.id}`,{revision:0,name:'Updated supplier'},owner,'patch');
 expect(edited.status).toBe(200);expect(edited.body.code).toBe(first.body.code);
 expect((await write('/suppliers',{name:'Not permitted'},staff)).status).toBe(403);
});
it('isolates suppliers, validates contacts, revision checks edits and preserves inactive codes',async()=>{
 expect((await get('/suppliers',admin)).status).toBe(403);
 expect((await get('/suppliers',foreign)).status).toBe(403);
 expect((await write('/suppliers',{code:'NEW',name:'New supplier'},staff)).status).toBe(403);
 expect((await write('/suppliers',{code:'NEW',name:'New supplier',email:'invalid'})).status).toBe(422);
 const row=await write('/suppliers',{code:'NEW',name:'New supplier',phone:'+971 50 123 4567'});expect(row.status).toBe(201);
 expect((await write(`/suppliers/${row.body.id}`,{revision:0,active:false},owner,'patch')).status).toBe(200);
 expect((await write(`/suppliers/${row.body.id}`,{revision:0,name:'Stale'},owner,'patch')).body.error.code).toBe('REVISION_CONFLICT');
 expect((await write('/suppliers',{code:'NEW',name:'Duplicate'})).body.error.code).toBe('SUPPLIER_CODE_EXISTS');
 expect((await write(`/suppliers/${supplier}`,{revision:0,name:'Wrong tenant'},foreign,'patch',other)).status).toBe(404);
});
it('requires CSRF, location assignments and cost permission; never exposes draft costs to warehouse staff',async()=>{
 expect((await request(app).post(`/api/businesses/${business}/operations/purchases`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send(input())).status).toBe(403);
 expect((await write('/purchases',input({locationId:hiddenLocation,lines:[{productId:product,quantity:'1'}]}),staff)).status).toBe(404);
 expect((await write('/purchases',input(),staff)).status).toBe(403);
 const doc=await write('/purchases',input({lines:[{productId:product,quantity:'1'}]}),staff);expect(doc.status).toBe(201);
 expect(doc.text).not.toContain('unitCost');expect(doc.text).not.toContain('totalValue');
 expect((await get(`/purchases/${doc.body.id}`,staff)).text).not.toContain('1.2345');
 expect((await confirm(await submit(doc.body),staff)).status).toBe(403);
 expect((await get(`/inventory?locationId=${hiddenLocation}`,staff)).status).toBe(404);
 expect((await get(`/purchases/${doc.body.id}`,foreign,other)).status).toBe(404);
});
it('creates drafts idempotently and changes no stock before confirmation',async()=>{
 const body=input();const rows=await Promise.all([write('/purchases',body),write('/purchases',body)]);
 expect(rows.map(r=>r.status)).toEqual([201,201]);expect(rows[0]!.body.id).toBe(rows[1]!.body.id);
 expect((await write('/purchases',{...body,notes:'different'})).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 expect(await db.stockBalance.count({where:{businessId:business}})).toBe(0);
 const doc=rows[0]!.body;
 expect((await confirm(doc)).body.error.code).toBe('DOCUMENT_STATE');
 const pending=await submit(doc);
 expect(await db.stockMovement.count({where:{businessId:business}})).toBe(0);
 const done=await Promise.all([confirm(pending),confirm(pending)]);
 expect(done.map(r=>r.status)).toEqual([200,200]);
 expect(await db.stockMovement.count({where:{businessId:business,sourceId:doc.id}})).toBe(1);
 expect((await db.stockBalance.findFirstOrThrow({where:{businessId:business,locationId:location,productId:product}})).onHand.toFixed(4)).toBe('5.0000');
 expect((await write(`/purchases/${doc.id}/status`,{revision:done[0]!.body.revision,action:'cancel',confirm:true})).body.error.code).toBe('DOCUMENT_STATE');
});
it('snapshots pack factors and costs, supports exact draft edits and locks completed records',async()=>{
 const doc=await draft({lines:[{productId:product,quantity:'2',packId:pack,unitCost:'0.1001'}]});
 expect(doc.lines[0]).toMatchObject({factor:'12.0000',baseQuantity:'24.0000',unitCost:'0.1001',packName:'Carton'});
 expect(doc.totalValue).toBe('2.40240000');
 const edit={revision:0,documentDate:'2026-11-10',notes:'Changed draft',lines:[{productId:product,quantity:'1',packId:pack,unitCost:'0.1001'}]};
 const saved=await write(`/purchases/${doc.id}`,edit,owner,'patch');expect(saved.status).toBe(200);
 expect((await write(`/purchases/${doc.id}`,edit,owner,'patch')).body.error.code).toBe('REVISION_CONFLICT');
 const done=await confirm(await submit(saved.body));expect(done.status).toBe(200);
 expect((await write(`/purchases/${doc.id}`,{...edit,revision:done.body.revision},owner,'patch')).body.error.code).toBe('DOCUMENT_STATE');
 expect((await get(`/purchases/${doc.id}`)).body.lines[0].baseQuantity).toBe('12.0000');
});
it('tracks partial order deliveries and rejects concurrent over-receiving atomically',async()=>{
 const order=await submit(await draft({kind:'ORDER',lines:[{productId:secondProduct,quantity:'10',unitCost:'1'}]}));
 const receipt=()=>draft({orderId:order.id,lines:[{productId:secondProduct,quantity:'6',unitCost:'1'}]});
 const a=await submit(await receipt()),b=await submit(await receipt());
 const results=await Promise.all([confirm(a),confirm(b)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await get(`/purchases/${order.id}`)).body).toMatchObject({status:'PARTIAL',lines:[{receivedQuantity:'6.0000'}]});
 const last=await submit(await draft({orderId:order.id,lines:[{productId:secondProduct,quantity:'4',unitCost:'1'}]}));
 expect((await confirm(last)).status).toBe(200);
 expect((await get(`/purchases/${order.id}`)).body.status).toBe('RECEIVED');
 expect((await db.stockBalance.findFirstOrThrow({where:{businessId:business,productId:secondProduct}})).onHand.toFixed(4)).toBe('10.0000');
});
it('rolls back balances, movements and order progress if completion fails after posting',async()=>{
 const order=await submit(await draft({kind:'ORDER',lines:[{productId:product,quantity:'10',unitCost:'1'}]}));
 const pending=await submit(await draft({notes:'force rollback',orderId:order.id}));
 const before=await db.stockBalance.findFirstOrThrow({where:{businessId:business,productId:product}});
 await db.$executeRawUnsafe("CREATE FUNCTION test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notes='force rollback' AND NEW.status='COMPLETED' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END; $$");
 await db.$executeRawUnsafe('CREATE TRIGGER test_receipt_failure BEFORE UPDATE ON purchase_documents FOR EACH ROW EXECUTE FUNCTION test_receipt_failure()');
 try{
  expect((await confirm(pending)).status).toBe(500);
  expect((await db.stockBalance.findUniqueOrThrow({where:{id:before.id}})).onHand.toFixed(4)).toBe(before.onHand.toFixed(4));
  expect(await db.stockMovement.count({where:{sourceId:pending.id}})).toBe(0);
  expect((await get(`/purchases/${pending.id}`)).body.status).toBe('PENDING');
  expect((await get(`/purchases/${order.id}`)).body).toMatchObject({status:'OPEN',lines:[{receivedQuantity:'0.0000'}]});
 }finally{await db.$executeRawUnsafe('DROP TRIGGER test_receipt_failure ON purchase_documents');await db.$executeRawUnsafe('DROP FUNCTION test_receipt_failure()');}
 expect((await confirm(pending)).status).toBe(200);
});
it('prevents concurrent overselling in the internal stock engine and keeps history immutable',async()=>{
 const make=()=>auth.transaction(tx=>postStock(tx,{businessId:business,locationId:location,productId:secondProduct,delta:'-7',type:'TEST_SALE',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'test',actorId:owner.user.id,notes:''}));
 const result=await Promise.allSettled([make(),make()]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await db.stockBalance.findFirstOrThrow({where:{businessId:business,productId:secondProduct}})).onHand.toFixed(4)).toBe('3.0000');
 const movement=await db.stockMovement.findFirstOrThrow({where:{businessId:business}});
 await expect(db.stockMovement.update({where:{id:movement.id},data:{notes:'tampered'}})).rejects.toThrow();
 await expect(db.stockMovement.delete({where:{id:movement.id}})).rejects.toThrow();
 const view=await get(`/inventory?locationId=${location}&view=movements`,staff);expect(view.status).toBe(200);
 expect(view.text).not.toContain('unitCost');
});
it('validates quantities, product uniqueness and cross-tenant references without writes',async()=>{
 const before=await db.purchaseDocument.count({where:{businessId:business}});
 for(const quantity of ['0','-1','1.00001','1e3']){
  expect((await write('/purchases',input({lines:[{productId:product,quantity}]}))).status).toBe(422);
 }
 expect((await write('/purchases',input({lines:[{productId:product,quantity:'1'},{productId:product,quantity:'2'}]}))).status).toBe(422);
 expect((await write('/purchases',input({supplierId:randomUUID()}))).body.error.code).toBe('SUPPLIER_INACTIVE');
 expect((await write('/purchases',input({lines:[{productId:randomUUID(),quantity:'1'}]}))).body.error.code).toBe('PRODUCT_NOT_FOUND');
 expect((await write('/purchases',input({lines:[{productId:product,quantity:'1',packId:randomUUID()}]}))).body.error.code).toBe('PACK_NOT_FOUND');
 expect((await write('/purchases',input({lines:[{productId:product,quantity:'99999999999999',packId:pack}]}))).body.error.code).toBe('QUANTITY_OVERFLOW');
 expect(await db.purchaseDocument.count({where:{businessId:business}})).toBe(before);
});
it('reopens and cancels without posting, guards empty locations with drafts, and retains supplier snapshots',async()=>{
 const doc=await draft({locationId:hiddenLocation});
 const archive=()=>request(app).patch(`/api/businesses/${business}/locations/${hiddenLocation}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:0,active:false});
 expect((await archive()).body.error.code).toBe('LOCATION_IN_USE');
 const pending=await submit(doc);
 const reopened=await write(`/purchases/${doc.id}/status`,{revision:pending.revision,action:'reopen',confirm:true});expect(reopened.body.status).toBe('DRAFT');
 const cancelled=await write(`/purchases/${doc.id}/status`,{revision:reopened.body.revision,action:'cancel',confirm:true});expect(cancelled.body.status).toBe('CANCELLED');
 expect(await db.stockMovement.count({where:{sourceId:doc.id}})).toBe(0);
 expect((await archive()).status).toBe(200);
 await db.supplier.update({where:{id:supplier},data:{name:'Renamed supplier'}});
 expect((await get(`/purchases/${doc.id}`)).body.supplierName).toBe('Food Supplier');
 expect((await get(`/purchases?kind=RECEIPT&supplierId=${supplier}`)).body.total).toBeGreaterThan(0);
});
it('uses approved order costs for cost-blind receiving and prevents order cancellation with open receipts',async()=>{
 const order=await submit(await draft({kind:'ORDER',lines:[{productId:product,quantity:'3',unitCost:'0.4321'}]}));
 const response=await write('/purchases',input({orderId:order.id,lines:[{productId:product,quantity:'1'}]}),staff);
 expect(response.status).toBe(201);expect(response.text).not.toContain('0.4321');
 expect((await get(`/purchases/${response.body.id}`)).body.lines[0].unitCost).toBe('0.4321');
 expect((await write(`/purchases/${order.id}/status`,{revision:order.revision,action:'cancel',confirm:true})).body.error.code).toBe('OPEN_RECEIPTS');
 expect((await write(`/purchases/${response.body.id}/status`,{revision:0,action:'cancel',confirm:true})).status).toBe(200);
 expect((await write(`/purchases/${order.id}/status`,{revision:order.revision,action:'cancel',confirm:true})).status).toBe(200);
});
it('preserves approved order prices when cost-blind staff add receipt lines during draft editing',async()=>{
 const order=await submit(await draft({kind:'ORDER',lines:[{productId:product,quantity:'3',unitCost:'0.4321'},{productId:secondProduct,quantity:'3',unitCost:'0.9876'}]}));
 const response=await write('/purchases',input({orderId:order.id,lines:[{productId:product,quantity:'1'}]}),staff);
 expect(response.status,response.text).toBe(201);
 const saved=await write(`/purchases/${response.body.id}`,{revision:0,documentDate:'2026-11-11',lines:[{productId:product,quantity:'2'},{productId:secondProduct,quantity:'1'}]},staff,'patch');
 expect(saved.status,saved.text).toBe(200);expect(saved.text).not.toContain('unitCost');
 const priced=(await get(`/purchases/${response.body.id}`)).body;
 expect(priced.lines.find((l:{productId:string})=>l.productId===product).unitCost).toBe('0.4321');
 expect(priced.lines.find((l:{productId:string})=>l.productId===secondProduct).unitCost).toBe('0.9876');
 expect(priced.totalValue).toBe('1.85180000');
});
it('blocks archive with stock or open documents, and rechecks supplier, location access and entitlement at posting',async()=>{
 const pending=await submit(await draft());
 const archive=await request(app).patch(`/api/businesses/${business}/locations/${location}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:0,active:false});
 expect(archive.body.error.code).toBe('LOCATION_IN_USE');
 await db.supplier.update({where:{id:supplier},data:{active:false}});expect((await confirm(pending)).body.error.code).toBe('SUPPLIER_INACTIVE');
 await db.supplier.update({where:{id:supplier},data:{active:true}});
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
 expect((await confirm(pending)).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await get(`/purchases/${pending.id}`)).status).toBe(200);
 const completed=await db.purchaseDocument.findFirstOrThrow({where:{businessId:business,status:'COMPLETED'}});
 expect((await confirm(completed)).status).toBe(200);
 await db.locationAssignment.deleteMany({where:{businessId:business}});expect((await get(`/purchases/${pending.id}`,staff)).status).toBe(404);
});

it('plans unlisted items without a location or supplier and posts inventory only on linked receipt confirmation',async()=>{
 await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()+86400000)}});
 const proposal={kind:'ORDER',clientKey:randomUUID(),documentDate:'2026-11-20',plannedItems:[{name:'عطور فرنسية',quantity:'10'}]};
 const movementCount=await db.stockMovement.count({where:{businessId:business}});
 const created=await write('/purchases',proposal);
 expect(created.status,created.text).toBe(201);
 expect(created.body).toMatchObject({kind:'ORDER',status:'DRAFT',locationId:null,supplierId:null,notes:'',supplierReference:'',
  lines:[],plannedItems:[{name:'عطور فرنسية',quantity:'10.0000',receivedQuantity:'0.0000'}]});
 const orderId=created.body.id;
 expect((await write('/purchases',proposal)).body.id).toBe(orderId);
 expect((await get(`/purchases/${orderId}`,foreign,other)).status).toBe(404);
 expect((await get(`/purchases/${orderId}`,staff)).status).toBe(404);
 const changed=await write(`/purchases/${orderId}`,{revision:0,documentDate:'2026-11-21',notes:'Optional note',plannedItems:proposal.plannedItems},owner,'patch');
 expect(changed.status,changed.text).toBe(200);
 expect(changed.body).toMatchObject({documentDate:'2026-11-21',notes:'Optional note'});
 const order=await submit(changed.body);
 expect(await db.stockMovement.count({where:{businessId:business}})).toBe(movementCount);
 const plannedItemId=order.plannedItems[0].id;
 const line=(quantity:string)=>({productId:product,plannedItemId,quantity});
 const unrelated=await write('/purchases',input({lines:[line('1')]}));
 expect(unrelated.status).toBe(422);
 const oversized=await write('/purchases',input({orderId,lines:[line('11')]}));
 expect(oversized.body.error.code).toBe('ORDER_QUANTITY_EXCEEDED');
 const receipt=await submit(await draft({orderId,lines:[line('6')]}));
 expect(await db.stockMovement.count({where:{businessId:business}})).toBe(movementCount);
 expect((await confirm(receipt)).status).toBe(200);
 expect((await get(`/purchases/${orderId}`)).body).toMatchObject({status:'PARTIAL',plannedItems:[{receivedQuantity:'6.0000'}]});
 const rest=await submit(await draft({orderId,lines:[line('4')]}));
 expect((await confirm(rest)).status).toBe(200);
 expect((await get(`/purchases/${orderId}`)).body).toMatchObject({status:'RECEIVED',plannedItems:[{receivedQuantity:'10.0000'}]});
 expect(await db.stockMovement.count({where:{businessId:business}})).toBe(movementCount+2);
});

const receiveDirect=(doc:any,who=owner,b=business)=>write(`/purchases/${doc.id}/status`,{revision:doc.revision,action:'receive',confirm:true},who,'post',b);
it('receives a reviewed draft atomically, records its approver and safely replays concurrent requests',async()=>{
 const doc=await draft({lines:[{productId:product,quantity:'2.5',unitCost:'1.2345'},{productId:secondProduct,quantity:'3',unitCost:'2'}]});
 const before=await db.stockBalance.findFirstOrThrow({where:{businessId:business,locationId:location,productId:product}});
 const result=await Promise.all([receiveDirect(doc),receiveDirect(doc)]);
 expect(result.map(r=>r.status)).toEqual([200,200]);
 expect(result[0]!.body).toMatchObject({status:'COMPLETED',revision:1,completedName:owner.user.name});
 expect(await db.stockMovement.count({where:{businessId:business,sourceId:doc.id}})).toBe(2);
 const after=await db.stockBalance.findFirstOrThrow({where:{id:before.id}});
 expect(after.onHand.minus(before.onHand).toFixed(4)).toBe('2.5000');
 expect(await db.authAudit.count({where:{businessId:business,targetId:doc.id,action:'purchase.status_changed'}})).toBe(1);
 expect((await db.authAudit.findFirstOrThrow({where:{targetId:doc.id,action:'purchase.status_changed'}})).changes).toEqual({from:'DRAFT',to:'COMPLETED'});
 expect((await receiveDirect(doc)).status).toBe(200);
 expect((await write(`/purchases/${doc.id}`,{revision:1,documentDate:'2026-11-23',notes:'Cannot edit',lines:[{productId:product,quantity:'1'}]},owner,'patch')).body.error.code).toBe('DOCUMENT_STATE');
});
it('preserves receiving approval permissions, location scope and tenant isolation on direct receiving and replay',async()=>{
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:staff.user.id}}});
 await db.locationAssignment.create({data:{businessId:business,locationId:location,membershipId:member.id}});
 const doc=await draft();
 expect((await receiveDirect(doc,staff)).status).toBe(403);
 expect((await receiveDirect(doc,admin)).status).toBe(403);
 expect((await receiveDirect(doc,foreign,other)).status).toBe(404);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'receiving.confirm':true,'receiving.create':false}}});
 expect((await receiveDirect(doc,staff)).status).toBe(403);
 // An approver without preparation permission can still approve a submitted receipt.
 const pending=await submit(doc);
 expect((await confirm(pending,staff)).status).toBe(200);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'receiving.confirm':true}}});
 const direct=await draft();
 const result=await receiveDirect(direct,staff);expect(result.status,result.text).toBe(200);expect(result.text).not.toContain('unitCost');
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{}}});
 expect((await receiveDirect(direct,staff)).status).toBe(403);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'receiving.confirm':true}}});
 await db.location.update({where:{id:hiddenLocation},data:{archivedAt:null}});
 const hidden=await draft({locationId:hiddenLocation});expect((await receiveDirect(hidden,staff)).status).toBe(404);
 await db.locationAssignment.deleteMany({where:{membershipId:member.id}});
 expect((await receiveDirect(direct,staff)).status).toBe(404);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{}}});
});
it('rejects stale reviews and wrong states without posting stock',async()=>{
 const doc=await draft();
 const edited=await write(`/purchases/${doc.id}`,{revision:doc.revision,documentDate:'2026-11-23',notes:'Changed since review',lines:[{productId:product,quantity:'1'}]},owner,'patch');expect(edited.status,edited.text).toBe(200);
 expect((await receiveDirect(doc)).body.error.code).toBe('REVISION_CONFLICT');
 const pending=await submit(edited.body);
 expect((await receiveDirect(pending)).body.error.code).toBe('DOCUMENT_STATE');
 const order=await draft({kind:'ORDER'});expect((await receiveDirect(order)).body.error.code).toBe('DOCUMENT_STATE');
 const cancelled=await draft();const cancel=await write(`/purchases/${cancelled.id}/status`,{revision:cancelled.revision,action:'cancel',confirm:true});
 expect((await receiveDirect(cancel.body)).body.error.code).toBe('DOCUMENT_STATE');
 expect(await db.stockMovement.count({where:{sourceId:{in:[doc.id,order.id,cancelled.id]}}})).toBe(0);
 expect((await write(`/purchases/${doc.id}/status`,{revision:pending.revision,action:'receive'})).status).toBe(422);
});
it('revalidates active records and subscription before direct receiving, leaving failed drafts untouched',async()=>{
 const doc=await draft();
 await db.supplier.update({where:{id:supplier},data:{active:false}});
 try{expect((await receiveDirect(doc)).body.error.code).toBe('SUPPLIER_INACTIVE');}finally{await db.supplier.update({where:{id:supplier},data:{active:true}});}
 await db.product.update({where:{id:product},data:{active:false}});
 try{expect((await receiveDirect(doc)).body.error.code).toBe('PRODUCT_INACTIVE');}finally{await db.product.update({where:{id:product},data:{active:true}});}
 await db.location.update({where:{id:location},data:{archivedAt:new Date()}});
 try{expect((await receiveDirect(doc)).body.error.code).toBe('LOCATION_ARCHIVED');}finally{await db.location.update({where:{id:location},data:{archivedAt:null}});}
 await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()-1000)}});
 try{expect((await receiveDirect(doc)).body.error.code).toBe('SUBSCRIPTION_REQUIRED');}finally{await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()+86400000)}});}
 expect((await get(`/purchases/${doc.id}`)).body).toMatchObject({status:'DRAFT',revision:0});
 expect(await db.stockMovement.count({where:{sourceId:doc.id}})).toBe(0);
 expect((await receiveDirect(doc)).status).toBe(200);
});
it('updates linked order quantities on direct receiving and rejects concurrent over-receiving',async()=>{
 const order=await submit(await draft({kind:'ORDER',lines:[{productId:product,quantity:'5'}]}));
 const a=await draft({orderId:order.id,lines:[{productId:product,quantity:'4'}]});
 const b=await draft({orderId:order.id,lines:[{productId:product,quantity:'4'}]});
 const result=await Promise.all([receiveDirect(a),receiveDirect(b)]);
 expect(result.map(r=>r.status).sort()).toEqual([200,409]);
 expect(result.find(r=>r.status===409)!.body.error.code).toBe('ORDER_QUANTITY_EXCEEDED');
 expect((await get(`/purchases/${order.id}`)).body).toMatchObject({status:'PARTIAL',lines:[{receivedQuantity:'4.0000'}]});
 expect(await db.stockMovement.count({where:{sourceId:{in:[a.id,b.id]}}})).toBe(1);
 const rest=await draft({orderId:order.id,lines:[{productId:product,quantity:'1'}]});
 expect((await receiveDirect(rest)).status).toBe(200);
 expect((await get(`/purchases/${order.id}`)).body.status).toBe('RECEIVED');
});
it('receives goods without a supplier, preserving review and stock posting',async()=>{
 const doc=await draft({supplierId:null});
 expect(doc.supplierId).toBeNull();expect(doc.supplierName).toBe('');
 const edited=await write(`/purchases/${doc.id}`,{revision:doc.revision,documentDate:'2026-11-11',lines:[{productId:product,quantity:'2',unitCost:'1.2345'}]},owner,'patch');
 expect(edited.status,edited.text).toBe(200);
 const pending=await submit(edited.body),posted=await confirm(pending);
 expect(posted.status,posted.text).toBe(200);expect(posted.body.status).toBe('COMPLETED');
 expect(await db.stockMovement.count({where:{businessId:business,sourceId:doc.id,type:'PURCHASE_RECEIPT'}})).toBe(1);
 const withoutField=await draft({supplierId:undefined});expect(withoutField.supplierId).toBeNull();
 const invalid=await write('/purchases',input({supplierId:randomUUID()}));expect(invalid.status).toBe(409);
});
it('all operation types includes both orders and receipts without crossing tenants',async()=>{
 const receipt=await draft(),order=await draft({kind:'ORDER'});
 const all=await get('/purchases?kind=ALL');expect(all.status,all.text).toBe(200);
 expect(all.body.items.some((row:any)=>row.id===receipt.id)).toBe(true);
 expect(all.body.items.some((row:any)=>row.id===order.id)).toBe(true);
 expect(all.body.items.every((row:any)=>row.businessId===business)).toBe(true);
 const receipts=await get('/purchases?kind=RECEIPT');expect(receipts.body.items.every((row:any)=>row.kind==='RECEIPT')).toBe(true);
});
