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
import { postStock } from '../src/operations/inventory.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4000,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/transfer-design';await mkdir(artifacts,{recursive:true});
let planId:string|undefined,primaryPage:Page|undefined;
async function shot(page:Page,name:string){
 await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);
 for(const dialog of await page.getByRole('dialog').all())assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} dialog overflow`);
 await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});
}
async function actor(role:'OWNER'|'WAREHOUSE_STAFF',businessId:string,locationId?:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Operations Owner':locationId?'Location Employee':'Viewer',email:`${id}@example.test`,passwordHash:await passwordHash('Browser transfer password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 const member=await db.membership.create({data:{userId:id,businessId,role}});
 if(locationId)await db.locationAssignment.create({data:{businessId,locationId,membershipId:member.id}});
 const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return {page,user};
}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name:lang==='ar'?'تحويلات المخزون':'Stock transfers',exact:true}).click();await page.getByRole('table').waitFor();}
async function choose(page:Page,label:string,name:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function detail(page:Page,reference:string,lang='en'){await open(page,lang);await page.getByRole('row').filter({hasText:reference}).getByRole('button',{name:lang==='ar'?'فتح المستند':'Open document',exact:true}).click();await page.getByRole('table').waitFor();}
async function action(page:Page,label:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function record(page:Page,label:string,quantity:string,reason=''){
 await page.getByRole('button',{name:label,exact:true}).click();await page.getByLabel('Quantity',{exact:true}).fill(quantity);
 if(reason)await page.getByLabel('Notes / reason',{exact:true}).fill(reason);
 await page.getByRole('button',{name:'Review quantities',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('table').waitFor();
}
try{
 const business=await db.business.create({data:{name:'Transfer Browser Market'}});bids.push(business.id);
 planId=(await db.billingPlan.create({data:{code:`browser-transfer-${randomUUID()}`,name:'Transfer browser',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:10,maxShops:10}})).id;
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const source=await db.location.create({data:{businessId:business.id,code:'MAIN',name:'Main warehouse',kind:'WAREHOUSE'}}),destination=await db.location.create({data:{businessId:business.id,code:'SHOP',name:'Downtown shop',kind:'SHOP'}});
 const product=await db.product.create({data:{businessId:business.id,sku:'MILK-001',name:'Fresh milk 1 litre',unit:'LITRE',purchasePrice:'9.8765',sellingPrice:'12'}});
 await db.productBarcode.create({data:{businessId:business.id,productId:product.id,value:'001234567890'}});
 const owner=await actor('OWNER',business.id),page=owner.page,sourcePage=(await actor('WAREHOUSE_STAFF',business.id,source.id)).page,destinationPage=(await actor('WAREHOUSE_STAFF',business.id,destination.id)).page;
 primaryPage=page;
 await auth.transaction(tx=>postStock(tx,{businessId:business.id,locationId:source.id,productId:product.id,delta:'100',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'test opening',actorId:owner.user.id,notes:''}));
 await open(page);await shot(page,'new-en-empty');await page.getByRole('button',{name:'New transfer',exact:true}).click();await choose(page,'Choose source location','Main warehouse');await choose(page,'Choose destination location','Downtown shop');
 const scan=page.getByLabel('Scan or enter a barcode',{exact:true});await scan.fill('UNKNOWN');await scan.press('Enter');await page.getByRole('alert').waitFor();await scan.fill('001234567890');await scan.press('Enter');await page.waitForFunction(()=>document.activeElement?.id==='transfer-quantity-0');await page.getByLabel('Quantity',{exact:true}).fill('10');
 await shot(page,'new-en-editor');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Stock transfers · Draft',exact:true}).waitFor();
 const doc=await db.stockTransfer.findFirstOrThrow({where:{businessId:business.id}});
 assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id,locationId:source.id}})).onHand.toFixed(4),'100.0000');
 await detail(destinationPage,doc.reference);assert.equal(await destinationPage.getByRole('button',{name:'Dispatch goods',exact:true}).count(),0);
 await detail(sourcePage,doc.reference);assert.equal(await sourcePage.getByRole('button',{name:'Edit transfer draft',exact:true}).count(),0);
 await action(sourcePage,'Dispatch goods');await sourcePage.getByRole('heading',{name:'Stock transfers · In transit',exact:true}).waitFor();assert.equal(await sourcePage.getByRole('button',{name:'Record arrival',exact:true}).count(),0);
 assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id,locationId:source.id}})).onHand.toFixed(4),'90.0000');assert.equal(await db.stockBalance.count({where:{businessId:business.id,locationId:destination.id}}),0);
 await detail(destinationPage,doc.reference);assert.equal(await destinationPage.getByRole('button',{name:'Record loss',exact:true}).count(),0);assert(!(await destinationPage.content()).includes('9.8765'));
 await destinationPage.getByRole('button',{name:'Record arrival',exact:true}).click();await destinationPage.getByLabel('Quantity',{exact:true}).fill('11');await destinationPage.getByRole('button',{name:'Review quantities',exact:true}).click();await destinationPage.getByRole('alert').waitFor();assert.equal(await db.transferEvent.count({where:{transferId:doc.id}}),0);
 await destinationPage.getByLabel('Quantity',{exact:true}).fill('4');
 for(const lang of ['en','ar'])for(const width of [320,390,1440]){
  if(await destinationPage.evaluate(()=>document.documentElement.lang)!==lang)await destinationPage.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  await destinationPage.setViewportSize({width,height:width<768?844:1100});
  await shot(destinationPage,`new-${lang}-${width}-arrival-form`);
  await destinationPage.getByRole('button',{name:lang==='ar'?'مراجعة الكميات':'Review quantities',exact:true}).click();await shot(destinationPage,`new-${lang}-${width}-arrival-review`);
  await destinationPage.keyboard.press('Escape');await destinationPage.getByRole('dialog').waitFor({state:'hidden'});
  await destinationPage.waitForFunction(label=>document.activeElement?.textContent?.trim()===label,lang==='ar'?'مراجعة الكميات':'Review quantities',{timeout:3000});
 }
 await destinationPage.getByRole('button',{name:'English',exact:true}).click();await destinationPage.setViewportSize({width:1440,height:1100});
 await destinationPage.getByRole('button',{name:'Review quantities',exact:true}).click();await shot(destinationPage,'new-en-arrival-review');await destinationPage.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await destinationPage.getByRole('heading',{name:'Stock transfers · Partially completed',exact:true}).waitFor();
 await detail(page,doc.reference);await record(page,'Record return to source','2','Two units returned with the driver');await record(page,'Record loss','1','One bottle broken in transit; checked with driver');
 await detail(destinationPage,doc.reference);await record(destinationPage,'Record arrival','3');await destinationPage.getByRole('heading',{name:'Stock transfers · Closed',exact:true}).waitFor();
 assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id,locationId:source.id}})).onHand.toFixed(4),'92.0000');
 assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id,locationId:destination.id}})).onHand.toFixed(4),'7.0000');
 assert.equal((await db.transferLine.findFirstOrThrow({where:{transferId:doc.id}})).lost.toFixed(4),'1.0000');
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){
  await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
  await open(page,lang);await shot(page,`new-${lang}-${width}-list`);await page.getByRole('button',{name:lang==='ar'?'فتح المستند':'Open document',exact:true}).click();await page.getByRole('table').waitFor();await page.getByRole('heading',{name:lang==='ar'?'سجل الوصول والفروقات':'Arrival & discrepancy history',exact:true}).waitFor();await page.getByText('One bottle broken in transit; checked with driver',{exact:true}).waitFor();await shot(page,`new-${lang}-${width}-history`);
  await open(page,lang);await page.getByRole('button',{name:lang==='ar'?'تحويل جديد':'New transfer',exact:true}).click();await choose(page,lang==='ar'?'اختيار موقع الإرسال':'Choose source location','Main warehouse');await choose(page,lang==='ar'?'اختيار موقع الاستلام':'Choose destination location','Downtown shop');
  const localScan=page.getByLabel(lang==='ar'?'امسح الباركود أو أدخله':'Scan or enter a barcode',{exact:true});await localScan.fill('001234567890');await localScan.press('Enter');await page.getByLabel(lang==='ar'?'الكمية':'Quantity',{exact:true}).waitFor();await shot(page,`new-${lang}-${width}-editor`);
 }
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: transfer draft, source-only dispatch, destination-only partial arrival, over-receive error, manager return/loss, conservation, AR/EN 320/390/768/1024/1440.');
}catch(error){if(primaryPage)await primaryPage.screenshot({path:`${artifacts}/failure.png`,fullPage:true});throw error;}
finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');
  await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines DISABLE TRIGGER transfer_event_lines_immutable');await tx.transferEventLine.deleteMany({where:{businessId:{in:bids}}});await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines ENABLE TRIGGER transfer_event_lines_immutable');
  await tx.$executeRawUnsafe('ALTER TABLE transfer_events DISABLE TRIGGER transfer_events_immutable');await tx.transferEvent.deleteMany({where:{businessId:{in:bids}}});await tx.$executeRawUnsafe('ALTER TABLE transfer_events ENABLE TRIGGER transfer_events_immutable');
 });
 await db.transferLine.deleteMany({where:{businessId:{in:bids}}});await db.stockTransfer.deleteMany({where:{businessId:{in:bids}}});await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
