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
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/import-design';await mkdir(artifacts,{recursive:true});
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);if(await page.getByRole('dialog').count())assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'Dialog horizontal overflow');await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
async function actor(role:'OWNER'|'CASHIER',businessId:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Location Owner':'Shop Cashier',email:`${id}@example.test`,passwordHash:await passwordHash('Browser locations password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 await db.membership.create({data:{userId:id,businessId,role}});const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('navigation').getByRole('button',{name:lang==='ar'?'المنتجات':'Products',exact:true}).click();await page.getByRole('table').waitFor();}
async function workbook(sku='EXCEL-001',price='3.75'){
 const wb=new Excel.Workbook(),sheet=wb.addWorksheet('Products');sheet.addRow([...columns]);sheet.addRow([sku,'Excel milk','LITRE','1.25',price,'0','','','','','00012345','true']);return Buffer.from(await wb.xlsx.writeBuffer());
}
try{
 const business=await db.business.create({data:{name:'Import Browser Market'}});bids.push(business.id);
 await db.businessSubscription.create({data:{businessId:business.id,planId:'8ac8ae27-f871-47f2-8d70-e38b0aed295c',trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const page=await actor('OWNER',business.id),staff=await actor('CASHIER',business.id);await open(staff);assert.equal(await staff.getByRole('button',{name:'Import Excel',exact:true}).count(),0);
 await open(page);await page.getByRole('button',{name:'Import Excel',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download Excel template',exact:true}).click();assert.equal((await download).suggestedFilename(),'product-import-template.xlsx');
 await page.locator('#product-import-file').setInputFiles({name:'invalid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await workbook('BAD','-1')});await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fix these rows'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),0);assert.equal(await page.getByRole('button',{name:'Confirm import',exact:true}).count(),0);await shot(page,'new-en-errors');
 const valid=await workbook();
 // Resize the same preview; viewport checks must not repeatedly upload files.
 for(const lang of ['en','ar']){
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await open(page,lang);
  await page.getByRole('button',{name:lang==='ar'?'استيراد Excel':'Import Excel',exact:true}).click();await page.locator('#product-import-file').setInputFiles({name:'products.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:valid});await page.getByRole('button',{name:lang==='ar'?'معاينة الاستيراد':'Preview import',exact:true}).click();await page.getByRole('button',{name:lang==='ar'?'تأكيد الاستيراد':'Confirm import',exact:true}).waitFor();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:width<768?844:1100});await shot(page,`new-${lang}-${width}-preview`);}
 }
 assert.equal(await db.product.count({where:{businessId:business.id}}),0);
 await page.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).click();await page.getByRole('status').filter({hasText:'تم استيراد المنتجات'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),1);await shot(page,'new-ar-complete');
 await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).last().click();await page.getByRole('cell',{name:'EXCEL-001',exact:true}).waitFor();
 await page.getByRole('button',{name:'استيراد Excel',exact:true}).click();await page.locator('#product-import-file').setInputFiles({name:'products.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:valid});await page.getByRole('button',{name:'معاينة الاستيراد',exact:true}).click();await page.getByRole('alert').filter({hasText:'صحّح هذه الصفوف'}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),1);
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: template download, invalid-row preview, no writes before confirmation, duplicate prevention, staff denial and AR/EN import layouts.');
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.productImport.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
