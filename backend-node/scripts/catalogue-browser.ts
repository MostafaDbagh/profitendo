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
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:process.env.BROWSER_APP_ORIGIN||'http://localhost:3000'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4000,'localhost',()=>resolve(s));s.on('error',reject);});
let paidPlanId:string|undefined;
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/catalogue-release-design';await mkdir(artifacts,{recursive:true});
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
async function actor(role:'OWNER'|'CASHIER',businessId:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Location Owner':'Shop Cashier',email:`${id}@example.test`,passwordHash:await passwordHash('Browser locations password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 await db.membership.create({data:{userId:id,businessId,role}});const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(process.env.BROWSER_PRIMARY_TEST==='true'&&req.url().startsWith('http://127.0.0.1:8001'))errors.push('Primary app called legacy API');});await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:lang==='ar'?'دليل المنتجات':'Product catalogue',exact:true}).click();await page.getByRole('table').waitFor();}
try{
 const business=await db.business.create({data:{name:'Catalogue Browser Market'}});bids.push(business.id);
 await db.businessSubscription.create({data:{businessId:business.id,planId:'8ac8ae27-f871-47f2-8d70-e38b0aed295c',trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const page=await actor('OWNER',business.id),staff=await actor('CASHIER',business.id);await open(page);await page.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();await shot(page,'new-en-empty');
 await page.getByRole('button',{name:'Categories & units',exact:true}).click();
 await page.getByLabel('Definition type',{exact:true}).selectOption('UNIT');await page.getByLabel('Code',{exact:true}).fill('BOTTLE');await page.getByLabel('Name',{exact:true}).fill('Bottle');await page.getByRole('button',{name:'Add definition',exact:true}).click();await page.getByRole('button',{name:'Retire',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Add product',exact:true}).click();await page.getByPlaceholder('e.g. Fresh milk 1 litre',{exact:true}).fill('Fresh milk 1 litre');await page.getByLabel('SKU',{exact:true}).fill('MILK-001');await page.getByLabel('Unit',{exact:true}).selectOption('BOTTLE');await page.getByLabel('Selling price',{exact:true}).fill('3.7500');await page.getByLabel('Purchase cost',{exact:true}).fill('1.2345');await page.getByLabel('Barcodes',{exact:true}).fill('001234567890\nALT-MILK');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('cell',{name:'MILK-001',exact:true}).waitFor();assert.equal(await db.product.count({where:{businessId:business.id}}),1);
 const scan=page.getByLabel('Scan or enter a barcode',{exact:true});await scan.fill('001234567890');await scan.press('Enter');await page.getByRole('status').filter({hasText:'Product found:'}).waitFor();assert(await scan.evaluate(el=>el===document.activeElement));
 await scan.fill('UNKNOWN');await scan.press('Enter');await page.getByRole('alert').waitFor();
 await open(staff);await staff.getByRole('cell',{name:'MILK-001',exact:true}).waitFor();assert.equal(await staff.getByRole('columnheader',{name:'Purchase cost',exact:true}).count(),0);assert.equal(await staff.getByRole('button',{name:'Add product',exact:true}).count(),0);assert(!(await staff.content()).includes('1.2345'));
 await page.getByRole('button',{name:'Edit product',exact:true}).click();await page.getByLabel('Product name',{exact:true}).fill('Fresh milk updated');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:'Fresh milk updated',exact:true}).waitFor();
 await page.getByRole('button',{name:'Packs & image',exact:true}).click();await page.getByLabel('Pack name',{exact:true}).fill('Carton of 12');await page.getByLabel('Base units per pack',{exact:true}).fill('12');await page.getByRole('button',{name:'Add pack',exact:true}).click();await page.getByRole('button',{name:'Retire',exact:true}).waitFor();
 const sharp=(await import('sharp')).default;const png=await sharp({create:{width:20,height:20,channels:3,background:'#10b981'}}).png().toBuffer();await page.locator('#product-image').setInputFiles({name:'product.png',mimeType:'image/png',buffer:png});await page.getByAltText('Fresh milk updated',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Retire',exact:true}).click();await page.getByRole('button',{name:'Confirm retirement',exact:true}).click();await page.getByText('Retired',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){
  await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await open(page,lang);await shot(page,`new-${lang}-${width}-list`);await page.getByRole('button',{name:lang==='ar'?'إضافة منتج':'Add product',exact:true}).click();await page.getByRole('dialog').waitFor();await shot(page,`new-${lang}-${width}-form`);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  for(const [en,ar,kind] of [['Packs & image','العبوات والصورة','assets'],['Categories & units','الفئات والوحدات','references']]){
   const button=page.getByRole('button',{name:lang==='ar'?ar:en,exact:true});await button.click();await page.getByRole('dialog').waitFor();await shot(page,`new-${lang}-${width}-${kind}`);assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  }
 }
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await open(page);await page.getByRole('button',{name:'Edit product',exact:true}).click();await page.getByRole('dialog').getByLabel('Active',{exact:true}).uncheck();await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();await scan.fill('ALT-MILK');await scan.press('Enter');await page.getByRole('alert').filter({hasText:'This product is inactive.'}).waitFor();
 if(process.env.BROWSER_PRIMARY_TEST==='true'){await page.goto(settings.appOrigin);await page.waitForURL('**/business');await page.goto(`${settings.appOrigin}/products`);await page.waitForURL('**/business');}
 paidPlanId=(await db.billingPlan.create({data:{code:`browser-paid-${randomUUID()}`,name:'Test paid plan',nameAr:'خطة اختبار مدفوعة',priceMinor:2900,maxMembers:10,maxWarehouses:2,maxShops:3}})).id;
 await db.billingCheckout.create({data:{businessId:business.id,planId:paidPlanId,scope:'browser-test',providerPlanId:`P-${'A'.repeat(24)}`,providerSubscriptionId:'I-BROWSERTEST',providerStatus:'ACTIVE',paidFrom:new Date(Date.now()-86400000),paidUntil:new Date(Date.now()+20*86400000),paidTransaction:'BROWSERPAYMENT'}});
 for(const lang of ['en','ar'])for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:lang==='ar'?'الاشتراك':'Subscription',exact:true}).click();await page.getByText(lang==='ar'?'اشتراك مدفوع نشط':'Paid subscription active',{exact:true}).waitFor();await shot(page,`paid-${lang}-${width}`);
 }
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: real catalogue create/edit/deactivate, barcode Enter lookup, cost privacy, placeholders and AR/EN layouts.');
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.productPack.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.billingCheckout.deleteMany({where:{businessId:{in:bids}}});if(paidPlanId)await db.billingPlan.delete({where:{id:paidPlanId}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
