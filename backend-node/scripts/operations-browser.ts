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
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/operations-design';await mkdir(artifacts,{recursive:true});
let planId:string|undefined;
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
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function section(page:Page,name:string){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('button',{name,exact:true}).click();}
async function choose(page:Page,label:string,name:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function action(page:Page,label:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
try{
 const business=await db.business.create({data:{name:'Receiving Browser Market'}});bids.push(business.id);
 planId=(await db.billingPlan.create({data:{code:`browser-ops-${randomUUID()}`,name:'Operations browser',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:10,maxShops:10}})).id;
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const location=await db.location.create({data:{businessId:business.id,code:'WH-01',name:'Main warehouse',kind:'WAREHOUSE'}});
 const product=await db.product.create({data:{businessId:business.id,sku:'MILK-001',name:'Fresh milk 1 litre',unit:'LITRE',purchasePrice:'1.2345',sellingPrice:'2.5000',minimumStock:'10'}});
 await db.productBarcode.create({data:{businessId:business.id,productId:product.id,value:'001234567890'}});
 const page=await actor('OWNER',business.id,location.id),staff=await actor('WAREHOUSE_STAFF',business.id,location.id);
 await section(page,'Suppliers');await page.getByRole('table').waitFor();await shot(page,'new-en-suppliers-empty');
 await page.getByRole('button',{name:'Add supplier',exact:true}).click();await page.getByLabel('Supplier code',{exact:true}).fill('SUP-001');await page.getByPlaceholder('e.g. Gulf Food Supplies').fill('Gulf Food Supplies');await page.getByLabel('Phone',{exact:true}).fill('+971 50 123 4567');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:'Gulf Food Supplies',exact:true}).waitFor();
 await section(page,'Purchasing & receiving');await page.getByRole('button',{name:'New receiving',exact:true}).click();
 await choose(page,'Choose location','Main warehouse');await choose(page,'Choose supplier','Gulf Food Supplies');
 const scan=page.getByLabel('Scan delivery barcode',{exact:true});
 await scan.fill('UNKNOWN');await scan.press('Enter');await page.getByRole('alert').waitFor();
 await scan.fill('001234567890');await scan.press('Enter');await page.getByLabel('Quantity',{exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement?.id==='line-quantity-0');await page.getByLabel('Quantity',{exact:true}).fill('5');
 await page.getByLabel('Scanning mode',{exact:true}).selectOption('repeat');
 for(let n=0;n<2;n++){await scan.fill('001234567890');await scan.press('Enter');}
 await page.waitForFunction(()=> (document.getElementById('line-quantity-0') as HTMLInputElement)?.value==='7.0000');
 assert(await scan.evaluate(el=>el===document.activeElement));
 await shot(page,'new-en-receipt-editor');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Receiving · Draft',exact:true}).waitFor();
 assert.equal(await db.stockMovement.count({where:{businessId:business.id}}),0);
 await action(page,'Send for confirmation');await page.getByRole('heading',{name:'Receiving · Awaiting confirmation',exact:true}).waitFor();
 await section(staff,'Purchasing & receiving');await staff.getByRole('button',{name:'Open document',exact:true}).click();await staff.getByRole('table').waitFor();assert.equal(await staff.getByRole('button',{name:'Confirm receiving',exact:true}).count(),0);assert(!(await staff.content()).includes('1.2345'));assert.equal(await staff.getByRole('columnheader',{name:'Cost per base unit',exact:true}).count(),0);
 await action(page,'Confirm receiving');await page.getByRole('heading',{name:'Receiving · Completed',exact:true}).waitFor();
 assert.equal(await db.stockMovement.count({where:{businessId:business.id}}),1);
 assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id}})).onHand.toFixed(4),'7.0000');
 await shot(page,'new-en-completed-receipt');
 // Purchase order -> partial receipt, through real UI.
 await section(page,'Purchasing & receiving');await page.getByRole('button',{name:'New purchase order',exact:true}).click();await choose(page,'Choose location','Main warehouse');await choose(page,'Choose supplier','Gulf Food Supplies');
 await scan.fill('001234567890');await scan.press('Enter');await page.getByLabel('Quantity',{exact:true}).fill('10');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Purchase orders · Draft',exact:true}).waitFor();
 await action(page,'Open purchase order');await page.getByRole('button',{name:'Receive remaining items',exact:true}).click();await page.getByLabel('Quantity',{exact:true}).fill('4');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Receiving · Draft',exact:true}).waitFor();await action(page,'Send for confirmation');await action(page,'Confirm receiving');await page.getByRole('heading',{name:'Receiving · Completed',exact:true}).waitFor();
 assert.equal((await db.purchaseDocument.findFirstOrThrow({where:{businessId:business.id,kind:'ORDER'}})).status,'PARTIAL');
 for(const lang of ['en','ar'])for(const width of (process.env.BROWSER_QUICK==='1'?[320,390,1440]:[320,390,768,1024,1440])){
  await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
  await section(page,lang==='ar'?'المخزون':'Inventory');await choose(page,lang==='ar'?'اختيار الموقع':'Choose location','Main warehouse');await page.getByRole('table').waitFor();await shot(page,`new-${lang}-${width}-stock`);
  await page.getByLabel(lang==='ar'?'المخزون':'Inventory',{exact:true}).selectOption('movements');await page.getByRole('table').waitFor();await shot(page,`new-${lang}-${width}-movements`);
  await section(page,lang==='ar'?'الشراء والاستلام':'Purchasing & receiving');await page.getByRole('table').waitFor();await shot(page,`new-${lang}-${width}-documents`);
  await page.getByRole('button',{name:lang==='ar'?'فتح المستند':'Open document',exact:true}).first().click();await page.getByRole('table').waitFor();await shot(page,`new-${lang}-${width}-receipt`);
  await section(page,lang==='ar'?'الموردون':'Suppliers');await page.getByRole('button',{name:lang==='ar'?'تعديل المورد':'Edit supplier',exact:true}).click();await page.getByRole('dialog').waitFor();await shot(page,`new-${lang}-${width}-supplier-form`);await page.keyboard.press('Escape');
  await section(page,lang==='ar'?'الشراء والاستلام':'Purchasing & receiving');await page.getByRole('button',{name:lang==='ar'?'استلام جديد':'New receiving',exact:true}).click();
  await choose(page,lang==='ar'?'اختيار الموقع':'Choose location','Main warehouse');await choose(page,lang==='ar'?'اختيار المورد':'Choose supplier','Gulf Food Supplies');
  const localScan=page.getByLabel(lang==='ar'?'مسح باركود البضاعة':'Scan delivery barcode',{exact:true});await localScan.fill('001234567890');await localScan.press('Enter');await page.getByLabel(lang==='ar'?'الكمية':'Quantity',{exact:true}).waitFor();await shot(page,`new-${lang}-${width}-editor`);
 }
 assert.equal(errors.length,0,errors.join('; '));console.log(`PASS: supplier create, both scanner modes, staff cost privacy, draft/pending no stock, confirmed receipt, partial PO, AR/EN widths ${process.env.BROWSER_QUICK==='1'?'320/390/1440':'320/390/768/1024/1440'}.`);
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await db.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE stock_movements DISABLE TRIGGER stock_history_immutable');await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});await tx.$executeRawUnsafe('ALTER TABLE stock_movements ENABLE TRIGGER stock_history_immutable');});
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.purchaseLine.deleteMany({where:{businessId:{in:bids}}});await db.purchaseDocument.deleteMany({where:{businessId:{in:bids},kind:'RECEIPT'}});await db.purchaseDocument.deleteMany({where:{businessId:{in:bids}}});
 await db.supplier.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
