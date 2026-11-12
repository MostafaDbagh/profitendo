import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import {prepareReportBatch} from '../src/reports/delivery-worker.js';
import {deliverMailBatch} from '../src/auth/mail.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3300'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4305,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/closing-reports-ui';await mkdir(artifacts,{recursive:true});
let planId:string|undefined, primaryPage:Page|undefined;
async function shot(page:Page,name:string){
 await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);
 for(const dialog of await page.getByRole('dialog').all())assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} dialog overflow`);
 await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});
}
async function actor(role:'OWNER'|'WAREHOUSE_STAFF',businessId:string,locationId:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Warehouse Owner':'Receiving Employee',email:`${id}@example.test`,passwordHash:await passwordHash('Browser operations password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 const member=await db.membership.create({data:{userId:id,businessId,role}});
 if(role!=='OWNER')await db.locationAssignment.create({data:{businessId,locationId,membershipId:member.id}});
 const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4300',httpOnly:true,sameSite:'Lax'}]);
 await context.route('http://localhost:4300/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4305${u.pathname}${u.search}`});await route.fulfill({response});});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function section(page:Page,name:string){if(!page.url().includes('/business')||await page.evaluate(()=>document.documentElement.lang!==localStorage.getItem('profitlens_lang')))await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();}
async function choose(page:Page,label:string,name:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function action(page:Page,label:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}

const log=(message:string)=>console.log('PASS:',message);
try{
 const business=await db.business.create({data:{name:'Daily reports market'}});bids.push(business.id);
 planId=(await db.billingPlan.create({data:{code:`reports-${randomUUID()}`,name:'Report browser',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:3,maxShops:3}})).id;
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const shop=await db.location.create({data:{businessId:business.id,code:'SHOP',name:'Daily report shop',kind:'SHOP'}});
 const page=await actor('OWNER',business.id,'');primaryPage=page;
 const open=async()=>{await section(page,'Dashboard & reports');await page.getByRole('button',{name:'Closing reports',exact:true}).click();await page.locator('#closing-reports-enabled').waitFor();};
 await open();await page.getByText('Email delivery is not configured yet.',{exact:false}).waitFor();assert.equal(await page.locator('#closing-reports-enabled').getAttribute('aria-checked'),'false');
 await page.locator('#closing-reports-enabled').click();await page.getByRole('button',{name:'Save report settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Report settings saved.'}).waitFor();
 await section(page,'Treasury');await page.getByRole('button',{name:'Daily cash closing',exact:true}).click();await choose(page,'Choose location',shop.name);await page.locator('#cash-opening').fill('100');await page.locator('#cash-counted').fill('100');await page.getByRole('button',{name:'Review & close day',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('Day closed',{exact:true}).waitFor();
 assert.equal(await db.reportDelivery.count({where:{businessId:business.id,automatic:true}}),1);assert.equal((await prepareReportBatch(db,settings)).prepared,1);
 await open();await page.getByRole('button',{name:'View report',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Cash closing',exact:true}).waitFor();await shot(page,'01-auto-report');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.locator('#closing-reports-enabled').click();await page.getByRole('button',{name:'Save report settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Report settings saved.'}).waitFor();
 await page.getByRole('button',{name:'Send report now',exact:true}).click();await page.getByRole('status').filter({hasText:'Report requested.'}).waitFor();assert.equal((await prepareReportBatch(db,settings)).prepared,1);
 const mail=await db.authMail.findFirstOrThrow({where:{report:{businessId:business.id,automatic:false}}});await db.authMail.update({where:{id:mail.id},data:{createdAt:new Date(0)}});const sent:string[]=[];await deliverMailBatch(db,settings,async payload=>{sent.push(payload.text);},1);assert.equal(sent.length,1);assert(sent[0]!.includes('Daily reports market'));assert(sent[0]!.includes('$100.00'));
 await page.getByRole('button',{name:'Refresh reports',exact:true}).click();await page.getByText('Ready in app · email sent',{exact:true}).waitFor();
 for(const lang of ['en','ar']){
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.keyboard.press('Shift');await shot(page,`${lang}-${width}-settings`);}
  await page.getByRole('button',{name:lang==='ar'?'عرض التقرير':'View report',exact:true}).first().click();await page.getByRole('dialog').getByRole('heading',{name:'Cash closing',exact:true}).waitFor();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await shot(page,`${lang}-${width}-detail`);}
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 }
 await page.getByRole('button',{name:'English',exact:true}).click();await page.locator('#closing-report-language').selectOption('ar');
 await page.getByLabel('Gross profit',{exact:true}).uncheck();await page.getByRole('button',{name:'Save report settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Report settings saved.'}).waitFor();await page.getByRole('button',{name:'Send report now',exact:true}).click();await page.getByRole('status').filter({hasText:'Report requested.'}).waitFor();await prepareReportBatch(db,settings);await page.getByRole('button',{name:'Refresh reports',exact:true}).click();await page.getByRole('button',{name:'View report',exact:true}).first().click();await page.getByRole('dialog').getByRole('heading',{name:'الإغلاق النقدي',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'إجمالي الربح',exact:true}).count(),0);await shot(page,'ar-report-content');await page.keyboard.press('Escape');
 const staff=await actor('WAREHOUSE_STAFF',business.id,shop.id);await staff.goto(settings.appOrigin+'/business-v2');assert.equal(await staff.getByRole('button',{name:'Closing reports',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: UI automatic close trigger, switches off/on, manual send while off, same email/app report, selected reports, Arabic content, five widths and staff restrictions');
}catch(error){if(primaryPage){await primaryPage.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{});console.error((await primaryPage.locator('body').innerText()).slice(-5000));}throw error;}

finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 await db.$transaction(async tx=>{
  const triggers=[['transfer_event_lines','transfer_event_lines_immutable'],['transfer_events','transfer_events_immutable'],['stock_movements','stock_history_immutable'],['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['money_entries','money_entries_immutable'],['cash_closes','cash_closes_immutable'],['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']];for(const [table,trigger] of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  const where={businessId:{in:bids}};await tx.migrationPreview.deleteMany({where});await tx.moneyEntry.deleteMany({where});await tx.cashClose.deleteMany({where});await tx.adjustmentLine.deleteMany({where});await tx.adjustment.deleteMany({where});await tx.stockMovement.deleteMany({where});await tx.transferEventLine.deleteMany({where});await tx.transferEvent.deleteMany({where});await tx.transferLine.deleteMany({where});await tx.stockTransfer.deleteMany({where});await tx.salePayment.deleteMany({where});await tx.saleLine.deleteMany({where});await tx.sale.deleteMany({where});for(const [table,trigger] of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 const where={businessId:{in:bids}};await db.purchaseLine.deleteMany({where});await db.purchaseDocument.deleteMany({where});await db.supplier.deleteMany({where});await db.stockBalance.deleteMany({where});await db.locationAssignment.deleteMany({where});await db.location.deleteMany({where});await db.productBarcode.deleteMany({where});await db.product.deleteMany({where});await db.authAudit.deleteMany({where});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
