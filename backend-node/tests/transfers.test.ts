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
let owner:AuthContext,sourceStaff:AuthContext,destinationStaff:AuthContext,unassigned:AuthContext,foreign:AuthContext,admin:AuthContext,business:string,other:string,source:string,destination:string,foreignLocation:string,planId:string,product:string,hash:string;
async function actor(role:'OWNER'|'WAREHOUSE_STAFF'|'SUPER_ADMIN',tenant=business,location?:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Transfer tester',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(role!=='SUPER_ADMIN'){const member=await db.membership.create({data:{businessId:tenant,userId:id,role}});if(location)await db.locationAssignment.create({data:{businessId:tenant,membershipId:member.id,locationId:location}});}
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
const get=(path='',who=owner,b=business)=>request(app).get(`/api/businesses/${b}/transfers${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'='post',b=business)=>request(app)[method](`/api/businesses/${b}/transfers${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
const body=(extra:Record<string,unknown>={})=>({clientKey:randomUUID(),sourceId:source,destinationId:destination,notes:'Delivery to branch',lines:[{productId:product,quantity:'10'}],...extra});
async function draft(extra:Record<string,unknown>={}){const r=await write('',body(extra));expect(r.status,r.text).toBe(201);return r.body;}
const dispatch=(doc:any,who=owner)=>write(`/${doc.id}/status`,{revision:doc.revision,action:'dispatch',confirm:true},who);
async function moving(extra:Record<string,unknown>={}){const r=await dispatch(await draft(extra));expect(r.status,r.text).toBe(200);return r.body;}
const event=(doc:any,quantity:string,kind='RECEIVE',extra:Record<string,unknown>={})=>({clientKey:randomUUID(),revision:doc.revision,kind,reason:kind==='RECEIVE'?'':'Counted and checked with driver',confirm:true,lines:[{lineId:doc.lines[0].id,quantity}],...extra});
const record=(doc:any,input:object,who=owner)=>write(`/${doc.id}/events`,input,who);
async function stock(locationId:string,productId=product){return (await db.stockBalance.findFirst({where:{businessId:business,locationId,productId}}))?.onHand.toFixed(4)??'0.0000';}
async function funded(quantity='100'){
 const p=await db.product.create({data:{businessId:business,sku:`SKU-${randomUUID().slice(0,8).toUpperCase()}`,name:'Transfer product',unit:'PIECE',purchasePrice:'9.8765',sellingPrice:'12'}});
 await auth.transaction(tx=>postStock(tx,{businessId:business,locationId:source,productId:p.id,delta:quantity,type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'test opening',actorId:owner.user.id,notes:''}));return p.id;
}
beforeAll(async()=>{
 hash=await passwordHash('Transfer integration password 914!');
 business=(await db.business.create({data:{name:'Transfer business'}})).id;other=(await db.business.create({data:{name:'Foreign transfer business'}})).id;bids.push(business,other);
 source=(await db.location.create({data:{businessId:business,code:'SOURCE',name:'Main warehouse',kind:'WAREHOUSE'}})).id;
 destination=(await db.location.create({data:{businessId:business,code:'DEST',name:'Branch shop',kind:'SHOP'}})).id;
 foreignLocation=(await db.location.create({data:{businessId:other,code:'FOREIGN',name:'Foreign location',kind:'WAREHOUSE'}})).id;
 owner=await actor('OWNER');sourceStaff=await actor('WAREHOUSE_STAFF',business,source);destinationStaff=await actor('WAREHOUSE_STAFF',business,destination);unassigned=await actor('WAREHOUSE_STAFF');foreign=await actor('OWNER',other);admin=await actor('SUPER_ADMIN');
 planId=(await db.billingPlan.create({data:{code:`transfer-${randomUUID()}`,name:'Transfer test',nameAr:'اختبار',trialDays:14,maxMembers:20,maxWarehouses:10,maxShops:10}})).id;
 await db.businessSubscription.createMany({data:bids.map(businessId=>({businessId,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}))});
 product=await funded('1000');
});
afterAll(async()=>{
 await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');
  await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');
  await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines DISABLE TRIGGER transfer_event_lines_immutable');
  await tx.transferEventLine.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines ENABLE TRIGGER transfer_event_lines_immutable');
  await tx.$executeRawUnsafe('ALTER TABLE transfer_events DISABLE TRIGGER transfer_events_immutable');
  await tx.transferEvent.deleteMany({where:{businessId:{in:bids}}});
  await tx.$executeRawUnsafe('ALTER TABLE transfer_events ENABLE TRIGGER transfer_events_immutable');
 });
 await db.transferLine.deleteMany({where:{businessId:{in:bids}}});await db.stockTransfer.deleteMany({where:{businessId:{in:bids}}});
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});
 await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
});
it('requires both locations to create a route, scopes reads to either participant, and never exposes costs',async()=>{
 expect((await get('',admin)).status).toBe(403);expect((await get('',foreign)).status).toBe(403);
 expect((await write('',body(),sourceStaff)).status).toBe(404);expect((await write('',body({destinationId:foreignLocation}))).status).toBe(404);
 expect((await request(app).post(`/api/businesses/${business}/transfers`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send(body())).status).toBe(403);
 const doc=await draft();
 for(const who of [sourceStaff,destinationStaff]){const r=await get(`/${doc.id}`,who);expect(r.status).toBe(200);expect(r.text).not.toContain('purchasePrice');expect(r.text).not.toContain('9.8765');}
 expect((await get(`/${doc.id}`,unassigned)).status).toBe(404);expect((await get('',unassigned)).body.total).toBe(0);
 expect((await get(`/${doc.id}`,foreign,other)).status).toBe(404);
 expect((await get(`?locationId=${source}`,destinationStaff)).status).toBe(404);
 expect((await get(`/${doc.id}`,sourceStaff)).body.capabilities).toMatchObject({edit:false,dispatch:true,receive:false});
 expect((await dispatch(doc,destinationStaff)).status).toBe(404);
});
it('validates distinct locations, exact positive quantities and unique products',async()=>{
 for(const change of [{destinationId:source},{lines:[]},{lines:[{productId:product,quantity:'0'}]},{lines:[{productId:product,quantity:'1.00001'}]},{lines:[{productId:product,quantity:'1e2'}]},{lines:[{productId:product,quantity:1}]},{lines:[{productId:product,quantity:'1'},{productId:product,quantity:'2'}]}])expect((await write('',body(change))).status).toBe(422);
});
it('creates drafts idempotently, revision checks edits and cancels without stock movement',async()=>{
 const input=body(),before=await stock(source),rows=await Promise.all([write('',input),write('',input)]);
 expect(rows.map(r=>r.status)).toEqual([201,201]);expect(rows[0]!.body.id).toBe(rows[1]!.body.id);
 expect((await write('',{...input,notes:'changed'})).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 const doc=rows[0]!.body,edit={revision:0,notes:'updated',lines:[{productId:product,quantity:'11.2500'}]};
 const saved=await write(`/${doc.id}`,edit,owner,'patch');expect(saved.status).toBe(200);
 expect((await write(`/${doc.id}`,edit,owner,'patch')).body.error.code).toBe('REVISION_CONFLICT');
 expect((await write(`/${doc.id}/status`,{revision:1,action:'cancel',confirm:true})).body.status).toBe('CANCELLED');
 expect((await dispatch(saved.body)).body.error.code).toBe('REVISION_CONFLICT');
 expect(await stock(source)).toBe(before);expect(await db.stockMovement.count({where:{sourceId:doc.id}})).toBe(0);
});
it('dispatches only once, keeps destination unchanged and enforces source-only permission',async()=>{
 const doc=await draft(),before=await stock(destination);
 const rows=await Promise.all([dispatch(doc,sourceStaff),dispatch(doc,sourceStaff)]);
 expect(rows.map(r=>r.status)).toEqual([200,200]);expect(rows[0]!.body.lines[0].inTransit).toBe('10.0000');
 expect(await stock(destination)).toBe(before);
 expect(await db.stockMovement.count({where:{sourceId:doc.id,type:'TRANSFER_OUT'}})).toBe(1);
 expect((await write(`/${doc.id}`,{revision:1,notes:'edit after dispatch',lines:[{productId:product,quantity:'1'}]},owner,'patch')).body.error.code).toBe('TRANSFER_STATE');
 expect((await write(`/${doc.id}/status`,{revision:1,action:'cancel',confirm:true})).body.error.code).toBe('TRANSFER_STATE');
 expect((await record(rows[0]!.body,event(rows[0]!.body,'1'),sourceStaff)).status).toBe(404);
});
it('prevents concurrent over-dispatch and protects reserved stock',async()=>{
 const p=await funded('10'),a=await draft({lines:[{productId:p,quantity:'6'}]}),b=await draft({lines:[{productId:p,quantity:'6'}]});
 const rows=await Promise.all([dispatch(a),dispatch(b)]);expect(rows.map(r=>r.status).sort()).toEqual([200,409]);expect(await stock(source,p)).toBe('4.0000');
 const balance=await db.stockBalance.findFirstOrThrow({where:{businessId:business,productId:p,locationId:source}});
 await db.stockBalance.update({where:{id:balance.id},data:{reserved:'3'}});
 expect((await dispatch(await draft({lines:[{productId:p,quantity:'2'}]}))).body.error.code).toBe('INSUFFICIENT_STOCK');
 expect(await stock(source,p)).toBe('4.0000');
});
it('records partial arrivals with durable retry receipts and prevents concurrent over-receiving',async()=>{
 const doc=await moving(),input=event(doc,'4'),rows=await Promise.all([record(doc,input,destinationStaff),record(doc,input,destinationStaff)]);
 expect(rows.map(r=>r.status)).toEqual([200,200]);expect(rows[0]!.body.eventId).toBe(rows[1]!.body.eventId);
 const partial=rows[0]!.body.transfer;expect(partial).toMatchObject({status:'PARTIAL',lines:[{received:'4.0000',inTransit:'6.0000'}]});
 expect((await record(partial,{...input,lines:[{lineId:doc.lines[0].id,quantity:'5'}]},destinationStaff)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
 expect((await record(partial,event(partial,'7'),destinationStaff)).body.error.code).toBe('TRANSFER_QUANTITY_EXCEEDED');
 const contenders=await Promise.all([record(partial,event(partial,'6'),destinationStaff),record(partial,event(partial,'6'),destinationStaff)]);
 expect(contenders.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await get(`/${doc.id}`)).body).toMatchObject({status:'COMPLETED',lines:[{received:'10.0000',inTransit:'0.0000'}]});
 expect(await db.stockMovement.count({where:{sourceId:doc.id,type:'TRANSFER_IN'}})).toBe(2);
 expect((await record(doc,input,destinationStaff)).status).toBe(200);
});
it('resolves returned and lost goods explicitly, conserves quantities and keeps event history immutable',async()=>{
 const p=await funded('20'),doc=await moving({lines:[{productId:p,quantity:'10'}]});
 expect((await record(doc,event(doc,'1','LOSS'),destinationStaff)).status).toBe(403);
 expect((await record(doc,event(doc,'1','LOSS',{reason:''}))).status).toBe(422);
 const received=(await record(doc,event(doc,'4'),destinationStaff)).body.transfer;
 const returned=(await record(received,event(received,'3','RETURN'))).body.transfer;
 const result=await record(returned,event(returned,'3','LOSS'));expect(result.status).toBe(200);
 expect(result.body.transfer).toMatchObject({status:'COMPLETED',lines:[{quantity:'10.0000',received:'4.0000',returned:'3.0000',lost:'3.0000',inTransit:'0.0000'}]});
 expect(await stock(source,p)).toBe('13.0000');expect(await stock(destination,p)).toBe('4.0000');
 const history=await get(`/${doc.id}/events`,destinationStaff);expect(history.body.total).toBe(3);
 const loss=await db.transferEvent.findFirstOrThrow({where:{transferId:doc.id,kind:'LOSS'}});
 await expect(db.transferEvent.update({where:{id:loss.id},data:{reason:'tampered'}})).rejects.toThrow();
 const line=await db.transferEventLine.findFirstOrThrow({where:{eventId:loss.id}});
 await expect(db.transferEventLine.delete({where:{id:line.id}})).rejects.toThrow();
});
it('rolls back every source movement if one line lacks stock',async()=>{
 const p=await funded('2'),before=await stock(source);
 const doc=await draft({lines:[{productId:product,quantity:'1'},{productId:p,quantity:'3'}]});
 expect((await dispatch(doc)).body.error.code).toBe('INSUFFICIENT_STOCK');
 expect(await stock(source)).toBe(before);expect(await stock(source,p)).toBe('2.0000');
 expect(await db.stockMovement.count({where:{sourceId:doc.id}})).toBe(0);expect((await get(`/${doc.id}`)).body.status).toBe('DRAFT');
});
it('rolls back receipt stock, counters and history if closure fails after posting',async()=>{
 const doc=await moving({notes:'force transfer rollback'}),before=await stock(destination),input=event(doc,'10');
 await db.$executeRawUnsafe("CREATE FUNCTION test_transfer_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notes='force transfer rollback' AND NEW.status='COMPLETED' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END; $$");
 await db.$executeRawUnsafe('CREATE TRIGGER test_transfer_failure BEFORE UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION test_transfer_failure()');
 try{
  expect((await record(doc,input)).status).toBe(500);expect(await stock(destination)).toBe(before);
  expect(await db.transferEvent.count({where:{transferId:doc.id}})).toBe(0);
  expect((await get(`/${doc.id}`)).body.lines[0]).toMatchObject({received:'0.0000',inTransit:'10.0000'});
 }finally{await db.$executeRawUnsafe('DROP TRIGGER test_transfer_failure ON stock_transfers');await db.$executeRawUnsafe('DROP FUNCTION test_transfer_failure()');}
 expect((await record(doc,input)).status).toBe(200);
});
it('rolls back dispatch when the final status write fails after all source postings',async()=>{
 const doc=await draft({notes:'force dispatch rollback'}),before=await stock(source);
 await db.$executeRawUnsafe("CREATE FUNCTION test_dispatch_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notes='force dispatch rollback' AND NEW.status='IN_TRANSIT' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END; $$");
 await db.$executeRawUnsafe('CREATE TRIGGER test_dispatch_failure BEFORE UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION test_dispatch_failure()');
 try{
  expect((await dispatch(doc)).status).toBe(500);expect(await stock(source)).toBe(before);
  expect(await db.stockMovement.count({where:{sourceId:doc.id}})).toBe(0);
  expect((await get(`/${doc.id}`)).body.status).toBe('DRAFT');
 }finally{await db.$executeRawUnsafe('DROP TRIGGER test_dispatch_failure ON stock_transfers');await db.$executeRawUnsafe('DROP FUNCTION test_dispatch_failure()');}
 expect((await dispatch(doc)).status).toBe(200);
});
it('guards an empty destination with drafts and transit, preserving route snapshots',async()=>{
 const empty=(await db.location.create({data:{businessId:business,code:'EMPTY',name:'Empty branch',kind:'SHOP'}})).id;
 const doc=await draft({destinationId:empty});
 const archive=()=>request(app).patch(`/api/businesses/${business}/locations/${empty}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:0,active:false});
 expect(await stock(empty)).toBe('0.0000');expect((await archive()).body.error.code).toBe('LOCATION_IN_USE');
 expect((await write(`/${doc.id}/status`,{revision:0,action:'cancel',confirm:true})).status).toBe(200);
 const next=await moving({destinationId:empty});expect((await archive()).body.error.code).toBe('LOCATION_IN_USE');
 await db.location.update({where:{id:empty},data:{name:'Renamed branch'}});
 expect((await get(`/${next.id}`)).body.destinationName).toBe('Empty branch');
 expect((await record(next,event(next,'10','RETURN'))).status).toBe(200);
 expect((await archive()).status).toBe(200);
});
it('rejects overflow at destination and preserves the full in-transit quantity',async()=>{
 const p=await funded('2'),doc=await moving({lines:[{productId:p,quantity:'2'}]});
 await db.stockBalance.create({data:{businessId:business,locationId:destination,productId:p,onHand:'99999999999999.9999'}});
 expect((await record(doc,event(doc,'2'))).body.error.code).toBe('QUANTITY_OVERFLOW');
 expect(await db.transferEvent.count({where:{transferId:doc.id}})).toBe(0);expect((await get(`/${doc.id}`)).body.lines[0].inTransit).toBe('2.0000');
});
it('blocks archiving transfer endpoints, rechecks assignments and allows finishing after trial expiry',async()=>{
 const doc=await moving();
 const archive=await request(app).patch(`/api/businesses/${business}/locations/${destination}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:0,active:false});
 expect(archive.body.error.code).toBe('LOCATION_IN_USE');
 await db.product.update({where:{id:product},data:{active:false}});
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
 expect((await write('',body())).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await record(doc,event(doc,'1'),destinationStaff)).status).toBe(200);
 const partial=(await get(`/${doc.id}`)).body;
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:destinationStaff.user.id}}});
 await db.locationAssignment.deleteMany({where:{membershipId:member.id}});
 expect((await record(partial,event(partial,'1'),destinationStaff)).status).toBe(404);
 expect((await get(`/${doc.id}/events`,destinationStaff)).status).toBe(404);
 expect((await record(partial,event(partial,'9'))).status).toBe(200);
});
