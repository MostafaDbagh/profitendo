import Excel from 'exceljs';
import { columns, parseWorkbook } from '../src/catalogue/workbook.js';
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
let owner:AuthContext,staff:AuthContext,manager:AuthContext,admin:AuthContext,foreign:AuthContext,business:string,other:string,planId:string,hash:string,batchId:string;
async function actor(role:'OWNER'|'CASHIER'|'OPERATIONS_MANAGER'|'SUPER_ADMIN',tenant=business){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Catalogue tester',email:`${id}@example.test`,passwordHash:hash,emailVerifiedAt:new Date(),platformRole:role==='SUPER_ADMIN'?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(role!=='SUPER_ADMIN')await db.membership.create({data:{businessId:tenant,userId:id,role}});
 return auth.transaction(tx=>auth.makeSession(tx,user,true));
}
const cookie=(ctx:AuthContext)=>`pl_session=${ctx.token}`;
const get=(path='',who=owner,b=business)=>request(app).get(`/api/businesses/${b}/product-imports${path}`).set('Cookie',cookie(who));
const write=(path:string,body:object,who=owner,method:'post'|'patch'|'put'='post',b=business)=>request(app)[method](`/api/businesses/${b}/product-imports${path}`).set('Cookie',cookie(who)).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,who.token)).send(body);
beforeAll(async()=>{
 hash=await passwordHash('Catalogue test password 412!');business=(await db.business.create({data:{name:'Catalogue tenant'}})).id;other=(await db.business.create({data:{name:'Other tenant'}})).id;bids.push(business,other);
 owner=await actor('OWNER');staff=await actor('CASHIER');manager=await actor('OPERATIONS_MANAGER');admin=await actor('SUPER_ADMIN');foreign=await actor('OWNER',other);
 planId=(await db.billingPlan.create({data:{code:`catalogue-${randomUUID()}`,name:'Catalogue test',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:1,maxShops:1}})).id;
});
afterAll(async()=>{await db.productImport.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();});


const productRow=(sku='IMPORT-01',barcode='001234567890')=>[sku,'Imported milk','LITRE','1.2345','3.7500','0','','','','',barcode,'true'];
async function file(rows:unknown[][],headers:readonly string[]=columns){const wb=new Excel.Workbook(),sheet=wb.addWorksheet('Products');sheet.addRow([...headers]);for(const row of rows)sheet.addRow(row);return {filename:'products.xlsx',fileBase64:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')};}
async function preview(rows:unknown[][]){return write('/preview',await file(rows));}
it('requires owner/manager cost permission and CSRF before processing uploads',async()=>{
 const upload=await file([productRow()]);
 expect((await write('/preview',upload,staff)).status).toBe(403);expect((await write('/preview',upload,admin)).status).toBe(403);expect((await write('/preview',upload,foreign)).status).toBe(403);
 expect((await request(app).post(`/api/businesses/${business}/product-imports/preview`).set('Cookie',cookie(owner)).set('Origin',settings.appOrigin).send(upload)).status).toBe(403);
 expect((await write('/preview',upload)).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 await db.businessSubscription.createMany({data:bids.map(businessId=>({businessId,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}))});
});
it('returns row errors without writing products, including formula and numeric barcode rejection',async()=>{
 const numeric=productRow('NUM');numeric[10]=12345 as unknown as string;
 const formula=productRow('FORM');formula[4]={formula:'1+1',result:2} as unknown as string;
 const invalid=productRow('BAD');invalid[4]='-1';
 const res=await preview([productRow(),productRow(),numeric,formula,invalid]);expect(res.status).toBe(201);expect(res.body.id).toBeNull();
 expect(res.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({row:3,code:'IDENTIFIER_EXISTS'}),expect.objectContaining({row:4,code:'TEXT_REQUIRED'}),expect.objectContaining({row:5,code:'PLAIN_VALUES_REQUIRED'}),expect.objectContaining({row:6,field:'sellingPrice'})]));
 expect(await db.product.count({where:{businessId:business}})).toBe(0);expect(await db.productImport.count({where:{businessId:business}})).toBe(0);
});
it('stores an encrypted preview and commits all rows exactly once under concurrent retries',async()=>{
 const res=await preview([productRow(),productRow('IMPORT-02','00002')]);expect(res.status).toBe(201);expect(res.body.issues).toEqual([]);batchId=res.body.id;
 const batch=await db.productImport.findUniqueOrThrow({where:{id:batchId}});expect(batch.payload).not.toContain('Imported milk');expect(batch.payload).not.toContain('1.2345');
 expect(await db.product.count({where:{businessId:business}})).toBe(0);
 const results=await Promise.all([write(`/${batchId}/commit`,{confirm:true}),write(`/${batchId}/commit`,{confirm:true})]);expect(results.map(r=>r.status)).toEqual([200,200]);expect(results[0]!.body.count).toBe(2);
 expect(await db.product.count({where:{businessId:business}})).toBe(2);expect(await db.authAudit.count({where:{businessId:business,action:'products.imported'}})).toBe(1);
 expect((await db.productImport.findUniqueOrThrow({where:{id:batchId}})).payload).toBe('');
 expect((await db.productBarcode.findUniqueOrThrow({where:{businessId_value:{businessId:business,value:'001234567890'}}})).value).toBe('001234567890');
});
it('rechecks changed catalogue identifiers and rolls back the entire batch',async()=>{
 const res=await preview([productRow('NEW-1','N1'),productRow('NEW-2','N2')]);
 const created=await db.product.create({data:{businessId:business,sku:'NEW-2',name:'Concurrent product',unit:'PIECE',purchasePrice:'0',sellingPrice:'0'}});
 expect((await write(`/${res.body.id}/commit`,{confirm:true})).body.error.code).toBe('IMPORT_CONFLICT');
 expect(await db.product.count({where:{businessId:business,sku:'NEW-1'}})).toBe(0);
 await db.product.delete({where:{id:created.id}});await write(`/${res.body.id}/discard`,{});
});
it('binds previews to the uploader, tenant, current permissions and expiry',async()=>{
 const res=await preview([productRow('PRIVATE','PRIV')]);
 expect((await write(`/${res.body.id}/commit`,{confirm:true},manager)).status).toBe(404);
 expect((await write(`/${res.body.id}/commit`,{confirm:true},foreign,'post',other)).status).toBe(404);
 await db.productImport.update({where:{id:res.body.id},data:{expiresAt:new Date(0)}});
 expect((await write(`/${res.body.id}/commit`,{confirm:true})).body.error.code).toBe('IMPORT_EXPIRED');
 const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:business,userId:manager.user.id}}});
 const managed=await write('/preview',await file([productRow('MANAGED','MNG')]),manager);expect(managed.status).toBe(201);
 await db.membership.update({where:{id:member.id},data:{permissionOverrides:{'catalogue.cost':false}}});expect((await get('/template',manager)).status).toBe(403);
 expect((await write(`/${managed.body.id}/commit`,{confirm:true},manager)).status).toBe(403);
});
it('rejects a changed business currency and commits a 500-row batch without partial writes',async()=>{
 const upload=await file([productRow('CURRENCY','CUR')]);const res=await write('/preview',upload,foreign,'post',other);expect(res.status).toBe(201);
 await db.business.update({where:{id:other},data:{baseCurrency:'EUR'}});
 expect((await write(`/${res.body.id}/commit`,{confirm:true},foreign,'post',other)).body.error.code).toBe('IMPORT_CURRENCY_CHANGED');
 await db.business.update({where:{id:other},data:{baseCurrency:'USD'}});
 const bulk=await write('/preview',await file(Array.from({length:500},(_,i)=>productRow(`BULK-${i}`,`B-${i}`))),foreign,'post',other);expect(bulk.status).toBe(201);
 const result=await write(`/${bulk.body.id}/commit`,{confirm:true},foreign,'post',other);expect(result.status).toBe(200);expect(result.body.count).toBe(500);
 expect(await db.product.count({where:{businessId:other}})).toBe(500);expect(await db.productBarcode.count({where:{businessId:other}})).toBe(500);
 expect(await db.authAudit.count({where:{businessId:other,action:'product.created'}})).toBe(500);
});
it('rechecks subscription eligibility while allowing completed retries after expiry',async()=>{
 const res=await preview([productRow('EXPIRED','EXP')]);
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
 expect((await write(`/${res.body.id}/commit`,{confirm:true})).body.error.code).toBe('SUBSCRIPTION_REQUIRED');
 expect((await write(`/${batchId}/commit`,{confirm:true})).body.count).toBe(2);
});
it('provides a text-formatted template and rejects malformed or oversized workbooks',async()=>{
 const template=await get('/template');expect(template.status).toBe(200);const rows=await parseWorkbook(Buffer.from(template.body.fileBase64,'base64'));expect(rows[0]!.values).toEqual(columns);
 await expect(parseWorkbook(Buffer.from('not a zip'))).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
 await expect(parseWorkbook(Buffer.alloc(1024*1024+1))).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
 const tooMany=await file(Array.from({length:501},(_,i)=>productRow(`SKU-${i}`,`BAR-${i}`)));await expect(parseWorkbook(Buffer.from(tooMany.fileBase64,'base64'))).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
});
it('rejects expanded ZIP payloads before workbook parsing and rejects extra sheets',async()=>{
 const wb=new Excel.Workbook();wb.addWorksheet('Products').addRow(['x'.repeat(9*1024*1024)]);
 const compressed=Buffer.from(await wb.xlsx.writeBuffer());expect(compressed.length).toBeLessThan(1024*1024);
 await expect(parseWorkbook(compressed)).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
 const two=new Excel.Workbook();two.addWorksheet('One');two.addWorksheet('Two');await expect(parseWorkbook(Buffer.from(await two.xlsx.writeBuffer()))).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
});
