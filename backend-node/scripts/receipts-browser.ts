import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
const settings=readAuthSettings(process.env),url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const db=createDatabase(url),auth=new AuthService(db,settings),browser=await chromium.launch({channel:'chrome',headless:true});
const ids:string[]=[],bids:string[]=[],errors:string[]=[],scope=randomBytes(32).toString('hex'),plan='8ac8ae27-f871-47f2-8d70-e38b0aed295c';
const artifacts=process.env.RECEIPT_SCREENSHOTS||'../tmp/receipt-design';await mkdir(artifacts,{recursive:true});
async function pageFor(id:string){const context=await browser.newContext({viewport:{width:1440,height:1100}});const user=await db.authUser.findUniqueOrThrow({where:{id}}),session=await auth.transaction(tx=>auth.makeSession(tx,user,true));await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;}
async function shot(page:Page,name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:lang==='ar'?'الاشتراك':'Subscription',exact:true}).click();await page.getByRole('heading',{name:lang==='ar'?'إيصالات الدفع':'Payment receipts',exact:true}).waitFor();}
try{
 const ownerId=randomUUID();ids.push(ownerId);await db.authUser.create({data:{id:ownerId,name:'Receipt Test Owner',email:`${ownerId}@example.test`,passwordHash:await passwordHash('Receipt browser password 154!'),emailVerifiedAt:new Date(),mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${ownerId}`)}});
 const first=await db.business.create({data:{name:'Alpha Receipt Market',timezone:'Asia/Dubai'}}),second=await db.business.create({data:{name:'Beta Receipt Market'}});bids.push(first.id,second.id);
 await db.membership.createMany({data:bids.map(businessId=>({businessId,userId:ownerId,role:'OWNER' as const}))});
 await db.businessSubscription.create({data:{businessId:first.id,planId:plan,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const page=await pageFor(ownerId);await open(page);await page.getByText('No payments received yet.',{exact:true}).waitFor();await shot(page,'new-en-1440-empty');
 // Presentation fixtures only. Provider verification/receipt insertion is tested
 // separately against a fake provider plus real DB in tests/paypal.test.ts.
 const checkout=await db.billingCheckout.create({data:{businessId:first.id,planId:plan,scope,providerPlanId:`P-${'A'.repeat(24)}`,providerSubscriptionId:'I-RECEIPTFIXTURE',providerStatus:'ACTIVE'}});
 await db.billingReceipt.createMany({data:Array.from({length:26},(_,i)=>({checkoutId:checkout.id,scope,transactionId:`TESTPAYMENT-${String(i).padStart(3,'0')}`,eventId:`TESTEVENT-${i}`,amountMinor:2999,currency:'USD',paidAt:new Date(Date.UTC(2026,10,11,12,0)-i*60000)}))});
 await open(page);const table=page.getByRole('table');await table.getByRole('cell',{name:'TES…000',exact:true}).waitFor();assert.equal(await table.locator('tbody tr').count(),25);await shot(page,'new-en-1440-receipts');
 assert(!(await page.content()).includes('TESTPAYMENT-000'));
 await page.getByRole('button',{name:'Next',exact:true}).click();await table.getByRole('cell',{name:'TES…025',exact:true}).waitFor();assert.equal(await table.locator('tbody tr').count(),1);
 await page.locator('#active-business').selectOption(second.id);await page.getByRole('button',{name:'Subscription',exact:true}).click();await page.getByText('No payments received yet.',{exact:true}).waitFor();assert.equal(await page.getByText('TES…025',{exact:true}).count(),0);
 const pattern='http://localhost:4000/api/billing/businesses/*/payments*';await page.route(pattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"failed"}}'}));
 await open(page);await page.getByRole('alert').waitFor();await shot(page,'new-en-1440-error');await page.unroute(pattern);await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('cell',{name:'TES…000',exact:true}).waitFor();
 for(const lang of ['en','ar'])for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await open(page,lang);await page.getByRole('cell',{name:'TES…000',exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');await shot(page,`new-${lang}-${width}-receipts`);
 }
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: real owner receipt API, empty/error/retry states, pagination, business switching, masked references and AR/EN responsive layouts.');
}finally{await browser.close();await db.billingReceipt.deleteMany({where:{scope}});await db.billingCheckout.deleteMany({where:{scope}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();}
