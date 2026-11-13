import {chromium} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw Error('Dedicated test database required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3200'}),auth=new AuthService(db,settings),app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const ids:string[]=[],bids:string[]=[],pids:string[]=[],errors:string[]=[];
const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(4319,'localhost',()=>resolve(s));});
const browser=await chromium.launch({channel:'chrome',headless:true});
const artifacts=new URL('../../tmp/subscriber-signups/',import.meta.url).pathname;await mkdir(artifacts,{recursive:true});
try{
 const email=`signup-ui-${randomUUID()}@example.test`,password='Subscriber browser password 840!';
 await auth.register({email,password,name:'Signup Test Owner',businessName:'Signup Test Business',phone:'+971501234567'});
 const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);bids.push((await db.membership.findFirstOrThrow({where:{userId:user.id}})).businessId);
 const plan=await db.billingPlan.create({data:{code:'ui-paid-'+randomUUID(),name:'UI Paid Monthly',nameAr:'خطة الاختبار الشهرية',priceMinor:1900,currency:'USD',interval:'MONTH',published:true,maxMembers:5,maxWarehouses:1,maxShops:2}});pids.push(plan.id);
 const admin=await db.authUser.create({data:{email:`admin-${randomUUID()}@example.test`,name:'Test platform operator',passwordHash:user.passwordHash,platformRole:'SUPER_ADMIN',emailVerifiedAt:new Date()}});ids.push(admin.id);
 const session=await auth.login(admin.email,password),ctx=await browser.newContext();await ctx.addCookies([{name:'pl_session',value:session.token,url:settings.appOrigin,httpOnly:true,sameSite:'Lax'}]);
 await ctx.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4319${u.pathname}${u.search}`});await route.fulfill({response});});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto(settings.appOrigin+'/platform-v2?tab=subscribers');await page.locator('#subscriber-search').fill('Signup Test Business');await page.locator('main form button').click();await page.getByRole('cell',{name:'Signup Test Business',exact:true}).waitFor();
 for(const lang of ['en','ar']){
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${artifacts}/${process.env.BASELINE?'before':'after'}-${lang}-${width}.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 }
 if(!process.env.BASELINE){assert(await page.getByText('+971501234567',{exact:true}).count());await page.locator('#subscriber-search').fill(email);await page.locator('main form button').click();await page.getByRole('cell',{name:'Signup Test Business',exact:true}).waitFor();}
 if(!process.env.BASELINE){
  await page.getByRole('row').filter({hasText:email}).getByRole('button').click();await page.locator('#activation-plan').selectOption(plan.id);await page.locator('#activation-reference').fill('ui-cash-'+randomUUID());await page.getByRole('dialog').getByRole('checkbox').check();
  await page.screenshot({path:`${artifacts}/manual-payment-confirmation.png`,fullPage:true});await page.getByRole('dialog').locator('button[type="submit"]').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const {billingState}=await import('../src/billing/entitlements.js');assert.equal((await auth.transaction(tx=>billingState(tx,bids[0]!))).active,true);assert.equal(await db.manualSubscriptionPayment.count({where:{businessId:bids[0]!}}),1);
  await page.screenshot({path:`${artifacts}/active-subscription.png`,fullPage:true});
  const b=await db.business.create({data:{name:'UI PayPal Confirm'}});bids.push(b.id);
  await db.paidApproval.create({data:{businessId:b.id,planId:plan.id,requestedBy:user.id,status:'APPROVED'}});
  const transactionId='ui-paypal-'+randomUUID(),scope='ui-'+randomUUID();
  const checkout=await db.billingCheckout.create({data:{businessId:b.id,planId:plan.id,scope,providerPlanId:'P-UI',providerStatus:'ACTIVE',paidFrom:new Date(Date.now()-1000),paidUntil:new Date(Date.now()+86400000*30),paidTransaction:transactionId}});
  await db.billingReceipt.create({data:{checkoutId:checkout.id,scope,transactionId,eventId:randomUUID(),amountMinor:1900,currency:'USD',paidAt:new Date()}});
  assert.equal((await auth.transaction(tx=>billingState(tx,b.id))).active,false);
  await page.locator('#subscriber-search').fill(b.name);await page.locator('main form button').click();const providerRow=page.getByRole('row').filter({hasText:b.name});await providerRow.getByRole('button').click();await page.getByRole('dialog').getByRole('checkbox').check();
  await page.screenshot({path:`${artifacts}/paypal-confirmation.png`,fullPage:true});await page.getByRole('dialog').locator('button[type="submit"]').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await auth.transaction(tx=>billingState(tx,b.id))).active,true);

 }
 assert.deepEqual(errors,[]);console.log('PASS: subscriber list browser checks');
}finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.billingReceipt.deleteMany({where:{checkout:{businessId:{in:bids}}}});await db.billingCheckout.deleteMany({where:{businessId:{in:bids}}});await db.manualSubscriptionPayment.deleteMany({where:{businessId:{in:bids}}});await db.billingAudit.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.billingPlan.deleteMany({where:{id:{in:pids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
