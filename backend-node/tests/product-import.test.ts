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

it('previews and commits CSV with the same identifier preservation and atomic workflow',async()=>{
 await db.businessSubscription.update({where:{businessId:business},data:{trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const row=productRow('CSV-001','00098765');row[1]='حليب, طازج';
 const escape=(v:string)=>'"'+v.replaceAll('"','""')+'"';
 const res=await write('/preview',{filename:'products.csv',fileBase64:Buffer.from('\uFEFF'+columns.join(',')+'\r\n'+row.map(escape).join(',')).toString('base64')});
 expect(res.status).toBe(201);expect(res.body.issues).toEqual([]);expect(res.body.rows[0].product.barcodes).toEqual(['00098765']);
 expect((await write(`/${res.body.id}/commit`,{confirm:true})).status).toBe(200);
 expect((await db.product.findUniqueOrThrow({where:{businessId_sku:{businessId:business,sku:'CSV-001'}}})).name).toBe('حليب, طازج');
});
it('rejects CSV missing required, duplicate and extra headers before creating a preview',async()=>{
 for(const headers of [columns.filter(c=>c!=='name'),columns.map(()=> 'sku'),[...columns,'extra']]){
  const res=await write('/preview',{filename:'bad.csv',fileBase64:Buffer.from(headers.join(',')+'\n'+productRow().join(',')).toString('base64')});
  expect(res.status).toBe(422);expect(res.body.error.code).toBe('IMPORT_HEADERS');
 }
 const extraExcel=await write('/preview',await file([productRow()], [...columns,'unexpected']));expect(extraExcel.body.error.code).toBe('IMPORT_HEADERS');
 const template=await get('/template?format=csv');expect(template.status).toBe(200);expect(Buffer.from(template.body.fileBase64,'base64').toString()).toBe('\uFEFF'+columns.join(',')+'\r\n');
});

it.each(['ar','en'] as const)('round-trips a real %s export with reordered columns, existing rows and a new product',async lang=>{
 const tester=await actor('OWNER');
 const before=await db.product.findMany({where:{businessId:business},orderBy:{id:'asc'},include:{barcodes:true}});
 const stockBefore=await db.stockBalance.findMany({where:{businessId:business}});
 const foreignBefore=await db.product.count({where:{businessId:other}});
 const exported=await request(app).get(`/api/businesses/${business}/products/insights?export=true&lang=${lang}`).set('Cookie',cookie(tester));
 expect(exported.status).toBe(200);
 const {parseCsv}=await import('../src/catalogue/csv.js');
 const {importHeaderMap}=await import('../src/catalogue/workbook.js');
 const {csvCell}=await import('../src/reports/service.js');
 const source=parseCsv(Buffer.from(exported.body.csv));
 const keys=importHeaderMap(source[0]!.values)!;
 const added:Record<string,string>={sku:`ROUND-${lang}`,name:`Coffee ${lang}`,unit:lang==='ar'?'غرام':'Gram',purchasePrice:'1.2345',sellingPrice:'',minimumStock:'',barcodes:`000-ROUND-${lang}`,active:lang==='ar'?'نعم':'Yes'};
 const newRow=keys.map(key=>added[key]??'');
 // Edits to existing rows must never overwrite existing catalogue records.
 source[1]!.values[keys.indexOf('name')]='Do not overwrite this product';
 const reordered=[...source.map(row=>row.values),newRow].map(values=>[...values].reverse());
 const content=reordered.map(values=>values.map(csvCell).join(',')).join('\r\n');
 const result=await write('/preview',{filename:'roundtrip.csv',fileBase64:Buffer.from(content).toString('base64'),duplicateMode:'skip'},tester);
 expect(result.status).toBe(201);expect(result.body.issues).toEqual([]);expect(result.body.skipped).toBe(before.length);expect(result.body.total).toBe(1);
 expect(result.body.rows[0].product).toMatchObject({sku:`ROUND-${lang.toUpperCase()}`,unit:'GRAM',purchasePrice:'1.2345',sellingPrice:'0',minimumStock:'0',category:'',barcodes:[`000-ROUND-${lang}`]});
 expect((await write(`/${result.body.id}/commit`,{confirm:true},tester)).body.count).toBe(1);
 expect(await db.product.findMany({where:{businessId:business,id:{in:before.map(p=>p.id)}},orderBy:{id:'asc'},include:{barcodes:true}})).toEqual(before);
 expect(await db.stockBalance.findMany({where:{businessId:business}})).toEqual(stockBefore);
 expect(await db.product.count({where:{businessId:other}})).toBe(foreignBefore);
 const repeated=await write('/preview',{filename:'roundtrip.csv',fileBase64:Buffer.from(content).toString('base64'),duplicateMode:'skip'},tester);
 expect(repeated.body).toMatchObject({id:null,total:0,issues:[],rows:[],skipped:before.length+1});
});

it('accepts mixed-language reordered Excel columns with only required fields and rejects semantic duplicates',async()=>{
 const tester=await actor('OWNER');
 const res=await write('/preview',await file([['1.2345','Coffee minimal','غرام']],['تكلفة الشراء','Product Name','UNIT']),tester);
 expect(res.status).toBe(201);expect(res.body.issues).toEqual([]);
 expect(res.body.rows[0].product).toMatchObject({name:'Coffee minimal',unit:'GRAM',sellingPrice:'0',minimumStock:'0',category:''});
 expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).body.count).toBe(1);
 const duplicate=await write('/preview',await file([['A','B','GRAM','1']],['name','اسم المنتج','unit','purchasePrice']),tester);
 expect(duplicate.status).toBe(422);expect(duplicate.body.error.code).toBe('IMPORT_HEADERS');
});

it('does not skip a SKU belonging only to another tenant, and rejects conflicting new barcodes',async()=>{
 const tester=await actor('OWNER');
 const sameForeignSku=await write('/preview',await file([productRow('BULK-0','LOCAL-BULK-0')]),tester);
 expect(sameForeignSku.body.issues).toEqual([]);expect(sameForeignSku.body.total).toBe(1);expect(sameForeignSku.body.skipped).toBe(0);
 expect((await write(`/${sameForeignSku.body.id}/commit`,{confirm:true},tester)).body.count).toBe(1);
 const conflict=await write('/preview',await file([productRow('NEW-BARCODE-CONFLICT','001234567890')]),tester);
 expect(conflict.body.id).toBeNull();expect(conflict.body.issues).toContainEqual(expect.objectContaining({field:'barcodes',code:'IDENTIFIER_EXISTS'}));
 expect(await db.product.count({where:{businessId:business,sku:'NEW-BARCODE-CONFLICT'}})).toBe(0);
});

it.each(['ar','en'] as const)('serves %s templates through the real API for both formats',async lang=>{
 const {templateColumns}=await import('../src/catalogue/workbook.js');
 const {parseCsv}=await import('../src/catalogue/csv.js');
 for(const format of ['csv','xlsx']){
  const response=await get(`/template?format=${format}&lang=${lang}`);
  expect(response.status).toBe(200);
  const bytes=Buffer.from(response.body.fileBase64,'base64');
  const rows=format==='csv'?parseCsv(bytes):await parseWorkbook(bytes);
  expect(rows[0]!.values).toEqual([...templateColumns(lang)]);
 }
});
it('reports missing purchase cost and duplicate new SKUs without creating products',async()=>{
 const tester=await actor('OWNER');
 const before=await db.product.count({where:{businessId:business}});
 const emptyCost=productRow('EMPTY-COST','EMPTY-COST-BAR');emptyCost[3]='';
 const res=await write('/preview',await file([emptyCost,productRow('DUPLICATE-NEW','DUP-A'),productRow('DUPLICATE-NEW','DUP-B')]),tester);
 expect(res.body.id).toBeNull();
 expect(res.body.issues).toContainEqual(expect.objectContaining({field:'purchasePrice',code:'INVALID_VALUE'}));
 expect(res.body.issues).toContainEqual(expect.objectContaining({field:'sku',code:'IDENTIFIER_EXISTS'}));
 expect(await db.product.count({where:{businessId:business}})).toBe(before);
});


it('shows duplicates and supports explicitly excluding or keeping them without overwriting products',async()=>{
 const tester=await actor('OWNER');
 const upload=await file([productRow('IMPORT-01','001234567890'),productRow('RESOLVE-NEW','RESOLVE-BAR')]);
 const before=await db.product.findUniqueOrThrow({where:{businessId_sku:{businessId:business,sku:'IMPORT-01'}}});
 const review=await write('/preview',upload,tester);
 expect(review.body.id).toBeNull();expect(review.body.duplicates[0]).toMatchObject({row:2,sku:'IMPORT-01',fields:expect.arrayContaining(['sku','barcodes','name'])});
 const skipped=await write('/preview',{...upload,duplicateMode:'skip'},tester);
 expect(skipped.body).toMatchObject({id:null,skipped:2,total:0,issues:[]});
 const kept=await write('/preview',{...upload,duplicateMode:'keep'},tester);
 expect(kept.body.issues).toEqual([]);expect(kept.body.rows[0].product.sku).toMatch(/^PRD-/);expect(kept.body.rows[0].product.barcodes).toEqual([]);
 expect(kept.body.rows[1].product).toMatchObject({sku:'RESOLVE-NEW',barcodes:['RESOLVE-BAR']});
 expect((await write(`/${kept.body.id}/commit`,{confirm:true},tester)).body.count).toBe(2);
 expect(await db.product.findUniqueOrThrow({where:{id:before.id}})).toEqual(before);
 expect(await db.stockBalance.count({where:{businessId:business}})).toBe(0);
});
it('keeps the first accepted row and excludes subsequent in-file duplicates',async()=>{
 const tester=await actor('OWNER');
 const row=productRow('FRESH-DUP','FRESH-BAR');row[1]='Unique in-file product';
 const res=await write('/preview',{...await file([row,row]),duplicateMode:'skip'},tester);
 expect(res.body).toMatchObject({total:1,skipped:1,issues:[]});expect(res.body.duplicates).toHaveLength(1);
 expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).body.count).toBe(1);
});
it('supports an accountant permission profile, then rechecks revoked permissions on commit',async()=>{
 const accountant=await actor('CASHIER');
 await db.membership.update({where:{businessId_userId:{businessId:business,userId:accountant.user.id}},data:{permissionOverrides:{'catalogue.create':true,'catalogue.cost':true}}});
 const res=await write('/preview',await file([['محصول عربي','قطعة','١٬٢٣٤٫٥٠٠٠','٢٥٠٠٫٧٥']],['اسم الصنف','وحدة القياس','سعر الشراء','سعر البيع']),accountant);
 expect(res.status).toBe(201);expect(res.body.issues).toEqual([]);
 expect(res.body.rows[0].product).toMatchObject({purchasePrice:'1234.5000',sellingPrice:'2500.75',unit:'PIECE'});
 expect((await write(`/${res.body.id}/commit`,{confirm:true},accountant)).body.count).toBe(1);
 const pending=await write('/preview',await file([productRow('ACCOUNTANT-PENDING','ACC-PENDING')]),accountant);
 await db.membership.update({where:{businessId_userId:{businessId:business,userId:accountant.user.id}},data:{permissionOverrides:{'catalogue.create':true,'catalogue.cost':false}}});
 expect((await write(`/${pending.body.id}/commit`,{confirm:true},accountant)).status).toBe(403);
 expect(await db.product.count({where:{businessId:business,sku:'ACCOUNTANT-PENDING'}})).toBe(0);
});
it('never bypasses invalid prices when resolving duplicates',async()=>{
 const tester=await actor('OWNER');const bad=productRow('IMPORT-01','001234567890');bad[3]='1,25';
 for(const duplicateMode of ['keep','skip']){
  const res=await write('/preview',{...await file([bad]),duplicateMode},tester);
  expect(res.body.id).toBeNull();expect(res.body.issues).toContainEqual(expect.objectContaining({field:'purchasePrice',code:'INVALID_VALUE'}));
 }
});

it('keeps in-file identifier copies as separate products and preserves exact financial values',async()=>{
 const tester=await actor('OWNER');const row=productRow('COPY-FILE','000-COPY-FILE');row[1]='Repeated copy';row[3]='99999999999999.9999';row[4]='0';
 const res=await write('/preview',{...await file([row,row]),duplicateMode:'keep'},tester);
 expect(res.body.issues).toEqual([]);expect(res.body.rows[1].product).toMatchObject({name:'Repeated copy',purchasePrice:'99999999999999.9999',sellingPrice:'0',barcodes:[]});
 expect(res.body.rows[1].product.sku).not.toBe('COPY-FILE');
 expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).body.count).toBe(2);
 expect((await db.product.findUniqueOrThrow({where:{businessId_sku:{businessId:business,sku:'COPY-FILE'}}})).purchasePrice.toString()).toBe('99999999999999.9999');
});
it('shows same-name warnings without changing distinct valid identifiers',async()=>{
 const tester=await actor('OWNER');const first=productRow('NAME-ONE','NAME-BAR-ONE'),second=productRow('NAME-TWO','NAME-BAR-TWO');first[1]='Special Coffee';second[1]='special   coffee';
 const res=await write('/preview',await file([first,second]),tester);
 expect(res.body.issues).toEqual([]);expect(res.body.duplicates).toEqual([expect.objectContaining({row:3,fields:['name']})]);
 expect(res.body.rows.map((r:{product:{sku:string}})=>r.product.sku)).toEqual(['NAME-ONE','NAME-TWO']);
 await write(`/${res.body.id}/discard`,{},tester);
});
it('reports invalid units, boolean values and excessive precision together without partial writes',async()=>{
 const tester=await actor('OWNER');const row=productRow('BAD-FIELDS','BAD-FIELDS-BAR');row[2]='UNKNOWN';row[3]='1.23456';row[11]='maybe';
 const res=await write('/preview',await file([row]),tester);
 expect(res.body.id).toBeNull();expect(res.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({field:'purchasePrice'}),expect.objectContaining({field:'active'})]));
 expect(await db.product.count({where:{businessId:business,sku:'BAD-FIELDS'}})).toBe(0);
});

it('rejects numeric zero SKUs instead of silently replacing them with generated identifiers',async()=>{
 const tester=await actor('OWNER');const row:unknown[]=productRow('ZERO-SKU','ZERO-SKU-BAR');row[0]=0;
 const res=await write('/preview',await file([row]),tester);
 expect(res.body.id).toBeNull();expect(res.body.issues).toContainEqual(expect.objectContaining({field:'sku/barcodes',code:'TEXT_REQUIRED'}));
});
it.each(['TRUE','FALSE','True','False','YES','NO'])('accepts case-insensitive active value %s',async active=>{
 const tester=await actor('OWNER');const row=productRow(`ACTIVE-${active.toUpperCase()}`,`BAR-${active}`);row[11]=active;
 const res=await write('/preview',await file([row]),tester);expect(res.status).toBe(201);expect(res.body.issues).toEqual([]);
 expect(res.body.rows[0].product.active).toBe(['true','yes'].includes(active.toLowerCase()));await write(`/${res.body.id}/discard`,{},tester);
});
it.each([
 ['purchasePrice',3,'-0.01'],['purchasePrice',3,'100000000000000'],['sellingPrice',4,'1e3'],['sellingPrice',4,'NaN'],
 ['minimumStock',5,'-1'],['minimumStock',5,'0.00001'],['name',1,''],['name',1,'a'],['name',1,'x'.repeat(161)],
 ['category',6,'x'.repeat(81)],['description',9,'x'.repeat(2001)],['sku',0,'BAD SKU'],['barcodes',10,'bad barcode'],
 ['barcodes',10,'REPEAT\nREPEAT'],['barcodes',10,Array.from({length:21},(_,i)=>`B${i}`).join('\n')],['active',11,'sometimes']
])('rejects invalid %s value without creating a preview',async(field,index,value)=>{
 const tester=await actor('OWNER');const row=productRow(`INVALID-${randomUUID()}`,'VALID-BAR');row[Number(index)]=String(value);
 const res=await write('/preview',await file([row]),tester);expect(res.status).toBe(201);expect(res.body.id).toBeNull();
 expect(res.body.issues).toContainEqual(expect.objectContaining({field,code:'INVALID_VALUE'}));
 expect(await db.productImport.count({where:{actorId:tester.user.id}})).toBe(0);
});
it('keeps nonconflicting barcodes while resolving a barcode-only duplicate',async()=>{
 const tester=await actor('OWNER');const row=productRow('PARTIAL-BAR','001234567890\n000-UNIQUE-BAR');row[1]='A unique mixed-barcode item';
 const res=await write('/preview',{...await file([row]),duplicateMode:'keep'},tester);
 expect(res.body.issues).toEqual([]);expect(res.body.rows[0].product).toMatchObject({sku:'PARTIAL-BAR',barcodes:['000-UNIQUE-BAR']});
 expect(res.body.duplicates[0].fields).toEqual(['barcodes']);expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).status).toBe(200);
});
it('does not let an excluded row reserve its otherwise unique identifiers',async()=>{
 const tester=await actor('OWNER');const first=productRow('REUSE-SKIPPED','REUSE-SKIPPED-BAR'),second=[...first];second[1]='Distinct survivor';
 const res=await write('/preview',{...await file([first,second]),duplicateMode:'skip'},tester);
 expect(res.body).toMatchObject({total:1,skipped:1,issues:[]});expect(res.body.rows[0].row).toBe(3);
 expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).body.count).toBe(1);
});
it('rechecks retired custom units and categories on confirmation with atomic rollback',async()=>{
 const tester=await actor('OWNER');
 for(const kind of ['UNIT','CATEGORY'] as const){
  const reference=await db.catalogueReference.create({data:{businessId:business,kind,code:`REF_${kind}`,name:`Custom ${kind}`}});
  const row=productRow(`RETIRE-${kind}`,`RETIRE-${kind}-BAR`);row[kind==='UNIT'?2:6]=kind==='UNIT'?reference.code:reference.name;
  const res=await write('/preview',await file([row]),tester);expect(res.body.issues).toEqual([]);
  await db.catalogueReference.update({where:{id:reference.id},data:{active:false}});
  const commit=await write(`/${res.body.id}/commit`,{confirm:true},tester);expect(commit.status).toBe(422);expect(commit.body.error.code).toBe(`${kind}_UNAVAILABLE`);
  expect(await db.product.count({where:{businessId:business,sku:row[0]}})).toBe(0);await write(`/${res.body.id}/discard`,{},tester);
 }
});
it('discards previews idempotently and prevents both confirmation and cross-uploader discard',async()=>{
 const tester=await actor('OWNER'),second=await actor('OWNER');const res=await write('/preview',await file([productRow('DISCARD-TEST','DISCARD-BAR')]),tester);
 await write(`/${res.body.id}/discard`,{},second);
 expect((await db.productImport.findUniqueOrThrow({where:{id:res.body.id}})).status).toBe('PREVIEW');
 expect((await write(`/${res.body.id}/discard`,{},tester)).status).toBe(200);expect((await write(`/${res.body.id}/discard`,{},tester)).status).toBe(200);
 const stored=await db.productImport.findUniqueOrThrow({where:{id:res.body.id}});expect(stored.payload).toBe('');expect(stored.status).toBe('EXPIRED');
 expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).body.error.code).toBe('IMPORT_EXPIRED');
});
it('enforces pending-preview limits and releases a slot when discarded',async()=>{
 const tester=await actor('OWNER');const batches:string[]=[];const upload=await file([productRow('LIMIT-TEST','LIMIT-BAR')]);
 for(let i=0;i<5;i++){const res=await write('/preview',upload,tester);expect(res.status).toBe(201);batches.push(res.body.id);}
 expect((await write('/preview',upload,tester)).body.error.code).toBe('IMPORT_PREVIEW_LIMIT');
 await write(`/${batches[0]}/discard`,{},tester);expect((await write('/preview',upload,tester)).status).toBe(201);
});
it('rejects tampered commit bodies, invalid IDs and unsupported preview modes',async()=>{
 const tester=await actor('OWNER');const upload=await file([productRow('TAMPER-TEST','TAMPER-BAR')]);const res=await write('/preview',upload,tester);
 for(const body of [{confirm:false},{},{confirm:true,rows:[]},{confirm:true,duplicateMode:'keep'}])expect((await write(`/${res.body.id}/commit`,body,tester)).status).toBe(422);
 expect((await write('/not-an-id/commit',{confirm:true},tester)).status).toBe(400);
 expect((await write('/preview',{...upload,duplicateMode:'overwrite'},tester)).status).toBe(422);
 expect((await write('/preview',{...upload,filename:'products.xls'},tester)).status).toBe(422);
 expect((await write('/preview',{...upload,fileBase64:'%%%invalid'},tester)).status).toBe(422);
 await write(`/${res.body.id}/discard`,{},tester);
});
it('rejects empty workbooks and allows zero prices without changing stock or financial records',async()=>{
 const tester=await actor('OWNER');expect((await write('/preview',await file([]),tester)).body.error.code).toBe('IMPORT_EMPTY');
 const row=productRow('ZERO-PRICES','000000');row[3]='0';row[4]='0';row[5]='0';
 const res=await write('/preview',await file([row]),tester);expect(res.body.issues).toEqual([]);expect((await write(`/${res.body.id}/commit`,{confirm:true},tester)).body.count).toBe(1);
 const stored=await db.product.findUniqueOrThrow({where:{businessId_sku:{businessId:business,sku:'ZERO-PRICES'}}});expect(stored.purchasePrice.toString()).toBe('0');expect(stored.sellingPrice.toString()).toBe('0');
 expect(await db.stockBalance.count({where:{businessId:business}})).toBe(0);expect(await db.stockMovement.count({where:{businessId:business}})).toBe(0);
});
it('allows only one of two different previews with the same identifiers to commit concurrently',async()=>{
 const first=await actor('OWNER'),second=await actor('OWNER');const upload=await file([productRow('RACE-SAME','RACE-SAME-BAR')]);
 const a=await write('/preview',upload,first),b=await write('/preview',upload,second);
 const results=await Promise.all([write(`/${a.body.id}/commit`,{confirm:true},first),write(`/${b.body.id}/commit`,{confirm:true},second)]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(await db.product.count({where:{businessId:business,sku:'RACE-SAME'}})).toBe(1);
 expect(await db.authAudit.count({where:{businessId:business,action:'products.imported',targetId:{in:[a.body.id,b.body.id]}}})).toBe(1);
});

it.each(['xlsx','csv'] as const)('imports %s products with omitted or blank units as PIECE',async format=>{
 const tester=await actor('OWNER');
 for(const includeUnit of [false,true]){
  const name=`Optional unit ${format} ${includeUnit}`;
  const headers=includeUnit?['name','purchasePrice','unit']:['name','purchasePrice'];
  const row=includeUnit?[name,'1','   ']:[name,'1'];
  const upload=format==='xlsx'?await file([row],headers):{filename:'products.csv',fileBase64:Buffer.from(headers.join(',')+'\n'+row.join(',')).toString('base64')};
  const preview=await write('/preview',upload,tester);
  expect(preview.status).toBe(201);expect(preview.body.issues).toEqual([]);
  expect(preview.body.rows[0].product.unit).toBe('PIECE');
  const committed=await write(`/${preview.body.id}/commit`,{confirm:true},tester);
  expect(committed.status).toBe(200);
  expect(await db.product.findFirst({where:{businessId:business,name},select:{unit:true}})).toEqual({unit:'PIECE'});
 }
});
