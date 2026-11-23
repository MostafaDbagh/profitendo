import express from 'express';
import {resolve} from 'node:path';
import {checkImportRecovery} from './import-recovery-checks.js';
import Excel from 'exceljs';
import {columns} from '../src/catalogue/workbook.js';
import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4000,'localhost',()=>resolve(s));s.on('error',reject);});
let frontendServer:ReturnType<typeof app.listen>|undefined;
if(process.env.IMPORT_FRONTEND_BUILD==='true'){
 const frontend=express();
 frontend.get('/business-v2',(_req,res)=>res.sendFile(resolve('../frontend/build/app.html')));
 frontend.use(express.static(resolve('../frontend/build')));
 frontendServer=await new Promise((resolve,reject)=>{const server=frontend.listen(3000,'localhost',()=>resolve(server));server.on('error',reject);});
}
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts=process.env.IMPORT_ARTIFACTS||'../tmp/import-design';await mkdir(artifacts,{recursive:true});
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);if(await page.getByRole('dialog').count())assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'Dialog horizontal overflow');await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
async function actor(role:'OWNER'|'CASHIER'|'ACCOUNTANT',businessId:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Location Owner':'Shop Cashier',email:`${id}@example.test`,passwordHash:await passwordHash('Browser locations password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 await db.membership.create({data:{userId:id,businessId,role:role==='ACCOUNTANT'?'VIEWER':role,...(role==='ACCOUNTANT'?{permissionOverrides:{'catalogue.create':true,'catalogue.cost':true}}:{})}});const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);try{await page.getByRole('navigation').getByRole('button',{name:lang==='ar'?'المنتجات':'Products',exact:true}).click({timeout:10000});}catch(e){await page.screenshot({path:`${artifacts}/navigation-failure.png`,fullPage:true});console.log({url:page.url(),errors,body:await page.locator('body').innerText()});throw e;}await page.getByRole('table').waitFor();}
async function workbook(sku='EXCEL-001',price='3.75'){
 const wb=new Excel.Workbook(),sheet=wb.addWorksheet('Products');sheet.addRow([...columns]);sheet.addRow([sku,'Excel milk','LITRE','1.25',price,'0','','','','','00012345','true']);return Buffer.from(await wb.xlsx.writeBuffer());
}
let planId:string|undefined;
try{
 planId=(await db.billingPlan.create({data:{code:`import-browser-${randomUUID()}`,name:'Import browser test',nameAr:'اختبار الاستيراد',trialDays:14,maxMembers:10,maxWarehouses:1,maxShops:1}})).id;
 const business=await db.business.create({data:{name:'Import Browser Market'}});bids.push(business.id);
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const page=await actor('OWNER',business.id),staff=await actor('CASHIER',business.id);await open(staff);assert.equal(await staff.getByRole('button',{name:'Import Excel / CSV',exact:true}).count(),0);
 await open(page);await page.getByRole('button',{name:'Import Excel / CSV',exact:true}).click();
 for(const width of [390,1440]){await page.setViewportSize({width,height:width<768?844:1100});await shot(page,`simple-empty-en-${width}`);}
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download Excel template',exact:true}).click();assert.equal((await download).suggestedFilename(),'product-import-template.xlsx');
 await page.locator('#product-import-file').setInputFiles({name:'invalid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await workbook('BAD','-1')});await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fix these rows'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),0);assert.equal(await page.getByRole('button',{name:'Confirm import',exact:true}).count(),0);await shot(page,'new-en-errors');
 const valid=await workbook();
 // Resize the same preview; viewport checks must not repeatedly upload files.
 for(const lang of ['en','ar']){
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await open(page,lang);
  await page.getByRole('button',{name:lang==='ar'?'استيراد Excel / CSV':'Import Excel / CSV',exact:true}).click();await page.locator('#product-import-file').setInputFiles({name:'products.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:valid});await page.getByRole('button',{name:lang==='ar'?'معاينة الاستيراد':'Preview import',exact:true}).click();await page.getByRole('button',{name:lang==='ar'?'تأكيد الاستيراد':'Confirm import',exact:true}).waitFor();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:width<768?844:1100});await shot(page,`new-${lang}-${width}-preview`);}
 }
 assert.equal(await db.product.count({where:{businessId:business.id}}),0);
 await page.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).click();await page.getByRole('status').filter({hasText:'تم استيراد المنتجات'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),1);await shot(page,'new-ar-complete');
 await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).last().click();await page.getByText('EXCEL-001',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'استيراد Excel / CSV',exact:true}).click();await page.locator('#product-import-file').setInputFiles({name:'products.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:valid});await page.getByRole('button',{name:'معاينة الاستيراد',exact:true}).click();await page.getByRole('alert').filter({hasText:'صحّح هذه الصفوف'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),1);

 await page.getByRole('region',{name:'مراجعة المكررات'}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:width<768?844:1100});await page.getByRole('button',{name:'استبعاد المكررات',exact:true}).scrollIntoViewIfNeeded();await shot(page,`duplicates-ar-${width}`);}
 await page.getByRole('button',{name:'استبعاد المكررات',exact:true}).click();await page.getByText(/تم استبعاد 1 صف/).waitFor();assert.equal(await page.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).count(),0);assert.equal(await db.product.count({where:{businessId:business.id}}),1);
 await page.getByRole('button',{name:'إبقاء المكررات',exact:true}).click();await page.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).waitFor();await shot(page,'duplicates-ar-keep');
 await page.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).click();await page.getByRole('status').filter({hasText:'تم استيراد المنتجات'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),2);assert.equal(await db.productBarcode.count({where:{businessId:business.id}}),1);assert.equal(await db.stockBalance.count({where:{businessId:business.id}}),0);
 const accountant=await actor('ACCOUNTANT',business.id);await open(accountant);
 await accountant.getByRole('button',{name:'Import Excel / CSV',exact:true}).click();
 const arBook=new Excel.Workbook(),arSheet=arBook.addWorksheet('منتجات');arSheet.addRow(['سعر البيع','اسم الصنف','سعر الشراء','وحدة القياس']);arSheet.addRow(['٢٫٥٠','منتج المحاسب','١٫٢٥','قطعة']);
 await accountant.locator('#product-import-file').setInputFiles({name:'arabic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await arBook.xlsx.writeBuffer())});await accountant.getByRole('button',{name:'Preview import',exact:true}).click();await accountant.getByRole('button',{name:'Confirm import',exact:true}).waitFor();
 assert.equal(await db.product.count({where:{businessId:business.id}}),2);await shot(accountant,'accountant-en-arabic-headers');
 await accountant.getByRole('button',{name:'Confirm import',exact:true}).click();await accountant.getByRole('status').filter({hasText:'Products imported'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),3);
 const accountingProduct=await db.product.findFirstOrThrow({where:{businessId:business.id,name:'منتج المحاسب'}});assert.equal(accountingProduct.purchasePrice.toString(),'1.25');assert.equal(accountingProduct.sellingPrice.toString(),'2.5');
 await accountant.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).last().click();await accountant.getByRole('button',{name:'Import Excel / CSV',exact:true}).click();await accountant.locator('#product-import-file').setInputFiles({name:'arabic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await arBook.xlsx.writeBuffer())});await accountant.getByRole('button',{name:'Preview import',exact:true}).click();await accountant.getByRole('region',{name:'Duplicate review'}).waitFor();
 for(const width of [320,390,768,1440]){await accountant.setViewportSize({width,height:width<768?844:1100});await accountant.getByRole('button',{name:'Exclude duplicates',exact:true}).scrollIntoViewIfNeeded();await shot(accountant,`duplicates-en-${width}`);}
 await accountant.getByRole('button',{name:'Exclude duplicates',exact:true}).click();await accountant.getByText(/Excluded 1 duplicate rows/).waitFor();assert.equal(await accountant.getByRole('button',{name:'Confirm import',exact:true}).count(),0);
 if(process.env.IMPORT_DEEP_TEST==='true'){for(const role of ['OWNER','ACCOUNTANT'] as const){const recovery=await actor(role,business.id);await open(recovery);await checkImportRecovery(recovery,db,business.id,role,shot);}}
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: template download, invalid-row preview, no writes before confirmation, duplicate review/exclude/keep, accountant imports with Arabic titles and prices, staff denial, unchanged stock and AR/EN import layouts.');
}finally{
 await browser.close();if(frontendServer)await new Promise<void>((resolve,reject)=>frontendServer!.close(e=>e?reject(e):resolve()));await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.productImport.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
