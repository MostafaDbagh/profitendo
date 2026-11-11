import { chromium, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, decrypt, passwordHash } from '../src/auth/crypto.js';
const settings=readAuthSettings(process.env),url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),auth=new AuthService(db,settings),browser=await chromium.launch({channel:'chrome',headless:true});
const ids:string[]=[],bids:string[]=[],plans:string[]=[],errors:string[]=[],run=randomUUID().slice(0,8),code=`browser-${run}`,email=`billing-${run}@example.test`;
const artifacts=process.env.BILLING_SCREENSHOTS||'../tmp/billing-design';await mkdir(artifacts,{recursive:true});
async function actor(admin:boolean){const id=randomUUID();ids.push(id);return db.authUser.create({data:{id,name:admin?'Platform Operator':'Trial Owner',email:`${id}@example.test`,passwordHash:await passwordHash('Billing browser password 153!'),emailVerifiedAt:new Date(),platformRole:admin?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});}
async function pageFor(id:string){const context=await browser.newContext({viewport:{width:1440,height:1000}});const user=await db.authUser.findUniqueOrThrow({where:{id}}),session=await auth.transaction(tx=>auth.makeSession(tx,user,true));await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;}
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
try{
 const admin=await actor(true),owner=await actor(false),business=await db.business.create({data:{name:'Trial Market'}});bids.push(business.id);await db.membership.create({data:{businessId:business.id,userId:owner.id,role:'OWNER'}});
 const page=await pageFor(admin.id);await page.goto(`${settings.appOrigin}/platform-v2`);await page.getByRole('button',{name:'Subscription plans',exact:true}).click();await page.getByRole('button',{name:'Add plan',exact:true}).click();
 await page.locator('#plan-code').fill(code);await page.locator('#plan-name').fill(`Browser trial ${run}`);await page.locator('#plan-name-ar').fill('تجربة المتجر');await page.locator('#plan-maxMembers').fill('2');
 await shot(page,'new-en-1440-plan-form');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const plan=await db.billingPlan.findUniqueOrThrow({where:{code}});plans.push(plan.id);assert.equal(plan.priceMinor,null);assert.equal(plan.published,false);
 const row=page.getByRole('row').filter({hasText:code});await row.getByRole('button',{name:'Make trial available',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Make trial available',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await row.getByRole('button',{name:'Stop offering trial',exact:true}).waitFor();await shot(page,'new-en-1440-plans');
 const customer=await pageFor(owner.id);await customer.goto(`${settings.appOrigin}/business-v2`);await customer.getByRole('button',{name:'Subscription',exact:true}).click();await customer.getByText('Trial not started',{exact:true}).waitFor();await shot(customer,'new-en-1440-trial-offers');
 const offer=customer.locator('div').filter({has:customer.getByRole('heading',{name:`Browser trial ${run}`,exact:true})}).filter({has:customer.getByRole('button',{name:'Start free trial',exact:true})}).last();
 await offer.getByRole('button',{name:'Start free trial',exact:true}).click();await customer.getByRole('dialog').getByRole('button',{name:'Start free trial',exact:true}).click();await customer.getByRole('dialog').waitFor({state:'hidden'});await customer.getByText('Trial active',{exact:true}).waitFor();
 await shot(customer,'new-en-1440-trial-active');
 await customer.getByRole('button',{name:'Invitations',exact:true}).click();await customer.locator('#team-email').fill(email);await customer.getByRole('button',{name:'Send invitation',exact:true}).click();await customer.getByRole('cell',{name:email,exact:true}).waitFor();
 await customer.locator('#team-email').fill(`full-${email}`);await customer.getByRole('button',{name:'Send invitation',exact:true}).click();await customer.getByRole('alert').filter({hasText:'team limit is reached'}).waitFor();
 await db.businessSubscription.update({where:{businessId:business.id},data:{trialStartedAt:new Date(Date.now()-172800000),trialEndsAt:new Date(Date.now()-86400000)}});
 await customer.getByRole('button',{name:'Subscription',exact:true}).click();await customer.getByText('Trial expired',{exact:true}).waitFor();assert.equal(await customer.getByRole('button',{name:'Start free trial',exact:true}).count(),0);await shot(customer,'new-en-1440-trial-expired');
 for(const lang of ['en','ar'])for(const width of [320,390,768,1440]){
  await customer.setViewportSize({width,height:width<768?844:1000});await customer.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await customer.goto(`${settings.appOrigin}/business-v2`);await customer.getByRole('button',{name:lang==='ar'?'الاشتراك':'Subscription',exact:true}).click();await customer.getByText(lang==='ar'?'انتهت التجربة':'Trial expired',{exact:true}).waitFor();await shot(customer,`new-${lang}-${width}-subscription`);
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>localStorage.setItem('profitlens_lang','ar'));await page.goto(`${settings.appOrigin}/platform-v2`);await page.getByRole('button',{name:'خطط الاشتراك',exact:true}).click();await page.getByRole('button',{name:'إضافة خطة',exact:true}).click();await shot(page,'new-ar-390-plan-form');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='إضافة خطة');
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: plan creation/publication, owner trial activation, invite seat limit, expiry/no restart, AR/EN responsive layouts and dialog focus.');
}finally{
 await browser.close();const created=await db.billingPlan.findUnique({where:{code}});if(created&&!plans.includes(created.id))plans.push(created.id);
 for(const mail of await db.authMail.findMany()){try{if(JSON.parse(decrypt(settings.key,mail.payload,`mail:${mail.id}`)).to.includes(run))await db.authMail.delete({where:{id:mail.id}});}catch{/*Unrelated mail.*/}}
 await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.deleteMany({where:{id:{in:plans}}});await db.$disconnect();
}
