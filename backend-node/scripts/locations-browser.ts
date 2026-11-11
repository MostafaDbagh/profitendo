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
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/location-design';await mkdir(artifacts,{recursive:true});
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
async function actor(role:'OWNER'|'CASHIER',businessId:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Location Owner':'Shop Cashier',email:`${id}@example.test`,passwordHash:await passwordHash('Browser locations password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 await db.membership.create({data:{userId:id,businessId,role}});const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:lang==='ar'?'المستودعات والمتاجر':'Warehouses & shops',exact:true}).click();await page.getByRole('table').waitFor();}
try{
 const business=await db.business.create({data:{name:'Location Browser Market'}});bids.push(business.id);
 await db.businessSubscription.create({data:{businessId:business.id,planId:'8ac8ae27-f871-47f2-8d70-e38b0aed295c',trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const page=await actor('OWNER',business.id),staff=await actor('CASHIER',business.id);await open(page);await page.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();await shot(page,'new-en-empty');
 await page.getByRole('button',{name:'Add location',exact:true}).click();await page.getByPlaceholder('e.g. Main warehouse',{exact:true}).fill('Main warehouse');await page.getByPlaceholder('e.g. WH-01',{exact:true}).fill('WH-01');await page.getByLabel('Address (optional)',{exact:true}).fill('Building 12, Dubai');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('cell',{name:'WH-01',exact:true}).waitFor();assert.equal(await db.location.count({where:{businessId:business.id}}),1);
 await page.getByRole('button',{name:'Add location',exact:true}).click();await page.getByLabel('Location name',{exact:true}).fill('City shop');await page.getByLabel('Location code',{exact:true}).fill('SH-01');await page.getByLabel('Location type',{exact:true}).last().selectOption('SHOP');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:'SH-01',exact:true}).waitFor();
 await open(staff);await staff.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();assert.equal(await staff.getByRole('button',{name:'Add location',exact:true}).count(),0);
 const shop=page.getByRole('row').filter({has:page.getByRole('cell',{name:'SH-01',exact:true})});await shop.getByRole('button',{name:'Staff access',exact:true}).click();await page.getByRole('button',{name:'Assign · Shop Cashier',exact:true}).click();await page.getByRole('button',{name:'Remove assignment · Shop Cashier',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await open(staff);await staff.getByRole('cell',{name:'SH-01',exact:true}).waitFor();assert.equal(await staff.getByRole('cell',{name:'WH-01',exact:true}).count(),0);
 await shop.getByRole('button',{name:'Edit location',exact:true}).click();await page.getByLabel('Location name',{exact:true}).fill('City shop updated');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:'City shop updated',exact:true}).waitFor();
 await shop.getByRole('button',{name:'Archive',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByLabel('Status',{exact:true}).selectOption('archived');await page.getByRole('cell',{name:'SH-01',exact:true}).waitFor();await page.getByRole('button',{name:'Reactivate',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await open(staff);await staff.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();
 for(const lang of ['en','ar'])for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await open(page,lang);await shot(page,`new-${lang}-${width}-list`);
  await page.getByRole('button',{name:lang==='ar'?'إضافة موقع':'Add location',exact:true}).click();await page.getByRole('dialog').waitFor();await shot(page,`new-${lang}-${width}-form`);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 }
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await open(page);await page.getByLabel('Find a location',{exact:true}).fill('WH-01');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('cell',{name:'WH-01',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
 const pattern='http://localhost:4000/api/businesses/*/locations?*';await page.route(pattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"failed"}}'}));await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:'Warehouses & shops',exact:true}).click();
 await page.getByRole('alert').waitFor();await page.unroute(pattern);await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('cell',{name:'WH-01',exact:true}).waitFor();
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: real location creation/editing, staff assignments and isolation, archive/reactivation, search, error/retry and AR/EN responsive layouts.');
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
