import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService, type AuthContext } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { csrfFor, encrypt, passwordHash } from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const ids:string[]=[],bids:string[]=[];
let owner:AuthContext,staff:AuthContext,manager:AuthContext,admin:AuthContext,foreign:AuthContext,business:string,other:string,planId:string,hash:string,productId:string;
async function actor(role:'OWNER'|'CASHIER'|'OPERATIONS_MANAGER'|'SUPER_ADMIN',tenant=business){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Catalogue tester',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(role!=='SUPER_ADMIN')await db.membership.create({data:{businessId:tenant,userId:id,role}});
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
const get=(path='',who=owner,b=business)=>request(app).get(`/api/businesses/${b}/products${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'|'put'='post',b=business)=>request(app)[method](`/api/businesses/${b}/products${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
const input=(sku='SKU-01',barcodes=['001234567890'])=>({sku,name:'Milk one litre',unit:'LITRE',purchasePrice:'1.2345',sellingPrice:'2.5000',minimumStock:'3.2500',barcodes});
beforeAll(async()=>{
 hash=await passwordHash('Catalogue test password 412!');business=(await db.business.create({data:{name:'Catalogue tenant'}})).id;other=(await db.business.create({data:{name:'Other tenant'}})).id;bids.push(business,other);
 owner=await actor('OWNER');staff=await actor('CASHIER');manager=await actor('OPERATIONS_MANAGER');admin=await actor('SUPER_ADMIN');foreign=await actor('OWNER',other);
 planId=(await db.billingPlan.create({data:{code:`catalogue-${randomUUID()}`,name:'Catalogue test',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:1,maxShops:1}})).id;
});
afterAll(async()=>{await db.productPack.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();});

it('requires tenant access, management, CSRF and trial entitlement',async()=>{
 expect((await get('',admin)).status).toBe(403);expect((await get('',foreign)).status).toBe(403);
 expect((await write('',input(),staff)).status).toBe(403);
 expect((await request(app).post(`/api/businesses/${business}/products`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send(input())).status).toBe(403);
 expect((await write('',input())).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 await db.businessSubscription.createMany({data:bids.map(businessId=>({businessId,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}))});
});
it('validates precise decimals and unique barcode inputs without rounding',async()=>{
 for(const change of [{purchasePrice:1.25},{sellingPrice:'1.00001'},{minimumStock:'-1'},{purchasePrice:'1e2'},{barcodes:['123','123']},{barcodes:['']},{unit:'INVALID'},{stock:100}])expect((await write('',{...input(),...change})).status).toBe(422);
 const result=await write('',input());expect(result.status).toBe(201);productId=result.body.id;
 expect(result.body).toMatchObject({purchasePrice:'1.2345',sellingPrice:'2.5000',minimumStock:'3.2500',barcodes:['001234567890']});expect(result.body).not.toHaveProperty('stock');
 expect((await db.business.findUniqueOrThrow({where:{id:business}})).currencyLockedAt).not.toBeNull();
});
it('scopes identifiers per business and atomically rolls back barcode conflicts',async()=>{
 expect((await write('',input('SKU-01',['OTHER']))).body.error.code).toBe('PRODUCT_IDENTIFIER_EXISTS');
 const results=await Promise.all([write('',input('SKU-02',['SHARED'])),write('',input('SKU-03',['SHARED']))]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
 expect(await db.product.count({where:{businessId:business}})).toBe(2);
 expect((await write('',input(),foreign,'post',other)).status).toBe(201);
 const failed=await write(`/${productId}`,{revision:0,name:'Should rollback',barcodes:['SHARED']},owner,'patch');expect(failed.status).toBe(409);
 const original=await get(`/${productId}`);expect(original.body.product).toMatchObject({revision:0,name:'Milk one litre',barcodes:['001234567890']});
});
it('redacts costs in lists, detail and exact scanner lookups, preserving leading zeros',async()=>{
 for(const path of ['',`/${productId}`,'/barcode?value=001234567890']){
  const response=await get(path,staff);expect(response.status).toBe(200);expect(response.text).not.toContain('purchasePrice');expect(response.text).not.toContain('1.2345');
 }
 expect((await get('/barcode?value=1234567890',staff)).body.error.code).toBe('PRODUCT_NOT_FOUND');
 expect((await get('?search=001234567890',staff)).body.total).toBe(1);
 expect((await get(`/${productId}`,foreign,other)).status).toBe(404);
 expect((await get('/barcode?value=001234567890',foreign,other)).body.product.id).not.toBe(productId);
});
it('checks revisions, immutable units/SKUs and purchase-cost permissions on writes',async()=>{
 expect((await write(`/${productId}`,{revision:0,unit:'PIECE'},owner,'patch')).status).toBe(422);
 expect((await write(`/${productId}`,{revision:0,sku:'CHANGED'},owner,'patch')).status).toBe(422);
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:manager.user.id}}});
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'catalogue.cost':false}}});
 expect((await write(`/${productId}`,{revision:0,purchasePrice:'9'},manager,'patch')).status).toBe(403);
 const saved=await write(`/${productId}`,{revision:0,sellingPrice:'3.75',barcodes:['001234567890','ALT-01']},manager,'patch');expect(saved.status).toBe(200);expect(saved.body).not.toHaveProperty('purchasePrice');
 expect((await write(`/${productId}`,{revision:0,name:'Stale'},owner,'patch')).body.error.code).toBe('REVISION_CONFLICT');
 expect((await get('/barcode?value=ALT-01')).body.product.id).toBe(productId);
 const audit=await db.authAudit.findFirstOrThrow({where:{businessId:business,action:'product.updated'}});expect(JSON.stringify(audit.changes)).not.toContain('3.75');
});
it('creates immutable tenant-scoped packs and converts exactly without stock or price changes',async()=>{
 const path=`/${productId}/packs`;
 expect((await write(path,{name:'Carton',baseQuantity:'12'},staff)).status).toBe(403);
 expect((await write(path,{name:'Carton',baseQuantity:'12'},foreign,'post',other)).status).toBe(404);
 for(const factor of ['0','-1','0.00001','1e2'])expect((await write(path,{name:'Carton',baseQuantity:factor})).status).toBe(422);
 const before=(await get(`/${productId}`)).body.product;
 const pack=await write(path,{name:'Carton',baseQuantity:'12'});
 expect(pack.status).toBe(201);expect(pack.body.baseQuantity).toBe('12.0000');
 expect((await write(path,{name:'Carton',baseQuantity:'24'})).body.error.code).toBe('PACK_EXISTS');
 expect((await get(path,staff)).body.items).toHaveLength(1);
 expect((await get(path,admin)).status).toBe(403);
 const conversion=await write(`${path}/${pack.body.id}/convert`,{quantity:'2.5'},staff);
 expect(conversion.body).toMatchObject({baseQuantity:'30.0000',baseUnit:'LITRE'});
 expect((await write(`${path}/${pack.body.id}/convert`,{quantity:'99999999999999'})).body.error.code).toBe('QUANTITY_OVERFLOW');
 expect((await write(`${path}/${pack.body.id}/convert`,{quantity:'1'},foreign,'post',other)).status).toBe(404);
 expect((await write(`${path}/${pack.body.id}`,{baseQuantity:'24'},owner,'patch')).status).toBe(404);
 const fractional=await write(path,{name:'Small measure',baseQuantity:'0.0001'});
 expect((await write(`${path}/${fractional.body.id}/convert`,{quantity:'0.0001'})).body.error.code).toBe('QUANTITY_PRECISION');
 expect((await get(`/${productId}`)).body.product).toEqual(before);
 expect(await db.authAudit.count({where:{businessId:business,action:'product.pack_created'}})).toBe(2);
 const subscription=await db.businessSubscription.findUniqueOrThrow({where:{businessId:business}});
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
 expect((await write(path,{name:'Expired plan pack',baseQuantity:'6'})).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await get(path,staff)).status).toBe(200);
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:subscription.trialStartedAt,trialEndsAt:subscription.trialEndsAt}});

});
it('retains inactive identifiers and blocks growth after expiry without hiding records',async()=>{
 expect((await write(`/${productId}`,{revision:1,active:false},owner,'patch')).status).toBe(200);
 expect((await get('/barcode?value=ALT-01')).body.error.code).toBe('PRODUCT_INACTIVE');
 expect((await get('?state=inactive')).body.items[0].id).toBe(productId);
 expect((await write('',input('NEW',['ALT-01']))).status).toBe(409);
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
 expect((await write(`/${productId}`,{revision:2,active:true},owner,'patch')).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await get(`/${productId}`)).status).toBe(200);
 expect((await get(`/${productId}/packs`)).status).toBe(200);
 await db.business.update({where:{id:business},data:{suspendedAt:new Date()}});expect((await get()).status).toBe(403);
});

it('manages tenant units and images, and retires packs without rewriting history',async()=>{
 await db.business.update({where:{id:business},data:{suspendedAt:null}});
 await db.businessSubscription.update({where:{businessId:business},data:{trialEndsAt:new Date(Date.now()+86400000)}});
 const ref=await write('/references',{kind:'UNIT',code:'BOTTLE',name:'Bottle'});expect(ref.status).toBe(201);
 expect((await write('/references',{kind:'UNIT',code:'BOTTLE',name:'Duplicate'})).status).toBe(409);
 const created=await write('',{...input('IMAGE-01',['IMAGE']),unit:'BOTTLE'});expect(created.status).toBe(201);
 expect((await write(`/references/${ref.body.id}`,{revision:0,active:false},owner,'patch')).status).toBe(200);
 expect((await write('',{...input('IMAGE-02',['IMAGE2']),unit:'BOTTLE'})).status).toBe(422);
 expect((await get(`/${created.body.id}`)).body.product.unit).toBe('BOTTLE');
 const path=`/${created.body.id}`,sharp=(await import('sharp')).default;
 const fileBase64=(await sharp({create:{width:10,height:10,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64');
 expect((await write(`${path}/image`,{revision:0,fileBase64},staff,'put')).status).toBe(403);
 expect((await write(`${path}/image`,{revision:0,fileBase64:'PHN2Zy8+'},owner,'put')).status).toBe(422);
 expect((await write(`${path}/image`,{revision:0,fileBase64},owner,'put')).status).toBe(200);
 expect((await get(`${path}/image`,foreign,other)).status).toBe(404);
 expect((await get(`${path}/image`,staff)).body.dataUrl).toMatch(/^data:image\/webp;base64,/);
 expect((await write(`${path}/image`,{revision:0,fileBase64:null},owner,'put')).status).toBe(409);
 expect((await write(`${path}/image`,{revision:1,fileBase64:null},owner,'put')).status).toBe(200);
 const pack=await write(`${path}/packs`,{name:'Old carton',baseQuantity:'12'});expect(pack.status).toBe(201);
 expect((await write(`${path}/packs/${pack.body.id}/retire`,{confirm:true})).status).toBe(200);
 expect((await get(`${path}/packs`)).body.items[0].retiredAt).toBeTruthy();
 expect((await write(`${path}/packs/${pack.body.id}/convert`,{quantity:'2'})).body.baseQuantity).toBe('24.0000');
});
it('enforces add and edit product grants independently at the API',async()=>{
 const creator=await actor('CASHIER');
 await db.membership.updateMany({where:{userId:creator.user.id,businessId:business},data:{permissionOverrides:{'catalogue.create':true,'catalogue.edit':false,'catalogue.cost':true}}});
 const made=await write('',input(`GRANT-${randomUUID().slice(0,8)}`,[]),creator);expect(made.status,made.text).toBe(201);
 expect((await write(`/${made.body.id}`,{revision:0,name:'Denied edit'},creator,'patch')).status).toBe(403);
 await db.membership.updateMany({where:{userId:creator.user.id,businessId:business},data:{permissionOverrides:{'catalogue.create':false,'catalogue.edit':true,'catalogue.cost':true}}});
 expect((await write('',input(`DENY-${randomUUID().slice(0,8)}`,[]),creator)).status).toBe(403);
 expect((await write(`/${made.body.id}`,{revision:0,name:'Allowed edit'},creator,'patch')).status).toBe(200);
});

it('separates product deactivation from editing and honors explicit delete denial',async()=>{
 const p=await db.product.create({data:{businessId:business,sku:`DEL-${randomUUID().toUpperCase()}`,name:'Deletion permission test',unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}});
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:manager.user.id}}});
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'catalogue.delete':false}}});
 try {
  expect((await write(`/${p.id}`,{revision:0,active:false},manager,'patch')).status).toBe(403);
  expect((await write(`/${p.id}`,{revision:0,name:'Still editable'},manager,'patch')).status).toBe(200);
  await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'catalogue.delete':true}}});
  expect((await write(`/${p.id}`,{revision:1,active:false},manager,'patch')).status).toBe(200);
 } finally {await db.membership.update({where:{id:member.id},data:{permissionOverrides:member.permissionOverrides!}});}
});

it('keeps records and image files isolated even when the caller owns both businesses',async()=>{
 const dual=await actor('OWNER');
 await db.membership.create({data:{businessId:other,userId:dual.user.id,role:'OWNER'}});
 const created=await write('',input(`PRIVATE-${randomUUID().slice(0,8)}`,[]),foreign,'post',other);
 expect(created.status,created.text).toBe(201);
 const id=created.body.id,sharp=(await import('sharp')).default;
 const fileBase64=(await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer()).toString('base64');
 expect((await write(`/${id}/image`,{revision:0,fileBase64},foreign,'put',other)).status).toBe(200);
 const actual=await get(`/${id}/image`,dual,other);expect(actual.status).toBe(200);expect(actual.body.dataUrl).toMatch(/^data:image\/webp/);
 for(const who of [owner,dual]){
  for(const path of [`/${id}`,`/${id}/image`,`/${id}/packs`]){
   const denied=await get(path,who);expect(denied.status,denied.text).toBe(404);expect(denied.text).not.toContain(actual.body.dataUrl);
  }
  expect((await write(`/${id}`,{revision:1,name:'Injected tenant write'},who,'patch')).status).toBe(404);
  expect((await write(`/${id}/image`,{revision:1,fileBase64:null},who,'put')).status).toBe(409);
 }
 expect((await get(`/${id}`,dual,other)).body.product.name).toBe(created.body.name);
 expect((await get(`/${id}/image`,dual,other)).body.dataUrl).toBe(actual.body.dataUrl);
});

it('blocks existing cookies from files and records immediately after staff access changes',async()=>{
 const employee=await actor('OPERATIONS_MANAGER');
 const p=await db.product.create({data:{businessId:business,sku:`SESSION-${randomUUID().toUpperCase()}`,name:'Session protected record',unit:'PIECE',purchasePrice:'1',sellingPrice:'2'}});
 expect((await get(`/${p.id}`,employee)).status).toBe(200);
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:employee.user.id}}});
 const change=await request(app).patch(`/api/businesses/${business}/members/${member.id}`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,owner.token)).send({revision:0,active:false});
 expect(change.status,change.text).toBe(200);
 for(const path of [`/${p.id}`,`/${p.id}/image`])expect((await get(path,employee)).status).toBe(401);
 expect((await write(`/${p.id}`,{revision:0,name:'Revoked write'},employee,'patch')).status).toBe(401);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).revision).toBe(0);
});
