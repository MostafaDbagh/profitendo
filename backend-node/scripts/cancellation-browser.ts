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
import { processCancellationBatch } from '../src/billing/paypal/cancellation.js';
import type { PayPalProvider } from '../src/billing/paypal/client.js';
import type { SubscriptionSnapshot } from '../src/billing/paypal/contracts.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'});
const db=createDatabase(url),auth=new AuthService(db,settings),scope=randomBytes(32).toString('hex');
const snapshots=new Map<string,SubscriptionSnapshot>();let cancels=0;
// Explicit fake provider: browser writes hit the real API/DB; no payment network calls.
const provider:PayPalProvider={scope,async getPlan(){throw new Error('Not used');},async createSubscription(){throw new Error('Not used');},async verifyWebhook(){throw new Error('Not used');},
 async getSubscription(id){return snapshots.get(id)!;},async cancelSubscription(id){cancels++;snapshots.set(id,{...snapshots.get(id)!,status:'CANCELLED',status_update_time:'2026-11-12T12:00:00Z'});}};
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth,provider);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4000,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true});
const ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/cancellation-design';await mkdir(artifacts,{recursive:true});
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
try{
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:'Billing recovery owner',email:`${id}@example.test`,passwordHash:await passwordHash('Browser cancellation password 143!'),emailVerifiedAt:new Date(),mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 const business=await db.business.create({data:{name:'Alpha Recovery Market',timezone:'Asia/Dubai'}});bids.push(business.id);
 await db.membership.create({data:{userId:id,businessId:business.id,role:'OWNER'}});
 const checkout=await db.billingCheckout.create({data:{businessId:business.id,planId:'8ac8ae27-f871-47f2-8d70-e38b0aed295c',scope,providerPlanId:`P-${'A'.repeat(24)}`,providerSubscriptionId:'I-BROWSER123',providerStatus:'ACTIVE',providerUpdatedAt:new Date('2026-11-11T12:00:00Z')}});
 snapshots.set('I-BROWSER123',{id:'I-BROWSER123',plan_id:checkout.providerPlanId,custom_id:checkout.id,status:'ACTIVE',status_update_time:'2026-11-11T12:00:00Z'});
 const session=await auth.transaction(tx=>auth.makeSession(tx,user,true)),context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 if(process.env.BASELINE==='1'){
  for(const lang of ['en','ar'])for(const width of [390,1440]){
   await page.setViewportSize({width,height:1100});await page.goto(settings.appOrigin);await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
   await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:lang==='ar'?'الاشتراك':'Subscription',exact:true}).click();await page.getByRole('heading',{name:lang==='ar'?'إيصالات الدفع':'Payment receipts',exact:true}).waitFor();await shot(page,`before-${lang}-${width}`);
  }
 }else{
  await db.business.update({where:{id:business.id},data:{suspendedAt:new Date()}});
  await page.goto(`${settings.appOrigin}/auth-v2`);await page.getByRole('link',{name:'Billing and cancellation',exact:true}).click();
  await page.getByRole('heading',{name:'Alpha Recovery Market',exact:true}).waitFor();
  const cancel=page.getByRole('button',{name:'Cancel subscription',exact:true});await cancel.click();
  await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='Cancel subscription');
  for(const lang of ['en','ar'])for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.reload();
   await page.getByRole('button',{name:lang==='ar'?'إلغاء الاشتراك':'Cancel subscription',exact:true}).click();await page.getByRole('dialog').waitFor();await shot(page,`new-${lang}-${width}-confirm`);await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.reload();
  await page.getByRole('button',{name:'Cancel subscription',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await page.getByText('Cancellation requested',{exact:true}).waitFor();assert.equal(cancels,0);await shot(page,'new-en-pending');
  assert.equal((await processCancellationBatch(auth,provider)).confirmed,1);
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByText('Cancellation confirmed',{exact:true}).waitFor();assert.equal(cancels,1);await shot(page,'new-en-confirmed');
  const pattern='http://localhost:4000/api/billing/businesses/*/cancellation';await page.route(pattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"failed"}}'}));
  await page.reload();await page.getByRole('alert').waitFor();await page.unroute(pattern);await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Cancellation confirmed',{exact:true}).waitFor();
  assert.equal(errors.length,0,errors.join('; '));
 }
 console.log(process.env.BASELINE==='1'?'PASS: before screenshots captured.':'PASS: suspended-owner billing recovery, cancellation confirmation, pending/confirmed/error/retry states, modal focus and AR/EN responsive layouts.');
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await db.billingCancellation.deleteMany({where:{checkout:{scope}}});await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.billingCheckout.deleteMany({where:{scope}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
