import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3300'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4303,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/ui-coverage';await mkdir(artifacts,{recursive:true});
let planId:string|undefined, primaryPage:Page|undefined;
async function shot(page:Page,name:string){
 // End navigation's resize-driven scroll reset before a full-page capture.
 await page.keyboard.press('Shift');
 await page.evaluate(()=>{window.scrollTo({top:0,behavior:'instant'});return document.fonts.ready;});
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
 await context.route('http://localhost:4300/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4303${u.pathname}${u.search}`});await route.fulfill({response});});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
try{
 const business=await db.business.create({data:{name:'Mock Grocery — Warehouse & Shop',baseCurrency:'USD'}});bids.push(business.id);
 planId=(await db.billingPlan.create({data:{code:`grocery-${randomUUID()}`,name:'Grocery mock plan',nameAr:'خطة البقالة التجريبية',trialDays:14,maxMembers:10,maxWarehouses:3,maxShops:3}})).id;
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000*14)}});
 const page=await actor('OWNER',business.id,'');primaryPage=page;
 const findings:{screen:string;lang:string;issue:string}[]=[],screens:string[]=[];
 for(const lang of ['en','ar']){
  await page.goto(settings.appOrigin+'/business-v2');await page.getByTestId('business-dashboard').waitFor();
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  const names=await page.getByRole('navigation').getByRole('button').allTextContents();
  for(const name of names){
   const nav=page.getByRole('navigation').getByRole('button',{name:name.trim(),exact:true});await nav.focus();await page.keyboard.press('Enter');
   await page.waitForLoadState('networkidle');await page.getByRole('main').waitFor();
   const screen=new URL(page.url()).searchParams.get('tab')||'dashboard';screens.push(`${lang}:${screen}`);
   const alerts=await page.getByRole('main').getByRole('alert').allTextContents();if(alerts.length)findings.push({screen,lang,issue:`Unexpected alert: ${alerts.join(' ')}`});
   const unlabelled=await page.getByRole('main').evaluate(root=>Array.from(root.querySelectorAll('input,select,textarea')).filter(el=>(el as HTMLElement).offsetWidth>0&&!(el as HTMLInputElement).labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!['submit','button','hidden'].includes((el as HTMLInputElement).type)).map(el=>el.id||el.tagName));
   if(unlabelled.length)findings.push({screen,lang,issue:`Missing input labels: ${unlabelled.join(', ')}`});
   for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>Array.from(document.querySelectorAll('main input[id$="search"]')).every(el=>el.getBoundingClientRect().width>=160),undefined,{timeout:3000});await shot(page,`${lang}-${width}-${screen}`);}
  }
 }
 await writeFile(`${artifacts}/results.json`,JSON.stringify({screens,findings,errors},null,2));
 assert.deepEqual(findings,[]);assert.deepEqual(errors,[]);console.log(`PASS: ${screens.length} owner screens/states, AR/EN phone/tablet/desktop, keyboard navigation, empty states and input labels`);
}catch(error){if(primaryPage){await primaryPage.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{});console.error((await primaryPage.locator('body').innerText()).slice(-5000));}throw error;}

finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 await db.authAudit.deleteMany({where:{businessId:{in:bids}}});
 await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});
 if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
