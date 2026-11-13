import {chromium} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {passwordHash} from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3200',AUTH_OWNER_PHONE_REQUIRED:'true'}),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(4317,'localhost',()=>resolve(s));});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[],id=randomUUID(),bid=randomUUID(),pid=randomUUID(),password='Expired trial test 749!',email=`expiry-${id}@example.test`,dir='../tmp/trial-expiry';
page.setDefaultTimeout(15000);await mkdir(dir,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
await page.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4317${u.pathname}${u.search}`});await route.fulfill({response});});
await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
try{
 await db.authUser.create({data:{id,email,name:'Trial Owner',passwordHash:await passwordHash(password),emailVerifiedAt:new Date(),phoneVerifiedAt:new Date()}});
 await db.business.create({data:{id:bid,name:'Trial expiry test shop'}});
 await db.membership.create({data:{userId:id,businessId:bid,role:'OWNER',hiddenTabs:['billing']}});
 await db.billingPlan.create({data:{id:pid,code:`expiry-${pid}`,name:'14-day trial',nameAr:'تجربة 14 يوماً',trialDays:14,maxMembers:3,maxWarehouses:2,maxShops:2}});
 await db.businessSubscription.create({data:{businessId:bid,planId:pid,trialStartedAt:new Date(Date.now()-15*86400000),trialEndsAt:new Date(Date.now()-86400000)}});
 await page.goto(settings.appOrigin+'/auth-v2');await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill(password);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.getByTestId('business-dashboard').waitFor();
 if(process.env.BASELINE){await page.screenshot({path:`${dir}/before.png`,fullPage:true});}
 else{
 for(const lang of ['en','ar'])for(const width of [320,390,768,1440]){
 await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.setViewportSize({width,height:1000});await page.goto(settings.appOrigin+'/business-v2');await page.getByTestId('subscription-notice').waitFor();await page.getByTestId('business-dashboard').waitFor();await page.getByRole('heading',{name:lang==='ar'?'ملخص هذا الشهر':'This month’s overview'}).waitFor();await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${dir}/${lang}-${width}.png`,fullPage:true});
 await page.getByTestId('subscription-notice').getByRole('button').click();await page.getByRole('heading',{name:lang==='ar'?'اشتراك النشاط التجاري':'Business subscription',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start free trial',exact:true}).count(),0);
 }
 await db.businessSubscription.update({where:{businessId:bid},data:{trialEndsAt:new Date(Date.now()+5000)}});await page.goto(settings.appOrigin+'/business-v2');await page.getByTestId('business-dashboard').waitFor();await page.getByTestId('subscription-notice').waitFor({state:'hidden'});await page.getByTestId('subscription-notice').waitFor({timeout:15000});
 // Model a server-confirmed payment here; provider verification is covered by paypal.test.ts.
 await db.paidApproval.create({data:{businessId:bid,planId:pid,requestedBy:id,status:'APPROVED'}});
 await db.billingCheckout.create({data:{businessId:bid,planId:pid,scope:randomBytes(32).toString('hex'),providerPlanId:'P-TEST',providerStatus:'ACTIVE',paidFrom:new Date(),paidUntil:new Date(Date.now()+30*86400000)}});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByTestId('subscription-notice').waitFor({state:'hidden'});await page.getByTestId('business-dashboard').waitFor();

 }
 assert.deepEqual(errors,[]);console.log('PASS: expired owner login, dashboard, renewal navigation, AR/EN responsive states and live expiry.');
}finally{
 await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.authAudit.deleteMany({where:{userId:id}});await db.billingCheckout.deleteMany({where:{businessId:bid}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id}});await db.billingPlan.deleteMany({where:{id:pid}});await db.$disconnect();
}
